import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireProducao, producaoErro } from "@/lib/producao-auth";
import {
  calcularEnfesto,
  preverPecas,
  custoPorPeca,
  experienciasDe,
  type ItemCusto,
} from "@/lib/producao";

/**
 * Ciclo de vida do corte:
 *  • producao  → registra o que já foi cortado; se sobrou peso, vira PARCIAL
 *    e o motor gera a PROJEÇÃO do restante (histórico + taxa do próprio corte)
 *  • fechar    → produção do restante; total real × previsto = erro, que
 *    alimenta o aprendizado das próximas projeções
 *  • ocorrencia→ furo/mancha/rasgo... o material vira SOBRA reaproveitável
 *  • sobra     → registrar ponta/retalho manualmente
 *  • custos    → itens extras por peça (mão de obra, linha...) → custo final
 *  • editar    → dados gerais
 */

const acaoSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("producao"),
    usedKg: z.number().positive().max(10000),
    pieces: z.number().int().nonnegative().max(1000000),
  }),
  z.object({
    action: z.literal("fechar"),
    pieces: z.number().int().nonnegative().max(1000000),
  }),
  z.object({
    action: z.literal("ocorrencia"),
    type: z.string().min(1).max(60),
    description: z.string().max(500).nullable().optional(),
    lostKg: z.number().nonnegative().max(10000).default(0),
    lostM: z.number().nonnegative().max(100000).default(0),
  }),
  z.object({
    action: z.literal("sobra"),
    weightKg: z.number().positive().max(10000),
    geometry: z.enum(["FAIXA", "RETANGULO", "IRREGULAR", "RETALHOS"]).nullable().optional(),
    quality: z.enum(["BOA", "REGULAR", "RUIM"]).nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
  }),
  z.object({
    action: z.literal("custos"),
    items: z
      .array(z.object({ name: z.string().min(1).max(60), value: z.number().nonnegative().max(100000) }))
      .max(30),
  }),
  z.object({
    action: z.literal("editar"),
    operator: z.string().max(80).nullable().optional(),
    tableName: z.string().max(80).nullable().optional(),
    tableLengthM: z.number().positive().max(100).nullable().optional(),
    planName: z.string().max(120).nullable().optional(),
    productName: z.string().max(120).nullable().optional(),
    gradeInfo: z.string().max(120).nullable().optional(),
    notes: z.string().max(1000).nullable().optional(),
  }),
]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireProducao();
    const { id } = await params;
    const parsed = acaoSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const cut = await db.cutTicket.findFirst({
      where: { id, companyId: user.companyId },
      include: { roll: { include: { fabric: true } }, occurrences: true },
    });
    if (!cut) {
      return NextResponse.json({ error: "Corte não encontrado" }, { status: 404 });
    }
    const a = parsed.data;

    // contexto do corte pro motor de previsão
    const ctx = {
      fabricId: cut.roll?.fabric.id ?? null,
      fabricType: cut.roll?.fabric.type ?? null,
      supplier: cut.roll?.fabric.supplier ?? null,
      grammage: cut.roll?.fabric.grammage ?? null,
      color: cut.roll?.color ?? null,
      productName: cut.productName,
      gradeInfo: cut.gradeInfo,
      tableName: cut.tableName,
      operator: cut.operator,
    };

    if (a.action === "producao") {
      if (cut.status === "FECHADO") {
        return NextResponse.json({ error: "Corte já fechado" }, { status: 409 });
      }
      if (a.usedKg > cut.plannedKg + 0.001) {
        return NextResponse.json(
          { error: `O corte tem ${cut.plannedKg} kg destinados — informe até esse peso` },
          { status: 409 }
        );
      }
      const enfesto = calcularEnfesto({
        usedKg: a.usedKg,
        yieldMPerKg: cut.roll?.fabric.yieldMPerKg ?? 0,
        tableLengthM: cut.tableLengthM,
      });
      const restante = Math.round((cut.plannedKg - a.usedKg) * 1000) / 1000;

      if (restante > 0.01) {
        // PARCIAL: projeta o restante — histórico da loja + taxa deste corte
        const fechados = await db.cutTicket.findMany({
          where: { companyId: user.companyId, status: "FECHADO", id: { not: cut.id } },
          include: { roll: { include: { fabric: true } } },
          orderBy: { finalizedAt: "desc" },
          take: 500,
        });
        const proj = preverPecas(
          experienciasDe(fechados),
          ctx,
          restante,
          a.pieces > 0 && a.usedKg > 0 ? a.pieces / a.usedKg : null
        );
        const updated = await db.cutTicket.update({
          where: { id: cut.id },
          data: {
            status: "PARCIAL",
            usedKg: a.usedKg,
            piecesFirst: a.pieces,
            lengthM: enfesto.lengthM,
            sheets: enfesto.sheets,
            predictedTotal: proj ? a.pieces + proj.pecas : null,
            predictedMin: proj ? a.pieces + proj.min : null,
            predictedMax: proj ? a.pieces + proj.max : null,
            predictedBasis: proj?.base ?? 0,
          },
        });
        return NextResponse.json(updated);
      }

      // usou tudo: fecha direto
      const fechado = await fechaCorte(user.companyId, cut.id, {
        usedKg: cut.plannedKg,
        piecesFirst: a.pieces,
        piecesRest: null,
        piecesTotal: a.pieces,
        lengthM: enfesto.lengthM,
        sheets: enfesto.sheets,
      });
      return NextResponse.json(fechado);
    }

    if (a.action === "fechar") {
      if (cut.status !== "PARCIAL") {
        return NextResponse.json(
          { error: "Registre primeiro a produção da parte cortada" },
          { status: 409 }
        );
      }
      const total = (cut.piecesFirst ?? 0) + a.pieces;
      const fechado = await fechaCorte(user.companyId, cut.id, {
        usedKg: cut.plannedKg,
        piecesFirst: cut.piecesFirst,
        piecesRest: a.pieces,
        piecesTotal: total,
        lengthM: calcularEnfesto({
          usedKg: cut.plannedKg,
          yieldMPerKg: cut.roll?.fabric.yieldMPerKg ?? 0,
          tableLengthM: cut.tableLengthM,
        }).lengthM,
        sheets: cut.sheets,
      });
      return NextResponse.json(fechado);
    }

    if (a.action === "ocorrencia") {
      const occ = await db.cutOccurrence.create({
        data: {
          cutId: cut.id,
          type: a.type,
          description: a.description ?? null,
          lostKg: a.lostKg,
          lostM: a.lostM,
        },
      });
      // o material da ocorrência NÃO é perda: vira sobra reaproveitável
      if (a.lostKg > 0) {
        await criaSobra(user.companyId, cut, a.lostKg, {
          notes: `Ocorrência: ${a.type}${a.description ? ` — ${a.description}` : ""}`,
        });
      }
      return NextResponse.json(occ, { status: 201 });
    }

    if (a.action === "sobra") {
      const sobra = await criaSobra(user.companyId, cut, a.weightKg, {
        geometry: a.geometry ?? null,
        quality: a.quality ?? null,
        notes: a.notes ?? null,
      });
      return NextResponse.json(sobra, { status: 201 });
    }

    if (a.action === "custos") {
      const pieces = cut.piecesTotal ?? 0;
      const custo = pieces > 0
        ? custoPorPeca({ fabricCost: cut.fabricCost, pieces, extras: a.items })
        : null;
      const updated = await db.cutTicket.update({
        where: { id: cut.id },
        data: {
          costItems: JSON.stringify(a.items),
          ...(custo ? { costPerPiece: custo.total } : {}),
        },
      });
      return NextResponse.json(updated);
    }

    // editar
    const { action: _a, ...campos } = a;
    void _a;
    const updated = await db.cutTicket.update({
      where: { id: cut.id },
      data: campos,
    });
    return NextResponse.json(updated);
  } catch (e) {
    return producaoErro(e);
  }
}

