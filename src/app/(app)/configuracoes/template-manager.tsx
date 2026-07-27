"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Pencil, Check, X } from "lucide-react";
import { Card, Badge } from "@/components/ui";
import { templateCategoryLabel } from "@/lib/format";

type Template = { id: string; title: string; body: string; category: string };

const CATEGORY_COLORS: Record<string, string> = {
  PRIMEIRO_ATENDIMENTO: "#0ea5e9",
  CATALOGO: "#c4622d",
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
  const [editing, setEditing] = useState<string | null>(null);

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

  async function remove(id: string, titulo: string) {
    // apagar é definitivo: pergunta antes (um toque sem querer apagava)
    if (!confirm(`Apagar a resposta rápida "${titulo}"? Não dá para desfazer.`))
      return;
    setTemplates((prev) => prev.filter((t) => t.id !== id));
    await fetch(`/api/templates/${id}`, { method: "DELETE" });
    router.refresh();
  }

  /** Salva a edição de um modelo já existente. */
  async function salvarEdicao(e: React.FormEvent<HTMLFormElement>, id: string) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const dados = {
      title: String(fd.get("title") ?? "").trim(),
      body: String(fd.get("body") ?? "").trim(),
      category: String(fd.get("category") ?? "OUTRO"),
    };
    if (!dados.title || !dados.body) return;
    setSaving(true);
    const res = await fetch(`/api/templates/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dados),
    });
    setSaving(false);
    if (res.ok) {
      const t = await res.json();
      setTemplates((prev) => prev.map((x) => (x.id === id ? t : x)));
      setEditing(null);
      router.refresh();
    } else {
      alert("Não consegui salvar. Tente de novo.");
    }
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
        {visible.map((t) =>
          editing === t.id ? (
            // ---- edição do modelo (mesmo lugar do card) ----
            <Card key={t.id} className="p-4">
              <form onSubmit={(e) => salvarEdicao(e, t.id)} className="space-y-3">
                <input
                  name="title"
                  required
                  defaultValue={t.title}
                  placeholder="Nome do modelo"
                  className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400"
                />
                <select
                  name="category"
                  defaultValue={t.category}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm bg-white outline-none focus:border-brand-400"
                >
                  {Object.entries(templateCategoryLabel).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
                <textarea
                  name="body"
                  required
                  rows={4}
                  defaultValue={t.body}
                  placeholder="Texto da mensagem — use {{nome}} e {{vendedora}}"
                  className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400"
                />
                <div className="flex gap-2">
                  <button
                    disabled={saving}
                    className="flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 transition disabled:opacity-60"
                  >
                    <Check className="size-4" />
                    {saving ? "Salvando..." : "Salvar"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    className="flex items-center gap-1.5 rounded-xl border border-gray-200 text-gray-500 text-sm font-medium px-4 py-2 hover:border-gray-300 transition"
                  >
                    <X className="size-4" />
                    Cancelar
                  </button>
                </div>
              </form>
            </Card>
          ) : (
            <Card key={t.id} className="p-4">
              <div className="flex items-start gap-2 mb-1">
                <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
                  <p className="text-sm font-semibold text-brand-700">{t.title}</p>
                  <Badge color={CATEGORY_COLORS[t.category] ?? "#94a3b8"}>
                    {templateCategoryLabel[t.category as keyof typeof templateCategoryLabel] ?? t.category}
                  </Badge>
                </div>
                {/* botões SEMPRE visíveis: no celular não existe passar o mouse */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setEditing(t.id)}
                    className="p-2 rounded-lg text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition"
                    title="Editar modelo"
                    aria-label={`Editar ${t.title}`}
                  >
                    <Pencil className="size-4" />
                  </button>
                  <button
                    onClick={() => remove(t.id, t.title)}
                    className="p-2 rounded-lg text-gray-400 hover:text-rose-500 hover:bg-rose-50 transition"
                    title="Excluir modelo"
                    aria-label={`Excluir ${t.title}`}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
              <p className="text-xs text-gray-500 leading-relaxed whitespace-pre-wrap">
                {t.body}
              </p>
            </Card>
          )
        )}
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
