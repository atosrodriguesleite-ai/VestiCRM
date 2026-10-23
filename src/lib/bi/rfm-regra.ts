/**
 * O RFM DO BI — a regra PURA (RN-093, ADR-019). Sem banco: a tela do
 * navegador importa os grupos e as mensagens daqui, e o teste prova a conta
 * sem Postgres.
 *
 * Desenhado com o dono em 22/10/2026 ("todos os CRMs bons têm essa matriz, e
 * no nosso não tem"), para enxergar a carteira E agir nela — chamar no
 * WhatsApp, campanha, recompra —, aumentando o LTV. As decisões dele:
 *
 * 1. **As notas são da PRÓPRIA loja** (percentil, de 20 em 20%): as 20% que
 *    compraram mais recentemente ganham 5 em R, e assim por diante. A loja
 *    que repõe a cada 15 dias e a que compra por coleção são medidas cada uma
 *    pela sua régua — dias fixos ("90 dias = sumida") seriam injustos com uma
 *    das duas. Empate leva a MESMA nota (a ordem de leitura não decide), e o
 *    lado do empate é o que não engana (achado da revisão): em FREQUÊNCIA e
 *    VALOR o bloco empatado leva a nota do PÉ dele — "comprou uma vez" é o
 *    bloco enorme de quase toda loja e não pode subir só por ser comum, e
 *    pelo meio do bloco quem tem 2 compras levava a mesma nota de quem tem
 *    10; em RECÊNCIA leva a do TOPO — quem comprou no mesmo dia é igualmente
 *    recente, e a loja que vendeu para todas hoje não pode ver todas
 *    "Perdidas".
 * 2. **Frequência e Valor contam os ÚLTIMOS 12 MESES**: o RFM diz quanto a
 *    cliente vale HOJE. A que comprou muito há três anos e parou não é
 *    Campeã; quem não compra há mais de 12 meses é Perdida, sem nota.
 * 3. **Os grupos saem de R × FV** (a média de F e V, arredondada para cima
 *    no meio): "quão recente" × "quanto vale" — oito grupos com nome e com a
 *    ação de cada um. Novata é a da PRIMEIRA compra da vida, recente.
 *
 * O que NÃO é: não é a faixa da aba Recompra (ativa/esfriando/em risco/
 * sumida por dias fixos, RN-084). São duas réguas que respondem perguntas
 * diferentes — por isso nenhum grupo daqui se chama "Em risco": o mesmo nome
 * com outra regra faria a loja ver dois números para a mesma palavra.
 *
 * Venda = pedido pago com data de pagamento (RN-001, a régua da carteira) e
 * valor = `netTotal` (RN-002, sem o frete).
 */
import { primeiroNome } from "../comm/autoria";
import { nomeProvisorio } from "../nome-provisorio";
import { porcentagensQueFecham, r2 } from "../tracking/insights-puro";

export type GrupoRfm =
  | "CAMPEAS"
  | "FIEIS"
  | "PROMISSORAS"
  | "NOVATAS"
  | "ATENCAO"
  | "NAO_PERDER"
  | "HIBERNANDO"
  | "PERDIDAS";

/** os oito grupos, na ordem da tela (do melhor para o mais distante) */
export const GRUPOS_RFM: { id: GrupoRfm; rotulo: string; emoji: string; quem: string; acao: string }[] = [
  { id: "CAMPEAS", rotulo: "Campeãs", emoji: "🏆", quem: "Comprou há pouco e vale muito", acao: "Novidade primeiro, tratamento VIP" },
  { id: "FIEIS", rotulo: "Fiéis", emoji: "💚", quem: "Vale muito e comprou num tempo médio", acao: "Manter perto, avisar de reposição" },
  { id: "PROMISSORAS", rotulo: "Promissoras", emoji: "✨", quem: "Comprou há pouco, ainda vale pouco", acao: "Puxar para comprar mais" },
  { id: "NOVATAS", rotulo: "Novatas", emoji: "🌱", quem: "Primeira compra, recente", acao: "Fazer acontecer a 2ª compra" },
  { id: "ATENCAO", rotulo: "Precisam de atenção", emoji: "👀", quem: "Tempo médio e vale pouco", acao: "Chamar antes que esfrie" },
  { id: "NAO_PERDER", rotulo: "Não posso perder", emoji: "🚨", quem: "Valia muito e parou de comprar", acao: "Chamar hoje, com cuidado" },
  { id: "HIBERNANDO", rotulo: "Hibernando", emoji: "😴", quem: "Faz tempo e vale pouco", acao: "Campanha de reativação" },
  { id: "PERDIDAS", rotulo: "Perdidas", emoji: "👋", quem: "Sumiu há muito tempo (ou não compra há mais de 12 meses)", acao: "Última tentativa" },
];

