import { NextResponse } from "next/server";
import { AuthError } from "../auth";
import { porteiraCalendario, type PorteiraCalendario } from "./gate";

/**
 * Embrulho das rotas do Calendário (RN-092): porteira (chave da loja +
 * gerência) e o 401 em português. Cada rota recebe o usuário já conferido.
 */
export async function comPorteira(
  fn: (user: Extract<PorteiraCalendario, { ok: true }>["user"]) => Promise<NextResponse>
): Promise<NextResponse> {
  try {
    const p = await porteiraCalendario();
    if (!p.ok) return p.resposta;
    return await fn(p.user);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    throw e;
  }
}

export const recusa = (error: string, status = 400) => NextResponse.json({ error }, { status });
