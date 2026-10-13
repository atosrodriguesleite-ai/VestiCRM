/**
 * MOTIVO DE PERDA DA NEGOCIAÇÃO (RN-081) — lista fechada, regra pura.
 *
 * "Por que não fechou?" é a pergunta número um de quem organiza processo
 * comercial — e a resposta só serve se der para CONTAR. A tela do funil já
 * perguntava numa lista (o `window.prompt` não abria no celular e texto
 * livre virava "preço", "Preço" e "achou caro" em três barras), mas a lista
 * morava dentro da tela, o servidor aceitava qualquer texto e o relatório
 * agrupava por texto normalizado. Terceira peça do BI (ADR-019): a lista
 * vira fonte única, o texto gravado segue o padrão das trocas (RN-073)
 * — "Chip — detalhe" — e quem conta, conta pelo CHIP.
 */

export const OUTRO = "Outro";

/** Os motivos do atacado de moda, na linguagem da loja (a ordem é a da tela). */
export const MOTIVOS_DE_PERDA = [
  "Achou caro",
  "Não fechou o pedido mínimo",
  "Prazo de entrega",
  "Frete caro",
  "Não tinha a grade/tamanho",
  "Comprou de outro fornecedor",
  "Sumiu / não respondeu",
  "Só estava pesquisando",
  OUTRO,
] as const;
export type MotivoDePerda = (typeof MOTIVOS_DE_PERDA)[number];

/** Os botões da tela: tudo menos "Outro", que vira a caixinha do detalhe. */
export const MOTIVOS_DA_TELA = MOTIVOS_DE_PERDA.filter((m) => m !== OUTRO);

/** Motivos que o SISTEMA grava sozinho (não aparecem na lista da tela). */
export const MOTIVOS_DO_SISTEMA = ["Pedido cancelado"] as const;

export const SEPARADOR = " — ";
export const TETO_DO_DETALHE = 120;
export const SEM_MOTIVO = "Sem motivo registrado";

const TODOS: readonly string[] = [...MOTIVOS_DE_PERDA, ...MOTIVOS_DO_SISTEMA];

/**
 * Chave de comparação: minúsculas, sem acento, espaços colapsados, sem
 * espaços ao redor da barra. É o que faz "achou caro", "Achou Caro" e
 * "Sumiu/não respondeu" (gravados na era do texto livre) caírem no chip
 * certo na LEITURA — a porta, essa segue exigindo o chip como está escrito.
 */
export function chaveDoMotivo(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}
const CHIP_POR_CHAVE = new Map(TODOS.map((c) => [chaveDoMotivo(c), c]));

/** O texto gravado: "Chip — detalhe"; sem detalhe, só o chip; sem chip, "Outro". */
export function textoDoMotivoDePerda(chip: string, detalhe = ""): string {
  const d = detalhe.trim();
  const c = chip.trim() || OUTRO;
  return d ? `${c}${SEPARADOR}${d}` : c;
}

/** Separa "Chip — detalhe" (tolerando espaços tortos ao redor do travessão). */
function partir(texto: string): { chip: string; detalhe: string } {
  const t = texto.trim();
  const m = /^([\s\S]*?)\s*—\s*([\s\S]*)$/.exec(t);
  return m ? { chip: m[1].trim(), detalhe: m[2].trim() } : { chip: t, detalhe: "" };
}

/**
 * De QUAL chip é este texto gravado. Texto antigo que só difere em caixa,
 * acento ou espaço casa com o chip; o resto (frase livre, detalhe sem chip
 * conhecido) cai em "Outro" — nunca uma barra por frase. Nulo/vazio é "sem
 * motivo" (o relatório mostra à parte).
 */
export function chipDoMotivo(texto: string | null | undefined): string {
  const t = (texto ?? "").trim();
  if (!t) return SEM_MOTIVO;
  return CHIP_POR_CHAVE.get(chaveDoMotivo(partir(t).chip)) ?? OUTRO;
}

