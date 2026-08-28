import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { lerLinkDadosEnvio } from "@/lib/dados-envio-link";
import { NOME_DO_ESTADO } from "@/lib/envios/estados";
import { notifyDadosRecebidos } from "@/lib/notify";
import { normalizarBusca, soDigitos } from "@/lib/busca";
import { nomeProvisorio } from "@/lib/nome-provisorio";

export const dynamic = "force-dynamic";

/**
 * A CLIENTE ENVIOU O FORMULÁRIO "Dados de envio" (RN-024). Rota PÚBLICA:
 * quem prova quem ela é é o crachá do link (assinado, sorteado, 7 dias) —
 * mesmo espírito do pedido do catálogo.
 *
 * O que ela mandou VALE (decisão do dono: ela sabe onde mora) — a mudança
 * fica na linha do tempo e a vendedora é avisada no sino. O telefone NÃO
 * passa por aqui: é a identidade da cliente (lição da RN-021).
 */

const schema = z.object({
  token: z.string().min(10).max(400),
  tipo: z.enum(["PF", "PJ"]),
  nome: z.string().trim().min(2).max(120),
  cpf: z.string().max(20).optional(),
  cnpj: z.string().max(24).optional(),
  /** true = não mexe no documento que já está na ficha (veio mascarado) */
  manterDocumento: z.boolean().optional(),
  razaoSocial: z.string().trim().max(160).optional(),
  ie: z.string().trim().max(30).optional(),
  cep: z.string().max(12),
  rua: z.string().trim().min(1).max(160),
  numero: z.string().trim().min(1).max(20),
  complemento: z.string().trim().max(80).optional(),
  bairro: z.string().trim().min(1).max(80),
  cidade: z.string().trim().min(1).max(80),
  uf: z.string().trim().length(2),
});



