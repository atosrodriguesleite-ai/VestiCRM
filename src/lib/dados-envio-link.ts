import crypto from "node:crypto";
import { db } from "./db";
import { VALIDADE_DO_LINK_MS, lerTokenDadosEnvio } from "./dados-envio";

/**
 * LINK CURTO do formulário "Dados de envio" (RN-024).
 *
 * A primeira versão carregava o crachá HMAC inteiro NA URL — seguro, mas o
 * link passava de 200 caracteres e assustava no WhatsApp (pedido do dono:
 * "o menor possível"). Agora a URL leva só um código de 11 caracteres
 * sorteados (64 bits — não se adivinha nem por força bruta) e o resto
 * (cliente, loja, validade de 7 dias) mora na tabela `DadosEnvioLink`.
 *
 * Mora num arquivo próprio porque importa o banco — o `dados-envio.ts` é
 * puro (régua de completo, máscara, nome para documentos) e os testes o
 * importam sem Prisma.
 *
 * Os links LONGOS já enviados continuam valendo até vencerem: quem lê
 * (`lerLinkDadosEnvio`) aceita os dois formatos — trocar o formato não pode
 * quebrar a mensagem que a cliente ainda não abriu.
 */

/** Cria um link novo para a cliente — sorteado a cada clique, vence em 7 dias. */
export async function criarLinkDadosEnvio(
  customerId: string,
  companyId: string
): Promise<string> {
  const code = crypto.randomBytes(8).toString("base64url"); // 11 caracteres
  await db.dadosEnvioLink.create({
    data: {
      companyId,
      customerId,
      code,
      expiresAt: new Date(Date.now() + VALIDADE_DO_LINK_MS),
    },
  });
  // faxina de carona (sem cron, regra do CLAUDE.md): leva embora os vencidos
  // desta cliente — a tabela não acumula lixo de quem clica toda semana
  await db.dadosEnvioLink
    .deleteMany({ where: { customerId, expiresAt: { lt: new Date() } } })
    .catch(() => {});
  return code;
}

/**
 * Lê o código do link — null se não existir ou tiver vencido. Aceita também
 * o crachá HMAC antigo (links longos já enviados seguem valendo 7 dias).
 */
export async function lerLinkDadosEnvio(
  codigo: string
): Promise<{ customerId: string; companyId: string } | null> {
  const v = (codigo ?? "").trim();
  if (!v) return null;

  // formato antigo (corpo.assinatura): valida pelo HMAC, sem banco
  if (v.includes(".")) return lerTokenDadosEnvio(v);

  if (v.length > 32) return null; // código curto não tem esse tamanho
  const link = await db.dadosEnvioLink.findUnique({
    where: { code: v },
    select: { customerId: true, companyId: true, expiresAt: true },
  });
  if (!link || link.expiresAt.getTime() < Date.now()) return null;
  return { customerId: link.customerId, companyId: link.companyId };
}
