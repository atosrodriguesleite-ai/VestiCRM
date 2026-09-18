import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";
import { porteiraEtiquetas } from "@/lib/etiquetas/gate";
import { filaDeSeparacao } from "@/lib/etiquetas/separacao";

/** A FILA DE SEPARAÇÃO (RN-060): pedidos pagos a separar e os separados nos últimos dias. */
export async function GET() {
  try {
    const porta = await porteiraEtiquetas();
    if (!porta.ok) return porta.resposta;
    return NextResponse.json(await filaDeSeparacao(porta.user));
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
