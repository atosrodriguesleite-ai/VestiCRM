import { porteiraFinanceiroTela } from "@/lib/financeiro/gate";
import { montarDRE } from "@/lib/financeiro/relatorios";
import { diaSP } from "@/lib/financeiro/lancamentos";
import { garantirRecorrencias } from "@/lib/financeiro/recorrencia";
import { DreView } from "./dre-view";

export const dynamic = "force-dynamic";

/** Mês válido ("2026-09") ou null. */
function mesValido(v: string): string | null {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : null;
}

/**
 * DRE (RN-036) — "a loja deu lucro?", por competência, mês a mês.
 */
export default async function DrePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await porteiraFinanceiroTela();

  // carona no tráfego (RN-031/ADR-002): as contas fixas do horizonte
  await garantirRecorrencias(user.companyId);

  const sp = await searchParams;
  const texto = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]) ?? "";
  const mesAtual = diaSP(new Date()).slice(0, 7);
  // padrão: os últimos 6 meses, que é onde a lojista compara
  const [ano, mes] = mesAtual.split("-").map(Number);
  const inicioPadrao = new Date(Date.UTC(ano, mes - 6, 1)).toISOString().slice(0, 7);
  const de = mesValido(texto("de")) ?? inicioPadrao;
  const ate = mesValido(texto("ate")) ?? mesAtual;
  // de depois de até devolveria tabela vazia sem explicar: inverte
  const [inicio, fim] = de <= ate ? [de, ate] : [ate, de];

  const dre = await montarDRE(user.companyId, inicio, fim);
  return <DreView filtro={{ de: inicio, ate: fim }} dre={dre} />;
}
