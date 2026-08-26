import type { Metadata } from "next";
import { db } from "@/lib/db";
import { dadosDeEnvio, mascararDocumento } from "@/lib/dados-envio";
import { lerLinkDadosEnvio } from "@/lib/dados-envio-link";
import { nomeProvisorio } from "@/lib/nome-provisorio";
import { FormularioDados } from "./formulario";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Dados de envio",
  robots: { index: false, follow: false }, // página pessoal: fora do Google
};

/**
 * FORMULÁRIO PÚBLICO "Dados de envio" (RN-024): a cliente chega pelo link do
 * chat e preenche/confere o próprio cadastro. Sem login — quem prova quem
 * ela é é o crachá do link (assinado, sorteado, vence em 7 dias).
 *
 * O que a ficha já tem aparece preenchido para ela SÓ CONFERIR; o documento
 * aparece MASCARADO (***.456.789-**) — quem pegar o link não descobre o CPF.
 */
export default async function PaginaDados({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  // link cortado no meio pelo WhatsApp pode terminar num "%" solto — o
  // decode explode, e a cliente veria erro cru em vez do aviso amigável
  let tokenLimpo = "";
  try {
    tokenLimpo = decodeURIComponent(token);
  } catch {
    tokenLimpo = "";
  }
  // aceita o código curto (11 caracteres, no banco) E o crachá longo antigo —
  // link já enviado no WhatsApp continua valendo até vencer
  const cracha = await lerLinkDadosEnvio(tokenLimpo);

  const vencido = (
    <main className="min-h-dvh bg-[#faf7f2] flex items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <p className="text-4xl mb-3">⏳</p>
        <h1 className="text-lg font-bold text-gray-800 mb-2">Este link venceu</h1>
        <p className="text-sm text-gray-500">
          Por segurança, o link de dados vale por 7 dias. Peça um novo na
          conversa com a loja. 💜
        </p>
      </div>
    </main>
  );
  if (!cracha) return vencido;

  const cliente = await db.customer.findFirst({
    where: { id: cracha.customerId, companyId: cracha.companyId },
    select: {
      name: true, cpf: true, cnpj: true, legalName: true, stateRegistration: true,
      zip: true, street: true, streetNumber: true, complement: true,
      district: true, city: true, state: true, phone: true,
      company: { select: { name: true } },
    },
  });
  if (!cliente) return vencido;

  const { completo } = dadosDeEnvio(cliente);
  // O NOME DA FICHA É DO VENDEDOR (RN-024): com nome de gente, o campo vem
  // travado — editar aqui não mudaria nada e a cliente acharia que mudou.
  // Com o crachá provisório ("Contato (77)…"), o campo vem VAZIO: entregar o
  // crachá pré-preenchido fazia a cliente pular o campo e o telefone virava
  // nome para sempre (achado da revisão).
  const nomeDaLoja = !nomeProvisorio(cliente.name);
  return (
    <FormularioDados
      token={tokenLimpo}
      loja={cliente.company.name}
      completo={completo}
      nomeBloqueado={nomeDaLoja}
      inicial={{
        nome: nomeDaLoja ? cliente.name : "",
        tipo: cliente.cnpj ? "PJ" : "PF",
        cpfMascarado: mascararDocumento(cliente.cpf),
        cnpjMascarado: mascararDocumento(cliente.cnpj),
        razaoSocial: cliente.legalName ?? "",
        ie: cliente.stateRegistration ?? "",
        cep: cliente.zip ?? "",
        rua: cliente.street ?? "",
        numero: cliente.streetNumber ?? "",
        complemento: cliente.complement ?? "",
        bairro: cliente.district ?? "",
        cidade: cliente.city ?? "",
        uf: cliente.state ?? "",
      }}
    />
  );
}
