import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isManagerUp } from "@/lib/scope";
import { financeiroLiberado } from "@/lib/financeiro/gate";
import { montarDFC } from "@/lib/financeiro/visao";
import { dataDoDia, diaSP } from "@/lib/financeiro/lancamentos";
import { DfcView } from "./dfc-view";

export const dynamic = "force-dynamic";

/**
 * DFC (RN-033) — "por onde o dinheiro andou": só o que entrou e saiu de
 * verdade, separado em operacional, investimento e financiamento.
 */
export default async function DfcPage({
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
  const hojeDia = diaSP(new Date());
  const [ano, mes] = hojeDia.split("-").map(Number);
  const primeiro = `${hojeDia.slice(0, 7)}-01`;
  const ultimo = `${hojeDia.slice(0, 7)}-${String(
    new Date(Date.UTC(ano, mes, 0)).getUTCDate()
  ).padStart(2, "0")}`;
  const deIso = dataDoDia(texto("de")) ? texto("de") : primeiro;
  const ateIso = dataDoDia(texto("ate")) ? texto("ate") : ultimo;

  const dfc = await montarDFC(user.companyId, dataDoDia(deIso)!, dataDoDia(ateIso)!);
  return <DfcView filtro={{ de: deIso, ate: ateIso }} dfc={dfc} />;
}
