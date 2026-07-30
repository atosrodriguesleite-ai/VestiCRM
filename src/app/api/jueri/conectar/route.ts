import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { podeOperarIntegracoes } from "@/lib/scope";
import { jueriGet } from "@/lib/jueri";

/**
 * Conexão da loja com a Jueri: valida o token com uma LEITURA e salva a
 * credencial da loja. GET devolve o estado; DELETE desconecta.
 */

const schema = z.object({
  token: z.string().min(10).max(200),
  clienteSistema: z.string().min(1).max(20),
});

export async function GET() {
  try {
    const user = await requireUser();
    const conn = await db.jueriConnection.findUnique({
      where: { companyId: user.companyId },
      select: { clienteSistema: true, lastSyncAt: true, createdAt: true },
    });
    return NextResponse.json({ conectado: Boolean(conn), ...conn });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!podeOperarIntegracoes(user)) {
      return NextResponse.json({ error: "Só admin conecta integrações." }, { status: 403 });
    }
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Informe o token e o ID do cliente." }, { status: 400 });
    }
    const { token, clienteSistema } = parsed.data;

    // valida com leitura real: tipos de preço precisam responder
    const teste = await jueriGet(token, `/${clienteSistema}/tipo-preco`);
    if (teste.status === 401) {
      return NextResponse.json({ error: "Token inválido ou sem acesso." }, { status: 400 });
    }
    if (!Array.isArray(teste.body)) {
      return NextResponse.json(
        { error: `A Jueri não retornou os dados (HTTP ${teste.status}) — confira o ID do cliente.` },
        { status: 400 }
      );
    }

    await db.jueriConnection.upsert({
      where: { companyId: user.companyId },
      update: { token, clienteSistema },
      create: { companyId: user.companyId, token, clienteSistema },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

export async function DELETE() {
  try {
    const user = await requireUser();
    if (!podeOperarIntegracoes(user)) {
      return NextResponse.json({ error: "Só admin desconecta integrações." }, { status: 403 });
    }
    await db.jueriConnection.deleteMany({ where: { companyId: user.companyId } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
