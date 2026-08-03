import { redirect } from "next/navigation";
import {
  Bot,
  MessageCircle,
  Timer,
  Wallet,
  Inbox,
  AlertTriangle,
} from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isManagerUp } from "@/lib/scope";
import { brl } from "@/lib/format";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { StatTile } from "@/components/charts";
import { configDaIa, estadoDaTrava, monitorDeEquipe, usoDoMes } from "@/lib/ia";
import { CerebroDaIa } from "./cerebro";

export const dynamic = "force-dynamic";

/**
 * IA DE VENDAS — Entrega 1: o Cérebro (o que a loja ensina), o plano de uso
 * com trava e o Monitor de Equipe. A IA que RESPONDE chega na próxima
 * entrega — quando chegar, já encontra tudo daqui pronto.
 */
export default async function IaPage() {
  const user = await requireUser();
  if (!isManagerUp(user)) redirect("/dashboard");
  const company = await db.company.findUnique({
    where: { id: user.companyId },
    select: { aiSalesEnabled: true },
  });
  // módulo pago à parte: sem a chave do Super Admin, a tela não existe
  if (!company?.aiSalesEnabled) redirect("/dashboard");

  const [config, uso, monitor] = await Promise.all([
    configDaIa(user.companyId),
    usoDoMes(user.companyId),
    monitorDeEquipe(user),
  ]);
  const trava = estadoDaTrava(config.limiteConversasMes, uso.conversas);

  const fmtMin = (min: number | null) =>
    min == null
      ? "—"
      : min < 60
        ? `${min} min`
        : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="IA de Vendas"
        subtitle="Ensine a IA a vender do jeito da sua marca. O atendimento automático chega na próxima atualização — tudo que você configurar aqui já fica valendo."
      />

      {/* plano de conversas e trava de uso */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
        <StatTile
          label="Plano do mês"
          value={trava.limite.toLocaleString("pt-BR")}
          hint="conversas de IA inclusas"
          icon={<Bot />}
        />
        <StatTile
          label="Usadas no mês"
          value={String(trava.usadas)}
          hint={`restam ${trava.restantes.toLocaleString("pt-BR")}`}
          icon={<MessageCircle />}
          tone={trava.estourou ? "warn" : trava.alerta ? "warn" : "good"}
        />
        <StatTile
          label="Respostas da IA"
          value={String(uso.respostas)}
          hint="mensagens escritas pela IA"
          icon={<Inbox />}
        />
        <StatTile
          label="Situação"
          value={trava.estourou ? "No teto" : trava.alerta ? "Quase lá" : "Tranquila"}
          hint={
            trava.estourou
              ? "a IA pausaria; humanas seguem normal"
              : `${Math.min(Math.round(trava.pct * 100), 999)}% do plano usado`
          }
          icon={<AlertTriangle />}
          tone={trava.estourou ? "warn" : "good"}
        />
      </div>

      {trava.alerta && !trava.estourou && (
        <Card className="p-4 mb-6 border-amber-200 bg-amber-50/60">
          <p className="text-sm text-amber-800">
            ⚠️ Seu plano de conversas passou de 80% neste mês. Quando bater o
            teto, a IA pausa e o atendimento segue com a equipe — fale com a
            plataforma para ampliar o plano.
          </p>
        </Card>
      )}

      {/* o cérebro: tom, roteiro e políticas (formulário client) */}
      <CerebroDaIa
        inicial={{
          tomDeMarca: config.tomDeMarca,
          roteiro: config.roteiro,
          politicas: config.politicas,
          atendente: config.atendente,
          copilot: config.copilot,
          relatoriosAoDono: config.relatoriosAoDono,
        }}
      />

      {/* Monitor de Equipe — determinístico, mesmo mês/régua das outras telas */}
      <Card className="p-5 mt-6">
        <h2 className="font-semibold flex items-center gap-2 mb-1">
          <Timer className="size-4 text-brand-600" />
          Monitor de Equipe — este mês
        </h2>
        <p className="text-[11px] text-gray-400 mb-4">
          Tempo de resposta e conversas saem do WhatsApp; vendas usam a régua
          oficial (pedido pago, valor sem frete). Nada aqui é estimativa.
        </p>

        {monitor.fila.aguardando > 0 && (
          <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50/70 px-4 py-3 text-sm text-rose-800">
            🔔 <b>{monitor.fila.aguardando}</b> conversa
            {monitor.fila.aguardando === 1 ? "" : "s"} na fila sem dona,
            esperando há até <b>{fmtMin(monitor.fila.maiorEsperaMin)}</b>.
          </div>
        )}

        {monitor.vendedoras.length === 0 ? (
          <EmptyState title="Sem equipe cadastrada ainda" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                  <th className="py-2 pr-3">Vendedora</th>
                  <th className="py-2 pr-3">Conversas</th>
                  <th className="py-2 pr-3">Respostas</th>
                  <th className="py-2 pr-3">Tempo p/ responder</th>
                  <th className="py-2 pr-3">Esperando agora</th>
                  <th className="py-2 pr-3">Vendas</th>
                  <th className="py-2 pr-3">Conversão</th>
                  <th className="py-2">Agenda atrasada</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {monitor.vendedoras.map((v) => (
                  <tr key={v.userId}>
                    <td className="py-2.5 pr-3 font-medium text-gray-700">
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="size-2.5 rounded-full shrink-0"
                          style={{ background: v.color }}
                        />
                        {v.nome}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 tabular-nums">{v.conversas}</td>
                    <td className="py-2.5 pr-3 tabular-nums">{v.respostas}</td>
                    <td className="py-2.5 pr-3 tabular-nums">
                      {fmtMin(v.mediaRespostaMin)}
                    </td>
                    <td className="py-2.5 pr-3">
                      {v.aguardandoAgora === 0 ? (
                        <span className="text-emerald-600">em dia ✓</span>
                      ) : (
                        <span className="text-rose-600 font-medium tabular-nums">
                          {v.aguardandoAgora} (há {fmtMin(v.maiorEsperaMin)})
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 tabular-nums">
                      {v.pedidos > 0 ? (
                        <>
                          {v.pedidos} · <b>{brl(v.vendido)}</b>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2.5 pr-3 tabular-nums">
                      {v.conversaoPct == null ? "—" : `${v.conversaoPct}%`}
                    </td>
                    <td className="py-2.5 tabular-nums">
                      {v.tarefasAtrasadas === 0 ? (
                        <span className="text-emerald-600">0</span>
                      ) : (
                        <span className="text-amber-600 font-medium">
                          {v.tarefasAtrasadas}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-gray-400">
          <Wallet className="size-3.5" />
          Vendas e conversão consideram pedidos pagos do mês (mesma régua do
          Dashboard e das Comissões).
        </p>
      </Card>
    </div>
  );
}
