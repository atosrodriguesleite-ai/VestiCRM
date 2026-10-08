/**
 * RELATÓRIO DE TROCAS (RN-073, parte 3) — aba "Trocas" do Estoque.
 *
 * O dono pediu porque "está tendo muita troca": a pergunta é QUAL peça
 * volta, POR QUÊ, e QUANTO isso mexeu em dinheiro. Tudo sai dos registros
 * da troca (`Troca`/`TrocaItem`), que guardam o retrato da peça — produto
 * apagado ou renomeado não some da conta. A data é a da TROCA (não a da
 * venda): é quando a peça voltou para a loja.
 *
 * Montagem pura (testada sem banco) + a consulta, recortada pela loja
 * (RN-013). A aba é de gerência: mostra dinheiro (a régua do Painel).
 */
import { db } from "@/lib/db";
import { round2 } from "@/lib/orders";
import { chaveDeGrupo } from "@/lib/tracking/insights-puro";
import { MOTIVOS_DA_TROCA } from "./regra";

export const TETO_DE_TROCAS = 2000;

export type TrocaParaRelatorio = {
  id: string;
  numero: number;
  createdAt: Date;
  motivo: string | null;
  diferenca: number;
  resolucao: string;
  resolvidaEm: Date | null;
  registradaPorNome: string;
  order: { id: string; number: number; status: string; customer: { name: string } };
  itens: {
    sentido: string;
    productId: string | null;
    name: string;
    color: string | null;
    size: string | null;
    quantity: number;
    destino: string | null;
  }[];
};

export type PecaQueVolta = {
  chave: string;
  nome: string;
  cor: string;
  tamanho: string;
  voltaram: number;
  defeito: number;
  trocas: number;
};

export type RelatorioDeTrocas = {
  totais: {
    trocas: number;
    /**
     * trocas de pedido que DEPOIS foi cancelado: as peças voltaram (contam
     * nas peças), mas o dinheiro da troca foi desfeito junto com a venda —
     * fica FORA dos cartões de dinheiro (achado da revisão)
     */
    deCancelados: number;
    pecasVoltaram: number;
    pecasDefeito: number;
    pecasSairam: number;
    /** diferença que a cliente pagou e a loja confirmou ter recebido */
    recebido: number;
    /** diferença a cobrar ainda não confirmada */
    aReceber: number;
    /** dinheiro devolvido à cliente (confirmado) */
    devolvido: number;
    /** devolução ainda não confirmada */
    aDevolver: number;
    /** crédito dado na ficha das clientes */
    creditoDado: number;
  };
  motivos: { motivo: string; trocas: number; pct: number }[];
  pecas: PecaQueVolta[];
  /** quantas peças diferentes voltaram (a tabela mostra as 30 primeiras) */
  pecasDistintas: number;
  ultimas: {
    id: string;
    numero: number;
    quando: string;
    pedidoId: string;
    pedido: number;
    cliente: string;
    por: string;
    voltou: string;
    levou: string;
    diferenca: number;
    resolucao: string;
    acertada: boolean;
    pedidoCancelado: boolean;
  }[];
  truncado: boolean;
};

/**
 * O motivo conta pelo CHIP do cardápio ("Tamanho — ficou pequena" é
 * Tamanho). Texto que não começa por um chip (troca registrada antes do
 * cardápio, ou o "Outro" antigo, que gravava só a frase) conta como
 * "Outro" — cada frase virar uma linha era o defeito. Vazio é "Sem motivo".
 */
export function motivoDoChip(motivo: string | null): string {
  const m = (motivo ?? "").trim();
  if (!m) return "Sem motivo";
  const inicio = chaveDeGrupo(m.split(" — ")[0]);
  const chip = MOTIVOS_DA_TROCA.find((c) => chaveDeGrupo(c) === inicio);
  return chip ?? "Outro";
}

/**
 * Porcentagens inteiras que FECHAM 100 (a sobra vai para quem tem o maior
 * resto — a régua da RN-030/RN-061: as partes somam o todo, nunca 99%).
 */
export function porcentagensQueFecham(contagens: number[]): number[] {
  const total = contagens.reduce((s, n) => s + n, 0);
  if (total <= 0) return contagens.map(() => 0);
  const brutas = contagens.map((n) => (n / total) * 100);
  const base = brutas.map(Math.floor);
  let falta = 100 - base.reduce((s, n) => s + n, 0);
  const ordem = brutas.map((b, i) => ({ i, resto: b - Math.floor(b) })).sort((a, b) => b.resto - a.resto || a.i - b.i);
  for (const { i } of ordem) {
    if (falta <= 0) break;
    base[i]++;
    falta--;
  }
  return base;
}

/** A chave da peça: o PRODUTO (pelo id) × cor × tamanho; produto apagado, pelo nome do retrato. */
function chaveDaPecaDoRelatorio(i: { productId: string | null; name: string; color: string | null; size: string | null }) {
  // a MESMA régua de agrupar nome da curva ABC (caixa, acento, invisível)
  const base = i.productId ? `p:${i.productId}` : `n:${chaveDeGrupo(i.name)}`;
  return `${base}|${chaveDeGrupo(i.color ?? "")}|${chaveDeGrupo(i.size ?? "")}`;
}