export const IDS_DOS_GRUPOS = GRUPOS_RFM.map((g) => g.id);

export const grupoRfm = (id: GrupoRfm) => GRUPOS_RFM.find((g) => g.id === id)!;

/** a janela de Frequência e Valor */
export const DIAS_DA_JANELA = 365;
/** abaixo disso, as notas por percentil mudam muito de um dia para o outro (a tela avisa) */
export const POUCAS_CLIENTES = 20;
const DIA_MS = 86_400_000;

/**
 * A nota de 1 a 5 de cada valor, pelo percentil dentro da própria lista:
 * valores todos diferentes viram 20% em cada nota. Os IGUAIS levam a mesma
 * nota, a do pé do bloco (`empate: "baixo"`, quantos são estritamente
 * menores) ou a do topo (`"alto"`, quantos são menores ou iguais) — ver o
 * cabeçalho. Maior valor, maior nota: para recência, passe os dias com o
 * sinal trocado.
 */
export function notasPorPercentil(valores: number[], empate: "baixo" | "alto"): (v: number) => number {
  const ordenados = [...valores].sort((a, b) => a - b);
  const n = ordenados.length;
  // quantos valores ficam antes de v (busca binária): < v, ou ≤ v
  const contar = (v: number, inclusive: boolean) => {
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (ordenados[m] < v || (inclusive && ordenados[m] === v)) lo = m + 1;
      else hi = m;
    }
    return lo;
  };
  return (v: number) => {
    if (n === 0) return 3;
    if (empate === "baixo") return Math.min(5, 1 + Math.floor((contar(v, false) * 5) / n));
    return Math.max(1, Math.min(5, Math.ceil((contar(v, true) * 5) / n)));
  };
}

/** o grupo pela nota de recência e a nota conjunta de frequência e valor (pura) */
export function grupoDe(r: number, fv: number, comprasNaVida: number): GrupoRfm {
  if (r >= 4) {
    if (comprasNaVida <= 1) return "NOVATAS";
    return fv >= 4 ? "CAMPEAS" : "PROMISSORAS";
  }
  if (r === 3) return fv >= 4 ? "FIEIS" : "ATENCAO";
  if (fv >= 4) return "NAO_PERDER";
  return r === 2 ? "HIBERNANDO" : "PERDIDAS";
}

/** F e V viram UMA nota: a média, com o meio arredondado para cima (4 e 3 → 4) */
export const notaFv = (f: number, v: number) => Math.round((f + v) / 2);

/** o que o banco entrega por cliente (pedidos pagos com data, netTotal) */
export type BaseDoRfm = {
  id: string;
  /** compras pagas na vida inteira */
  compras: number;
  /** valor vendido na vida inteira (netTotal, sem frete) — o LTV */
  ltv: number;
  ultimaCompra: Date;
  /** compras pagas nos últimos 12 meses */
  compras12: number;
  /** valor vendido nos últimos 12 meses */
  valor12: number;
};

export type NotasDoRfm = {
  diasDesde: number;
  /** as notas (nulas para quem não compra há mais de 12 meses) */
  r: number | null;
  f: number | null;
  v: number | null;
  fv: number | null;
  grupo: GrupoRfm;
};

export type ClienteRfm = BaseDoRfm & NotasDoRfm;

