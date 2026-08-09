import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp, orderScope } from "@/lib/scope";
import { emitirNfeDoPedido, consultarNfe } from "@/lib/bling";

/** Emite a NF-e do pedido via Bling (gerente/admin). */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    if (!isManagerUp(user))
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    const { id } = await params;
    const conn = await db.blingConnection.findUnique({
      where: { companyId: user.companyId },
    });
    if (!conn)
      return NextResponse.json(
        { error: "Conecte o Bling em Configurações para emitir notas." },
        { status: 409 }
      );
    const r = await emitirNfeDoPedido(user.companyId, id);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
    return NextResponse.json(r);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

/** Atualiza a situação da NF-e (autorizada? número? link?). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const order = await db.order.findFirst({
      where: { id, ...orderScope(user) },
      select: { id: true, nfeBlingId: true },
    });
    if (!order?.nfeBlingId)
      return NextResponse.json({ error: "Pedido sem NF-e" }, { status: 404 });
    const c = await consultarNfe(user.companyId, order.nfeBlingId);
    // consulta falhou (token, Bling fora do ar) ≠ nota pendente: gravar o
    // "EMITINDO" genérico aqui APAGAVA o número e o DANFE de nota autorizada
    if (!c.ok) {
      return NextResponse.json(
        { error: "Não consegui consultar o Bling agora. Tente em instantes." },
        { status: 502 }
      );
    }
    // A consulta NÃO passa por cima da máquina de estados da emissão:
    //  - "EMITINDO" da consulta não apaga um ERRO recuperável (o rascunho
    //    pendente pareceria "em andamento" e a retomada ficava inalcançável);
    //  - REJEITADA/CANCELADA de uma nota VELHA não derruba a trava EMITINDO
    //    de uma emissão em andamento (era reabrir a porta da nota dupla).
    await db.order.updateMany({
      where: {
        id: order.id,
        nfeBlingId: order.nfeBlingId,
        ...(c.situacao === "EMITINDO" ? { nfeStatus: { not: "ERRO" } } : {}),
        ...(c.situacao === "REJEITADA" || c.situacao === "CANCELADA"
          ? { nfeStatus: { not: "EMITINDO" } }
          : {}),
      },
      data: {
        nfeStatus: c.situacao,
        nfeNumber: c.numero ?? null,
        nfeUrl: c.url ?? null,
      },
    });
    return NextResponse.json(c);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
