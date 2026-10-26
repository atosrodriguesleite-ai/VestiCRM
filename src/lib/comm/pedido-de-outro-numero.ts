import type { Prisma, Customer } from "@prisma/client";
import { db } from "../db";
import { logServerError } from "../health";
import { formatPhone } from "../format";
import { mesmoNumero } from "../telefone";
import { repointCustomer, consolidateOpenConversations } from "../merge-contacts";
import { JANELA_DA_BOLHA_MS, mesmoTexto, textoLimpo } from "./bolha-do-pedido";
import { ehTextoDePedidoDoCatalogo } from "../contatos-parecidos";

/**
 * O MESMO PEDIDO DO CATÁLOGO, VINDO DE OUTRO NÚMERO (RN-097).
 *
 * Relato do dono (26/10/2026): *"quando a pessoa manda o pedido e coloca um
 * número diferente do dela, o sistema abre outra conversa e duplica"* — e,
 * junto, *"o pedido chega duas vezes no WhatsApp (não duplica na aba
 * Pedidos, mas duplica nas mensagens)"*. É UM defeito com duas caras: a
 * cliente preenche o pedido com o telefone Y, o catálogo cria o cadastro Y
 * com a bolha do pedido (RN-010/RN-043) e abre o wa.me; a mensagem de
 * verdade sai do WhatsApp do APARELHO dela, o número X. O webhook procura X,
 * não acha, cria outro cadastro, outra conversa (na fila) e outra bolha com
 * o mesmo texto. A bolha única (RN-043) só junta a MESMA cliente, e a RN-021
 * só vale quando ela entrou pelo link pessoal.
 *
 * A régua, que estende a RN-021: **o WhatsApp por onde a mensagem do pedido
 * chegou é o número VERIFICADO** — foi o aparelho que montou o pedido que a
 * mandou. O que ela digitou é palpite, e fica anotado. Só que juntar cadastro
 * sozinho é o que a RN-020 proíbe (juntar gente errada é pior que o
 * duplicado), então aqui a prova tem que ser FORTE, e as três são exigidas:
 *
 *  1. o TEXTO da mensagem é o do pedido do catálogo, idêntico (`mesmoTexto`),
 *     dentro da mesma meia hora (a janela da RN-043);
 *  2. o cadastro do telefone digitado NASCEU DESTE PEDIDO (`nasceuDoPedido`):
 *     origem catálogo, criado dentro da janela, e nunca falou pelo WhatsApp —
 *     se o número digitado é de uma cliente de verdade (a irmã, a sócia), o
 *     cadastro dela não é tocado e vale o aviso de sempre ("parece a mesma
 *     pessoa", gerência decide);
 *  3. e, para FUNDIR, o pedido já existe — a porta do catálogo cria o pedido
 *     DEPOIS do intake, e apagar o cadastro no meio quebraria a criação dele
 *     (RN-010: o pedido do catálogo não pode se perder).
 *
 * Três situações, cada uma com a sua saída (`decidirAdocao`, pura):
 *
 *  • **o WhatsApp X ainda não tem cadastro** → o cadastro que nasceu do
 *    pedido LEVA o número X (`pedido-leva-o-whatsapp`): nada se apaga, o
 *    pedido, a conversa e a bolha ficam onde estão, e a bolha é reaproveitada
 *    pelo caminho de sempre;
 *  • **X já é cliente** (já falou antes) e o pedido existe → o cadastro
 *    nascido do pedido é FUNDIDO no de X (`fundir-no-whatsapp`), pelo mesmo
 *    caminho da unificação de contatos (`repointCustomer`): pedido, conversa,
 *    histórico e bolha vão para X;
 *  • o webhook chegou PRIMEIRO (a cliente apertou enviar antes de o POST do
 *    pedido chegar) → a porta do catálogo adota X antes de criar qualquer
 *    coisa (`telefoneDoWhatsAppDoPedido`), como faz com o link pessoal.
 *
 * E a corrida entre os dois caminhos (o webhook vê a bolha mas o pedido
 * ainda não existe) é fechada pela própria porta do catálogo, que no FIM —
 * com o pedido criado — procura a mensagem de verdade e funde
 * (`juntarDepoisDoPedido`). Os dois lados tomam a MESMA trava, pelo texto do
 * pedido (`pg_advisory_xact_lock(hashtext(texto))`), então quem decide vê o
 * que o outro já fez. Tudo fica dito na conversa (nota 📱) e na linha do
 * tempo da cliente.
 */

