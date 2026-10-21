import { normalizarBusca } from "../busca";

/**
 * RN-091 · FUNIL EDITÁVEL — as regras puras (sem banco, a tela também usa).
 *
 * A loja com a chave (`Company.funilEditavelEnabled`) cria, renomeia,
 * reordena e apaga etapas. O que NÃO se mexe é o que o resto do sistema usa
 * para funcionar:
 *  • GANHO e PERDIDO sempre existem (renomeia e muda a cor, não apaga): é
 *    para lá que o pedido pago e o cancelado levam o cartão
 *    (`opportunity-sync.ts`);
 *  • a PRIMEIRA etapa é a porta de entrada do lead (intake, catálogo,
 *    carrinho da Nuvemshop) — ela tem que ser ABERTA, senão lead novo
 *    nasceria "ganho" ou "perdido";
 *  • sempre sobra pelo menos UMA etapa aberta;
 *  • etapa para onde o sistema move o cartão sozinho (marco) fica ANTES da
 *    etapa de ganho: depois dela (o "Pós-venda" do funil padrão) a coluna
 *    quer dizer "já vendi", e um pedido aguardando pagamento cairia lá. É
 *    também o que segura o ganho no fim do funil — reabrir pedido estornado
 *    e o "em fechamento" do Dashboard contam as etapas ANTES do ganho;
 *  • apagar etapa com cartões exige DESTINO (aberto) — cartão nunca some.
 */

export const MARCOS = [
  "PRIMEIRO_CONTATO",
  "CATALOGO_ENVIADO",
  "NEGOCIACAO",
  "PAGAMENTO",
] as const;
export type Marco = (typeof MARCOS)[number];

/** O que o sistema já sabe reconhecer — o texto que a loja lê no editor. */
export const ROTULO_DO_MARCO: Record<Marco, string> = {
  PRIMEIRO_CONTATO: "A vendedora respondeu a cliente pela primeira vez",
  CATALOGO_ENVIADO: "A cliente abriu o catálogo",
  NEGOCIACAO: "Virou orçamento (pedido criado)",
  PAGAMENTO: "O pedido ficou aguardando pagamento",
};

/** Mais que isso o funil vira planilha — ninguém atualiza 20 colunas. */
export const TETO_DE_ETAPAS = 15;
export const TETO_DO_NOME = 40;

export type EtapaRegra = {
  id: string;
  name: string;
  isWon: boolean;
  isLost: boolean;
};

export const ehAberta = (e: { isWon: boolean; isLost: boolean }) => !e.isWon && !e.isLost;

/** Comparação de nome sem caixa, acento e espaço sobrando: "Catálogo" e
 *  "catalogo " são a MESMA etapa para quem lê o quadro. */
