import { db } from "@/lib/db";
import { porteiraFinanceiroTela } from "@/lib/financeiro/gate";
import { garantirCategoriasPadrao } from "@/lib/financeiro/cadastros";
import { carregarConciliacao } from "@/lib/financeiro/conciliacao";
import { dataDoDia, diaSP } from "@/lib/financeiro/lancamentos";
import { ConciliacaoView } from "./conciliacao-view";

export const dynamic = "force-dynamic";

const ABAS = ["pendente", "conciliado", "ignorado"] as const;

/**
 * CONCILIAÇÃO BANCÁRIA (RN-037) — "o sistema bate com o banco?".
 */
export default async function ConciliacaoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await porteiraFinanceiroTela();

  // esta tela ABRE a ficha do lançamento (RN-030), então a árvore precisa
  // existir: a loja cujo primeiro clique no menu foi "Conferir com o banco"
  // via o seletor de categoria VAZIO e salvava sem categoria — o lançamento
  // caía em "Sem categoria" no DRE e no fluxo (auditoria de 03/09/2026)
  await garantirCategoriasPadrao(user.companyId);

  const sp = await searchParams;
  const texto = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]) ?? "";

  // UMA consulta de contas para as duas coisas (o seletor da tela e a ficha
  // do lançamento): eram duas idas ao banco com o mesmo where e o mesmo
  // orderBy, mudando só o select
  const contas = await db.finConta.findMany({
    where: { companyId: user.companyId, arquivadaEm: null },
    orderBy: [{ padrao: "desc" }, { nome: "asc" }],
    select: {
      id: true,
      nome: true,
      tipo: true,
      padrao: true,
      diaFechamento: true,
      diaVencimento: true,
    },
  });
  if (contas.length === 0)
    return (
      <div className="mx-auto max-w-3xl p-6">
        <p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
          Para conferir o extrato, primeiro cadastre a conta do banco em{" "}
          <a href="/financeiro/cadastros" className="text-brand-700 hover:underline">
            Cadastros
          </a>
          .
        </p>
      </div>
    );

  const contaId = contas.find((c) => c.id === texto("conta"))?.id ?? contas[0].id;
  const aba = ABAS.find((a) => a === texto("aba")) ?? "pendente";

  const hoje = diaSP(new Date());
  const [ano, mes] = hoje.split("-").map(Number);
  const padraoDe = new Date(Date.UTC(ano, mes - 3, 1)).toISOString().slice(0, 10);
  const de = dataDoDia(texto("de")) ?? dataDoDia(padraoDe)!;
  const ate = dataDoDia(texto("ate")) ?? dataDoDia(hoje)!;

  const painel = await carregarConciliacao(user.companyId, contaId, aba, de, ate);
  // as listas da ficha do lançamento (RN-030): a linha do banco pode ser dos
  // DOIS lados, então as categorias vêm inteiras e a tela mostra as do lado
  // certo conforme o sinal do movimento
  const [categorias, fornecedores, centros, colecoes, importacoes] =
    await Promise.all([
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
      db.finOfxImportacao.findMany({
        where: { companyId: user.companyId, contaId },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          arquivo: true,
          banco: true,
          linhas: true,
          novas: true,
          createdAt: true,
          autorNome: true,
        },
      }),
    ]);
  return (
    <ConciliacaoView
      contas={contas}
      filtro={{ conta: contaId, aba, de: diaSP(de), ate: diaSP(ate) }}
      // RN-039: no cartão o dinheiro não anda (a fatura é que se paga), então
      // a tela nem oferece "Lançar" — o servidor recusaria depois da ficha
      // inteira preenchida, que é a pior forma de dizer não
      contaEhCartao={contas.find((c) => c.id === contaId)?.tipo === "CARTAO"}
      painel={painel}
      hoje={hoje}
      ficha={{
        contas,
        categorias,
        fornecedores,
        centros,
        colecoes,
      }}
      importacoes={importacoes.map((i) => ({
        id: i.id,
        arquivo: i.arquivo,
        banco: i.banco,
        linhas: i.linhas,
        novas: i.novas,
        dia: diaSP(i.createdAt),
        autorNome: i.autorNome,
      }))}
    />
  );
}