export type Adocao = "pedido-leva-o-whatsapp" | "fundir-no-whatsapp" | "nada";

export type SituacaoDaAdocao = {
  /** o WhatsApp por onde a mensagem chegou já tem cadastro nesta loja */
  whatsappJaEhCliente: boolean;
  /** o cadastro do telefone digitado nasceu deste pedido (`nasceuDoPedido`) */
  cadastroNasceuDoPedido: boolean;
  /** o pedido já foi criado pela porta do catálogo */
  pedidoJaExiste: boolean;
};

/** A decisão, sem banco: o que fazer com o cadastro do telefone digitado. */
export function decidirAdocao(s: SituacaoDaAdocao): Adocao {
  if (!s.cadastroNasceuDoPedido) return "nada";
  if (!s.whatsappJaEhCliente) return "pedido-leva-o-whatsapp";
  return s.pedidoJaExiste ? "fundir-no-whatsapp" : "nada";
}

/**
 * O cadastro nasceu deste pedido? Origem catálogo, criado dentro da janela
 * da bolha e sem NENHUMA mensagem recebida pelo WhatsApp — quem já escreveu
 * daquele número é gente de verdade, e cadastro de gente não se mexe sozinho.
 */
export function nasceuDoPedido(
  cadastro: { origin: string; createdAt: Date },
  falouPeloWhatsApp: boolean,
  agora = Date.now()
): boolean {
  if (cadastro.origin !== "CATALOGO_PUBLICO") return false;
  if (falouPeloWhatsApp) return false;
  const idade = agora - cadastro.createdAt.getTime();
  return idade >= -60_000 && idade <= JANELA_DA_BOLHA_MS;
}

/** O que a conversa e a linha do tempo dizem quando o digitado perde. */
export function notaDoWhatsAppQueVenceu(digitado: string, whatsapp: string): string {
  return (
    `📱 A cliente digitou o telefone ${formatPhone(digitado)} no pedido do catálogo, ` +
    `mas a mensagem do pedido chegou do WhatsApp ${formatPhone(whatsapp)}. ` +
    `O cadastro ficou com o número do WhatsApp, que é por onde ela fala — confira qual está certo.`
  );
}

/** O que a conversa diz quando o cadastro do digitado foi fundido neste. */
export function notaDaFusao(digitado: string, whatsapp: string, numeroDoPedido: number | null): string {
  const pedido = numeroDoPedido ? `O pedido #${String(numeroDoPedido).padStart(4, "0")}` : "O pedido do catálogo";
  return (
    `📱 ${pedido} foi digitado com o telefone ${formatPhone(digitado)} e a mensagem dele chegou ` +
    `deste WhatsApp (${formatPhone(whatsapp)}): o cadastro que nasceu com o pedido foi juntado neste — ` +
    `pedido, conversa e histórico estão aqui. Confira qual telefone está certo.`
  );
}

type Tx = Prisma.TransactionClient;

/** Falha aqui vai para a Saúde SEM alarme (régua da RN-066): nunca derruba o caminho. */
async function registrarFalha(e: unknown, onde: string, companyId: string) {
  await logServerError({
    source: "server",
    path: `lib/comm/pedido-de-outro-numero.ts:${onde}`,
    message: e instanceof Error ? e.message : String(e),
    detail: `loja ${companyId}`,
    alarme: false,
  }).catch(() => {});
}

/** A trava pelo texto do pedido: os dois caminhos passam por ela. */
async function travarPeloTexto(tx: Tx, texto: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pedido:${textoLimpo(texto)}`}))`;
}

const SELECAO_DA_BOLHA = {
  id: true,
  body: true,
  createdAt: true,
  externalId: true,
  conversation: {
    select: {
      id: true,
      customer: {
        select: { id: true, name: true, phone: true, origin: true, createdAt: true },
      },
    },
  },
} as const;

/**
 * As bolhas do pedido do catálogo na janela (recorte barato pelo começo do
 * texto; a igualdade de verdade é `mesmoTexto`, em memória — a janela tem
 * poucas). `comId`: a mensagem de verdade (do WhatsApp) ou a bolha do
 * catálogo (sem id).
 */