/** As notas e o grupo de cada cliente, comparando-as com as da própria loja (pura). */
export function calcularRfm<T extends BaseDoRfm>(base: T[], agora: Date): (T & NotasDoRfm)[] {
  const dias = (c: BaseDoRfm) => Math.max(0, Math.floor((agora.getTime() - c.ultimaCompra.getTime()) / DIA_MS));
  // as notas comparam só quem comprou nos 12 meses: a Perdida de três anos
  // não pode empurrar todo mundo para cima em recência
  const ativas = base.filter((c) => c.compras12 > 0);
  const notaR = notasPorPercentil(ativas.map((c) => -dias(c)), "alto");
  const notaF = notasPorPercentil(ativas.map((c) => c.compras12), "baixo");
  const notaV = notasPorPercentil(ativas.map((c) => r2(c.valor12)), "baixo");
  return base.map((c): T & NotasDoRfm => {
    const diasDesde = dias(c);
    if (c.compras12 <= 0) return { ...c, diasDesde, r: null, f: null, v: null, fv: null, grupo: "PERDIDAS" as const };
    const r = notaR(-diasDesde);
    const f = notaF(c.compras12);
    const v = notaV(r2(c.valor12));
    const fv = notaFv(f, v);
    return { ...c, diasDesde, r, f, v, fv, grupo: grupoDe(r, fv, c.compras) };
  });
}

export type ResumoDoGrupo = {
  clientes: number;
  /** % das clientes (as oito fecham 100) */
  pctClientes: number;
  /** vendido nos 12 meses pelas clientes do grupo */
  valor12: number;
  /** % do vendido nos 12 meses (as oito fecham 100; nulo se a loja não vendeu nada) */
  pctReceita: number | null;
  /** LTV médio: o valor vendido na vida ÷ clientes (nulo no grupo vazio) */
  ltvMedio: number | null;
  /** soma do valor vendido na vida */
  totalVida: number;
};

export type ResumoDoRfm = {
  porGrupo: Record<GrupoRfm, ResumoDoGrupo>;
  /** todas as clientes com compra paga */
  clientes: number;
  /** as que compraram nos 12 meses (as que têm nota) */
  ativas: number;
  /** vendido nos 12 meses (soma dos grupos, já arredondados — o centavo fecha) */
  valor12: number;
  /** LTV médio da loja (nulo sem cliente) */
  ltvMedio: number | null;
  /** a loja tem poucas clientes com nota: o percentil oscila (a tela diz) */
  poucas: boolean;
};

/** Os números de cada grupo (pura). */
export function resumirRfm(clientes: ClienteRfm[]): ResumoDoRfm {
  const porGrupo = {} as Record<GrupoRfm, ResumoDoGrupo>;
  const centavos12 = new Map<GrupoRfm, number>();
  const centavosVida = new Map<GrupoRfm, number>();
  const contagem = new Map<GrupoRfm, number>();
  for (const c of clientes) {
    contagem.set(c.grupo, (contagem.get(c.grupo) ?? 0) + 1);
    centavos12.set(c.grupo, (centavos12.get(c.grupo) ?? 0) + Math.round(c.valor12 * 100));
    centavosVida.set(c.grupo, (centavosVida.get(c.grupo) ?? 0) + Math.round(c.ltv * 100));
  }
  const pctC = porcentagensQueFecham(IDS_DOS_GRUPOS.map((g) => contagem.get(g) ?? 0));
  const somaCentavos12 = IDS_DOS_GRUPOS.reduce((s, g) => s + (centavos12.get(g) ?? 0), 0);
  // dinheiro devolvido (pedido com valor negativo) não vira fatia negativa
  const pctR = porcentagensQueFecham(IDS_DOS_GRUPOS.map((g) => Math.max(0, centavos12.get(g) ?? 0)));
  IDS_DOS_GRUPOS.forEach((g, i) => {
    const n = contagem.get(g) ?? 0;
    const vida = (centavosVida.get(g) ?? 0) / 100;
    porGrupo[g] = {
      clientes: n,
      pctClientes: pctC[i],
      valor12: (centavos12.get(g) ?? 0) / 100,
      pctReceita: somaCentavos12 > 0 ? pctR[i] : null,
      ltvMedio: n ? r2(vida / n) : null,
      totalVida: vida,
    };
  });
  const ativas = clientes.filter((c) => c.r != null).length;
  const vidaTotal = IDS_DOS_GRUPOS.reduce((s, g) => s + (centavosVida.get(g) ?? 0), 0) / 100;
  return {
    porGrupo,
    clientes: clientes.length,
    ativas,
    valor12: somaCentavos12 / 100,
    ltvMedio: clientes.length ? r2(vidaTotal / clientes.length) : null,
    poucas: ativas > 0 && ativas < POUCAS_CLIENTES,
  };
}

