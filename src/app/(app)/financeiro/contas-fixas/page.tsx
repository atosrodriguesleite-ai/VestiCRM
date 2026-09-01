import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isManagerUp } from "@/lib/scope";
import { financeiroLiberado } from "@/lib/financeiro/gate";
import { garantirCategoriasPadrao } from "@/lib/financeiro/cadastros";
import { garantirRecorrencias, mesDe } from "@/lib/financeiro/recorrencia";
import { ContasFixasView } from "./contas-fixas-view";

export const dynamic = "force-dynamic";

/**
 * CONTAS FIXAS (RN-031) — aluguel, salário, internet: configura uma vez e o
 * sistema lança sozinho todo mês (de carona no tráfego, sem cron novo).
 */
export default async function ContasFixasPage() {
  const user = await requireUser();
  if (!isManagerUp(user)) redirect("/dashboard");
  const company = await db.company.findUnique({
    where: { id: user.companyId },
    select: { financeEnabled: true },
  });
  if (!financeiroLiberado(user, company?.financeEnabled ?? false))
    redirect("/financeiro");

  await garantirCategoriasPadrao(user.companyId);
  await garantirRecorrencias(user.companyId);

  const [recorrencias, contas, categorias, fornecedores] = await Promise.all([
    db.finRecorrencia.findMany({
      where: { companyId: user.companyId },
      orderBy: [{ ativa: "desc" }, { descricao: "asc" }],
      include: {
        categoria: { select: { nome: true, codigo: true } },
        fornecedor: { select: { nome: true } },
        customer: { select: { name: true } },
        conta: { select: { nome: true } },
        _count: { select: { lancamentos: true } },
      },
    }),
    db.finConta.findMany({
      where: { companyId: user.companyId, arquivadaEm: null },
      orderBy: [{ padrao: "desc" }, { nome: "asc" }],
      select: { id: true, nome: true },
    }),
    db.finCategoria.findMany({
      where: { companyId: user.companyId, arquivadaEm: null },
      orderBy: { codigo: "asc" },
      select: { id: true, nome: true, codigo: true, tipo: true },
    }),
    db.fornecedor.findMany({
      where: { companyId: user.companyId, arquivadoEm: null },
      orderBy: { nome: "asc" },
      select: { id: true, nome: true, categoriaPadraoId: true },
    }),
  ]);

  return (
    <ContasFixasView
      mesAtual={mesDe(new Date())}
      contas={contas}
      categorias={categorias}
      fornecedores={fornecedores}
      recorrencias={recorrencias.map((r) => ({
        id: r.id,
        tipo: r.tipo,
        descricao: r.descricao,
        valor: r.valor,
        diaVencimento: r.diaVencimento,
        forma: r.forma,
        categoriaId: r.categoriaId,
        categoria: r.categoria ? `${r.categoria.codigo} · ${r.categoria.nome}` : null,
        fornecedorId: r.fornecedorId,
        customerId: r.customerId,
        pessoa: r.fornecedor?.nome ?? r.customer?.name ?? null,
        contaId: r.contaId,
        conta: r.conta?.nome ?? null,
        centroCustoId: r.centroCustoId,
        colecaoId: r.colecaoId,
        observacoes: r.observacoes,
        inicio: mesDe(r.inicio),
        fim: r.fim ? mesDe(r.fim) : null,
        ativa: r.ativa,
        geradoAte: r.geradoAte,
        gerados: r._count.lancamentos,
      }))}
    />
  );
}