async function bolhasDoPedido(
  tx: Tx,
  companyId: string,
  texto: string,
  comId: boolean,
  foraDasClientes: string[]
) {
  const linhas = await tx.message.findMany({
    where: {
      conversation: { companyId, customerId: { notIn: foraDasClientes } },
      direction: "IN",
      kind: "TEXT",
      mediaType: "TEXT",
      revoked: false,
      externalId: comId ? { not: null } : null,
      createdAt: { gte: new Date(Date.now() - JANELA_DA_BOLHA_MS) },
      body: { startsWith: "*Novo pedido" },
    },
    orderBy: { createdAt: "desc" },
    // o MESMO teto da busca da bolha única (RN-043): numa loja em lançamento,
    // dezenas de pedidos esperam o "enviar" ao mesmo tempo, e um teto curto
    // deixava a bolha de fora e o duplicado voltava calado
    take: 200,
    select: SELECAO_DA_BOLHA,
  });
  return linhas.filter((l) => mesmoTexto(l.body, texto));
}

/** A cliente já escreveu pelo WhatsApp (mensagem recebida com id de lá)? */
async function falouPeloWhatsApp(tx: Tx, companyId: string, customerId: string) {
  const n = await tx.message.count({
    where: {
      conversation: { companyId, customerId },
      direction: "IN",
      externalId: { not: null },
    },
  });
  return n > 0;
}

async function anotar(
  tx: Tx,
  companyId: string,
  customerId: string,
  conversationId: string,
  texto: string
) {
  await tx.message.create({
    data: { conversationId, direction: "IN", kind: "NOTE", body: texto },
  });
  await tx.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: new Date() },
  });
  await tx.customerEvent.create({
    data: { companyId, customerId, type: "OUTRO", channel: "WHATSAPP", description: texto },
  });
}

/**
 * LADO DO WEBHOOK (chamado pelo intake ANTES de resolver o cadastro): a
 * mensagem do pedido chegou do WhatsApp `telefone`; `existente` é o cadastro
 * que esse número já tem (ou null). Devolve o cadastro que fica com o pedido
 * — e por isso com a bolha, que o intake reaproveita em seguida — ou null
 * quando não há o que fazer (segue o caminho de sempre).
 */
export async function adotarPedidoDeOutroNumero(opts: {
  companyId: string;
  /** o número do WhatsApp, já normalizado */
  telefone: string;
  texto: string;
  existente: Customer | null;
}): Promise<{ customer: Customer; adocao: Exclude<Adocao, "nada"> } | null> {
  const { companyId, telefone, texto, existente } = opts;
  if (!ehTextoDePedidoDoCatalogo(texto)) return null;
  try {
    const resultado = await db.$transaction(
      async (tx) => {
        await travarPeloTexto(tx, texto);
        const bolhas = await bolhasDoPedido(
          tx,
          companyId,
          texto,
          false,
          existente ? [existente.id] : []
        );
        // a bolha de uma cliente que é o MESMO número escrito de outro jeito
        // é assunto da RN-043 (mesma cliente), não daqui
        const bolha = bolhas.find((b) => !mesmoNumero(b.conversation.customer.phone, telefone));
        if (!bolha) return null;
        const digitado = bolha.conversation.customer;
        const situacao: SituacaoDaAdocao = {
          whatsappJaEhCliente: !!existente,
          cadastroNasceuDoPedido: nasceuDoPedido(
            digitado,
            await falouPeloWhatsApp(tx, companyId, digitado.id)
          ),
          pedidoJaExiste:
            !!(await tx.order.findFirst({
              where: {
                companyId,
                customerId: digitado.id,
                createdAt: { gte: new Date(bolha.createdAt.getTime() - 60_000) },
              },
              select: { id: true },
            })),
        };
        const adocao = decidirAdocao(situacao);
        if (adocao === "nada") return null;

        if (adocao === "pedido-leva-o-whatsapp") {
          const customer = await tx.customer.update({
            where: { id: digitado.id },
            data: { phone: telefone },
          });
          await anotar(
            tx,
            companyId,
            customer.id,
            bolha.conversation.id,
            notaDoWhatsAppQueVenceu(digitado.phone, telefone)
          );
          return { customer, adocao };
        }

        // fundir: o cadastro nascido do pedido some dentro do de X
        const principal = existente as Customer;
        const pedido = await tx.order.findFirst({
          where: { companyId, customerId: digitado.id },
          orderBy: { createdAt: "desc" },
          select: { number: true },
        });
        await repointCustomer(tx, principal.id, digitado.id);
        await anotar(
          tx,
          companyId,
          principal.id,
          bolha.conversation.id,
          notaDaFusao(digitado.phone, telefone, pedido?.number ?? null)
        );
        const customer = await tx.customer.findUniqueOrThrow({ where: { id: principal.id } });
        return { customer, adocao };
      },
      { maxWait: 10_000, timeout: 20_000 }
    );
    if (resultado?.adocao === "fundir-no-whatsapp") {
      // as conversas abertas de X (a dele e a que veio do pedido) viram uma
      await consolidateOpenConversations(companyId, resultado.customer.id);
    }
    return resultado;
  } catch (e) {
    // corrida (o número X ganhou cadastro no meio → único) ou falha de
    // banco: a mensagem da cliente NUNCA pode se perder por causa desta
    // regra — segue o caminho de sempre e o caso fica na Saúde
    await registrarFalha(e, "adotar", companyId);
    return null;
  }
}