/** Fecha o corte: custo do tecido + custos extras (padrão das Configurações
 *  quando o corte não tem os próprios) e erro da projeção pro aprendizado. */
async function fechaCorte(
  companyId: string,
  cutId: string,
  dados: {
    usedKg: number;
    piecesFirst: number | null;
    piecesRest: number | null;
    piecesTotal: number;
    lengthM: number | null;
    sheets: number | null;
  }
) {
  const cut = await db.cutTicket.findUniqueOrThrow({
    where: { id: cutId },
    include: { roll: true },
  });
  const fabricCost =
    Math.round(dados.usedKg * (cut.roll?.pricePerKg ?? 0) * 100) / 100;

  let extras: ItemCusto[] = [];
  try {
    extras = JSON.parse(cut.costItems) as ItemCusto[];
  } catch {}
  if (extras.length === 0) {
    const settings = await db.productionSettings.findUnique({ where: { companyId } });
    try {
      extras = settings ? (JSON.parse(settings.costItems) as ItemCusto[]) : [];
    } catch {}
  }
  const custo = custoPorPeca({ fabricCost, pieces: dados.piecesTotal, extras });

  return db.cutTicket.update({
    where: { id: cutId },
    data: {
      status: "FECHADO",
      finalizedAt: new Date(),
      usedKg: dados.usedKg,
      piecesFirst: dados.piecesFirst,
      piecesRest: dados.piecesRest,
      piecesTotal: dados.piecesTotal,
      lengthM: dados.lengthM,
      sheets: dados.sheets,
      fabricCost,
      costItems: JSON.stringify(extras),
      costPerPiece: custo?.total ?? null,
      // erro = real − previsto (só quando houve projeção): treino do motor
      errorPieces:
        cut.predictedTotal != null ? dados.piecesTotal - cut.predictedTotal : null,
    },
  });
}

