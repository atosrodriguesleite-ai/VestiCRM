"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, Zap } from "lucide-react";
import type { AutomationSuggestion } from "@/lib/automations";
import { Card, Badge, EmptyState } from "@/components/ui";

export function SuggestionList({
  initial,
}: {
  initial: AutomationSuggestion[];
}) {
  const [suggestions, setSuggestions] = useState(initial);
  const [applying, setApplying] = useState<string | null>(null);
  const [appliedCount, setAppliedCount] = useState(0);

  async function apply(key: string) {
    setApplying(key);
    const res = await fetch("/api/automations/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    setApplying(null);
    if (res.ok) {
      setSuggestions((prev) => prev.filter((s) => s.key !== key));
      setAppliedCount((c) => c + 1);
    }
  }

  return (
    <>
      {appliedCount > 0 && (
        <p className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 rounded-xl px-4 py-2.5 mb-4">
          <CheckCircle2 className="size-4" />
          {appliedCount} tarefa{appliedCount === 1 ? "" : "s"} criada
          {appliedCount === 1 ? "" : "s"} —{" "}
          <Link href="/tarefas" className="font-semibold underline">
            ver tarefas
          </Link>
        </p>
      )}

      {suggestions.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Zap />}
            title="Nenhuma sugestão pendente"
            hint="Quando um cliente esfriar, esquecer um catálogo ou completar 30 dias sem comprar, a sugestão aparece aqui."
          />
        </Card>
      ) : (
        <div className="space-y-2">
          {suggestions.map((s) => (
            <Card
              key={s.key}
              className="p-4 flex flex-col sm:flex-row sm:items-center gap-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Badge color="#7c3aed">{s.rule}</Badge>
                  <Badge
                    color={
                      s.priority === "ALTA"
                        ? "#e11d48"
                        : s.priority === "MEDIA"
                          ? "#d97706"
                          : "#64748b"
                    }
                  >
                    {s.priority === "ALTA"
                      ? "Alta"
                      : s.priority === "MEDIA"
                        ? "Média"
                        : "Baixa"}
                  </Badge>
                </div>
                <p className="text-sm font-semibold">
                  <Link
                    href={`/clientes/${s.customerId}`}
                    className="hover:text-brand-600"
                  >
                    {s.title}
                  </Link>
                </p>
                <p className="text-xs text-gray-500 mt-0.5">{s.description}</p>
              </div>
              <button
                onClick={() => apply(s.key)}
                disabled={applying === s.key}
                className="shrink-0 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium px-4 py-2.5 transition disabled:opacity-60"
              >
                {applying === s.key ? "Criando..." : "Criar tarefa"}
              </button>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