/**
 * LADO DO CATÁLOGO, ANTES do intake: o webhook chegou primeiro? Se a
 * mensagem de verdade deste pedido (com id do WhatsApp) já está em alguma
 * conversa da loja, o número de quem a mandou é o verificado — o pedido
 * nasce nesse cadastro, como no link pessoal (RN-021).
 */
export async function telefoneDoWhatsAppDoPedido(
  companyId: string,
  texto: string | null | undefined
): Promise<{ telefone: string; customerId: string } | null> {
  if (!texto || !ehTextoDePedidoDoCatalogo(texto)) return null;
  try {
    const [bolha] = await bolhasDoPedido(db, companyId, texto, true, []);
    if (!bolha) return null;
    return { telefone: bolha.conversation.customer.phone, customerId: bolha.conversation.customer.id };
  } catch (e) {
    await registrarFalha(e, "telefoneDoWhatsApp", companyId);
    return null;
  }
}

/**
 * LADO DO CATÁLOGO, NO FIM (pedido já criado): fecha a corrida em que o
 * webhook viu a bolha do catálogo mas o pedido ainda não existia (e por isso
 * não fundiu). Se a mensagem de verdade chegou de outro WhatsApp X enquanto o
 * pedido nascia, e o cadastro do digitado nasceu deste pedido, funde agora:
 * a bolha do catálogo (que ficou sem id) sai, a mensagem de verdade fica.
 * Nunca derruba a resposta do pedido.
 */
export async function juntarDepoisDoPedido(opts: {
  companyId: string;
  /** o cadastro em que o pedido nasceu (o do telefone digitado) */
  customerId: string;
  texto: string | null | undefined;
  /** a bolha que o intake do catálogo criou (null quando reaproveitou) */
  bolhaDoCatalogoId: string | null;
}): Promise<boolean> {
  const { companyId, customerId, texto, bolhaDoCatalogoId } = opts;
  if (!texto || !bolhaDoCatalogoId || !ehTextoDePedidoDoCatalogo(texto)) return false;
  try {
    const principalId = await db.$transaction(
      async (tx) => {
        await travarPeloTexto(tx, texto);
        const [real] = await bolhasDoPedido(tx, companyId, texto, true, [customerId]);
        if (!real) return null;
        const digitado = await tx.customer.findFirst({
          where: { id: customerId, companyId },
          select: { id: true, phone: true, origin: true, createdAt: true },
        });
        if (!digitado) return null;
        const x = real.conversation.customer;
        if (mesmoNumero(x.phone, digitado.phone)) return null;
        // a bolha do catálogo ainda é a sem id? Se o webhook já a adotou
        // (ganhou id), ele mesmo decidiu — nada a fazer aqui
        const bolha = await tx.message.findFirst({
          where: { id: bolhaDoCatalogoId, conversation: { companyId, customerId }, externalId: null },
          select: { id: true },
        });
        if (!bolha) return null;
        const situacao: SituacaoDaAdocao = {
          whatsappJaEhCliente: true,
          cadastroNasceuDoPedido: nasceuDoPedido(
            digitado,
            await falouPeloWhatsApp(tx, companyId, digitado.id)
          ),
          pedidoJaExiste: true,
        };
        if (decidirAdocao(situacao) !== "fundir-no-whatsapp") return null;
        const pedido = await tx.order.findFirst({
          where: { companyId, customerId: digitado.id },
          orderBy: { createdAt: "desc" },
          select: { number: true },
        });
        await tx.message.delete({ where: { id: bolha.id } });
        await repointCustomer(tx, x.id, digitado.id);
        await anotar(tx, companyId, x.id, real.conversation.id, notaDaFusao(digitado.phone, x.phone, pedido?.number ?? null));
        return x.id;
      },
      { maxWait: 10_000, timeout: 20_000 }
    );
    if (!principalId) return false;
    await consolidateOpenConversations(companyId, principalId);
    return true;
  } catch (e) {
    await registrarFalha(e, "juntarDepois", companyId);
    return false;
  }
}
