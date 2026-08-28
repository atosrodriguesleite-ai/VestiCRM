import { NextRequest, NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/scope";
import { appBaseUrl } from "@/lib/comm/evolution";
import { criarLinkFicha } from "@/lib/ficha-form-link";

/**
 * Botão "Link do formulário" da ficha (RN-025): gera o link para o PRÓPRIO
 * funcionário preencher os dados pelo celular, sem login. Sorteado a cada
 * clique, vence em 7 dias e morre no envio (uso único) — a resposta fica
 * aguardando a conferência do admin.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    if (!isAdmin(user))
      return NextResponse.json(
        { error: "O link do formulário é do administrador." },
        { status: 403 }
      );
    const { id } = await params;
    // escopo RN-013: só ficha da própria loja
    const ficha = await db.funcionario.findFirst({
      where: { id, companyId: user.companyId },
      select: { id: true, nome: true },
    });
    if (!ficha)
      return NextResponse.json({ error: "Ficha não encontrada." }, { status: 404 });

    const code = await criarLinkFicha(ficha.id, user.companyId);
    const url = `${appBaseUrl()}/ficha/${code}`;
    return NextResponse.json({
      url,
      // mensagem pronta para colar no WhatsApp do funcionário
      mensagem: `Oi, ${ficha.nome.split(" ")[0]}! Preencha sua ficha de funcionário neste link (vale 7 dias): ${url}`,
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
