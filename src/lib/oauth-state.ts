import crypto from "node:crypto";
import { requireUser } from "./auth";
import { podeOperarIntegracoes } from "./scope";

/**
 * ESTADO DO OAUTH das integrações (Nuvemshop, Bling, Mercado Pago, Melhor
 * Envio) — o crachá que o provedor devolve para o sistema saber de qual loja
 * era aquela autorização.
 *
 * A versão anterior era `companyId.HMAC(companyId)`: SEMPRE o mesmo texto
 * para a mesma loja, sem validade. Quem visse esse crachá uma vez (print,
 * histórico do navegador, um ticket de suporte) podia montar o link de
 * autorização e mandar para OUTRA pessoa: ela entrava na conta dela, e os
 * tokens (com a carteira e o endereço do remetente) caíam na loja de quem
 * mandou o link. E valia para sempre.
 *
 * Três travas fecham isso:
 *  1. o crachá é SORTEADO a cada clique (não dá para prever nem reconhecer);
 *  2. ele VENCE em 15 minutos — o tempo de autorizar, não a eternidade;
 *  3. quem volta do provedor precisa estar LOGADO na mesma loja do crachá,
 *     com permissão de mexer em integrações. É esta que mata o golpe: a
 *     vítima está logada na loja dela, nunca na de quem mandou o link.
 */

/** Tempo que o crachá vale: o suficiente para autorizar sem pressa. */
export const VALIDADE_DO_ESTADO_MS = 15 * 60 * 1000;

const segredo = () => process.env.AUTH_SECRET ?? "dev";

const assinatura = (corpo: string) =>
  crypto.createHmac("sha256", segredo()).update(corpo).digest("base64url").slice(0, 32);

/** Crachá novo para esta loja, com sorteio e hora de nascimento. */
export function signState(companyId: string): string {
  const corpo = Buffer.from(
    JSON.stringify({
      c: companyId,
      n: crypto.randomBytes(9).toString("base64url"), // sorteio: nunca se repete
      t: Date.now(),
    })
  ).toString("base64url");
  return `${corpo}.${assinatura(corpo)}`;
}

/** Devolve o companyId do crachá — ou null se for falso, adulterado ou vencido. */
export function verifyState(state: string): string | null {
  const [corpo, sig] = (state ?? "").split(".");
  if (!corpo || !sig) return null;

  // comparação em tempo constante (não entrega a assinatura por tentativa)
  const esperada = assinatura(corpo);
  const a = Buffer.from(sig);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const { c, t } = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8"));
    if (typeof c !== "string" || !c || typeof t !== "number") return null;
    const idade = Date.now() - t;
    // vencido, ou nascido no futuro (relógio adulterado)
    if (idade > VALIDADE_DO_ESTADO_MS || idade < -60_000) return null;
    return c;
  } catch {
    return null;
  }
}

/**
 * Quem está voltando do provedor é gente da PRÓPRIA loja, com permissão de
 * mexer em integrações? Sem esta conferência, o crachá sozinho não prova
 * quem clicou — e era por aí que a conta de uma loja acabava ligada na outra.
 */
export async function sessaoAutorizadaPara(
  companyId: string
): Promise<"ok" | "sem_sessao" | "outra_loja"> {
  try {
    const user = await requireUser();
    if (user.companyId !== companyId || !podeOperarIntegracoes(user)) return "outra_loja";
    return "ok";
  } catch {
    // login venceu no meio do caminho, ou a volta caiu noutro navegador
    // (aparelho com o app instalado costuma abrir link externo à parte)
    return "sem_sessao";
  }
}
