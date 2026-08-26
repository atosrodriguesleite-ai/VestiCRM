import crypto from "node:crypto";
import { soDigitos } from "./busca";

/**
 * DADOS DE ENVIO PELO LINK (RN-024) — a cliente preenche o próprio cadastro.
 *
 * A vendedora manda um link do chat; a cliente abre um formulário (com o que
 * a ficha já tem, documento mascarado), preenche/corrige e o cadastro é
 * atualizado sozinho — ninguém mais digita CEP ditado por áudio.
 *
 * Três regras que seguram a ideia:
 *
 *  1. COMPLETO é o que a ETIQUETA exige — a régua é a MESMA da compra de
 *     etiqueta (CEP, rua, número, bairro, cidade, UF, telefone e CPF ou
 *     CNPJ). É ela que decide se o botão avisa "cadastro já completo".
 *     Não existe "marcar como completo" na mão: ficha completa É completa,
 *     seja preenchida pela cliente ou pela vendedora — um botão manual
 *     poderia mentir e a etiqueta seria recusada depois.
 *  2. O link ESCREVE na ficha, então ele VENCE (7 dias) e é sorteado a cada
 *     clique — link eterno vazado deixaria qualquer um trocar o endereço da
 *     cliente para sempre. Mesma lição do crachá do OAuth (RN-023).
 *  3. O telefone NÃO está no formulário: é a identidade da cliente (é por
 *     ele que a loja fala com ela) e a lição da RN-021 vale aqui — telefone
 *     digitado é palpite.
 *
 * Razão social: a FICHA fica no nome da pessoa (quem conversa); a razão
 * social (`Customer.legalName`) sai onde documento manda — NF-e, etiqueta e
 * declaração de conteúdo (`nomeParaDocumentos`).
 */

/** O que a etiqueta exige — a régua única de "cadastro completo". */
export type FichaParaEnvio = {
  zip?: string | null;
  street?: string | null;
  streetNumber?: string | null;
  district?: string | null;
  city?: string | null;
  state?: string | null;
  phone?: string | null;
  cpf?: string | null;
  cnpj?: string | null;
};

/**
 * A ficha tem tudo que a etiqueta pede? Devolve também O QUE falta, com os
 * mesmos nomes que a compra de etiqueta usa — os dois lugares falam igual.
 */
export function dadosDeEnvio(c: FichaParaEnvio): { completo: boolean; faltando: string[] } {
  const faltando = [
    // CEP de verdade tem 8 dígitos — "s/n" preenchido não engana a régua
    // (a cotação de frete já exigia 8; a régua tem que exigir o mesmo)
    soDigitos(c.zip).length !== 8 && "CEP",
    !c.street?.trim() && "rua",
    !c.streetNumber?.trim() && "número",
    !c.district?.trim() && "bairro",
    !c.city?.trim() && "cidade",
    !c.state?.trim() && "estado",
    soDigitos(c.phone).length < 8 && "telefone",
    soDigitos(c.cpf).length !== 11 && soDigitos(c.cnpj).length !== 14 && "CPF ou CNPJ",
  ].filter((v): v is string => Boolean(v));
  return { completo: faltando.length === 0, faltando };
}

/**
 * Nome que sai nos DOCUMENTOS (NF-e, etiqueta, declaração de conteúdo):
 * compra no CNPJ com razão social cadastrada → razão social; fora isso, o
 * nome da ficha. Decisão do dono (26/08/2026): a ficha fica no nome de quem
 * conversa, o documento sai no nome que o fisco conhece.
 */
export function nomeParaDocumentos(c: {
  name: string;
  cnpj?: string | null;
  legalName?: string | null;
}): string {
  if (soDigitos(c.cnpj).length === 14 && c.legalName?.trim()) return c.legalName.trim();
  return c.name;
}

/** CPF/CNPJ mascarado para a tela pública: mostra o meio, esconde as pontas. */
export function mascararDocumento(doc: string | null | undefined): string | null {
  const d = soDigitos(doc);
  if (d.length === 11) return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
  if (d.length === 14) return `**.${d.slice(2, 5)}.${d.slice(5, 8)}/****-**`;
  return null;
}

// ---- Crachá do link (assinado, sorteado, com validade) ----------------------

export const VALIDADE_DO_LINK_MS = 7 * 24 * 60 * 60 * 1000;

const segredo = () => process.env.AUTH_SECRET ?? "dev";
const assinatura = (corpo: string) =>
  crypto.createHmac("sha256", `dados-envio:${segredo()}`).update(corpo).digest("base64url").slice(0, 24);

/** Link novo para esta cliente — sorteado a cada clique, vence em 7 dias. */
export function criarTokenDadosEnvio(customerId: string, companyId: string): string {
  const corpo = Buffer.from(
    JSON.stringify({
      c: customerId,
      e: companyId,
      n: crypto.randomBytes(6).toString("base64url"),
      t: Date.now(),
    })
  ).toString("base64url");
  return `${corpo}.${assinatura(corpo)}`;
}

/** Lê o crachá — null se for falso, adulterado ou vencido. */
export function lerTokenDadosEnvio(
  token: string
): { customerId: string; companyId: string } | null {
  const [corpo, sig] = (token ?? "").split(".");
  if (!corpo || !sig) return null;
  const esperada = assinatura(corpo);
  const a = Buffer.from(sig);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const { c, e, t } = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8"));
    if (typeof c !== "string" || !c || typeof e !== "string" || !e || typeof t !== "number")
      return null;
    const idade = Date.now() - t;
    if (idade > VALIDADE_DO_LINK_MS || idade < -60_000) return null;
    return { customerId: c, companyId: e };
  } catch {
    return null;
  }
}