/** Sobra ligada ao corte, com a ficha do tecido copiada (a sobra sobrevive
 *  mesmo se o rolo/tecido for apagado depois). */
async function criaSobra(
  companyId: string,
  cut: {
    id: string;
    roll: {
      color: string;
      pricePerKg: number;
      fabric: { name: string; grammage: number | null; widthM: number; yieldMPerKg: number };
    } | null;
  },
  weightKg: number,
  extra: { geometry?: string | null; quality?: string | null; notes?: string | null }
) {
  const f = cut.roll?.fabric;
  return db.fabricScrap.create({
    data: {
      companyId,
      cutId: cut.id,
      fabricName: f?.name ?? "Tecido",
      color: cut.roll?.color ?? null,
      grammage: f?.grammage ?? null,
      widthM: f?.widthM ?? null,
      weightKg,
      estimatedM: f ? Math.round(weightKg * f.yieldMPerKg * 100) / 100 : null,
      value: Math.round(weightKg * (cut.roll?.pricePerKg ?? 0) * 100) / 100,
      geometry: extra.geometry ?? null,
      quality: extra.quality ?? null,
      notes: extra.notes ?? null,
    },
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireProducao();
    const { id } = await params;
    const cut = await db.cutTicket.findFirst({
      where: { id, companyId: user.companyId },
    });
    if (!cut) {
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    }
    if (cut.status !== "ABERTO") {
      return NextResponse.json(
        { error: "Só cortes sem produção registrada podem ser apagados" },
        { status: 409 }
      );
    }
    await db.$transaction(async (tx) => {
      // devolve o peso reservado ao rolo
      if (cut.rollId) {
        await tx.fabricRoll.update({
          where: { id: cut.rollId },
          data: { remainingKg: { increment: cut.plannedKg } },
        });
      }
      await tx.cutTicket.delete({ where: { id: cut.id } });
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return producaoErro(e);
  }
}