const rotulo = (i: { name: string; color: string | null; size: string | null; quantity: number }) => {
  const det = [i.color, i.size].filter(Boolean).join(" ");
  return `${i.quantity}× ${i.name}${det ? ` (${det})` : ""}`;
};

export function montarRelatorioDeTrocas(trocas: TrocaParaRelatorio[], truncado = false): RelatorioDeTrocas {
  const totais = {
    trocas: trocas.length,
    deCancelados: 0,
    pecasVoltaram: 0,
    pecasDefeito: 0,
    pecasSairam: 0,
    recebido: 0,
    aReceber: 0,
    devolvido: 0,
    aDevolver: 0,
    creditoDado: 0,
  };
  const motivos = new Map<string, number>();
  const pecas = new Map<string, PecaQueVolta & { trocasVistas: Set<string> }>();

  for (const t of trocas) {
    const m = motivoDoChip(t.motivo);
    motivos.set(m, (motivos.get(m) ?? 0) + 1);
    const cancelado = t.order.status === "CANCELADO";
    if (cancelado) totais.deCancelados++;
    if (cancelado) {
      // o dinheiro desta troca foi desfeito com a venda (RN-074)
    } else if (t.resolucao === "COBRAR") {
      if (t.resolvidaEm) totais.recebido += t.diferenca;
      else totais.aReceber += t.diferenca;
    } else if (t.resolucao === "DEVOLUCAO") {
      if (t.resolvidaEm) totais.devolvido += -t.diferenca;
      else totais.aDevolver += -t.diferenca;
    } else if (t.resolucao === "CREDITO") {
      totais.creditoDado += -t.diferenca;
    }
    for (const i of t.itens) {
      if (i.sentido === "SAI") {
        totais.pecasSairam += i.quantity;
        continue;
      }
      totais.pecasVoltaram += i.quantity;
      const defeito = i.destino === "DEFEITO" ? i.quantity : 0;
      totais.pecasDefeito += defeito;
      const chave = chaveDaPecaDoRelatorio(i);
      let p = pecas.get(chave);
      if (!p) {
        p = { chave, nome: i.name, cor: i.color ?? "", tamanho: i.size ?? "", voltaram: 0, defeito: 0, trocas: 0, trocasVistas: new Set() };
        pecas.set(chave, p);
      }
      p.voltaram += i.quantity;
      p.defeito += defeito;
      p.trocasVistas.add(t.id);
    }
  }

  return {
    totais: {
      ...totais,
      recebido: round2(totais.recebido),
      aReceber: round2(totais.aReceber),
      devolvido: round2(totais.devolvido),
      aDevolver: round2(totais.aDevolver),
      creditoDado: round2(totais.creditoDado),
    },
    motivos: (() => {
      const lista = [...motivos]
        .map(([motivo, n]) => ({ motivo, trocas: n }))
        .sort((a, b) => b.trocas - a.trocas || a.motivo.localeCompare(b.motivo, "pt-BR"));
      const pcts = porcentagensQueFecham(lista.map((m) => m.trocas));
      return lista.map((m, i) => ({ ...m, pct: pcts[i] }));
    })(),
    pecas: [...pecas.values()]
      .map(({ trocasVistas, ...p }) => ({ ...p, trocas: trocasVistas.size }))
      .sort((a, b) => b.voltaram - a.voltaram || b.defeito - a.defeito || a.nome.localeCompare(b.nome, "pt-BR"))
      .slice(0, 30),
    pecasDistintas: pecas.size,
    ultimas: [...trocas]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 50)
      .map((t) => ({
        id: t.id,
        numero: t.numero,
        quando: t.createdAt.toISOString(),
        pedidoId: t.order.id,
        pedido: t.order.number,
        cliente: t.order.customer.name,
        por: t.registradaPorNome,
        voltou: t.itens.filter((i) => i.sentido === "VOLTA").map((i) => `${rotulo(i)}${i.destino === "DEFEITO" ? " · defeito" : ""}`).join(", "),
        levou: t.itens.filter((i) => i.sentido === "SAI").map(rotulo).join(", "),
        diferenca: round2(t.diferenca),
        resolucao: t.resolucao,
        acertada: Boolean(t.resolvidaEm),
        pedidoCancelado: t.order.status === "CANCELADO",
      })),
    truncado,
  };
}

/** Os últimos N dias, contados até agora. */
export function janelaDeDias(dias: number, agora = new Date()): Date {
  return new Date(agora.getTime() - dias * 86_400_000);
}

export async function carregarRelatorioDeTrocas(companyId: string, dias: number): Promise<RelatorioDeTrocas> {
  const trocas = await db.troca.findMany({
    where: { companyId, createdAt: { gte: janelaDeDias(dias) } },
    orderBy: { createdAt: "desc" },
    take: TETO_DE_TROCAS + 1,
    select: {
      id: true,
      numero: true,
      createdAt: true,
      motivo: true,
      diferenca: true,
      resolucao: true,
      resolvidaEm: true,
      registradaPorNome: true,
      order: { select: { id: true, number: true, status: true, customer: { select: { name: true } } } },
      itens: { select: { sentido: true, productId: true, name: true, color: true, size: true, quantity: true, destino: true } },
    },
  });
  const truncado = trocas.length > TETO_DE_TROCAS;
  return montarRelatorioDeTrocas(truncado ? trocas.slice(0, TETO_DE_TROCAS) : trocas, truncado);
}
