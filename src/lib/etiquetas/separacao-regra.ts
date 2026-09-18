/**
 * A REGRA DO BIPE (RN-060) — pura, a MESMA no navegador e no servidor.
 *
 * O leitor manda um código; a resposta tem que sair na hora (o navegador
 * decide sem esperar o servidor) e tem que ser a mesma que o servidor
 * daria na segunda tranca. Por isso a decisão mora aqui, sem banco:
 *
 *   • peça que NÃO está no pedido → recusada ("peça errada");
 *   • peça do pedido já completa → recusada ("quantidade a mais") —
 *     é o mesmo erro do outro lado, e o pacote sairia com peça a mais;
 *   • senão → aceita, e a contagem daquela linha sobe 1.
 *
 * Código inválido (dígito verificador errado, leitura truncada) nem chega a
 * ser procurado: é recusado como "código ilegível".
 */

import { lerCodigoBipado } from "./ean13";
import { PAID_ORDER_STATUSES } from "../orders";

/** Status em que o pedido JÁ SAIU da loja: não há mais o que separar. */
const SAIU_DA_LOJA = new Set<string>(["ENVIADO", "ENTREGUE"]);

/**
 * Pedidos que entram na fila de separação: PAGOS (RN-001) e ainda dentro da
 * loja. Derivado da lista de venda, não escrito à mão — status novo no fluxo
 * entra aqui sozinho (o teste confere contra a lista do Estoque).
 */
export const STATUS_NA_FILA = PAID_ORDER_STATUSES.filter((s) => !SAIU_DA_LOJA.has(s));

/**
 * O PACOTE mudou? Compara o que o pedido pedia (variação × quantidade) com
 * o que passa a pedir. Editar só preço ou desconto não muda o pacote — e
 * mandar de volta para a fila um pedido já separado por causa de um
 * centavo faria a equipe conferir de novo o que já está pronto (achado da
 * revisão). Item sem variação (texto livre) conta pelo nome.
 */
export function pacoteMudou(
  antes: { variantId: string | null; name?: string; quantity: number }[],
  depois: { variantId: string | null; name?: string; quantity: number }[]
): boolean {
  const somar = (lista: typeof antes) => {
    const m = new Map<string, number>();
    for (const i of lista) {
      const chave = i.variantId ?? `nome:${i.name ?? ""}`;
      m.set(chave, (m.get(chave) ?? 0) + i.quantity);
    }
    return m;
  };
  const a = somar(antes);
  const d = somar(depois);
  if (a.size !== d.size) return true;
  for (const [k, q] of a) if (d.get(k) !== q) return true;
  return false;
}

export type ItemDaSeparacao = {
  variantId: string;
  rotulo: string;
  detalhe: string;
  codigo: string;
  /** quantidade no pedido */
  pedida: number;
  /** quantas já foram bipadas */
  bipada: number;
  /** quantas a loja declarou em FALTA (não tinha na arara) */
  falta: number;
};

export type ResultadoDoBipe =
  | { aceito: true; indice: number; item: ItemDaSeparacao; completa: boolean }
  | { aceito: false; motivo: "codigo-ilegivel" | "peca-errada" | "quantidade-a-mais"; indice: number | null; frase: string };

export function avaliarBipe(itens: ItemDaSeparacao[], entrada: string): ResultadoDoBipe {
  const codigo = lerCodigoBipado(entrada);
  if (!codigo) {
    return { aceito: false, motivo: "codigo-ilegivel", indice: null, frase: "Código ilegível. Bipe de novo." };
  }
  const indice = itens.findIndex((i) => i.codigo === codigo);
  if (indice < 0) {
    return { aceito: false, motivo: "peca-errada", indice: null, frase: "Peça ERRADA: não está neste pedido." };
  }
  const item = itens[indice];
  if (item.bipada + item.falta >= item.pedida) {
    return {
      aceito: false,
      motivo: "quantidade-a-mais",
      indice,
      frase: `${[item.rotulo, item.detalhe].filter(Boolean).join(" ")} já está completa (${item.pedida}). Peça a mais.`,
    };
  }
  const novo = { ...item, bipada: item.bipada + 1 };
  return { aceito: true, indice, item: novo, completa: novo.bipada + novo.falta >= novo.pedida };
}

/** Aplica um bipe aceito e devolve a lista nova (sem mexer na antiga). */
export function aplicarBipe(itens: ItemDaSeparacao[], r: ResultadoDoBipe): ItemDaSeparacao[] {
  if (!r.aceito) return itens;
  return itens.map((i, k) => (k === r.indice ? r.item : i));
}

