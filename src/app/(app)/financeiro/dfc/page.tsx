import { porteiraFinanceiroTela } from "@/lib/financeiro/gate";
import { montarDFC } from "@/lib/financeiro/visao";
import { dataDoDia, diaSP } from "@/lib/financeiro/lancamentos";
import { DfcView } from "./dfc-view";

export const dynamic = "force-dynamic";

/**
 * DFC (RN-035) — "por onde o dinheiro andou": só o que entrou e saiu de
 * verdade, separado em operacional, investimento e financiamento.
 */
export default async function DfcPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await porteiraFinanceiroTela();

  const sp = await searchParams;
  const texto = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]) ?? "";
  const hojeDia = diaSP(new Date());
  const [ano, mes] = hojeDia.split("-").map(Number);
  const primeiro = `${hojeDia.slice(0, 7)}-01`;
  const ultimo = `${hojeDia.slice(0, 7)}-${String(
    new Date(Date.UTC(ano, mes, 0)).getUTCDate()
  ).padStart(2, "0")}`;
  const cru = {
    de: dataDoDia(texto("de")) ? texto("de") : primeiro,
    ate: dataDoDia(texto("ate")) ? texto("ate") : ultimo,
  };
  /**
   * DE DEPOIS DE ATÉ SE INVERTE — o DRE e o fluxo já faziam, esta tela não.
   * Aqui o efeito era pior: as consultas voltavam vazias, mas o resíduo do
   * teste de honestidade é calculado por DIFERENÇA de saldos, então a loja
   * que movimentou R$ 45 mil no mês via "A loja gerou: R$ 0,00" ao lado de
   * "Transferências: −R$ 45.000,00" e o rodapé afirmando que a conta fecha.
   * Dizer o NOME ERRADO do dinheiro é o que a RN-035 chama de pior que não
   * mostrar (auditoria completa do módulo, 03/09/2026).
   */
  const [deIso, ateIso] = cru.de <= cru.ate ? [cru.de, cru.ate] : [cru.ate, cru.de];

  const dfc = await montarDFC(user.companyId, dataDoDia(deIso)!, dataDoDia(ateIso)!);
  return <DfcView filtro={{ de: deIso, ate: ateIso }} dfc={dfc} />;
}
