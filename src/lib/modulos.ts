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
  | "ENVIOS"
  | "IA_VENDAS"
  | "FINANCEIRO";

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
  {
    key: "IA_VENDAS",
    nome: "IA de Vendas",
    entrega:
      "Cérebro treinável (tom, roteiro, políticas), monitor de equipe e plano de conversas com trava.",
    flag: "aiSalesEnabled",
    // âncora do plano Pro (1.000 conversas/mês) — o praticado fica livre
    precoTabela: 397,
  },
  {
    key: "FINANCEIRO",
    nome: "Financeiro",
    entrega:
      "Contas a pagar/receber, fornecedores, fluxo de caixa, DRE e conciliação.",
    flag: "financeEnabled",
    // preço definido pelo dono no desenho do módulo (31/08/2026)
    precoTabela: 160,
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

/** Campos booleanos de módulo em Company (para derivar o que está ativo). */
type FlagsDaLoja = Record<string, boolean | null | undefined>;

/**
 * Módulos ativos DERIVADOS das chavinhas de Company.
 *
 * Auditoria 07/08/2026 (GRAVE): a tabela `CompanyModule` NUNCA era escrita —
 * ligar um módulo só virava o booleano em Company —, então o MRR de módulos
 * dava sempre R$ 0. Aqui o cálculo passa a nascer das PRÓPRIAS chavinhas: o
 * módulo com flag ligada conta pelo preço de tabela, e o preço PRATICADO
 * (negociado, gravado em CompanyModule) sobrepõe quando existir.
 */
function ativosDosFlags(
  flags: FlagsDaLoja,
  praticado: Map<string, { priceMonth: number; listPrice: number; activatedAt: Date }>
) {
  return MODULOS.filter((m) => m.flag && flags[m.flag]).map((m) => {
    const p = praticado.get(m.key);
    return {
      key: m.key,
      nome: m.nome,
      priceMonth: p?.priceMonth ?? m.precoTabela,
      listPrice: p?.listPrice ?? m.precoTabela,
      activatedAt: p?.activatedAt ?? new Date(0),
    };
  });
}

/** O que esta loja tem contratado hoje, com valores. */
export async function modulosDaLoja(companyId: string): Promise<ResumoModulos> {
  const [company, linhas] = await Promise.all([
    db.company.findUnique({ where: { id: companyId } }),
    db.companyModule.findMany({ where: { companyId, deactivatedAt: null } }),
  ]);
  const praticado = new Map(
    linhas.map((l) => [
      l.modulo,
      { priceMonth: l.priceMonth, listPrice: l.listPrice, activatedAt: l.activatedAt },
    ])
  );
  const ativos = company
    ? ativosDosFlags(company as unknown as FlagsDaLoja, praticado)
    : [];
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
  // lojas PAGANTES e não suspensas, com suas chavinhas e o preço praticado
  const [cobrancas, lojas, praticados] = await Promise.all([
    db.companyBilling.findMany({
      where: { kind: "PAGANTE", company: { suspended: false } },
      select: { monthlyFee: true },
    }),
    db.company.findMany({
      where: { suspended: false, billing: { kind: "PAGANTE" } },
    }),
    db.companyModule.findMany({
      where: {
        deactivatedAt: null,
        company: { suspended: false, billing: { kind: "PAGANTE" } },
      },
      select: { companyId: true, modulo: true, priceMonth: true, listPrice: true, activatedAt: true },
    }),
  ]);
  const base = cobrancas.reduce((s, c) => s + c.monthlyFee, 0);
  // preço praticado indexado por loja+módulo (sobrepõe a tabela quando existe)
  const porLoja = new Map<string, Map<string, { priceMonth: number; listPrice: number; activatedAt: Date }>>();
  for (const p of praticados) {
    const m = porLoja.get(p.companyId) ?? new Map();
    m.set(p.modulo, { priceMonth: p.priceMonth, listPrice: p.listPrice, activatedAt: p.activatedAt });
    porLoja.set(p.companyId, m);
  }
  // MRR de módulos DERIVADO das chavinhas de cada loja (a tabela CompanyModule
  // não era escrita — auditoria 07/08/2026)
  let somaModulos = 0;
  let somaTabela = 0;
  for (const loja of lojas) {
    const ativos = ativosDosFlags(
      loja as unknown as FlagsDaLoja,
      porLoja.get(loja.id) ?? new Map()
    );
    for (const a of ativos) {
      somaModulos += a.priceMonth;
      somaTabela += a.listPrice || a.priceMonth;
    }
  }
  return {
    base,
    modulos: somaModulos,
    total: base + somaModulos,
    descontoMensal: Math.max(somaTabela - somaModulos, 0),
  };
}
