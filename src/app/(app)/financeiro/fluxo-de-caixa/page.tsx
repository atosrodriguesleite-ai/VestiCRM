import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isManagerUp } from "@/lib/scope";
import { financeiroLiberado } from "@/lib/financeiro/gate";
import { montarFluxoDeCaixa } from "@/lib/financeiro/relatorios";
import { garantirRecorrencias } from "@/lib/financeiro/recorrencia";
import { diaSP } from "@/lib/financeiro/lancamentos";
import {
  AGRUPAMENTO_LABEL,
  MODO_FLUXO_LABEL,
  type AgrupamentoFluxo,
  type ModoFluxo,
} from "@/lib/financeiro/relatorios-tipos";
import { FluxoView } from "./fluxo-view";

export const dynamic = "force-dynamic";

function mesValido(v: string): string | null {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : null;
}

/**
 * FLUXO DE CAIXA (RN-034) — "tem dinheiro?", mês a mês.
 */
export default async function FluxoDeCaixaPage({
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

  await garantirRecorrencias(user.companyId);

  const sp = await searchParams;
  const texto = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]) ?? "";
  const mesAtual = diaSP(new Date()).slice(0, 7);
  const [ano, mes] = mesAtual.split("-").map(Number);
  // padrão: 3 meses para trás e 3 para frente — o passado explica, o futuro avisa
  const inicioPadrao = new Date(Date.UTC(ano, mes - 4, 1)).toISOString().slice(0, 7);
  const fimPadrao = new Date(Date.UTC(ano, mes + 2, 1)).toISOString().slice(0, 7);
  const de = mesValido(texto("de")) ?? inicioPadrao;
  const ate = mesValido(texto("ate")) ?? fimPadrao;
  const [inicio, fim] = de <= ate ? [de, ate] : [ate, de];

  // lista fechada, nunca `in` no objeto: `?modo=toString` passaria pelo `in`
  // (é chave do prototype) e o relatório sairia inteiro zerado
  const AGRUPAMENTOS = Object.keys(AGRUPAMENTO_LABEL) as AgrupamentoFluxo[];
  const MODOS = Object.keys(MODO_FLUXO_LABEL) as ModoFluxo[];
  const por = AGRUPAMENTOS.find((v) => v === texto("por")) ?? "categoria";
  const modo = MODOS.find((v) => v === texto("modo")) ?? "misto";

  const fluxo = await montarFluxoDeCaixa(user.companyId, inicio, fim, por, modo);
  return <FluxoView filtro={{ de: inicio, ate: fim, por, modo }} fluxo={fluxo} />;
}