/**
 * O detalhe que a vendedora escreveu: o que vem depois do travessão — ou,
 * no texto antigo sem chip conhecido, o texto inteiro (ele É o detalhe).
 */
export function detalheDoMotivo(texto: string | null | undefined): string {
  const t = (texto ?? "").trim();
  if (!t) return "";
  const { chip, detalhe } = partir(t);
  if (CHIP_POR_CHAVE.has(chaveDoMotivo(chip))) return detalhe;
  return t;
}

export type MotivoLido =
  | { ok: true; chip: string; detalhe: string; texto: string }
  | { ok: false; erro: string };

/**
 * O que a porta aceita gravar: um chip da lista (os do sistema inclusos —
 * a sincronização do pedido cancelado passa por aqui), com detalhe
 * opcional até o teto. Devolve o texto CANÔNICO para gravar ("Chip —
 * detalhe", espaços arrumados) ou a frase da recusa.
 */
export function lerMotivoDePerda(texto: string): MotivoLido {
  const t = texto.trim();
  if (!t) return { ok: false, erro: "Informe o motivo da perda." };
  const { chip, detalhe } = partir(t);
  if (!TODOS.includes(chip)) {
    return {
      ok: false,
      erro: `Motivo fora da lista. Escolha um dos motivos ou use "${OUTRO}${SEPARADOR}detalhe".`,
    };
  }
  const limpo = detalhe.replace(/\s+/g, " ").trim();
  if (limpo.length > TETO_DO_DETALHE) {
    return { ok: false, erro: `O detalhe do motivo tem no máximo ${TETO_DO_DETALHE} letras.` };
  }
  return { ok: true, chip, detalhe: limpo, texto: textoDoMotivoDePerda(chip, limpo) };
}

/** Só a frase da recusa (null = está certo). Açúcar sobre `lerMotivoDePerda`. */
export function validarMotivoDePerda(texto: string): string | null {
  const r = lerMotivoDePerda(texto);
  return r.ok ? null : r.erro;
}

/** quantos detalhes diferentes a barra "Outro" lista embaixo */
const DETALHES_NA_BARRA = 3;

/**
 * A contagem do relatório: uma barra por CHIP, da maior para a menor, com
 * "Sem motivo registrado" por último quando houver. A barra "Outro" não
 * engole o que foi escrito: leva embaixo os detalhes mais repetidos
 * ("pediu boleto ×12") — uma barra por chip, sem perder a informação.
 */
export function contarPorMotivo(
  perdidas: { lostReason: string | null }[]
): { label: string; value: number; sub?: string }[] {
  const conta = new Map<string, number>();
  const detalhesDoOutro = new Map<string, { texto: string; vezes: number }>();
  for (const o of perdidas) {
    const chip = chipDoMotivo(o.lostReason);
    conta.set(chip, (conta.get(chip) ?? 0) + 1);
    if (chip === OUTRO) {
      const d = detalheDoMotivo(o.lostReason);
      if (!d) continue;
      const k = chaveDoMotivo(d);
      const atual = detalhesDoOutro.get(k) ?? { texto: d, vezes: 0 };
      atual.vezes += 1;
      detalhesDoOutro.set(k, atual);
    }
  }
  const sub = [...detalhesDoOutro.values()]
    .sort((a, b) => b.vezes - a.vezes || a.texto.localeCompare(b.texto, "pt-BR"))
    .slice(0, DETALHES_NA_BARRA)
    .map((d) => (d.vezes > 1 ? `${d.texto} ×${d.vezes}` : d.texto))
    .join(" · ");
  return [...conta.entries()]
    .map(([label, value]) => (label === OUTRO && sub ? { label, value, sub } : { label, value }))
    .sort((a, b) => {
      if (a.label === SEM_MOTIVO) return 1;
      if (b.label === SEM_MOTIVO) return -1;
      return b.value - a.value || a.label.localeCompare(b.label, "pt-BR");
    });
}
