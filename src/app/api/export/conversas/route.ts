import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { conversationScope } from "@/lib/scope";
import { formatPhone } from "@/lib/format";

/**
 * Backup das conversas em CSV (abre no Excel/Planilhas): uma linha por
 * mensagem, com o cliente, o setor, o atendente e o texto. É a cópia de
 * segurança do atendimento — fica no seu computador, independente do WhatsApp.
 * Separador ; e BOM UTF-8 (padrão do Excel brasileiro).
 */

const esc = (v: unknown) => {
  const s = String(v ?? "").replace(/"/g, '""');
  return /[";\n]/.test(s) ? `"${s}"` : s;
};

/**
 * Telefone à prova de Excel: formatado vira texto naturalmente; se ainda for
 * só dígitos (formato fora do padrão BR), sai como fórmula ="..." para o
 * Excel não converter em notação científica (5,53E+11).
 */
const phoneText = (p: string) => {
  const f = formatPhone(p);
  return /^\d{8,}$/.test(f) ? `="${f}"` : f;
};

const dt = (d: Date) =>
  d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

export async function GET() {
  try {
    const user = await requireUser();
    // BACKUP NÃO ACOMPANHA A VISÃO TOTAL DO CHAT (achado da revisão de
    // 17/08/2026): o interruptor abre a Central na TELA; baixar o histórico
    // da loja inteira para o computador é outro tamanho de porta (LGPD,
    // saída de funcionária). Vendedora exporta o escopo normal dela —
    // atendimentos próprios + fila — com ou sem o interruptor.
    const conversations = await db.conversation.findMany({
      where: conversationScope({ ...user, chatVisaoTotal: false }),
      include: {
        customer: { select: { name: true, phone: true } },
        setor: { select: { name: true } },
        assignee: { select: { name: true } },
        messages: {
          orderBy: { createdAt: "asc" },
          include: { author: { select: { name: true } } },
        },
      },
      orderBy: { lastMessageAt: "desc" },
    });

    const header = [
      "Data/hora", "Cliente", "Telefone", "Setor", "Atendente",
      "Direção", "Tipo", "Autor", "Mensagem",
    ];
    const rows: string[][] = [];
    for (const c of conversations) {
      for (const m of c.messages) {
        const direcao =
          m.kind === "NOTE"
            ? "Nota interna"
            : m.direction === "IN"
              ? "Cliente → Loja"
              : "Loja → Cliente";
        rows.push([
          dt(m.createdAt),
          c.customer.name,
          // formatado → o Excel trata como texto (número puro vira 5,53E+11)
          formatPhone(c.customer.phone),
          c.setor?.name ?? "",
          c.assignee?.name ?? "",
          direcao,
          m.mediaType === "TEXT" ? "Texto" : m.mediaType,
          m.author?.name ?? (m.direction === "IN" ? c.customer.name : ""),
          m.body,
        ]);
      }
    }

    const csv =
      "﻿" +
      [header, ...rows].map((r) => r.map(esc).join(";")).join("\r\n");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="conversas-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
