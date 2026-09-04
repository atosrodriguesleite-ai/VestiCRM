import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { AuthError } from "@/lib/auth";
import { porteiraFinanceiro } from "@/lib/financeiro/gate";
import {
  corpoDoFornecedor,
  fornecedorSchema,
} from "@/lib/financeiro/fornecedor";

/**
 * FORNECEDORES (RN-029) — o outro lado das contas a pagar. CNPJ **ou** CPF,
 * com dígitos conferidos ANTES de gravar (mesma régua da ficha de cliente:
 * documento errado só aparece lá na frente, com a compra já feita).
 */

export async function GET() {
  try {
    const porta = await porteiraFinanceiro();
    if (!porta.ok) return porta.resposta;
    const fornecedores = await db.fornecedor.findMany({
      where: { companyId: porta.user.companyId },
      orderBy: [{ arquivadoEm: "asc" }, { nome: "asc" }],
      include: { categoriaPadrao: { select: { id: true, nome: true, codigo: true } } },
    });
    return NextResponse.json({ fornecedores });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

export async function POST(req: NextRequest) {
  try {
    const porta = await porteiraFinanceiro();
    if (!porta.ok) return porta.resposta;
    const parsed = fornecedorSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    const corpo = await corpoDoFornecedor(porta.user.companyId, parsed.data);
    if ("erro" in corpo)
      return NextResponse.json({ error: corpo.erro }, { status: 400 });
    const fornecedor = await db.fornecedor.create({
      data: { companyId: porta.user.companyId, ...corpo.data },
      include: { categoriaPadrao: { select: { id: true, nome: true, codigo: true } } },
    });
    return NextResponse.json({ fornecedor });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
