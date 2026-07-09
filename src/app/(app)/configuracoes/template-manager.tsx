"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Card, Badge } from "@/components/ui";
import { templateCategoryLabel } from "@/lib/format";

type Template = { id: string; title: string; body: string; category: string };

const CATEGORY_COLORS: Record<string, string> = {
  PRIMEIRO_ATENDIMENTO: "#0ea5e9",
  CATALOGO: "#6d28ff",
  COBRANCA: "#f59e0b",
  POS_VENDA: "#10b981",
  RECOMPRA: "#14b8a6",
  PROMOCAO: "#ec4899",
  CLIENTE_FRIO: "#64748b",
  ANIVERSARIO: "#e11d48",
  OUTRO: "#94a3b8",
};

export function TemplateManager({ initial }: { initial: Template[] }) {
  const router = useRouter();
  const [templates, setTemplates] = useState(initial);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("ALL");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const fd = new FormData(e.currentTarget);
    const res = await fetch("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: fd.get("title"),
        body: fd.get("body"),
        category: fd.get("category"),
      }),
    });
    setSaving(false);
    if (res.ok) {
      const t = await res.json();
      setTemplates((prev) => [...prev, t]);
      setAdding(false);
      router.refresh();
    }
  }

  async function remove(id: string) {
    setTemplates((prev) => prev.filter((t) => t.id !== id));
    await fetch(`/api/templates/${id}`, { method: "DELETE" });
    router.refresh();
  }

  const visible =
    filter === "ALL" ? templates : templates.filter((t) => t.category === filter);
  const usedCategories = [...new Set(templates.map((t) => t.category))];

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 overflow-x-auto thin-scroll pb-1">
        <button
          onClick={() => setFilter("ALL")}
          className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium whitespace-nowrap transition ${
            filter === "ALL"
              ? "bg-brand-600 text-white"
              : "bg-white border border-gray-200 text-gray-500"
          }`}
        >
          Todos ({templates.length})
        </button>
        {usedCategories.map((c) => (
          <button
            key={c}
            onClick={() => setFilter(c)}
            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium whitespace-nowrap transition ${
              filter === c
                ? "bg-brand-600 text-white"
                : "bg-white border border-gray-200 text-gray-500"
            }`}
          >
            {templateCategoryLabel[c as keyof typeof templateCategoryLabel] ?? c}
          </button>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        {visible.map((t) => (
          <Card key={t.id} className="p-4 group relative">
            <div className="flex items-center gap-2 mb-1">
              <p className="text-sm font-semibold text-brand-700">{t.title}</p>
              <Badge color={CATEGORY_COLORS[t.category] ?? "#94a3b8"}>
                {templateCategoryLabel[t.category as keyof typeof templateCategoryLabel] ?? t.category}
              </Badge>
            </div>
            <p className="text-xs text-gray-500 leading-relaxed">{t.body}</p>
            <button
              onClick={() => remove(t.id)}
              className="absolute top-3 right-3 p-1.5 rounded-lg text-gray-300 hover:text-rose-500 hover:bg-rose-50 opacity-0 group-hover:opacity-100 transition"
              title="Excluir modelo"
            >
              <Trash2 className="size-4" />
            </button>
          </Card>
        ))}
      </div>

      {adding ? (
        <Card className="p-4">
          <form onSubmit={submit} className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <input
                name="title"
                required
                placeholder="Nome do modelo (ex.: Cobrança gentil)"
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400"
              />
              <select
                name="category"
                defaultValue="OUTRO"
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm bg-white outline-none focus:border-brand-400"
              >
                {Object.entries(templateCategoryLabel).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <textarea
              name="body"
              required
              rows={3}
              placeholder="Texto da mensagem — use {{nome}} e {{vendedora}} para personalizar"
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400"
            />
            <div className="flex gap-2">
              <button
                disabled={saving}
                className="rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 transition disabled:opacity-60"
              >
                {saving ? "Salvando..." : "Salvar modelo"}
              </button>
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="rounded-xl border border-gray-200 text-gray-500 text-sm font-medium px-4 py-2 hover:border-gray-300 transition"
              >
                Cancelar
              </button>
            </div>
          </form>
        </Card>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700 transition"
        >
          <Plus className="size-4" />
          Adicionar modelo
        </button>
      )}
    </div>
  );
}
