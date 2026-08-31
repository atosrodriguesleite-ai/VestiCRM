import { redirect } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isManagerUp } from "@/lib/scope";
import { financeiroLiberado } from "@/lib/financeiro/gate";
import { carregarFaturas } from "@/lib/financeiro/cartao";
import { garantirRecorrencias } from "@/lib/financeiro/recorrencia";
import { diaSP } from "@/lib/financeiro/lancamentos";
import { CartoesView } from "./cartoes-view";

export const dynamic = "force-dynamic";

/**
 * CARTÕES DE CRÉDITO (RN-037): as compras juntadas em faturas, e a fatura
 * paga de uma vez na conta de onde o dinheiro sai.
 */
export default async function CartoesPage() {
  const user = await requireUser();
  if (!isManagerUp(user)) redirect("/dashboard");
  const company = await db.company.findUnique({
    where: { id: user.companyId },
    select: { financeEnabled: true },
  });
  if (!financeiroLiberado(user, company?.financeEnabled ?? false))
    redirect("/financeiro");

  await garantirRecorrencias(user.companyId);

  const [cartoes, contas] = await Promise.all([
    db.finConta.findMany({
      where: { companyId: user.companyId, tipo: "CARTAO", arquivadaEm: null },
      orderBy: { nome: "asc" },
      select: { id: true },
    }),
    db.finConta.findMany({
      where: {
        companyId: user.companyId,
        arquivadaEm: null,
        tipo: { not: "CARTAO" },
      },
      orderBy: [{ padrao: "desc" }, { nome: "asc" }],
      select: { id: true, nome: true },
    }),
  ]);

  if (cartoes.length === 0)
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <h1 className="mb-2 text-lg font-semibold text-slate-800">
            Cartões de crédito
          </h1>
          <p className="text-sm text-slate-600">
            Cadastre o cartão da loja em{" "}
            <Link href="/financeiro/cadastros" className="text-brand-700 hover:underline">
              Cadastros
            </Link>{" "}
            (tipo <b>Cartão de crédito</b>, com o dia em que a fatura fecha e o
            dia em que vence). Depois é só lançar as compras escolhendo o cartão
            — elas se juntam na fatura certa sozinhas.
          </p>
        </div>
      </div>
    );

  const detalhes = await Promise.all(
    cartoes.map((c) => carregarFaturas(user.companyId, c.id))
  );

  return (
    <CartoesView
      cartoes={detalhes.filter((c) => c !== null)}
      contas={contas}
      hoje={diaSP(new Date())}
    />
  );
}