export function resumoDaSeparacao(itens: ItemDaSeparacao[]) {
  const pedidas = itens.reduce((s, i) => s + i.pedida, 0);
  const bipadas = itens.reduce((s, i) => s + i.bipada, 0);
  const faltas = itens.reduce((s, i) => s + i.falta, 0);
  return { pedidas, bipadas, faltas, faltamBipar: pedidas - bipadas - faltas, completa: pedidas - bipadas - faltas <= 0 };
}

/**
 * Só conclui com TODA linha fechada: bipada + falta declarada = pedida.
 * Pedido SEM peça com código (item de texto livre, SKU da Nuvemshop que não
 * casou, peça apagada) conclui como "conferido na mão" — senão ele ficava
 * na cabeça da fila para sempre, sem saída (achado da revisão).
 */
export function podeConcluir(itens: ItemDaSeparacao[], semCodigo = 0): boolean {
  if (itens.length === 0) return semCodigo > 0;
  return itens.every((i) => i.bipada + i.falta === i.pedida);
}

/**
 * O PEDIDO DE AGORA manda nas quantidades e nos códigos; o que está GRAVADO
 * manda nas contagens (bipada e falta, nunca acima do que o pedido pede
 * hoje). É a única leitura da separação em andamento — abrir, bipar,
 * declarar falta e concluir passam por aqui, então a lojista que edita o
 * pedido no meio (peça nova, quantidade a mais) tem a mudança no bipe
 * seguinte, sem fechar a separação.
 */
export function mesclarComGravado(doPedido: ItemDaSeparacao[], gravados: ItemDaSeparacao[]): ItemDaSeparacao[] {
  const porId = new Map(gravados.map((g) => [g.variantId, g]));
  return doPedido.map((i) => {
    const g = porId.get(i.variantId);
    if (!g) return i;
    const bipada = Math.max(0, Math.min(i.pedida, g.bipada));
    const falta = Math.max(0, Math.min(i.pedida - bipada, g.falta));
    return { ...i, bipada, falta };
  });
}

/** Marca uma quantidade em falta numa linha (nunca além do que ainda não foi bipado). */
export function declararFalta(itens: ItemDaSeparacao[], variantId: string, falta: number): ItemDaSeparacao[] {
  return itens.map((i) =>
    i.variantId === variantId ? { ...i, falta: Math.max(0, Math.min(i.pedida - i.bipada, Math.floor(falta))) } : i
  );
}

/** Lê a lista gravada (JSON) — só o que é válido; linha torta cai fora. */
export function lerItensDaSeparacao(json: string | null | undefined): ItemDaSeparacao[] {
  if (!json) return [];
  try {
    const lido = JSON.parse(json);
    if (!Array.isArray(lido)) return [];
    const saida: ItemDaSeparacao[] = [];
    for (const e of lido) {
      if (!e || typeof e !== "object") continue;
      const o = e as Record<string, unknown>;
      if (typeof o.variantId !== "string" || typeof o.codigo !== "string" || typeof o.pedida !== "number") continue;
      saida.push({
        variantId: o.variantId,
        rotulo: typeof o.rotulo === "string" ? o.rotulo : "",
        detalhe: typeof o.detalhe === "string" ? o.detalhe : "",
        codigo: o.codigo,
        pedida: Math.max(0, Math.floor(o.pedida)),
        bipada: typeof o.bipada === "number" ? Math.max(0, Math.floor(o.bipada)) : 0,
        falta: typeof o.falta === "number" ? Math.max(0, Math.floor(o.falta)) : 0,
      });
    }
    return saida;
  } catch {
    return [];
  }
}

/**
 * A CONTAGEM DO SERVIDOR É A QUE VALE na conclusão: bipada é o que o
 * servidor confirmou, bipe a bipe (a segunda tranca) — o número que o
 * navegador manda NÃO sobe contagem nenhuma (subir seria concluir "4 de 4
 * bipadas" sem um bipe confirmado, achado da revisão). O que vem do
 * navegador é só a FALTA declarada (decisão de quem está na arara), e cabe
 * no que ainda não foi bipado.
 */
export function conciliarContagens(
  servidor: ItemDaSeparacao[],
  navegador: { variantId: string; falta: number }[]
): ItemDaSeparacao[] {
  const porId = new Map(navegador.map((n) => [n.variantId, n]));
  return servidor.map((s) => {
    const n = porId.get(s.variantId);
    if (!n) return s;
    const falta = Math.max(0, Math.min(s.pedida - s.bipada, Math.floor(n.falta)));
    return { ...s, falta };
  });
}
