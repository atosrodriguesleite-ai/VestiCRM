import { db } from "@/lib/db";
import { logServerError } from "@/lib/health";

/**
 * RECUSA DO PEDIDO DO CATÁLOGO DEIXA RASTRO (RN-010, 09/10/2026).
 *
 * Relato da Sutilli Semijoias: "o pedido chega no WhatsApp, mas não entra na
 * aba Pedidos — e acontece sempre". A rota do catálogo RECUSA o pedido em
 * quatro situações (dados inválidos, loja/peça que não existe, link de preço
 * vencido, mínimo do atacado), e a recusa só aparecia na tela do CELULAR DA
 * CLIENTE — a loja recebia a mensagem no WhatsApp e ficava sem o pedido, sem
 * nenhum lugar para descobrir por quê. O servidor é quem decide recusar,
 * então é ele quem deve contar: uma linha na Central de Comunicação da loja
 * (`catalogo.pedido-recusado`) e uma no painel de Saúde da plataforma.
 *
 * Na Saúde a recusa tem FONTE PRÓPRIA (`catalogo.recusa`) e fica FORA da
 * lista e da conta de erros — a mesma régua da "versão velha" da RN-066:
 * recusa é resposta decidida (e porta pública: robô mandando lixo também
 * cai aqui), e contá-la como erro do servidor enterraria os erros de
 * verdade. O painel mostra as últimas em bloco próprio.
 *
 * Nunca lança: o registro é aviso e não pode mudar a resposta à cliente.
 */

export const TIPO_PEDIDO_RECUSADO = "catalogo.pedido-recusado";
export const TIPO_FLOOD = "catalogo.flood";
/** fonte no painel de Saúde — fora da lista e da conta de erros */
export const FONTE_RECUSA_CATALOGO = "catalogo.recusa";
/** quantas variações cabem no detalhe "tem: …" antes de virar "e mais N" */
export const TETO_VARIACOES_NO_DETALHE = 20;

export type RecusaDoPedido = {
  /** o código HTTP que a cliente recebeu (400, 404, 409) */
  status: number;
  /** a frase devolvida à cliente */
  motivo: string;
  /** o que a loja precisa saber para consertar (qual peça, qual campo) */
  detalhe?: string | null;
  /** protocolo do envio (RN-010) — é o que liga o rastro ao aparelho */
  clientRef?: string | null;
  cliente?: { nome?: string | null; telefone?: string | null } | null;
  /** quantas linhas o pedido tinha */
  itens?: number | null;
};

export type LojaDoRastro = { id: string; name: string } | null;

/** Tudo o que vem do corpo da requisição é cortado: o esquema que limitaria já recusou. */
const curto = (v: string | null | undefined, max: number) =>
  v == null ? null : v.replace(/\s+/g, " ").trim().slice(0, max) || null;

/** Nome em português do campo que o esquema recusou (a lojista lê isto). */
const NOME_DO_CAMPO: Record<string, string> = {
  company: "endereço da loja",
  items: "lista de peças",
  productId: "código da peça",
  color: "cor da peça",
  size: "tamanho da peça",
  quantity: "quantidade",
  customer: "dados da cliente",
  name: "nome",
  phone: "telefone",
  store: "nome da loja da cliente",
  cep: "CEP",
  endereco: "endereço",
  bairro: "bairro",
  cidade: "cidade",
  estado: "estado",
  message: "mensagem do WhatsApp",
  ref: "link da vendedora",
  c: "link da cliente",
  promo: "catálogo de campanha",
  campanha: "link de campanha",
  campanhaDesconto: "desconto do link",
  link: "link de tabela de preço",
  clientRef: "protocolo do envio",
  trackSessionId: "sessão de navegação",
};

/**
 * Traduz um problema do esquema (Zod) para a frase que a lojista entende:
 * "tamanho da peça (items.0.size) em branco". O caminho técnico fica entre
 * parênteses para a plataforma.
 */
