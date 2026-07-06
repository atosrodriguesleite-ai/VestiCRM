import { Zap } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { computeAutomations } from "@/lib/automations";
import { PageHeader, Card } from "@/components/ui";
import { SuggestionList } from "./suggestion-list";

export const dynamic = "force-dynamic";

const RULES = [
  {
    title: "Cliente sem resposta há 2 dias",
    desc: "Conversas aguardando o cliente há mais de 2 dias geram sugestão de follow-up.",
  },
  {
    title: "Recebeu catálogo e não comprou",
    desc: "Negociações paradas na etapa \"Catálogo enviado\" há 3+ dias lembram o vendedor.",
  },
  {
    title: "Comprou há 30 dias",
    desc: "Clientes com última compra entre 30 e 90 dias recebem sugestão de recompra.",
  },
  {
    title: "Negociação perdida",
    desc: "Clientes perdidos recentemente entram na fila de reativação.",
  },
  {
    title: "Cliente novo",
    desc: "Todo cliente novo sem contato gera tarefa de primeira abordagem (criada automaticamente no cadastro).",
  },
  {
    title: "Pedido fechado",
    desc: "Pedidos ganhos sem pós-venda geram tarefa para confirmar entrega e pedir feedback.",
  },
];

export default async function AutomationsPage() {
  const user = await requireUser();
  const suggestions = await computeAutomations(user);

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Automação comercial"
        subtitle="O VestiCRM vigia sua carteira e sugere a próxima ação. Aplique com um clique para virar tarefa."
      />

      <SuggestionList initial={suggestions} />

      <h2 className="font-semibold mt-10 mb-3 flex items-center gap-2">
        <Zap className="size-4 text-brand-600" />
        Regras ativas
      </h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {RULES.map((r) => (
          <Card key={r.title} className="p-4">
            <p className="text-sm font-semibold mb-1">{r.title}</p>
            <p className="text-xs text-gray-500 leading-relaxed">{r.desc}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
