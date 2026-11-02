import { NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/auth";
import { isAdmin } from "@/lib/scope";
import { reiniciarConexaoDaLoja } from "@/lib/comm/reiniciar-conexao";

/**
 * Reinicia a conexão do WhatsApp da PRÓPRIA loja (RN-105) — gerência, a mesma
 * régua do Desconectar. Resposta sempre 200 com `ok` e a frase: recusa do
 * servidor é resultado para a tela dizer, não erro da porta.
 */
// reiniciar (15 s, mais 15 do PUT de reserva) + reaplicar avisos (15 s) + ler o
// estado (15 s, até 3 leituras curtas) + as esperas: 60 s não cobriam o pior caso
export const maxDuration = 90;

export async function POST() {
  try {
    const user = await requireUser();
    if (!isAdmin(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const r = await reiniciarConexaoDaLoja(user.companyId, { nome: user.name });
    return NextResponse.json(r);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
