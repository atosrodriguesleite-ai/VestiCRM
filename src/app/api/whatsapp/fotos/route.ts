import { NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp } from "@/lib/scope";
import { sincronizarFotos } from "@/lib/comm/fotos";

export const maxDuration = 60;

/**
 * Buscar AGORA as fotos de perfil das clientes.
 *
 * O sistema já faz isso sozinho de tempos em tempos; este botão é para quem
 * acabou de conectar o WhatsApp e quer ver a Central com as fotos na hora,
 * sem esperar a próxima rodada.
 */
export async function POST() {
  try {
    const user = await requireUser();
    if (!isManagerUp(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    // teto maior que o da rodada automática: aqui alguém está esperando
    const r = await sincronizarFotos(user.companyId, 60);
    return NextResponse.json(r);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
