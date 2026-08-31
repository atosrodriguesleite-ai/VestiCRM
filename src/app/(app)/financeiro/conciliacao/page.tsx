import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isManagerUp } from "@/lib/scope";
import { financeiroLiberado } from "@/lib/financeiro/gate";
import { carregarConciliacao } from "@/lib/financeiro/conciliacao";
import { dataDoDia, diaSP } from "@/lib/financeiro/lancamentos";
import { ConciliacaoView } from "./conciliacao-view";

export const dynamic = "force-dynamic";

const ABAS = ["pendente", "conciliado", "ignorado"] as const;

/**
 * CONCILIAÇÃO BANCÁRIA (RN-035) — "o sistema bate com o banco?".
 */
export default async function ConciliacaoPage({
  searchParams,
}: {
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

  const sp = await searchParams;
  const texto = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]) ?? "";

  const contas = await db.finConta.findMany({
    where: { companyId: user.companyId, arquivadaEm: null },
    orderBy: [{ padrao: "desc" }, { nome: "asc" }],
    select: { id: true, nome: true },
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
  const importacoes = await db.finOfxImportacao.findMany({
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
  });

  return (
    <ConciliacaoView
      contas={contas}
      filtro={{ conta: contaId, aba, de: diaSP(de), ate: diaSP(ate) }}
      painel={painel}
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
