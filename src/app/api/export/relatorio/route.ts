import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp } from "@/lib/scope";
import { PAID_ORDER_STATUSES } from "@/lib/orders";
import { originLabel } from "@/lib/format";
import { lerPeriodo, periodoPorExtenso, ultimosDiasSP } from "@/lib/periodo";

/**
 * "Me dá o mês fechado em planilha" — exporta o RESUMO dos Relatórios em CSV
 * (abre direto no Excel/Planilhas), no MESMO período que a tela mostra
 * (?de=&ate=; sem filtro, últimos 30 dias — o mesmo padrão da tela e das
 * demais telas de números). Mesma régua de acesso da tela:
 * Relatórios é visão geral da loja, vendedor comum não baixa.
 *
 * As contas são as MESMAS da tela (pedido PAGO, valor vendido `netTotal` sem
 * frete — RN-001/RN-002): se um dia divergirem, a planilha vira duas verdades.
 */

const esc = (v: unknown) => {
  let s = String(v ?? "").replace(/"/g, '""');
  // neutraliza injeção de fórmula: célula começando com = + - @ é executada
  // pelo Excel/Sheets ao abrir — mesma régua dos outros exports
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  // \r solto também força aspas: as linhas do arquivo são separadas por
  // \r\n, e um \r no meio do nome quebraria a linha da planilha
  return /[";\r\n]/.test(s) ? `"${s}"` : s;
};
const brlNum = (n: number) => n.toFixed(2).replace(".", ",");
const dataSP = (d: Date) =>
  d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!isManagerUp(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const de = req.nextUrl.searchParams.get("de") ?? undefined;
    const ate = req.nextUrl.searchParams.get("ate") ?? undefined;
    const filtro = lerPeriodo({ de, ate });
    // mesmo período da tela, da mesma régua (`ultimosDiasSP`): planilha que
    // abre num recorte e tela em outro seriam duas verdades
    const periodo = filtro.personalizado ? filtro.period : ultimosDiasSP(30);
    const rotulo = filtro.personalizado ? periodoPorExtenso(filtro) : "últimos 30 dias";
    const durMs = Math.max(periodo.to.getTime() - periodo.from.getTime(), 1);
    const anterior = {
      from: new Date(periodo.from.getTime() - durMs),
      to: new Date(periodo.from.getTime() - 1),
    };

    const paidScope = { companyId: user.companyId, status: { in: PAID_ORDER_STATUSES } };
    const [vendas, vendasAnteriores, vendedoras, clientes] = await Promise.all([
      db.order.findMany({
        where: { ...paidScope, paidAt: { gte: periodo.from, lte: periodo.to } },
        select: { netTotal: true, paidAt: true, sellerId: true },
      }),
      db.order.findMany({
        where: { ...paidScope, paidAt: { gte: anterior.from, lte: anterior.to } },
        select: { netTotal: true },
      }),
      db.user.findMany({
        where: { companyId: user.companyId },
        select: { id: true, name: true },
      }),
      db.customer.findMany({
        where: { companyId: user.companyId, createdAt: { gte: periodo.from, lte: periodo.to } },
        select: { origin: true },
      }),
    ]);

    const fat = vendas.reduce((s, v) => s + v.netTotal, 0);
    const fatAnterior = vendasAnteriores.reduce((s, v) => s + v.netTotal, 0);

    const linhas: string[][] = [];
    const linha = (...cols: unknown[]) => linhas.push(cols.map(esc));
    const vazio = () => linhas.push([]);

    // ---- Resumo ----
    linha("RESUMO DO PERÍODO", rotulo);
    linha("Faturamento (valor vendido, sem frete)", brlNum(fat));
    linha("Vendas (pedidos pagos)", vendas.length);
    linha("Ticket médio", brlNum(vendas.length ? fat / vendas.length : 0));
    linha("Novos leads", clientes.length);
    // filtro "tudo até X" começa na origem dos tempos: não existe período
    // anterior para comparar — a planilha não inventa um
    if (periodo.from.getTime() > 24 * 60 * 60 * 1000) {
      linha("Período anterior", `${dataSP(anterior.from)} a ${dataSP(anterior.to)}`);
      linha("Faturamento do período anterior", brlNum(fatAnterior));
      linha("Vendas do período anterior", vendasAnteriores.length);
    }
    vazio();

    // ---- Vendas por dia (fuso SP) ----
    const porDia = new Map<string, { pedidos: number; fat: number }>();
    for (const v of vendas) {
      if (!v.paidAt) continue;
      const dia = dataSP(v.paidAt);
      const cur = porDia.get(dia) ?? { pedidos: 0, fat: 0 };
      cur.pedidos += 1;
      cur.fat += v.netTotal;
      porDia.set(dia, cur);
    }
    linha("VENDAS POR DIA");
    linha("Dia", "Pedidos pagos", "Faturamento");
    // o Map preserva a ordem de inserção; ordenar pela data real evita
    // depender da ordem em que os pedidos vieram do banco
    const chaveDia = (d: string) => d.split("/").reverse().join("-");
    for (const [dia, t] of [...porDia.entries()].sort((a, b) =>
      chaveDia(a[0]).localeCompare(chaveDia(b[0]))
    )) {
      linha(dia, t.pedidos, brlNum(t.fat));
    }
    vazio();

    // ---- Vendas por vendedora (com a linha da loja) ----
    const nomeVendedora = new Map(vendedoras.map((v) => [v.id, v.name]));
    // agrupa por ID (duas "Maria Silva" são duas linhas, como na tela);
    // o nome é só o rótulo impresso
    const porVendedora = new Map<string, { nome: string; pedidos: number; fat: number }>();
    for (const v of vendas) {
      const id = v.sellerId ?? "loja";
      const nome = v.sellerId
        ? (nomeVendedora.get(v.sellerId) ?? "Vendedora removida")
        : "Loja (sem vendedora)";
      const cur = porVendedora.get(id) ?? { nome, pedidos: 0, fat: 0 };
      cur.pedidos += 1;
      cur.fat += v.netTotal;
      porVendedora.set(id, cur);
    }
    linha("VENDAS POR VENDEDORA");
    linha("Vendedora", "Pedidos pagos", "Faturamento");
    for (const t of [...porVendedora.values()].sort((a, b) => b.fat - a.fat)) {
      linha(t.nome, t.pedidos, brlNum(t.fat));
    }
    vazio();

    // ---- Leads por canal de origem ----
    const porCanal = new Map<string, number>();
    for (const c of clientes) {
      const nome = originLabel[c.origin];
      porCanal.set(nome, (porCanal.get(nome) ?? 0) + 1);
    }
    linha("LEADS POR CANAL (entraram no período)");
    linha("Canal", "Leads");
    for (const [nome, n] of [...porCanal.entries()].sort((a, b) => b[1] - a[1])) {
      linha(nome, n);
    }

    const csv =
      "﻿" + linhas.map((r) => r.join(";")).join("\r\n");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="relatorio-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
