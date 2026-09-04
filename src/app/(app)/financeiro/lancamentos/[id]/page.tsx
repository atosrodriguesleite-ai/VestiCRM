import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { porteiraFinanceiroTela } from "@/lib/financeiro/gate";
import { carregarFicha } from "@/lib/financeiro/consulta";
import { notaDoLancamento } from "@/lib/financeiro/nota-do-lancamento";
import {
  diaSP,
  podeEditarValores,
  statusDaParcela,
} from "@/lib/financeiro/lancamentos";
import { FichaLancamento } from "./ficha-view";

export const dynamic = "force-dynamic";

/**
 * A FICHA DO LANÇAMENTO (RN-030): cabeçalho, parcelas com suas baixas,
 * anexos e o histórico de quem mexeu. É a página de onde se dá baixa,
 * estorna, anexa comprovante e cancela.
 */
export default async function LancamentoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await porteiraFinanceiroTela();

  const { id } = await params;
  const l = await carregarFicha(user.companyId, id);
  if (!l) notFound();

  const hoje = new Date();
  // a nota do pedido que gerou este recebimento (RN-038): a lojista via a
  // conta aqui e tinha que ir procurar o pedido em outra tela
  const nota = await notaDoLancamento(user.companyId, l);
  // os cadastros do formulário de edição vêm junto (uma ida só ao banco)
  const [contas, categorias, fornecedores, centros, colecoes] = await Promise.all([
    db.finConta.findMany({
      where: { companyId: user.companyId, arquivadaEm: null },
      orderBy: [{ padrao: "desc" }, { nome: "asc" }],
      select: {
        id: true,
        nome: true,
        padrao: true,
        // cartão (RN-039): o form calcula a fatura da compra e a baixa
        // exclui o cartão da lista (lá o dinheiro não anda)
        tipo: true,
        diaFechamento: true,
        diaVencimento: true,
      },
    }),
    db.finCategoria.findMany({
      where: { companyId: user.companyId, arquivadaEm: null, tipo: l.tipo },
      orderBy: { codigo: "asc" },
      select: { id: true, nome: true, codigo: true },
    }),
    l.tipo === "DESPESA"
      ? db.fornecedor.findMany({
          where: { companyId: user.companyId, arquivadoEm: null },
          orderBy: { nome: "asc" },
          select: { id: true, nome: true, categoriaPadraoId: true },
        })
      : Promise.resolve([]),
    db.finCentroCusto.findMany({
      where: { companyId: user.companyId, arquivadoEm: null },
      orderBy: { nome: "asc" },
      select: { id: true, nome: true },
    }),
    db.finColecao.findMany({
      where: { companyId: user.companyId, arquivadaEm: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, nome: true },
    }),
  ]);

  // a MESMA régua da API decide se o botão de editar aparece (RN-030)
  const impedimentoEdicao = podeEditarValores(l.parcelas, l.origem);

  return (
    <FichaLancamento
      hoje={diaSP(hoje)}
      contas={contas}
      categorias={categorias}
      fornecedores={fornecedores}
      centros={centros}
      colecoes={colecoes}
      impedimentoEdicao={impedimentoEdicao}
      paraEditar={{
        id: l.id,
        descricao: l.descricao,
        documento: l.documento,
        competencia: diaSP(l.competencia),
        customerId: l.customerId,
        customerNome: l.customer?.name ?? null,
        fornecedorId: l.fornecedorId,
        categoriaId: l.categoriaId,
        centroCustoId: l.centroCustoId,
        colecaoId: l.colecaoId,
        observacoes: l.observacoes,
        parcelas: l.parcelas.map((p) => ({
          vencimento: diaSP(p.vencimento),
          valor: p.valor,
          contaId: p.contaId,
          forma: p.forma,
        })),
      }}
      lancamento={{
        id: l.id,
        tipo: l.tipo,
        descricao: l.descricao,
        documento: l.documento,
        competencia: diaSP(l.competencia),
        valor: l.valor,
        observacoes: l.observacoes,
        origem: l.origem,
        origemId: l.origemId,
        cancelado: Boolean(l.canceladoEm),
        pessoa: l.customer?.name ?? l.fornecedor?.nome ?? null,
        categoria: l.categoria ? `${l.categoria.codigo} · ${l.categoria.nome}` : null,
        centroCusto: l.centroCusto?.nome ?? null,
        colecao: l.colecao?.nome ?? null,
      }}
      parcelas={l.parcelas.map((p) => ({
        id: p.id,
        numero: p.numero,
        vencimento: diaSP(p.vencimento),
        valor: p.valor,
        abatido: p.abatido,
        saldo: p.saldo,
        conta: p.conta?.nome ?? null,
        forma: p.forma,
        status: statusDaParcela(p, hoje, Boolean(l.canceladoEm)),
        baixas: p.baixas.map((b) => ({
          id: b.id,
          data: diaSP(b.data),
          valor: b.valor,
          desconto: b.desconto,
          juros: b.juros,
          movimentado: b.movimentado,
          conta: b.conta.nome,
          autorNome: b.autorNome,
          observacao: b.observacao,
          estornada: Boolean(b.estornadaEm),
          estornoAutor: b.estornoAutor,
        })),
      }))}
      nota={nota}
      anexos={l.anexos.map((a) => ({
        id: a.id,
        fileName: a.fileName,
        autorNome: a.autorNome,
        quando: a.createdAt.toISOString(),
      }))}
      eventos={l.eventos.map((e) => ({
        id: e.id,
        descricao: e.descricao,
        autorNome: e.autorNome,
        quando: e.createdAt.toISOString(),
      }))}
    />
  );
}
