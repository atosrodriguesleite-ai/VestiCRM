import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { conversationScope } from "@/lib/scope";

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

const dt = (d: Date) =>
  d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

export async function GET() {
  try {
    const user = await requireUser();
    const conversations = await db.conversation.findMany({
      where: conversationScope(user),
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
          c.customer.phone,
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
