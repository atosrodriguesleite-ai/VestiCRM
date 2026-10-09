import { z } from "zod";

/**
 * PEÇAS EXTRAS — O PEDIDO PODE PEDIR MAIS DO QUE O ESTOQUE TEM, COM CIÊNCIA
 * (RN-075, 09/10/2026). Regra pura: serve à tela e ao servidor.
 *
 * Pedido do dono: *"quando a vendedora está montando um pedido e não tem a
 * peça em estoque, ela é impedida de lançar"* — e numa confecção a peça que
 * falta é FEITA para aquele pedido. Decidido com ele:
 *  - o que existe no estoque fica SEGURADO como sempre (RN-003); o que passa
 *    disso é EXTRA — produzido para este pedido, e por isso NÃO mexe em
 *    estoque nenhum: não reserva, não baixa, não fica negativo e não vai
 *    para a Nuvemshop (lá só chega o que de fato saiu daqui);
 *  - a pessoa CONFIRMA que está ciente antes de gravar, e o histórico do
 *    pedido diz quem confirmou e quais peças;
 *  - quando a peça é lançada no estoque depois, nada é segurado sozinho: o
 *    extra fica anotado (é peça que a confecção faz, não estoque esquecido).
 *
 * O EXTRA NÃO TEM COLUNA NO BANCO: é o que o pedido pede além do que o LIVRO
 * DE MOVIMENTOS diz que ele segura (`baixasLiquidasDoPedido`). Assim todo
 * caminho que já respeita o livro — cancelar devolve só o que saiu, editar
 * para menos tira primeiro do extra, reabrir pedido baixado não desconta de
 * novo — acerta o extra sem lembrar dele. Um número gravado à parte teria de
 * ser lembrado em cada uma dessas portas, e "esqueceu uma" é a classe de
 * defeito que mais custou aqui (RN-059).
 */

/** Uma peça que vai entrar (em parte) como extra nesta operação. */
export type ExtraDaPeca = {
  variantId: string;
  /** nome legível: "Regata Alça (Preto M)" */
  label: string;
  /** o que esta operação precisa tirar do estoque */
  precisa: number;
  /** o que o estoque cobre (vai ficar segurado) */
  doEstoque: number;
  /** o resto: vira extra, feito para este pedido */
  extra: number;
};

/**
 * O que a tela manda depois de a pessoa confirmar: por peça, quantos extras
 * ela VIU e aceitou. O servidor aceita o pedido só se os extras de verdade
 * (contados por ele, na hora) couberem nisso — o estoque que cai entre a
 * janela e o clique não vira extra que ninguém confirmou.
 */
export const extrasConfirmadosSchema = z
  .record(z.string().min(1), z.number().int().min(0).max(100_000))
  .optional();
export type ExtrasConfirmados = z.infer<typeof extrasConfirmadosSchema>;

/**
 * Os extras que uma operação vai criar: por peça, o que precisa sair do
 * estoque contra o que há. `precisa` já vem SOMADO por peça (a mesma peça em
 * duas linhas é uma conta só, régua do `juntarPorVariacao`).
 */
export function extrasPrevistos(
  pedidos: readonly { variantId: string; label: string; precisa: number }[],
  disponivel: ReadonlyMap<string, number>
): ExtraDaPeca[] {
  const extras: ExtraDaPeca[] = [];
  for (const p of pedidos) {
    if (p.precisa <= 0) continue;
    const doEstoque = Math.min(p.precisa, Math.max(0, disponivel.get(p.variantId) ?? 0));
    const extra = p.precisa - doEstoque;
    if (extra > 0) extras.push({ variantId: p.variantId, label: p.label, precisa: p.precisa, doEstoque, extra });
  }
  return extras;
}

/** Os extras que a pessoa NÃO confirmou (vazio = pode gravar). */
export function extrasSemCiencia(
  extras: readonly ExtraDaPeca[],
  confirmados: ExtrasConfirmados
): ExtraDaPeca[] {
  return extras.filter((e) => e.extra > (confirmados?.[e.variantId] ?? 0));
}

/** A confirmação que a tela manda de volta: exatamente o que a janela mostrou. */
export function confirmacaoDosExtras(extras: readonly ExtraDaPeca[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const e of extras) c[e.variantId] = (c[e.variantId] ?? 0) + e.extra;
  return c;
}

/**
 * O corpo do 409 quando há extra sem ciência. O `error` continua sendo a
 * frase de sempre ("Estoque insuficiente de X: restam N") — as telas que não
 * oferecem extra (Central, "Colar pedido do WhatsApp") seguem mostrando só
 * ela; as que oferecem leem `extras` e abrem a janela de confirmação.
 */
export function respostaDeExtras(extras: readonly ExtraDaPeca[]) {
  const primeira = extras[0];
  return {
    error: primeira
      ? `Estoque insuficiente de ${primeira.label}: restam ${primeira.doEstoque}`
      : "Estoque insuficiente",
    extras,
  };
}

