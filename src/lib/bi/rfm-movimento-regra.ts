/**
 * O RETRATO DO MÊS NO RFM — a regra pura (RN-101, Etapa 4 do RFM).
 *
 * Pedido do dono: ver, mês a mês, quem SUBIU e quem CAIU de grupo. Decisão
 * que sustenta tudo: o retrato NÃO é gravado — é recalculado. O RFM de
 * qualquer dia sai dos pedidos pagos até aquele dia (RN-093), então "como
 * estava no dia 1º" é a mesma conta da aba Clientes com o relógio no dia 1º.
 * Assim a loja vê os meses de trás no primeiro dia em que abre a tela (uma
 * foto gravada só teria história a partir de hoje), e venda cancelada depois
 * sai também do passado — o retrato diz a verdade de hoje sobre aquele mês.
 *
 * A ordem dos grupos é a da tela (`GRUPOS_RFM`, do melhor ao mais distante),
 * a MESMA das quedas (RN-100): subir é ir para um grupo melhor, cair é ir
 * para um pior. Quem não tinha comprado antes do mês e comprou nele CHEGOU.
 */
import { GRUPOS_RFM, type GrupoRfm } from "./rfm-regra";

export const MOVIMENTOS = ["caiu", "subiu", "chegou", "ficou"] as const;
export type Movimento = (typeof MOVIMENTOS)[number];

/** "de onde veio" de quem chegou no mês: ainda não tinha comprado */
export const NOVA = "NOVA" as const;
export type Origem = GrupoRfm | typeof NOVA;

const posicao = (g: GrupoRfm) => GRUPOS_RFM.findIndex((x) => x.id === g);

/** O nome de onde a cliente veio — UM texto, para o cartão e a lista dizerem o mesmo. */
export function rotuloDaOrigem(o: Origem): string {
  if (o === NOVA) return "🆕 primeira compra";
  const g = GRUPOS_RFM.find((x) => x.id === o)!;
  return `${g.emoji} ${g.rotulo}`;
}

export function movimentoDe(antes: Origem, depois: GrupoRfm): Movimento {
  if (antes === NOVA) return "chegou";
  const a = posicao(antes);
  const d = posicao(depois);
  return d < a ? "subiu" : d > a ? "caiu" : "ficou";
}

export type Caminho = { antes: Origem; depois: GrupoRfm; movimento: Movimento; clientes: number };

export type RetratoDoMes = {
  mes: string;
  /** o mês ainda corre (o "depois" é agora, não o fim do mês) */
  emCurso: boolean;
  contagem: Record<Movimento, number>;
  /** quem tinha compra paga no começo e hoje não tem (cancelada, devolvida a orçamento, contato unificado) */
  semVendaAgora: number;
  /** os caminhos do mês, sem os que ficaram: as quedas primeiro, depois as subidas e as chegadas, pelo tamanho */
  caminhos: Caminho[];
  /** por grupo: quantas no começo, quantas no fim, quantas entraram e quantas saíram */
  porGrupo: Record<GrupoRfm, { comeco: number; fim: number; entraram: number; sairam: number }>;
};

/** Função PURA: o RFM do começo do mês × o do fim (ou de agora) → o retrato. */
export function compararRetratos(
  mes: string,
  antes: ReadonlyMap<string, GrupoRfm>,
  depois: { id: string; grupo: GrupoRfm }[],
  emCurso: boolean
): RetratoDoMes {
  const contagem: Record<Movimento, number> = { caiu: 0, subiu: 0, chegou: 0, ficou: 0 };
  const porGrupo = Object.fromEntries(
    GRUPOS_RFM.map((g) => [g.id, { comeco: 0, fim: 0, entraram: 0, sairam: 0 }])
  ) as RetratoDoMes["porGrupo"];
  const caminhos = new Map<string, Caminho>();
  for (const g of antes.values()) porGrupo[g].comeco++;
  const presentes = new Set<string>();
  for (const c of depois) {
    presentes.add(c.id);
    const de: Origem = antes.get(c.id) ?? NOVA;
    const mov = movimentoDe(de, c.grupo);
    contagem[mov]++;
    porGrupo[c.grupo].fim++;
    if (mov === "ficou") continue;
    porGrupo[c.grupo].entraram++;
    if (de !== NOVA) porGrupo[de].sairam++;
    const chave = `${de}>${c.grupo}`;
    const atual = caminhos.get(chave) ?? { antes: de, depois: c.grupo, movimento: mov, clientes: 0 };
    atual.clientes++;
    caminhos.set(chave, atual);
  }
  let semVendaAgora = 0;
  for (const [id, g] of antes) {
    if (presentes.has(id)) continue;
    semVendaAgora++;
    porGrupo[g].sairam++;
  }
  const peso: Record<Movimento, number> = { caiu: 0, subiu: 1, chegou: 2, ficou: 3 };
  const ordem = (c: Caminho) => (c.antes === NOVA ? -1 : posicao(c.antes));
  return {
    mes,
    emCurso,
    contagem,
    semVendaAgora,
    caminhos: [...caminhos.values()].sort(
      (a, b) => peso[a.movimento] - peso[b.movimento] || b.clientes - a.clientes || ordem(a) - ordem(b) || posicao(a.depois) - posicao(b.depois)
    ),
    porGrupo,
  };
}

/**
 * Os meses que a tela oferece: o corrente e os `quantos − 1` anteriores, do
 * mais novo ao mais velho — e o escolhido, se for mais velho que eles (a URL
 * aceita os últimos 12; sem isso o mês escolhido não teria botão marcado).
 */
export function mesesDoRetrato(mesAtual: string, quantos = 6, escolhido?: string): string[] {
  const [a, m] = mesAtual.split("-").map(Number);
  const meses = Array.from({ length: quantos }, (_, i) => {
    const d = new Date(Date.UTC(a, m - 1 - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
  return escolhido && !meses.includes(escolhido) ? [...meses, escolhido] : meses;
}

/** O mês pedido na URL, se for um dos que a tela oferece (os últimos 12); senão, `null`. */
export function lerMesDoRetrato(texto: unknown, mesAtual: string): string | null {
  if (typeof texto !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(texto)) return null;
  return mesesDoRetrato(mesAtual, 12).includes(texto) ? texto : null;
}

/** 0h de São Paulo do dia 1º do mês (03:00 UTC — a régua de `inicioDoMesSP`). */
export function inicioDoMes(mes: string): Date {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, 1, 3, 0, 0));
}

/** "2026-12" → "2027-01" */
export function mesSeguinte(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`;
}

/** O mês por extenso, para a tela ("outubro de 2026"). */
export function nomeDoMes(mes: string): string {
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${mes}-15T12:00:00Z`)
  );
}
