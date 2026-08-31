import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isManagerUp } from "@/lib/scope";
import { financeiroLiberado } from "@/lib/financeiro/gate";
import { garantirCategoriasPadrao } from "@/lib/financeiro/cadastros";
import { carregarMovimentacoes, type BasePeriodo } from "@/lib/financeiro/consulta";
import { dataDoDia, diaSP, type StatusParcela } from "@/lib/financeiro/lancamentos";
import { ListaMovimentacoes } from "./lista";

/**
 * A TELA de Contas a Receber / Contas a Pagar (RN-028) — a mesma página para
 * os dois lados, mudando só o `tipo`.
 *
 * Os filtros moram na URL: o período que a lojista escolheu sobrevive ao
 * F5, ao voltar do detalhe e ao link mandado para a contadora.
 */

const STATUS_VALIDOS: (StatusParcela | "TODOS")[] = [
  "TODOS",
  "ATRASADA",
  "VENCE_HOJE",
  "PENDENTE",
  "PARCIAL",
  "QUITADA",
  "CANCELADA",
];

export async function PaginaMovimentacoes({
  tipo,
  searchParams,
}: {
  tipo: "RECEITA" | "DESPESA";
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  if (!isManagerUp(user)) redirect("/dashboard");
  const company = await db.company.findUnique({
    where: { id: user.companyId },
    select: { financeEnabled: true },
  });
  if (!financeiroLiberado(user, company?.financeEnabled ?? false))
    redirect("/financeiro");

  await garantirCategoriasPadrao(user.companyId);

  const sp = await searchParams;
  const texto = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]) ?? "";

  const hoje = new Date();
  // padrão: o mês corrente no fuso de São Paulo (o dia do servidor é UTC e
  // viraria o mês três horas antes para a loja)
  const hojeDia = diaSP(hoje);
  const primeiroDoMes = `${hojeDia.slice(0, 7)}-01`;
  const [ano, mes] = hojeDia.split("-").map(Number);
  const ultimoDoMes = `${hojeDia.slice(0, 7)}-${String(
    new Date(Date.UTC(ano, mes, 0)).getUTCDate()
  ).padStart(2, "0")}`;

  // a data da URL passa pelo MESMO leitor do resto do módulo: "2026-02-31"
  // casa com o formato mas não existe, e um null no filtro derrubava a tela
  const deIso = dataDoDia(texto("de")) ? texto("de") : primeiroDoMes;
  const ateIso = dataDoDia(texto("ate")) ? texto("ate") : ultimoDoMes;
  const base: BasePeriodo = (["vencimento", "emissao", "liquidacao"] as const).includes(
    texto("base") as BasePeriodo
  )
    ? (texto("base") as BasePeriodo)
    : "vencimento";
  const status = (STATUS_VALIDOS as string[]).includes(texto("status"))
    ? (texto("status") as StatusParcela | "TODOS")
    : "TODOS";

  // o dia inteiro cabe no intervalo: as datas são guardadas ao meio-dia
  const de = dataDoDia(deIso)!;
  const ate = dataDoDia(ateIso)!;

  const [dados, contas, categorias, fornecedores, centros, colecoes] =
    await Promise.all([
      carregarMovimentacoes(
        { companyId: user.companyId, tipo, base, de, ate, status, q: texto("q") },
        hoje
      ),
      db.finConta.findMany({
        where: { companyId: user.companyId, arquivadaEm: null },
        orderBy: [{ padrao: "desc" }, { nome: "asc" }],
        select: { id: true, nome: true, padrao: true },
      }),
      db.finCategoria.findMany({
        where: { companyId: user.companyId, arquivadaEm: null, tipo },
        orderBy: { codigo: "asc" },
        select: { id: true, nome: true, codigo: true },
      }),
      tipo === "DESPESA"
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

  return (
    <ListaMovimentacoes
      tipo={tipo}
      hoje={hojeDia}
      filtro={{ de: deIso, ate: ateIso, base, status, q: texto("q") }}
      linhas={dados.linhas}
      resumo={dados.resumo}
      truncado={dados.truncado}
      contas={contas}
      categorias={categorias}
      fornecedores={fornecedores}
      centros={centros}
      colecoes={colecoes}
    />
  );
}