/** A linha do histórico do pedido: quem confirmou e quais peças são extras. */
export function textoDosExtras(extras: readonly ExtraDaPeca[], quem: string): string {
  const total = extras.reduce((s, e) => s + e.extra, 0);
  const lista = extras.map((e) => `${e.label}: ${e.extra}`).join("; ");
  return `${MARCA_DOS_EXTRAS}${total} ${total === 1 ? "peça EXTRA" : "peças EXTRAS"} (sem estoque, feitas para este pedido), confirmadas por ${quem} — ${lista}. Não saíram do estoque.`;
}

/**
 * QUANTAS PEÇAS DO PEDIDO SÃO EXTRAS AGORA — o que ele pede além do que
 * segura, por peça. Só vale para pedido que SEGURA estoque (os itens da
 * Nuvemshop são baixados lá, e cancelado não segura nada); item sem vínculo
 * com o cadastro não conta (não há peça para segurar).
 */
export function extrasDoPedido(
  itens: readonly { variantId: string | null; quantity: number }[],
  segurado: ReadonlyMap<string, number>,
  /**
   * As TROCAS do pedido (RN-073), por peça: o livro já conta a peça que
   * voltou e a que saiu na troca, e os itens não — sem o ajuste, a peça
   * devolvida pareceria extra. O pacote é itens ± trocas, nunca negativo
   * (`ajusteDasTrocasPorVariacao`, a régua da própria troca).
   */
  ajusteDasTrocas: ReadonlyMap<string, number> = new Map()
): Map<string, number> {
  const pedido = new Map<string, number>();
  for (const i of itens) {
    if (!i.variantId || i.quantity <= 0) continue;
    pedido.set(i.variantId, (pedido.get(i.variantId) ?? 0) + i.quantity);
  }
  for (const [variantId, delta] of ajusteDasTrocas) {
    pedido.set(variantId, Math.max(0, (pedido.get(variantId) ?? 0) + delta));
  }
  const extras = new Map<string, number>();
  for (const [variantId, q] of pedido) {
    const e = q - (segurado.get(variantId) ?? 0);
    if (e > 0) extras.set(variantId, e);
  }
  return extras;
}

/** A soma de `extrasDoPedido`. */
export const totalDeExtras = (extras: ReadonlyMap<string, number>) =>
  [...extras.values()].reduce((s, n) => s + n, 0);

/**
 * Este pedido tem extras para mostrar? Só o que segura estoque AQUI e ainda
 * está na loja (cancelado e o que já saiu ficam de fora) (o da loja online tem `stockDeducted` mas foi baixado lá —
 * o livro daqui fica vazio e tudo pareceria extra). E o pedido que segura estoque mas não tem NENHUM movimento no
 * livro, criado antes desta regra, fica de fora: não dá para saber se ele
 * nasceu antes de o livro registrar o pedido (diria "tudo extra" de um
 * pedido que segurou tudo) — depois dela, pedido todo extra é legítimo.
 */
export const INICIO_DOS_EXTRAS = new Date("2026-10-08T00:00:00-03:00");

/**
 * Enquanto o pedido está NA LOJA o extra é trabalho pendente; depois que ele
 * sai (enviado, entregue, entregue a receber) a peça foi com a cliente e o
 * selo não diz mais nada — sem isso o pedido entregue há meses seguia
 * marcado (achado da revisão). É a MESMA lista do reservado do Estoque
 * (`STATUS_QUE_SEGURAM_NA_LOJA`, conferida pelo teste — não dá para
 * importá-la daqui: este arquivo vai para o navegador e aquele lê o banco).
 */
export const STATUS_COM_EXTRA_PENDENTE = [
  "ORCAMENTO",
  "AGUARDANDO_PAGAMENTO",
  "PAGO",
  "EM_PRODUCAO",
  "SEPARACAO",
] as const;

/**
 * A linha do histórico que a confirmação grava começa por aqui: é por ela
 * que a tela separa o extra CONFIRMADO (a confecção vai fazer) da falta que
 * ninguém confirmou — o pedido do catálogo que entrou com estoque a menos
 * (RN-067) ou o Pix que liquidou sem peça. As duas são "pede mais do que
 * segura", mas só a primeira é compromisso de produção (achado da revisão).
 */
export const MARCA_DOS_EXTRAS = "🧵 ";

export function pedidoMostraExtras(o: {
  status: string;
  stockDeducted: boolean;
  /** pedido da loja online: a Nuvemshop baixou lá, o livro daqui fica vazio */
  nuvemshopId: string | null;
  createdAt: Date;
  temMovimento: boolean;
}): boolean {
  if (!o.stockDeducted || o.nuvemshopId) return false;
  if (!(STATUS_COM_EXTRA_PENDENTE as readonly string[]).includes(o.status)) return false;
  return o.temMovimento || o.createdAt >= INICIO_DOS_EXTRAS;
}

/**
 * A transação achou extra que a pessoa não confirmou (o estoque caiu entre a
 * janela e o clique, ou a tela nem perguntou): desfaz tudo e a rota responde
 * 409 com a lista NOVA — a janela reabre com os números de agora.
 */
export class ExtrasSemCiencia extends Error {
  constructor(readonly extras: ExtraDaPeca[]) {
    super("extras sem ciência");
  }
}
