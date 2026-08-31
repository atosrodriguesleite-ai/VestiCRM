import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { AuthError } from "@/lib/auth";
import { dataUrlToBuffer } from "@/lib/img-server";
import { nomeDoArquivo } from "@/lib/midia-arquivo";
import { porteiraFinanceiro } from "@/lib/financeiro/gate";

/**
 * BAIXAR / REMOVER um anexo do lançamento (RN-028).
 *
 * O arquivo SEMPRE sai como download com `nosniff` — comprovante não é
 * página para abrir no endereço do app (mesma regra da mídia do chat e do
 * documento de RH: um .html anexado executaria com a sessão aberta).
 *
 * Aqui o DELETE EXISTE, e é a única exceção do módulo: anexou o boleto
 * errado, tem que poder tirar. O que não se apaga é o LANÇAMENTO e a BAIXA —
 * o dinheiro que andou. A remoção fica no histórico com quem fez.
 */

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ anexoId: string }> }
) {
  try {
    const porta = await porteiraFinanceiro();
    if (!porta.ok) return porta.resposta;
    const { anexoId } = await params;
    const anexo = await db.finAnexo.findFirst({
      where: { id: anexoId, companyId: porta.user.companyId },
      select: { arquivo: true, fileName: true },
    });
    if (!anexo)
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    const dec = dataUrlToBuffer(anexo.arquivo);
    if (!dec)
      return NextResponse.json({ error: "Arquivo inválido" }, { status: 415 });
    return new NextResponse(new Uint8Array(dec.buf), {
      headers: {
        "Content-Type": dec.mime || "application/octet-stream",
        "Content-Length": String(dec.buf.byteLength),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=0, no-store",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
          nomeDoArquivo(anexo.fileName, "DOCUMENT", dec.mime)
        )}`,
      },
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ anexoId: string }> }
) {
  try {
    const porta = await porteiraFinanceiro();
    if (!porta.ok) return porta.resposta;
    const { anexoId } = await params;
    const anexo = await db.finAnexo.findFirst({
      where: { id: anexoId, companyId: porta.user.companyId },
      select: { id: true, fileName: true, lancamentoId: true },
    });
    if (!anexo)
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    await db.$transaction([
      db.finAnexo.delete({ where: { id: anexo.id } }),
      db.finLancamentoEvento.create({
        data: {
          lancamentoId: anexo.lancamentoId,
          descricao: `Anexo removido: ${anexo.fileName}`,
          autorNome: porta.user.name,
        },
      }),
    ]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
