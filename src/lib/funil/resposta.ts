import { NextResponse } from "next/server";
import { AuthError } from "../auth";
import { FunilErro } from "./editor";

/** Tradução única dos erros das rotas do editor do funil (RN-091). */
export function respostaDoErro(e: unknown): NextResponse {
  if (e instanceof AuthError)
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (e instanceof FunilErro)
    return NextResponse.json({ error: e.message }, { status: e.status });
  throw e;
}
