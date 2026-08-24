import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/scope";
import { PLATFORM_SLUG } from "@/lib/platform";
import { canalDoLead, canalLeadLabel, instagramDoLead } from "@/lib/gestao";

/**
 * PLANILHA DOS LEADS DA PLATAFORMA (quem quer contratar o AtacadoPro).
 *
 * A tela mostra os mais recentes; aqui sai a base INTEIRA, com telefone,
 * e-mail, cidade, o canal de entrada, a loja que indicou e em que pé está a
 * negociação. É o que o dono usa para trabalhar a lista fora do sistema.
 *
 * Só Super Admin: são os leads comerciais da empresa-plataforma, nada a ver
 * com as clientes das lojas.
 *
 * Separador ; e BOM UTF-8 — padrão do Excel brasileiro.
 */

/**
 * Uma célula do CSV, segura para abrir no Excel.
 *
 * O nome e a cidade vêm do formulário PÚBLICO de demonstração: qualquer um na
 * internet escreve o que quiser ali. Célula que começa com = + - @ o Excel
 * trata como FÓRMULA e executa ao abrir a planilha — é assim que uma
 * "solicitação de demonstração" viraria um ataque no computador do dono.
 * O apóstrofo na frente faz o Excel tratar como texto.
 *
 * O \r também escapa: as linhas são juntadas com \r\n, e um \r solto no meio
 * de um campo partiria a linha no lugar errado.
 */
const esc = (v: unknown) => {
  const bruto = String(v ?? "");
  const seguro = /^[=+\-@\t\r]/.test(bruto) ? `'${bruto}` : bruto;
  const s = seguro.replace(/"/g, '""');
  return /[";\r\n]/.test(s) ? `"${s}"` : s;
};

const dataBR = (d: Date) =>
  d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

export async function GET() {
  try {
    const user = await requireUser();
    if (!isSuperAdmin(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }

    const plataforma = await db.company.findUnique({
      where: { slug: PLATFORM_SLUG },
      select: { id: true },
    });
    if (!plataforma) {
      return NextResponse.json({ error: "Plataforma não encontrada" }, { status: 404 });
    }

    const leads = await db.customer.findMany({
      where: { companyId: plataforma.id },
      orderBy: { createdAt: "desc" },
      select: {
        name: true,
        phone: true,
        email: true,
        city: true,
        state: true,
        notes: true,
        origin: true,
        landingSource: true,
        createdAt: true,
        opportunities: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { status: true, stage: { select: { name: true } } },
        },
      },
    });

    const header = [
      "Nome", "Telefone", "E-mail", "Instagram", "Cidade", "Estado",
      "Canal de entrada", "Loja que indicou", "Situação no funil", "Cadastro",
    ];
    const rows = leads.map((l) => [
      l.name,
      l.phone,
      l.email ?? "",
      instagramDoLead(l.notes) ?? "",
      l.city ?? "",
      l.state ?? "",
      canalLeadLabel[canalDoLead(l)],
      // a loja vem depois dos dois pontos ("catalogo:toque-leve")
      l.landingSource?.includes(":") ? (l.landingSource.split(":")[1] ?? "") : "",
      l.opportunities[0]?.stage.name ?? "",
      dataBR(l.createdAt),
    ]);

    const csv = "﻿" + [header, ...rows].map((r) => r.map(esc).join(";")).join("\r\n");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="leads-atacadopro-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
