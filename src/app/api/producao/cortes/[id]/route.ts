import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireProducao, producaoErro } from "@/lib/producao-auth";
import {
  calcularEnfestoRolos,
  preverPecas,
  custoPorPeca,
  experienciasDe,
  resumoPesagem,
  roloDominante,
  type ItemCusto,
  type ItemProduzido,
} from "@/lib/producao";

/**
 * Ciclo de vida do corte MULTI-ROLO (várias cores no mesmo enfesto):
 *  • producao  → registra o que já foi cortado; se sobrou peso, vira PARCIAL
 *    e o motor gera a PROJEÇÃO do restante (histórico + taxa do próprio corte)
 *  • fechar    → produção do restante; total real × previsto = erro, que
 *    alimenta o aprendizado das próximas projeções
 *  • ocorrencia→ furo/mancha/rasgo... o material vira SOBRA reaproveitável
 *    (com a cor do rolo de origem)
 *  • sobra     → registrar ponta/retalho manualmente
 *  • custos    → itens extras por peça (mão de obra, linha...) → custo final
 *  • editar    → dados gerais
 */

const norm = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

// um corte pode produzir VÁRIOS modelos, em várias CORES e tamanhos
const itemProduzidoSchema = z.object({
  name: z.string().min(1).max(120),
  color: z.string().max(60).nullable().optional(),
  size: z.string().max(30).nullable().optional(),
  pieces: z.number().int().nonnegative().max(1000000),
  pieceWeightG: z.number().positive().max(100000).nullable().optional(),
});

const acaoSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("producao"),
    usedKg: z.number().positive().max(10000),
    pieces: z.number().int().nonnegative().max(1000000).optional(),
    items: z.array(itemProduzidoSchema).max(60).optional(),
    wasteKg: z.number().nonnegative().max(10000).optional(),
  }),
  z.object({
    action: z.literal("fechar"),
    pieces: z.number().int().nonnegative().max(1000000).optional(),
    items: z.array(itemProduzidoSchema).max(60).optional(),
    wasteKg: z.number().nonnegative().max(10000).optional(),
  }),
  z.object({
    action: z.literal("ocorrencia"),
    type: z.string().min(1).max(60),
    description: z.string().max(500).nullable().optional(),
    color: z.string().max(60).nullable().optional(), // rolo/cor de origem
    lostKg: z.number().nonnegative().max(10000).default(0),
    lostM: z.number().nonnegative().max(100000).default(0),
  }),
  z.object({
    action: z.literal("sobra"),
    weightKg: z.number().positive().max(10000),
    color: z.string().max(60).nullable().optional(),
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

type CutComRolos = NonNullable<
  Awaited<
    ReturnType<
      typeof db.cutTicket.findFirst<{
        include: { rolls: { include: { roll: { include: { fabric: true } } } } };
      }>
    >
  >
>;

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
      include: { rolls: { include: { roll: { include: { fabric: true } } } } },
    });
    if (!cut) {
      return NextResponse.json({ error: "Corte não encontrado" }, { status: 404 });
    }
    const a = parsed.data;

    // sobras consumidas como matéria-prima deste corte (genealogia)
    const sobrasUsadas = await db.fabricScrap.findMany({
      where: { usedInCutId: cut.id },
    });
    const dom = roloDominante(cut.rolls);
    const cores = [
      ...new Set([
        ...cut.rolls.map((r) => r.roll.color),
        ...sobrasUsadas.map((s) => s.color).filter((c): c is string => Boolean(c)),
      ]),
    ];
    // contexto do corte pro motor de previsão (tecido dominante; cor só
    // quando o corte inteiro é de uma cor)
    const ctx = {
      fabricId: dom?.roll.fabric.id ?? null,
      fabricType: dom?.roll.fabric.type ?? null,
      supplier: dom?.roll.fabric.supplier ?? null,
      grammage: dom?.roll.fabric.grammage ?? null,
      color: cores.length === 1 ? cores[0] : null,
      productName: cut.productName,
      gradeInfo: cut.gradeInfo,
      tableName: cut.tableName,
      operator: cut.operator,
      geometry: sobrasUsadas[0]?.geometry ?? null,
    };
    // enfesto proporcional: usa a proporção do peso pedido sobre o planejado
    const enfestoDe = (kg: number) =>
      calcularEnfestoRolos(
        cut.rolls.map((r) => ({
          kg: cut.plannedKg > 0 ? (r.plannedKg / cut.plannedKg) * kg : 0,
          yieldMPerKg: r.roll.fabric.yieldMPerKg,
        })),
        cut.tableLengthM
      );

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
      const itens = a.items ?? [];
      const totalPecas = itens.length
        ? itens.reduce((s, i) => s + i.pieces, 0)
        : (a.pieces ?? -1);
      if (totalPecas < 0) {
        return NextResponse.json(
          { error: "Informe as peças produzidas (total ou por modelo)" },
          { status: 400 }
        );
      }
      const enfesto = enfestoDe(a.usedKg);
      const restante = Math.round((cut.plannedKg - a.usedKg) * 1000) / 1000;
      if (itens.length) {
        await db.cutItem.createMany({
          data: itens.map((i) => ({
            cutId: cut.id,
            stage: "PRIMEIRA",
            name: i.name,
            color: i.color ?? (cores.length === 1 ? cores[0] : null),
            size: i.size ?? null,
            pieces: i.pieces,
            pieceWeightG: i.pieceWeightG ?? null,
          })),
        });
        await entraNaCostura(user.companyId, cut, itens, cores);
      }
      const pesagem = resumoPesagem(itens, a.usedKg);
      if (pesagem && pesagem.wasteKg > 0.005) {
        await registraDesperdicio(user.companyId, cut, pesagem.wasteKg);
      } else if (!pesagem && a.wasteKg && a.wasteKg > 0) {
        await registraAparas(user.companyId, cut, a.wasteKg);
      }

      if (restante > 0.01) {
        // PARCIAL: projeta o restante — histórico da loja + taxa deste corte
        const fechados = await db.cutTicket.findMany({
          where: { companyId: user.companyId, status: "FECHADO", id: { not: cut.id } },
          include: { rolls: { include: { roll: { include: { fabric: true } } } } },
          orderBy: { finalizedAt: "desc" },
          take: 500,
        });
        const proj = preverPecas(
          experienciasDe(fechados),
          ctx,
          restante,
          totalPecas > 0 && a.usedKg > 0 ? totalPecas / a.usedKg : null
        );
        const updated = await db.cutTicket.update({
          where: { id: cut.id },
          data: {
            status: "PARCIAL",
            usedKg: a.usedKg,
            piecesFirst: totalPecas,
            lengthM: enfesto.lengthM,
            sheets: enfesto.sheets,
            predictedTotal: proj ? totalPecas + proj.pecas : null,
            predictedMin: proj ? totalPecas + proj.min : null,
            predictedMax: proj ? totalPecas + proj.max : null,
            predictedBasis: proj?.base ?? 0,
            ...(pesagem
              ? {
                  piecesWeightKg: pesagem.pesoPecasKg,
                  utilizationPct: pesagem.utilizationPct,
                  wasteKg: pesagem.wasteKg,
                }
              : {}),
          },
        });
        return NextResponse.json(updated);
      }

      const fechado = await fechaCorte(user.companyId, cut, {
        usedKg: cut.plannedKg,
        piecesFirst: totalPecas,
        piecesRest: null,
        piecesTotal: totalPecas,
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
      const itensResto = a.items ?? [];
      const pecasResto = itensResto.length
        ? itensResto.reduce((s, i) => s + i.pieces, 0)
        : (a.pieces ?? -1);
      if (pecasResto < 0) {
        return NextResponse.json(
          { error: "Informe as peças produzidas com o restante" },
          { status: 400 }
        );
      }
      const restKg = Math.round((cut.plannedKg - cut.usedKg) * 1000) / 1000;
      if (itensResto.length) {
        await db.cutItem.createMany({
          data: itensResto.map((i) => ({
            cutId: cut.id,
            stage: "RESTO",
            name: i.name,
            color: i.color ?? (cores.length === 1 ? cores[0] : null),
            size: i.size ?? null,
            pieces: i.pieces,
            pieceWeightG: i.pieceWeightG ?? null,
          })),
        });
        await entraNaCostura(user.companyId, cut, itensResto, cores);
      }
      const pesagemResto = resumoPesagem(itensResto, restKg);
      if (pesagemResto && pesagemResto.wasteKg > 0.005) {
        await registraDesperdicio(user.companyId, cut, pesagemResto.wasteKg);
      } else if (!pesagemResto && a.wasteKg && a.wasteKg > 0) {
        await registraAparas(user.companyId, cut, a.wasteKg);
      }
      const total = (cut.piecesFirst ?? 0) + pecasResto;
      const fechado = await fechaCorte(user.companyId, cut, {
        usedKg: cut.plannedKg,
        piecesFirst: cut.piecesFirst,
        piecesRest: pecasResto,
        piecesTotal: total,
        lengthM: enfestoDe(cut.plannedKg).lengthM,
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
      if (a.lostKg > 0) {
        await criaSobra(user.companyId, cut, a.lostKg, {
          color: a.color ?? null,
          notes: `Ocorrência: ${a.type}${a.description ? ` — ${a.description}` : ""}`,
        });
      }
      return NextResponse.json(occ, { status: 201 });
    }

    if (a.action === "sobra") {
      const sobra = await criaSobra(user.companyId, cut, a.weightKg, {
        color: a.color ?? null,
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

/** Fecha o corte: custo do tecido = soma (kg de cada rolo × preço do rolo),
 *  custos extras e erro da projeção pro aprendizado. */
async function fechaCorte(
  companyId: string,
  cut: CutComRolos,
  dados: {
    usedKg: number;
    piecesFirst: number | null;
    piecesRest: number | null;
    piecesTotal: number;
    lengthM: number | null;
    sheets: number | null;
  }
) {
  // rolos + sobras consumidas (a sobra herda o custo do rolo original)
  const sobrasDoCorte = await db.fabricScrap.findMany({
    where: { usedInCutId: cut.id },
    select: { value: true },
  });
  const fabricCost =
    Math.round(
      (cut.rolls.reduce((a, r) => a + r.plannedKg * r.roll.pricePerKg, 0) +
        sobrasDoCorte.reduce((a, s) => a + s.value, 0)) *
        100
    ) / 100;

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

  const itensTodos = await db.cutItem.findMany({ where: { cutId: cut.id } });
  const pesagemTotal = resumoPesagem(
    itensTodos.map((i) => ({
      name: i.name,
      pieces: i.pieces,
      pieceWeightG: i.pieceWeightG,
    })),
    dados.usedKg
  );

  return db.cutTicket.update({
    where: { id: cut.id },
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
      ...(pesagemTotal
        ? {
            piecesWeightKg: pesagemTotal.pesoPecasKg,
            utilizationPct: pesagemTotal.utilizationPct,
            wasteKg: pesagemTotal.wasteKg,
          }
        : {}),
      errorPieces:
        cut.predictedTotal != null ? dados.piecesTotal - cut.predictedTotal : null,
    },
  });
}

/** Peças cortadas entram no ESTOQUE DE COSTURA com a cor da peça. */
async function entraNaCostura(
  companyId: string,
  cut: { id: string; code: number },
  itens: ItemProduzido[],
  coresDoCorte: string[]
) {
  const validos = itens.filter((i) => i.pieces > 0);
  if (validos.length === 0) return;
  await db.sewingItem.createMany({
    data: validos.map((i) => ({
      companyId,
      cutId: cut.id,
      cutCode: cut.code,
      productName: i.name,
      color: i.color ?? (coresDoCorte.length === 1 ? coresDoCorte[0] : null),
      size: i.size ?? null,
      cutPieces: i.pieces,
    })),
  });
}

/** Desperdício apurado pelo método da balança — entra direto como descarte. */
async function registraDesperdicio(companyId: string, cut: CutComRolos, wasteKg: number) {
  const sobra = await criaSobra(companyId, cut, wasteKg, {
    geometry: "RETALHOS",
    quality: "RUIM",
    notes: "Desperdício apurado por pesagem das peças (método da balança)",
  });
  return db.fabricScrap.update({
    where: { id: sobra.id },
    data: { status: "DESCARTADA" },
  });
}

/** Aparas pesadas na mão (quando não há pesagem por modelo). */
async function registraAparas(companyId: string, cut: CutComRolos, wasteKg: number) {
  const sobra = await criaSobra(companyId, cut, wasteKg, {
    geometry: "RETALHOS",
    quality: "RUIM",
    notes: "Aparas do corte (descartadas na mesa)",
  });
  return db.fabricScrap.update({
    where: { id: sobra.id },
    data: { status: "DESCARTADA" },
  });
}

/** Sobra ligada ao corte, com a ficha do tecido do rolo de ORIGEM (pela cor
 *  informada; sem cor, vale o rolo dominante do corte). */
async function criaSobra(
  companyId: string,
  cut: CutComRolos,
  weightKg: number,
  extra: {
    color?: string | null;
    geometry?: string | null;
    quality?: string | null;
    notes?: string | null;
  }
) {
  const origem =
    (extra.color
      ? cut.rolls.find((r) => norm(r.roll.color) === norm(extra.color))
      : null) ?? roloDominante(cut.rolls);
  const f = origem?.roll.fabric;
  return db.fabricScrap.create({
    data: {
      companyId,
      cutId: cut.id,
      fabricName: f?.name ?? "Tecido",
      color: extra.color ?? origem?.roll.color ?? null,
      grammage: f?.grammage ?? null,
      widthM: f?.widthM ?? null,
      weightKg,
      estimatedM: f ? Math.round(weightKg * f.yieldMPerKg * 100) / 100 : null,
      value: Math.round(weightKg * (origem?.roll.pricePerKg ?? 0) * 100) / 100,
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
      include: { rolls: true },
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
      // devolve o peso reservado a CADA rolo e libera as sobras usadas
      for (const r of cut.rolls) {
        await tx.fabricRoll.update({
          where: { id: r.rollId },
          data: { remainingKg: { increment: r.plannedKg } },
        });
      }
      await tx.fabricScrap.updateMany({
        where: { usedInCutId: cut.id },
        data: { status: "DISPONIVEL", usedInCutId: null },
      });
      await tx.cutTicket.delete({ where: { id: cut.id } });
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return producaoErro(e);
  }
}
