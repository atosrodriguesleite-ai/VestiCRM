import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { appBaseUrl } from "@/lib/comm/evolution";
import { criarTokenDadosEnvio, dadosDeEnvio } from "@/lib/dados-envio";

/**
 * Botão "Dados de envio" do chat (RN-024): gera o link do formulário desta
 * cliente e já responde se a ficha está completa — completa, o chat avisa a
 * vendedora ANTES de enviar, para a cliente não preencher duas vezes.
 *
 * O link é sorteado a cada clique e vence em 7 dias (ele ESCREVE na ficha;
 * link eterno vazado deixaria qualquer um trocar o endereço da cliente).
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    // escopo RN-013: só cliente da própria loja
    const cliente = await db.customer.findFirst({
      where: { id, companyId: user.companyId },
      select: {
        id: true,
        zip: true, street: true, streetNumber: true, district: true,
        city: true, state: true, phone: true, cpf: true, cnpj: true,
      },
    });
    if (!cliente)
      return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });

    const situacao = dadosDeEnvio(cliente);
    const token = criarTokenDadosEnvio(cliente.id, user.companyId);
    return NextResponse.json({
      url: `${appBaseUrl()}/dados/${token}`,
      ...situacao,
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
