import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isManagerUp } from "@/lib/scope";
import { financeiroLiberado } from "@/lib/financeiro/gate";
import { garantirCategoriasPadrao } from "@/lib/financeiro/cadastros";
import { CadastrosView } from "./cadastros-view";

export const dynamic = "force-dynamic";

/**
 * FINANCEIRO · CADASTROS (RN-029, Fase 1) — a fundação do módulo: contas,
 * categorias (árvore pronta para moda), centros de custo, coleções e
 * fornecedores. Porteira dupla: gerente+ E loja com a chave do módulo —
 * sem a chave, a tela "não existe" e volta para o Financeiro simples.
 */
export default async function FinanceiroCadastrosPage() {
  const user = await requireUser();
  if (!isManagerUp(user)) redirect("/dashboard");
  const company = await db.company.findUnique({
    where: { id: user.companyId },
    select: { financeEnabled: true },
  });
  // a MESMA decisão da porteira das rotas (RN-029) — nunca reimplementada
  if (!financeiroLiberado(user, company?.financeEnabled ?? false))
    redirect("/financeiro");

  // primeira abertura semeia a árvore de categorias (idempotente)
  await garantirCategoriasPadrao(user.companyId);

  const [contas, categorias, centros, colecoes, fornecedores] =
    await Promise.all([
      db.finConta.findMany({
        where: { companyId: user.companyId },
        orderBy: [{ arquivadaEm: "asc" }, { createdAt: "asc" }],
      }),
      db.finCategoria.findMany({
        where: { companyId: user.companyId },
        orderBy: { codigo: "asc" },
      }),
      db.finCentroCusto.findMany({
        where: { companyId: user.companyId },
        orderBy: [{ arquivadoEm: "asc" }, { nome: "asc" }],
      }),
      db.finColecao.findMany({
        where: { companyId: user.companyId },
        orderBy: [{ arquivadaEm: "asc" }, { createdAt: "desc" }],
      }),
      db.fornecedor.findMany({
        where: { companyId: user.companyId },
        orderBy: [{ arquivadoEm: "asc" }, { nome: "asc" }],
        include: {
          categoriaPadrao: { select: { id: true, nome: true, codigo: true } },
        },
      }),
    ]);

  return (
    <CadastrosView
      contas={contas.map((c) => ({
        id: c.id,
        nome: c.nome,
        tipo: c.tipo,
        saldoInicial: c.saldoInicial,
        saldoInicialEm: c.saldoInicialEm.toISOString(),
        cor: c.cor,
        padrao: c.padrao,
        arquivada: Boolean(c.arquivadaEm),
        diaFechamento: c.diaFechamento,
        diaVencimento: c.diaVencimento,
        contaPagamentoId: c.contaPagamentoId,
      }))}
      categorias={categorias.map((c) => ({
        id: c.id,
        nome: c.nome,
        tipo: c.tipo,
        codigo: c.codigo,
        paiId: c.paiId,
        sistema: c.sistema,
        arquivada: Boolean(c.arquivadaEm),
      }))}
      centros={centros.map((c) => ({
        id: c.id,
        nome: c.nome,
        arquivado: Boolean(c.arquivadoEm),
      }))}
      colecoes={colecoes.map((c) => ({
        id: c.id,
        nome: c.nome,
        inicio: c.inicio?.toISOString() ?? null,
        fim: c.fim?.toISOString() ?? null,
        arquivada: Boolean(c.arquivadaEm),
      }))}
      fornecedores={fornecedores.map((f) => ({
        id: f.id,
        nome: f.nome,
        razaoSocial: f.razaoSocial,
        cnpj: f.cnpj,
        cpf: f.cpf,
        ie: f.ie,
        telefone: f.telefone,
        email: f.email,
        chavePix: f.chavePix,
        dadosBancarios: f.dadosBancarios,
        observacoes: f.observacoes,
        categoriaPadraoId: f.categoriaPadraoId,
        categoriaPadraoNome: f.categoriaPadrao
          ? `${f.categoriaPadrao.codigo} · ${f.categoriaPadrao.nome}`
          : null,
        arquivado: Boolean(f.arquivadoEm),
      }))}
    />
  );
}
