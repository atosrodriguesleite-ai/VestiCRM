import { NextRequest, NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/scope";
import { dataUrlToBuffer } from "@/lib/img-server";
import { nomeDoArquivo } from "@/lib/midia-arquivo";
import { docTipoLabel } from "@/lib/funcionarios";

/**
 * BAIXAR / APAGAR um documento da ficha (RN-025). Só ADMIN, sempre da própria
 * empresa (RN-013).
 *
 * O arquivo SEMPRE sai como download com `nosniff` — documento de RH não é
 * página para abrir no endereço do app (mesma regra da mídia do chat: um
 * .html anexado executaria com a sessão aberta).
 *
 * Apagar documento EXISTE (diferente da ficha): anexou o RG no funcionário
 * errado, tem que poder tirar. O que não se apaga é a ficha.
 */

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ docId: string }> }
) {
  try {
    const user = await requireUser();
    if (!isAdmin(user))
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    const { docId } = await params;
    const doc = await db.funcionarioDocumento.findFirst({
      where: { id: docId, funcionario: { companyId: user.companyId } },
      select: { arquivo: true, fileName: true },
    });
    if (!doc) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    const dec = dataUrlToBuffer(doc.arquivo);
    if (!dec) return NextResponse.json({ error: "Arquivo inválido" }, { status: 415 });
    return new NextResponse(new Uint8Array(dec.buf), {
      headers: {
        "Content-Type": dec.mime || "application/octet-stream",
        "Content-Length": String(dec.buf.byteLength),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=0, no-store",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
          nomeDoArquivo(doc.fileName, "DOCUMENT", dec.mime)
        )}`,
      },
    });
  } catch (e) {
    return trata(e);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ docId: string }> }
) {
  try {
    const user = await requireUser();
    if (!isAdmin(user))
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    const { docId } = await params;
    const doc = await db.funcionarioDocumento.findFirst({
      where: { id: docId, funcionario: { companyId: user.companyId } },
      select: { id: true, tipo: true, fileName: true, funcionarioId: true },
    });
    if (!doc) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    await db.funcionarioDocumento.delete({ where: { id: doc.id } });
    // o nome do arquivo fica no histórico: "removido (RG)" sozinho não diz QUAL
    await db.funcionarioEvento.create({
      data: {
        funcionarioId: doc.funcionarioId,
        descricao: `Documento removido: ${docTipoLabel[doc.tipo]} — ${doc.fileName}.`,
        autorNome: user.name,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return trata(e);
  }
}

function trata(e: unknown) {
  if (e instanceof AuthError)
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  throw e;
}
