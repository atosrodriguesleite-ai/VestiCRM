import { NextRequest, NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp } from "@/lib/scope";
import { lerPeriodo } from "@/lib/periodo";
import {
  channelRanking,
  sellerRanking,
  campaignRanking,
  productStats,
  categoryStats,
  colorStats,
  sizeStats,
} from "@/lib/tracking/insights";

/**
 * Exportação CSV (abre no Excel; para PDF use imprimir → salvar como PDF).
 * ?relatorio=canais|vendedores|campanhas|produtos|categorias|cores|tamanhos
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!isManagerUp(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const tipo = req.nextUrl.searchParams.get("relatorio") ?? "canais";
    // mesma leitura da tela: atalho em dias OU o período escolhido a dedo —
    // a planilha tem que sair do MESMO recorte que está na tela
    const qs = req.nextUrl.searchParams;
    const filtro = lerPeriodo({
      dias: qs.get("dias") ?? undefined,
      de: qs.get("de") ?? undefined,
      ate: qs.get("ate") ?? undefined,
    });
    const period = filtro.period;
    // nome do arquivo conta o recorte: "…-30d.csv" ou "…-2026-07-01_2026-07-31.csv"
    const sufixo = filtro.personalizado
      ? [filtro.de ?? "inicio", filtro.ate ?? "hoje"].join("_")
      : `${filtro.dias}d`;
    const c = user.companyId;

    let headers: string[] = [];
    let rows: (string | number | null)[][] = [];

    switch (tipo) {
      case "canais": {
        const data = await channelRanking(c, period);
        headers = ["Canal", "Acessos", "Pedidos", "Conversão %", "Faturamento"];
        rows = data.map((r) => [r.channel, r.sessions, r.orders, r.conversion, r.revenue]);
        break;
      }
      case "vendedores": {
        const data = await sellerRanking(c, period);
        headers = ["Vendedor", "Cliques", "Pedidos", "Conversão %", "Vendas", "Faturamento", "Ticket médio", "Dias até venda"];
        rows = data.map((r) => [r.name, r.clicks, r.orders, r.conversion, r.salesCount, r.revenue, r.avgTicket, r.avgDaysToSale]);
        break;
      }
      case "campanhas": {
        const data = await campaignRanking(c, period);
        headers = ["Campanha", "Ref", "Canal", "Responsável", "Cliques", "Pedidos", "Conversão %", "Faturamento", "Meta", "% da meta"];
        rows = data.map((r) => [r.name, r.slug, r.channel, r.ownerName, r.clicks, r.orders, r.conversion, r.revenue, r.goal, r.roi]);
        break;
      }
      case "produtos":
      case "categorias":
      case "cores":
      case "tamanhos": {
        const fn = { produtos: productStats, categorias: categoryStats, cores: colorStats, tamanhos: sizeStats }[tipo]!;
        const data = await fn(c, period);
        headers = [tipo === "produtos" ? "Produto" : tipo === "categorias" ? "Categoria" : tipo === "cores" ? "Cor" : "Tamanho",
          "Visualizações", "Adicionados", "Removidos", "Vendidos", "Faturamento", "Conversão %", "Abandono %"];
        rows = data
          .sort((a, b) => b.revenue - a.revenue || b.views - a.views)
          .map((r) => [r.key, r.views, r.adds, r.removes, r.sold, r.revenue, r.conversion, r.abandonRate]);
        break;
      }
      default:
        return NextResponse.json({ error: "Relatório desconhecido" }, { status: 400 });
    }

    const esc = (v: string | number | null) => {
      if (v === null) return "";
      let s = String(v).replace(/"/g, '""');
      // neutraliza injeção de fórmula: célula começando com = + - @ é
      // executada pelo Excel/Sheets ao abrir — e o nome do produto (que vira
      // célula aqui) é texto digitado pela equipe (auditoria 07/08/2026)
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return /[";\n]/.test(s) ? `"${s}"` : s;
    };
    const csv =
      "﻿" + // BOM para acentos no Excel
      [headers, ...rows].map((r) => r.map(esc).join(";")).join("\n");

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="inteligencia-${tipo}-${sufixo}.csv"`,
      },
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
