import { NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/auth";
import { isAdmin } from "@/lib/scope";
import { mergeDuplicateContacts } from "@/lib/merge-contacts";

/**
 * Unifica contatos duplicados (mesmo número com/sem 9º dígito) da loja.
 * GET  = prévia (não altera nada) · POST = aplica a unificação.
 * Só administrador — é uma operação que mexe no cadastro de clientes.
 */
export async function GET() {
  try {
    const user = await requireUser();
    if (!isAdmin(user))
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    const preview = await mergeDuplicateContacts(user.companyId, false);
    return NextResponse.json(preview);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

export async function POST() {
  try {
    const user = await requireUser();
    if (!isAdmin(user))
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    const result = await mergeDuplicateContacts(user.companyId, true);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