export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Confira os campos e tente de novo." }, { status: 400 });
  const d = parsed.data;

  // aceita o código curto (11 caracteres, no banco) E o crachá longo antigo
  const cracha = await lerLinkDadosEnvio(d.token);
  if (!cracha)
    return NextResponse.json(
      { error: "Este link venceu. Peça um novo na conversa com a loja. 💜" },
      { status: 410 }
    );

  // o crachá carrega loja E cliente — e os dois têm que bater (RN-013)
  const cliente = await db.customer.findFirst({
    where: { id: cracha.customerId, companyId: cracha.companyId },
  });
  if (!cliente)
    return NextResponse.json({ error: "Cadastro não encontrado." }, { status: 404 });

  const uf = d.uf.toUpperCase();
  if (!NOME_DO_ESTADO[uf])
    return NextResponse.json({ error: "Escolha o estado na lista." }, { status: 400 });
  if (soDigitos(d.cep).length !== 8)
    return NextResponse.json({ error: "CEP incompleto — confira os 8 números." }, { status: 400 });

  // "manter o que já está": o documento mascarado não viaja de volta — o que
  // vale é o da ficha. Só serve se a ficha TEM documento daquele tipo.
  const cpf =
    d.tipo === "PF"
      ? d.manterDocumento
        ? soDigitos(cliente.cpf ?? undefined)
        : soDigitos(d.cpf)
      : "";
  const cnpj =
    d.tipo === "PJ"
      ? d.manterDocumento
        ? soDigitos(cliente.cnpj ?? undefined)
        : soDigitos(d.cnpj)
      : "";
  if (d.tipo === "PF" && cpf.length !== 11)
    return NextResponse.json({ error: "CPF incompleto — confira os 11 números." }, { status: 400 });
  if (d.tipo === "PJ" && cnpj.length !== 14)
    return NextResponse.json({ error: "CNPJ incompleto — confira os 14 números." }, { status: 400 });

  // O NOME DA FICHA É DO VENDEDOR (decisão do dono, 26/08/2026): às vezes a
  // cliente nem usa nome no WhatsApp, e é a loja que sabe como chamá-la. O
  // nome digitado aqui só ENTRA quando a ficha ainda tem o crachá provisório
  // ("Contato (77) 8101-4696") — a mesma regra do intake, que nasceu de
  // incidente. Nome escrito por gente não é sobrescrito por nada.
  const nomeFinal = nomeProvisorio(cliente.name) ? d.nome : cliente.name;

  // o que muda de verdade (para a linha do tempo e o aviso não gritarem à toa)
  const mudancas: string[] = [];
  const difere = (antes: string | null | undefined, depois: string) =>
    (antes ?? "").trim() !== depois.trim();
  const enderecoNovo =
    difere(cliente.zip, d.cep) || difere(cliente.street, d.rua) ||
    difere(cliente.streetNumber, d.numero) || difere(cliente.district, d.bairro) ||
    difere(cliente.city, d.cidade) || difere(cliente.state, uf) ||
    difere(cliente.complement, d.complemento ?? "");
  if (enderecoNovo) mudancas.push(`endereço: ${d.rua}, ${d.numero} — ${d.cidade}/${uf}`);
  if (difere(cliente.name, nomeFinal)) mudancas.push(`nome: ${nomeFinal}`);
  // ela se apresentou diferente do nome da ficha (só chega aqui por chamada
  // direta — o formulário trava o campo): a loja fica sabendo, sem alarme
  // falso por maiúscula/acento, e o nome do vendedor NÃO muda
  else if (normalizarBusca(d.nome) !== normalizarBusca(cliente.name))
    mudancas.push(`ela se apresentou como "${d.nome}" (o nome da ficha fica)`);
  if (d.tipo === "PF" && soDigitos(cliente.cpf ?? undefined) !== cpf) mudancas.push("CPF novo");
  if (d.tipo === "PJ" && soDigitos(cliente.cnpj ?? undefined) !== cnpj) mudancas.push("CNPJ novo");
  if (d.tipo === "PJ" && difere(cliente.legalName, d.razaoSocial ?? ""))
    mudancas.push(`razão social: ${d.razaoSocial}`);
  if (d.tipo === "PJ" && difere(cliente.stateRegistration, d.ie ?? ""))
    mudancas.push("inscrição estadual");

  await db.customer.update({
    where: { id: cliente.id },
    data: {
      name: nomeFinal,
      zip: d.cep,
      street: d.rua,
      streetNumber: d.numero,
      complement: d.complemento || null,
      district: d.bairro,
      city: d.cidade,
      state: uf,
      // PF limpa o lado PJ e vice-versa — documento é um OU outro; deixar os
      // dois faria a etiqueta e a nota escolherem sozinhas
      cpf: d.tipo === "PF" ? cpf : null,
      cnpj: d.tipo === "PJ" ? cnpj : null,
      legalName: d.tipo === "PJ" ? d.razaoSocial?.trim() || null : null,
      stateRegistration: d.tipo === "PJ" ? d.ie?.trim() || null : null,
    },
  });

  // linha do tempo + sino (o aviso sai sempre; o detalhe diz o que mudou)
  if (mudancas.length > 0) {
    await db.customerEvent.create({
      data: {
        companyId: cliente.companyId,
        customerId: cliente.id,
        type: "OUTRO",
        description: `Preencheu os dados de envio pelo link: ${mudancas.join(" · ")}`,
      },
    });
  }
  const conversa = await db.conversation.findFirst({
    where: { companyId: cliente.companyId, customerId: cliente.id },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  await notifyDadosRecebidos({
    companyId: cliente.companyId,
    customerName: nomeFinal,
    ownerId: cliente.ownerId,
    convId: conversa?.id ?? null,
    mudancas:
      mudancas.length > 0
        ? mudancas.join(" · ")
        : "Confirmou os dados que já estavam na ficha.",
  });

  return NextResponse.json({ ok: true });
}