export function chaveDoNome(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Nome limpo para gravar (espaços repetidos viram um). */
export function limparNome(nome: string): string {
  return nome.replace(/\s+/g, " ").trim();
}

/** Recusa (em português) ou null. `proprioId` é a etapa sendo renomeada. */
export function problemaNoNome(
  nome: string,
  etapas: EtapaRegra[],
  proprioId?: string
): string | null {
  const limpo = limparNome(nome);
  if (!limpo) return "Dê um nome para a etapa.";
  if (limpo.length > TETO_DO_NOME)
    return `O nome pode ter no máximo ${TETO_DO_NOME} letras.`;
  const chave = chaveDoNome(limpo);
  const xara = etapas.find((e) => e.id !== proprioId && chaveDoNome(e.name) === chave);
  if (xara) return `Já existe a etapa "${xara.name}". Use outro nome.`;
  return null;
}

/** Cor do quadro: só #rrggbb (o que o seletor oferece). */
export function corValida(cor: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(cor);
}

/** Paleta do editor — as cores que o funil padrão já usa e mais algumas. */
export const PALETA = [
  "#94a3b8",
  "#38bdf8",
  "#818cf8",
  "#a78bfa",
  "#f472b6",
  "#dbba8b",
  "#f59e0b",
  "#fb923c",
  "#10b981",
  "#14b8a6",
  "#f43f5e",
  "#64748b",
];

/** Pode criar mais uma? */
export function problemaAoCriar(etapas: EtapaRegra[]): string | null {
  if (etapas.length >= TETO_DE_ETAPAS)
    return `O funil já tem ${TETO_DE_ETAPAS} etapas, o máximo. Junte ou apague alguma antes.`;
  return null;
}

/**
 * Onde a etapa nova entra: logo ANTES da primeira etapa de ganho/perda — é o
 * meio do funil, onde a loja quase sempre quer a coluna nova. Sem ganho nem
 * perda (não deveria acontecer), entra no fim. Devolve o índice na lista.
 */
export function posicaoDaNova(etapas: EtapaRegra[]): number {
  const i = etapas.findIndex((e) => !ehAberta(e));
  return i === -1 ? etapas.length : i;
}

/**
 * A nova ordem é aceitável? `atual` na ordem de hoje, `ids` na ordem pedida.
 * O conjunto tem que ser EXATAMENTE o de hoje (outra pessoa criou ou apagou
 * uma etapa no meio → recarregar), e a primeira tem que ser aberta.
 */
export function problemaNaOrdem(
  atual: EtapaRegra[],
  ids: string[],
  /** ids das etapas ligadas a algum marco */
  comMarco: string[] = []
): string | null {
  const hoje = new Set(atual.map((e) => e.id));
  const pedido = new Set(ids);
  if (
    ids.length !== atual.length ||
    pedido.size !== ids.length ||
    ids.some((id) => !hoje.has(id))
  )
    return "O funil mudou enquanto você editava. Feche e abra o editor de novo.";
  const primeira = atual.find((e) => e.id === ids[0]);
  if (primeira && !ehAberta(primeira))
    return `"${primeira.name}" não pode ser a primeira etapa: é por ela que o lead novo entra no funil.`;
  const posGanho = ids.findIndex((id) => atual.find((e) => e.id === id)?.isWon);
  if (posGanho !== -1) {
    const depois = comMarco.find((id) => ids.indexOf(id) > posGanho);
    if (depois) {
      const nome = atual.find((e) => e.id === depois)?.name;
      const ganho = atual.find((e) => e.id === ids[posGanho])?.name;
      return `"${nome}" recebe cartões sozinha (o sistema move para ela) e não pode ficar depois de "${ganho}" — ali o cartão de quem ainda não pagou pareceria venda feita. Mude a escolha em "O sistema move o cartão sozinho" antes.`;
    }
  }
  return null;
}

/** A etapa vem antes da etapa de ganho? (sem ganho, todas vêm) */
export function antesDoGanho(etapas: EtapaRegra[], id: string): boolean {
  const posGanho = etapas.findIndex((e) => e.isWon);
  const pos = etapas.findIndex((e) => e.id === id);
  return pos !== -1 && (posGanho === -1 || pos < posGanho);
}

/**
 * Pode apagar `alvoId` mandando os cartões para `destinoId`?
 * O destino é obrigatório SEMPRE (mesmo sem cartão, o vínculo de marcos e
 * de origem precisa de casa) e tem que ser outra etapa ABERTA.
 */
export function problemaAoApagar(
  etapas: EtapaRegra[],
  alvoId: string,
  destinoId: string | null | undefined,
  /** a etapa apagada tem marco? (eles vão junto para o destino) */
  alvoTemMarco = false
): string | null {
  const alvo = etapas.find((e) => e.id === alvoId);
  if (!alvo) return "Essa etapa não existe mais. Feche e abra o editor de novo.";
  if (alvo.isWon)
    return `"${alvo.name}" é a etapa de venda ganha: é para lá que o pedido pago leva o cartão. Ela pode ser renomeada, não apagada.`;
  if (alvo.isLost)
    return `"${alvo.name}" é a etapa de negociação perdida: é para lá que o pedido cancelado leva o cartão. Ela pode ser renomeada, não apagada.`;
  const abertas = etapas.filter(ehAberta);
  if (abertas.length <= 1) return "O funil precisa de pelo menos uma etapa aberta.";
  if (!destinoId) return "Escolha para qual etapa os cartões vão.";
  if (destinoId === alvoId) return "O destino tem que ser outra etapa.";
  const destino = etapas.find((e) => e.id === destinoId);
  if (!destino) return "A etapa de destino não existe mais. Feche e abra o editor de novo.";
  if (!ehAberta(destino))
    return "Os cartões só podem ir para uma etapa aberta (mandar para ganho ou perdido fecharia negociações sem ninguém decidir).";
  if (alvoTemMarco && !antesDoGanho(etapas, destino.id))
    return `O sistema move cartões sozinho para "${alvo.name}", e isso iria junto para "${destino.name}" — que fica depois da etapa de venda ganha. Escolha uma etapa antes dela.`;
  // apagar a primeira etapa: a próxima vira a porta de entrada — e ela tem
  // que ser aberta
  const resto = etapas.filter((e) => e.id !== alvoId);
  if (etapas[0]?.id === alvoId && resto[0] && !ehAberta(resto[0]))
    return `Apagar "${alvo.name}" deixaria "${resto[0].name}" como primeira etapa — e o lead novo não pode entrar como ganho ou perdido. Reordene antes.`;
  return null;
}

/** O marco pode apontar para essa etapa? (null = "não mover", sempre pode) */
export function problemaNoMarco(etapas: EtapaRegra[], stageId: string | null): string | null {
  if (stageId === null) return null;
  const e = etapas.find((x) => x.id === stageId);
  if (!e) return "Essa etapa não existe mais. Feche e abra o editor de novo.";
  if (!ehAberta(e))
    return "O sistema só move cartão sozinho para etapa aberta — ganho e perdido quem decide é o pedido (pago ou cancelado).";
  if (!antesDoGanho(etapas, stageId))
    return `"${e.name}" fica depois da etapa de venda ganha: ali o cartão de quem ainda não pagou pareceria venda feita. Escolha uma etapa antes dela.`;
  return null;
}
