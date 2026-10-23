import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { dataDoDia, diaSP } from "@/lib/dia";
import { comPorteira, recusa } from "@/lib/calendario/porta";
import { DATA_DO_SISTEMA_POR_CHAVE, LIMITES, diaDaData, foraDaJanela, intervaloDaTela } from "@/lib/calendario/datas";

/**
 * DATAS DO CALENDÁRIO (RN-092). Dois jeitos de nascer uma linha:
 *  - `{ chaveSistema, ano }`: a ANOTAÇÃO de uma data do sistema naquele ano
 *    (é onde moram notas, tarefas e antecedência própria). Idempotente:
 *    devolve a que já existe (o único do banco é a segunda tranca);
 *  - `{ tipo, titulo, dia, ... }`: uma data criada pela loja — lançamento de
 *    coleção ou modelo, ou uma data comercial/de oportunidade dela.
 */
const anotar = z.object({
  chaveSistema: z.string().min(1).max(60),
  ano: z.number().int().min(2000).max(2100),
});
const nova = z.object({
  tipo: z.enum(["COMERCIAL", "OPORTUNIDADE", "LANCAMENTO"]),
  titulo: z.string().trim().min(1).max(LIMITES.titulo),
  dia: z.string(),
  antecedenciaDias: z.number().int().min(0).max(LIMITES.antecedenciaMax).nullable().optional(),
  notas: z.string().max(LIMITES.notas).optional(),
});

export async function POST(req: NextRequest) {
  return comPorteira(async (user) => {
    const corpo = await req.json().catch(() => null);

    const a = anotar.safeParse(corpo);
    if (a.success) {
      const sis = DATA_DO_SISTEMA_POR_CHAVE.get(a.data.chaveSistema);
      if (!sis) return recusa("Essa data não existe.");
      const { chaveSistema, ano } = a.data;
      const ev = await db.calendarioEvento.upsert({
        where: { companyId_chaveSistema_ano: { companyId: user.companyId, chaveSistema, ano } },
        create: {
          companyId: user.companyId,
          tipo: sis.tipo,
          titulo: sis.data.titulo,
          data: dataDoDia(diaDaData(sis.data, ano))!,
          chaveSistema,
          ano,
          criadoPorNome: user.name,
        },
        update: {},
        select: { id: true },
      });
      return NextResponse.json({ id: ev.id });
    }

    const n = nova.safeParse(corpo);
    if (!n.success) return recusa("Dados inválidos.");
    const data = dataDoDia(n.data.dia);
    if (!data) return recusa("Essa data não existe no calendário.");
    const hoje = diaSP(new Date());
    const fora = foraDaJanela(n.data.dia, hoje);
    if (fora) return recusa(fora);
    // o teto conta só as datas que a TELA mostra: as antigas não aparecem e
    // não teriam como ser apagadas (achado da revisão)
    const { de, ate } = intervaloDaTela(hoje);
    const total = await db.calendarioEvento.count({
      where: { companyId: user.companyId, chaveSistema: null, data: { gte: dataDoDia(de)!, lte: dataDoDia(ate)! } },
    });
    if (total >= LIMITES.datasDaLoja) {
      return recusa(`O calendário chegou ao limite de ${LIMITES.datasDaLoja} datas da loja nestes 12 meses. Apague as que não servem mais.`);
    }
    const ev = await db.calendarioEvento.create({
      data: {
        companyId: user.companyId,
        tipo: n.data.tipo,
        titulo: n.data.titulo,
        data,
        antecedenciaDias: n.data.antecedenciaDias ?? null,
        notas: n.data.notas?.trim() ?? "",
        criadoPorNome: user.name,
      },
      select: { id: true },
    });
    return NextResponse.json({ id: ev.id }, { status: 201 });
  });
}