export function descreverCampoRecusado(issue: {
  path: PropertyKey[];
  code: string;
  message?: string;
}): string {
  const caminho = issue.path.map(String).join(".") || "(raiz)";
  const ultimo = [...issue.path].reverse().find((p) => typeof p === "string");
  const nome = (typeof ultimo === "string" && NOME_DO_CAMPO[ultimo]) || `campo ${caminho}`;
  const problema =
    issue.code === "too_small"
      ? "em branco"
      : issue.code === "too_big"
        ? "comprido demais"
        : issue.code === "invalid_type"
          ? /received undefined/i.test(issue.message ?? "")
            ? "faltando"
            : "em formato inválido"
          : "inválido";
  return `${nome} (${caminho}) ${problema}`;
}

/** O texto que a lojista lê — quem pediu, o que foi recusado e por quê. */
export function textoDaRecusa(r: RecusaDoPedido): string {
  const quem = [curto(r.cliente?.nome, 120), curto(r.cliente?.telefone, 30)]
    .filter(Boolean)
    .join(" · ");
  const partes = [
    `Pedido do catálogo RECUSADO (${r.status})${quem ? ` — ${quem}` : ""}${
      r.itens != null ? ` — ${r.itens} ${r.itens === 1 ? "linha" : "linhas"}` : ""
    }.`,
    `Motivo dito à cliente: ${curto(r.motivo, 300)}`,
    r.detalhe ? `Detalhe: ${curto(r.detalhe, 900)}` : null,
    r.clientRef ? `Protocolo: ${curto(r.clientRef, 60)}` : null,
    "A mensagem pode ter chegado no WhatsApp mesmo assim — confira com a cliente e, se precisar, use \"Colar pedido do WhatsApp\" na tela Pedidos.",
  ];
  return partes.filter(Boolean).join("\n");
}

/**
 * Lista de variações para o detalhe da peça que não casou, com teto: a peça
 * de 80 variações não pode engolir o resto do rastro.
 */
export function listarVariacoes(vs: { color: string; size: string }[]): string {
  if (vs.length === 0) return "nenhuma";
  const mostradas = vs
    .slice(0, TETO_VARIACOES_NO_DETALHE)
    .map((v) => `${curto(v.color, 40)} / ${curto(v.size, 40)}`)
    .join(", ");
  const resto = vs.length - TETO_VARIACOES_NO_DETALHE;
  return resto > 0 ? `${mostradas} e mais ${resto}` : mostradas;
}

/**
 * O RASTRO de uma decisão da porta do catálogo — uma função para a recusa e
 * para a trava de ritmo (RN-044), para não existirem duas escritas do mesmo
 * "deixa rastro" na mesma rota. Central de Comunicação da loja (quando a
 * loja é conhecida) + Saúde (fonte própria, sem alarme). Nunca lança.
 */
export async function gravarRastroDoCatalogo(input: {
  loja: LojaDoRastro;
  tipo: string;
  texto: string;
  /** o resumo de uma linha para o painel de Saúde */
  resumo: string;
}): Promise<void> {
  try {
    if (input.loja) {
      await db.commEvent.create({
        data: {
          companyId: input.loja.id,
          direction: "IN",
          type: input.tipo,
          status: "ERRO",
          error: input.texto.slice(0, 2000),
        },
      });
    }
  } catch {
    // aviso que falha não pode derrubar a resposta
  }
  await logServerError({
    source: FONTE_RECUSA_CATALOGO,
    path: "POST /api/catalog/order",
    message: `${input.loja ? `${input.loja.name}: ` : "loja desconhecida: "}${input.resumo}`.slice(0, 500),
    detail: `${input.loja ? `loja ${input.loja.id} (${input.loja.name})` : "loja desconhecida"}\n${input.texto}`,
    alarme: false,
  });
}

/** Grava o rastro de uma RECUSA do pedido. */
export async function registrarRecusaDoPedido(
  loja: LojaDoRastro,
  r: RecusaDoPedido
): Promise<void> {
  await gravarRastroDoCatalogo({
    loja,
    tipo: TIPO_PEDIDO_RECUSADO,
    texto: textoDaRecusa(r),
    resumo: `pedido do catálogo recusado (${r.status}) — ${curto(r.motivo, 200)}`,
  });
}
