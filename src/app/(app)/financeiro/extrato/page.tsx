import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isManagerUp } from "@/lib/scope";
import { financeiroLiberado } from "@/lib/financeiro/gate";
import { garantirRecorrencias } from "@/lib/financeiro/recorrencia";
import { carregarExtrato } from "@/lib/financeiro/extrato";
import { dataDoDia, diaSP } from "@/lib/financeiro/lancamentos";
import { ExtratoView } from "./extrato-view";

export const dynamic = "force-dynamic";

/**
 * EXTRATO (RN-032) — o livro-caixa: tudo que entrou, saiu e foi transferido,
 * com o saldo acumulado linha a linha. É aqui que se confere com o banco.
 */
export default async function ExtratoPage({
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

  // carona no tráfego: as contas fixas do mês entram sem cron (ADR-002)
  await garantirRecorrencias(user.companyId);

  const sp = await searchParams;
  const texto = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]) ?? "";

  const hoje = new Date();
  const hojeDia = diaSP(hoje);
  const [ano, mes] = hojeDia.split("-").map(Number);
  const primeiro = `${hojeDia.slice(0, 7)}-01`;
  const ultimo = `${hojeDia.slice(0, 7)}-${String(
    new Date(Date.UTC(ano, mes, 0)).getUTCDate()
  ).padStart(2, "0")}`;
  const deIso = dataDoDia(texto("de")) ? texto("de") : primeiro;
  const ateIso = dataDoDia(texto("ate")) ? texto("ate") : ultimo;

  const contas = await db.finConta.findMany({
    where: { companyId: user.companyId },
    orderBy: [{ arquivadaEm: "asc" }, { padrao: "desc" }, { nome: "asc" }],
    select: { id: true, nome: true, cor: true, arquivadaEm: true },
  });
  const contaId = contas.some((c) => c.id === texto("conta")) ? texto("conta") : "";

  const { linhas, cards, truncado } = await carregarExtrato({
    companyId: user.companyId,
    contaId: contaId || null,
    de: dataDoDia(deIso)!,
    ate: dataDoDia(ateIso)!,
  });

  return (
    <ExtratoView
      filtro={{ de: deIso, ate: ateIso, conta: contaId }}
      contas={contas.map((c) => ({
        id: c.id,
        nome: c.nome,
        cor: c.cor,
        arquivada: Boolean(c.arquivadaEm),
      }))}
      linhas={linhas}
      cards={cards}
      truncado={truncado}
    />
  );
}