/** a matriz clássica: R (linha, 5 → 1) × FV (coluna, 1 → 5), quantas clientes em cada célula — só quem tem nota */
export type MatrizDoRfm = number[][];

export function matrizDoRfm(clientes: ClienteRfm[]): MatrizDoRfm {
  // índice [r-1][fv-1]
  const m = Array.from({ length: 5 }, () => [0, 0, 0, 0, 0]);
  for (const c of clientes) if (c.r != null && c.fv != null) m[c.r - 1][c.fv - 1] += 1;
  return m;
}

/**
 * O grupo de uma CÉLULA da matriz, para o rótulo dela. É o grupo de quem cai
 * ali, com UMA exceção dita na legenda: a Novata (primeira compra da vida)
 * mora nas células de cima junto com as Promissoras e as Campeãs — a célula
 * mostra o grupo de quem já voltou a comprar.
 */
export function grupoDaCelula(r: number, fv: number): GrupoRfm {
  return grupoDe(r, fv, 2);
}

// ---- Mensagens prontas (a pessoa revisa e manda — nada sai sozinho, RN-017) --

/** "Oi Maria!" — ou "Oi!" quando o nome é o crachá provisório do sistema (nunca "Oi, Contato!") */
function saudacao(nome: string): string {
  if (nomeProvisorio(nome)) return "Oi!";
  return `Oi ${primeiroNome(nome)}!`;
}

/** A mensagem sugerida para chamar uma cliente do grupo (pura). */
export function mensagemDoGrupo(grupo: GrupoRfm, nome: string, link: string): string {
  const oi = saudacao(nome);
  switch (grupo) {
    case "CAMPEAS":
      return `${oi} 💎 Você é uma das nossas clientes mais especiais, então quis te mostrar primeiro o que acabou de chegar:\n${link}\n\nQuer que eu separe as peças do seu estilo antes de as grades quebrarem?`;
    case "FIEIS":
      return `${oi} 💛 Passando para te avisar: repusemos as grades e chegou novidade.\n${link}\n\nSe quiser, já monto o seu próximo pedido.`;
    case "PROMISSORAS":
      return `${oi} 😊 Que bom ter você com a gente! Separei o que está saindo mais por aqui:\n${link}\n\nPosso te sugerir um pedido com as peças que mais vendem?`;
    case "NOVATAS":
      return `${oi} 💛 Obrigada pela sua primeira compra! Como foi com as peças?\n\nJá chegou coisa nova no catálogo:\n${link}`;
    case "ATENCAO":
      return `${oi} Tudo bem? 😊 Faz um tempinho que a gente não conversa, e chegou muita novidade:\n${link}\n\nPosso te ajudar a montar o próximo pedido?`;
    case "NAO_PERDER":
      return `${oi} 💛 Sentimos sua falta por aqui! Você é uma cliente muito especial para nós.\n\nAconteceu alguma coisa? Quero muito te mostrar o que chegou:\n${link}`;
    case "HIBERNANDO":
      return `${oi} Tudo bem? Faz tempo! 😊 A coleção mudou bastante desde a sua última compra, dá uma espiada:\n${link}`;
    case "PERDIDAS":
      return `${oi} Quanto tempo! 💛 Lembrei de você e quis te mostrar as novidades da loja:\n${link}\n\nSe fizer sentido, estou por aqui.`;
  }
}
