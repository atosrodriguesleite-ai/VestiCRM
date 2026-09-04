import { z } from "zod";
import { db } from "../db";
import { round2 } from "../orders";
import { dataDoDia, FORMAS_PAGAMENTO } from "./lancamentos";

/**
 * A FICHA DA CONTA FIXA (RN-031) — as mesmas conferências do lançamento
 * (RN-030), porque ela é o MOLDE de lançamentos: etiqueta desta loja, não
 * arquivada, e categoria do MESMO lado (receita fixa não pode nascer com
 * categoria de despesa, senão o DRE soma errado todo mês).
 */

/** Até quanto tempo atrás uma conta fixa pode começar. */
export const MAX_ANOS_PARA_TRAS = 2;

export const recorrenciaSchema = z.object({
  tipo: z.enum(["RECEITA", "DESPESA"]),
  descricao: z.string().trim().min(1).max(160),
  valor: z.number().finite().positive(),
  diaVencimento: z.number().int().min(1).max(31),
  customerId: z.string().nullish(),
  fornecedorId: z.string().nullish(),
  categoriaId: z.string().nullish(),
  centroCustoId: z.string().nullish(),
  colecaoId: z.string().nullish(),
  contaId: z.string().nullish(),
  forma: z.enum(FORMAS_PAGAMENTO).default("PIX"),
  observacoes: z.string().trim().max(1000).nullish(),
  /** primeiro mês que vale, no formato AAAA-MM */
  inicio: z.string().regex(/^\d{4}-\d{2}$/, "Mês inválido"),
  /** último mês; vazio = sem fim */
  fim: z.string().regex(/^\d{4}-\d{2}$/).nullish(),
});

export type RecorrenciaInput = z.infer<typeof recorrenciaSchema>;

/** A conta fixa no formato do banco — tipada campo a campo (o Prisma exige). */
export type RecorrenciaData = {
  tipo: string;
  descricao: string;
  valor: number;
  diaVencimento: number;
  customerId: string | null;
  fornecedorId: string | null;
  categoriaId: string | null;
  centroCustoId: string | null;
  colecaoId: string | null;
  contaId: string | null;
  forma: string;
  observacoes: string | null;
  inicio: Date;
  fim: Date | null;
};

export async function conferirRecorrencia(
  companyId: string,
  dados: RecorrenciaInput,
  /**
   * É um cadastro NOVO? O limite de anos para trás só vale aqui: a edição
   * reenvia o `inicio` original, então uma conta fixa criada hoje ficaria
   * impossível de editar quando o mês de início passasse de dois anos.
   */
  criando = true
): Promise<{ erro: string } | { data: RecorrenciaData }> {
  const receita = dados.tipo === "RECEITA";
  const customerId = receita ? dados.customerId || null : null;
  const fornecedorId = receita ? null : dados.fornecedorId || null;

  if (customerId) {
    const c = await db.customer.findFirst({
      where: { id: customerId, companyId },
      select: { id: true },
    });
    if (!c) return { erro: "Cliente não encontrado" };
  }
  if (fornecedorId) {
    const f = await db.fornecedor.findFirst({
      where: { id: fornecedorId, companyId, arquivadoEm: null },
      select: { id: true },
    });
    if (!f) return { erro: "Fornecedor não encontrado" };
  }
  if (dados.categoriaId) {
    const cat = await db.finCategoria.findFirst({
      where: { id: dados.categoriaId, companyId, arquivadaEm: null, tipo: dados.tipo },
      select: { id: true },
    });
    if (!cat)
      return {
        erro: receita
          ? "Escolha uma categoria de RECEITA"
          : "Escolha uma categoria de DESPESA",
      };
  }
  if (dados.centroCustoId) {
    const cc = await db.finCentroCusto.findFirst({
      where: { id: dados.centroCustoId, companyId, arquivadoEm: null },
      select: { id: true },
    });
    if (!cc) return { erro: "Centro de custo não encontrado" };
  }
  if (dados.colecaoId) {
    const col = await db.finColecao.findFirst({
      where: { id: dados.colecaoId, companyId, arquivadaEm: null },
      select: { id: true },
    });
    if (!col) return { erro: "Coleção não encontrada" };
  }
  if (dados.contaId) {
    const conta = await db.finConta.findFirst({
      where: { id: dados.contaId, companyId, arquivadaEm: null },
      select: { id: true, tipo: true },
    });
    if (!conta) return { erro: "Conta não encontrada" };
    // CARTÃO NÃO RECEBE CONTA FIXA (RN-039): a parcela nasceria no dia
    // digitado, sem passar pela régua da fatura — a assinatura de R$ 55 de
    // um cartão que fecha dia 28 caía na fatura de setembro e a de outubro
    // fechava R$ 55 a menos do que o banco vai cobrar. Enquanto a conta
    // fixa não montar a fatura sozinha, a porta diz não (auditoria 03/09/2026)
    if (conta.tipo === "CARTAO")
      return {
        erro: "Conta fixa ainda não vai no cartão de crédito — escolha a conta do banco",
      };
  }

  const inicio = dataDoDia(`${dados.inicio}-01`);
  if (!inicio) return { erro: "Mês de início inválido" };
  /**
   * O MÊS DE INÍCIO TEM LIMITE PARA TRÁS.
   *
   * Um dígito trocado ("2016" no lugar de "2026") criava 24 lançamentos
   * vencidos de cara e mais 24 a cada abertura de tela — em poucos cliques,
   * R$ 363 mil de dívida que nunca existiu, no card "Atrasado" e no fluxo de
   * caixa, sem como desfazer (o módulo não tem DELETE e a limpeza só alcança
   * o futuro). Achado da auditoria completa, 03/09/2026.
   */
  const limite = new Date(inicio.getTime());
  limite.setUTCFullYear(limite.getUTCFullYear() + MAX_ANOS_PARA_TRAS);
  if (criando && limite < new Date())
    return {
      erro: `A conta fixa não pode começar há mais de ${MAX_ANOS_PARA_TRAS} ano(s) — confira o mês`,
    };
  const fim = dados.fim ? dataDoDia(`${dados.fim}-01`) : null;
  if (dados.fim && !fim) return { erro: "Mês de término inválido" };
  if (fim && fim < inicio)
    return { erro: "O término não pode ser antes do início" };

  return {
    data: {
      tipo: dados.tipo,
      descricao: dados.descricao,
      valor: round2(dados.valor),
      diaVencimento: dados.diaVencimento,
      customerId,
      fornecedorId,
      categoriaId: dados.categoriaId || null,
      centroCustoId: dados.centroCustoId || null,
      colecaoId: dados.colecaoId || null,
      contaId: dados.contaId || null,
      forma: dados.forma,
      observacoes: dados.observacoes?.trim() || null,
      inicio,
      fim,
    },
  };
}
