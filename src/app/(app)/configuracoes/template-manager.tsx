"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Card } from "@/components/ui";

type Template = { id: string; title: string; body: string };

export function TemplateManager({ initial }: { initial: Template[] }) {
  const router = useRouter();
  const [templates, setTemplates] = useState(initial);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const fd = new FormData(e.currentTarget);
    const res = await fetch("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: fd.get("title"), body: fd.get("body") }),
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

  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        {templates.map((t) => (
          <Card key={t.id} className="p-4 group relative">
            <p className="text-sm font-semibold text-brand-700 mb-1">
              {t.title}
            </p>
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
            <input
              name="title"
              required
              placeholder="Nome do modelo (ex.: Cobrança gentil)"
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400"
            />
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
