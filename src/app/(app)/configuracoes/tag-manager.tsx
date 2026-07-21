"use client";

import { useState } from "react";
import { Plus, Trash2, Tag as TagIcon } from "lucide-react";
import { Card } from "@/components/ui";

type Tag = { id: string; name: string; color: string };

const PALETTE = [
  "#8b5cf6", "#ec4899", "#f59e0b", "#10b981",
  "#0ea5e9", "#ef4444", "#14b8a6", "#6366f1",
];

/** Cria e gerencia as etiquetas (tags) usadas para marcar os contatos. */
export function TagManager({ initial }: { initial: Tag[] }) {
  const [tags, setTags] = useState(initial);
  const [name, setName] = useState("");
  const [color, setColor] = useState(PALETTE[0]);
  const [saving, setSaving] = useState(false);

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const nome = name.trim();
    if (!nome) return;
    setSaving(true);
    const res = await fetch("/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nome, color }),
    });
    setSaving(false);
    if (res.ok) {
      const t: Tag = await res.json();
      setTags((prev) => (prev.some((x) => x.id === t.id) ? prev : [...prev, t]));
      setName("");
      setColor(PALETTE[(tags.length + 1) % PALETTE.length]);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Excluir esta etiqueta? Ela sai de todos os contatos que a usavam.")) return;
    setTags((prev) => prev.filter((t) => t.id !== id));
    await fetch(`/api/tags/${id}`, { method: "DELETE" });
  }

  return (
    <div className="space-y-3">
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {tags.map((t) => (
            <span
              key={t.id}
              className="group inline-flex items-center gap-1.5 rounded-full pl-2.5 pr-1.5 py-1 text-xs font-semibold"
              style={{ backgroundColor: `${t.color}1a`, color: t.color }}
            >
              <span className="size-2 rounded-full" style={{ backgroundColor: t.color }} />
              {t.name}
              <button
                onClick={() => remove(t.id)}
                className="rounded-full p-0.5 opacity-60 hover:opacity-100 hover:bg-black/5"
                title="Excluir etiqueta"
              >
                <Trash2 className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <Card className="p-4">
        <form onSubmit={create} className="flex flex-wrap items-center gap-2">
          <TagIcon className="size-4 text-gray-300 shrink-0" />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            placeholder="Nome da etiqueta (ex.: VIP, Atacado, Inadimplente)"
            className="flex-1 min-w-40 rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400"
          />
          <div className="flex items-center gap-1">
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`size-6 rounded-full transition ${
                  color === c ? "ring-2 ring-offset-1 ring-gray-400" : ""
                }`}
                style={{ backgroundColor: c }}
                title="Cor da etiqueta"
              />
            ))}
          </div>
          <button
            disabled={saving || !name.trim()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2.5 transition disabled:opacity-50"
          >
            <Plus className="size-4" />
            {saving ? "Criando..." : "Criar etiqueta"}
          </button>
        </form>
      </Card>
    </div>
  );
}
