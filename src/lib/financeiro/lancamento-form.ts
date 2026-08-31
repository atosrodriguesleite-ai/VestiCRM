import { z } from "zod";
import { db } from "../db";
import { round2 } from "../orders";
import { dataDoDia, FORMAS_PAGAMENTO } from "./lancamentos";

/**
 * A FICHA DO LANÇAMENTO (RN-028) — validação e conferência num lugar só,
 * usada por criar e editar.
 *
 * O que esta camada garante antes de qualquer coisa chegar ao banco:
 *
 *  • toda etiqueta escolhida é DESTA loja (RN-013) e não está arquivada;
 *  • a CATEGORIA combina com o lado do lançamento — categoria de despesa
 *    numa conta a receber faria o DRE somar errado em silêncio;
 *  • receita tem cliente (ficha do CRM) e despesa tem fornecedor, nunca os
 *    dois trocados;
 *  • o VALOR do lançamento é a soma das parcelas, calculada aqui — número
 *    digitado à parte diverge do que a loja vai receber de verdade.
 */

export const parcelaSchema = z.object({
  vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida"),
  valor: z.number().finite().positive(),
  contaId: z.string().nullish(),
  forma: z.enum(FORMAS_PAGAMENTO).default("PIX"),
});

export const lancamentoSchema = z.object({
  tipo: z.enum(["RECEITA", "DESPESA"]),
  descricao: z.string().trim().min(1).max(160),
  documento: z.string().trim().max(60).nullish(),
  competencia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida"),
  customerId: z.string().nullish(),
  fornecedorId: z.string().nullish(),
  categoriaId: z.string().nullish(),
  centroCustoId: z.string().nullish(),
  colecaoId: z.string().nullish(),
  observacoes: z.string().trim().max(1000).nullish(),
  parcelas: z.array(parcelaSchema).min(1).max(60),
});

export type LancamentoInput = z.infer<typeof lancamentoSchema>;

export type LancamentoConferido = {
  cabecalho: {
    tipo: string;
    descricao: string;
    documento: string | null;
    competencia: Date;
    customerId: string | null;
    fornecedorId: string | null;
    categoriaId: string | null;
    centroCustoId: string | null;
    colecaoId: string | null;
    observacoes: string | null;
    valor: number;
  };
  parcelas: {
    numero: number;
    vencimento: Date;
    valor: number;
    contaId: string | null;
    forma: string;
  }[];
};

/** Confere a ficha inteira contra o banco. Devolve `{ erro }` ou `{ dados }`. */
export async function conferirLancamento(
  companyId: string,
  dados: LancamentoInput
): Promise<{ erro: string } | { dados: LancamentoConferido }> {
  const receita = dados.tipo === "RECEITA";

  // cliente (ficha do CRM) só na receita; fornecedor só na despesa
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
      where: {
        id: dados.categoriaId,
        companyId,
        arquivadaEm: null,
        // a categoria tem que ser do MESMO lado do lançamento
        tipo: dados.tipo,
      },
      select: { id: true },
    });
    if (!cat)
      return {
        erro: receita
          ? "Escolha uma categoria de RECEITA para uma conta a receber"
          : "Escolha uma categoria de DESPESA para uma conta a pagar",
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

  // contas das parcelas: uma consulta só para todas as escolhidas
  const contasEscolhidas = [
    ...new Set(dados.parcelas.map((p) => p.contaId).filter(Boolean)),
  ] as string[];
  if (contasEscolhidas.length > 0) {
    const contas = await db.finConta.findMany({
      where: { id: { in: contasEscolhidas }, companyId, arquivadaEm: null },
      select: { id: true },
    });
    if (contas.length !== contasEscolhidas.length)
      return { erro: "Conta não encontrada" };
  }

  const competencia = dataDoDia(dados.competencia);
  if (!competencia) return { erro: "Data de emissão inválida" };

  const parcelas: LancamentoConferido["parcelas"] = [];
  for (const [i, p] of dados.parcelas.entries()) {
    const venc = dataDoDia(p.vencimento);
    if (!venc) return { erro: `Vencimento inválido na parcela ${i + 1}` };
    parcelas.push({
      numero: i + 1,
      vencimento: venc,
      valor: round2(p.valor),
      contaId: p.contaId || null,
      forma: p.forma,
    });
  }

  // o valor do lançamento é a SOMA das parcelas — nunca um número à parte
  const valor = round2(parcelas.reduce((s, p) => s + p.valor, 0));
  if (!(valor > 0)) return { erro: "O valor precisa ser maior que zero" };

  return {
    dados: {
      cabecalho: {
        tipo: dados.tipo,
        descricao: dados.descricao,
        documento: dados.documento?.trim() || null,
        competencia,
        customerId,
        fornecedorId,
        categoriaId: dados.categoriaId || null,
        centroCustoId: dados.centroCustoId || null,
        colecaoId: dados.colecaoId || null,
        observacoes: dados.observacoes?.trim() || null,
        valor,
      },
      parcelas,
    },
  };
}
