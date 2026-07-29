import { db } from "./db";

/**
 * CATÁLOGO DE MÓDULOS E MRR CALCULADO.
 *
 * Até aqui as 5 chavinhas de módulo em `Company` ligavam e desligavam sem
 * preço nenhum: ativar era um clique e cobrar era lembrar de somar na
 * mensalidade. O MRR da plataforma era um número DIGITADO — só somava
 * `monthlyFee`, então todo módulo vendido ficava invisível no total.
 *
 * Aqui o preço vira dado. O MRR passa a ser: mensalidade base + módulos
 * ativos. E o desconto (preço de tabela − preço praticado) fica visível, que
 * é um número que a empresa não tinha como olhar.
 */

/** Chave estável de cada módulo (é o que vai gravado em CompanyModule). */
export type ModuloKey =
  | "PRODUCAO"
  | "PLANO_CORTE"
  | "MARKETING"
  | "INTELIGENCIA"
  | "BIBLIOTECA"
  | "ENVIOS";

export type Modulo = {
  key: ModuloKey;
  nome: string;
  /** o que a loja ganha, em uma linha de negócio */
  entrega: string;
  /** campo booleano correspondente em Company (quando existe) */
  flag: string | null;
  /** preço de tabela sugerido, em R$/mês */
  precoTabela: number;
};

/**
 * PREÇO DE TABELA — a âncora que faltava.
 *
 * Sem referência, cada negociação recomeçava do zero e não havia como saber
 * se a empresa estava cara ou barata. Estes valores são o ponto de partida
 * sugerido; o preço praticado por loja continua livre (fica em
 * `CompanyModule.priceMonth`), e a diferença entre os dois passa a ser
 * mensurável.
 */
export const MODULOS: Modulo[] = [
  {
    key: "PRODUCAO",
    nome: "Produção",
    entrega: "Tecidos, cortes, costura, facções, defeitos e custo por peça.",
    flag: "productionEnabled",
    precoTabela: 190,
  },
  {
    key: "PLANO_CORTE",
    nome: "Plano de Corte",
    entrega: "Lê molde do Audaces/DXF e calcula o encaixe no tecido.",
    flag: "cutPlanEnabled",
    precoTabela: 240,
  },
  {
    key: "MARKETING",
    nome: "Marketing",
    entrega: "Gestor de Bio, campanhas de aquisição e links inteligentes.",
    flag: "marketingEnabled",
    precoTabela: 90,
  },
  {
    key: "INTELIGENCIA",
    nome: "Inteligência",
    entrega:
      "De onde vem cada acesso, jornada da cliente no catálogo e recuperação de sacola.",
    // ainda não tem chavinha própria: hoje a tela é liberada para todas as
    // lojas. Vender exige criar o gate — está mapeado, não implementado.
    flag: null,
    precoTabela: 90,
  },
  {
    key: "BIBLIOTECA",
    nome: "Biblioteca de imagens",
    entrega: "Depósito de fotos avulsas para reaproveitar no catálogo.",
    flag: "mediaLibraryEnabled",
    precoTabela: 0,
  },
  {
    key: "ENVIOS",
    nome: "Envios",
    entrega: "Cotação, etiqueta e rastreio pelo Melhor Envio.",
    flag: "shippingEnabled",
    precoTabela: 120,
  },
];

export const MODULO_POR_KEY = new Map(MODULOS.map((m) => [m.key, m]));

export type ResumoModulos = {
  /** soma das mensalidades dos módulos ativos desta loja */
  mensalModulos: number;
  /** quanto seria pelo preço de tabela */
  mensalTabela: number;
  /** tabela − praticado (o desconto que está sendo dado, sem ninguém ver) */
  desconto: number;
  ativos: {
    key: ModuloKey;
    nome: string;
    priceMonth: number;
    listPrice: number;
    activatedAt: Date;
  }[];
};

/** O que esta loja tem contratado hoje, com valores. */
export async function modulosDaLoja(companyId: string): Promise<ResumoModulos> {
  const linhas = await db.companyModule.findMany({
    where: { companyId, deactivatedAt: null },
    orderBy: { activatedAt: "asc" },
  });
  const ativos = linhas.map((l) => ({
    key: l.modulo as ModuloKey,
    nome: MODULO_POR_KEY.get(l.modulo as ModuloKey)?.nome ?? l.modulo,
    priceMonth: l.priceMonth,
    listPrice: l.listPrice,
    activatedAt: l.activatedAt,
  }));
  const mensalModulos = ativos.reduce((s, m) => s + m.priceMonth, 0);
  const mensalTabela = ativos.reduce((s, m) => s + (m.listPrice || m.priceMonth), 0);
  return {
    mensalModulos,
    mensalTabela,
    desconto: Math.max(mensalTabela - mensalModulos, 0),
    ativos,
  };
}

/**
 * MRR DA PLATAFORMA — agora calculado.
 *
 * Antes o painel somava só `CompanyBilling.monthlyFee`: todo módulo vendido
 * era receita invisível. Loja suspensa e loja que não é PAGANTE ficam fora,
 * como já era a regra do card de recorrência.
 */
export async function mrrDaPlataforma(): Promise<{
  base: number;
  modulos: number;
  total: number;
  descontoMensal: number;
}> {
  const [cobrancas, modulos] = await Promise.all([
    db.companyBilling.findMany({
      where: { kind: "PAGANTE", company: { suspended: false } },
      select: { monthlyFee: true },
    }),
    db.companyModule.findMany({
      where: {
        deactivatedAt: null,
        company: { suspended: false, billing: { kind: "PAGANTE" } },
      },
      select: { priceMonth: true, listPrice: true },
    }),
  ]);
  const base = cobrancas.reduce((s, c) => s + c.monthlyFee, 0);
  const somaModulos = modulos.reduce((s, m) => s + m.priceMonth, 0);
  const somaTabela = modulos.reduce((s, m) => s + (m.listPrice || m.priceMonth), 0);
  return {
    base,
    modulos: somaModulos,
    total: base + somaModulos,
    descontoMensal: Math.max(somaTabela - somaModulos, 0),
  };
}
