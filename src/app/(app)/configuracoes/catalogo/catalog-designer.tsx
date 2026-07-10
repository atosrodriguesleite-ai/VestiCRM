"use client";

/* eslint-disable @next/next/no-img-element */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ExternalLink,
  Palette,
  Plus,
  Ruler,
  Trash2,
  Type,
  Upload,
  X,
} from "lucide-react";
import { Card } from "@/components/ui";
import { fileToDataUrl } from "@/lib/upload";
import { readableOn } from "@/lib/color";

type ColorItem = { id: string; name: string; hex: string };
type SizeItem = { id: string; name: string };

const FONTS: { key: string; label: string; css: string }[] = [
  { key: "montserrat", label: "Montserrat — moderna e geométrica", css: "'Montserrat', sans-serif" },
  { key: "inter", label: "Inter — neutra e limpa", css: "'Inter', sans-serif" },
  { key: "poppins", label: "Poppins — arredondada e amigável", css: "'Poppins', sans-serif" },
  { key: "playfair", label: "Playfair Display — elegante e editorial", css: "'Playfair Display', serif" },
  { key: "lora", label: "Lora — clássica e sofisticada", css: "'Lora', serif" },
];

const PRESETS: { name: string; colors: [string, string, string] }[] = [
  { name: "Terra", colors: ["#4B3621", "#E7DCCC", "#FFFFFF"] },
  { name: "Noir", colors: ["#111111", "#D4D4D4", "#FFFFFF"] },
  { name: "Rosé", colors: ["#9D2449", "#F6D8E0", "#FFF9FB"] },
  { name: "Oliva", colors: ["#3E4A2E", "#DCE0C8", "#FCFDF7"] },
  { name: "Oceano", colors: ["#1B3A5C", "#CFE0EE", "#FFFFFF"] },
  { name: "Lavanda", colors: ["#5B3E8C", "#E4DCF3", "#FDFCFF"] },
];

export function CatalogDesigner({
  slug,
  canEdit,
  initial,
  colors: initialColors,
  sizes: initialSizes,
}: {
  slug: string;
  canEdit: boolean;
  initial: {
    logoUrl: string | null;
    catalogPrimary: string;
    catalogSecondary: string;
    catalogBg: string;
    catalogFont: string;
    catalogLogoSize: string;
  };
  colors: ColorItem[];
  sizes: SizeItem[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [logo, setLogo] = useState(initial.logoUrl);
  const [primary, setPrimary] = useState(initial.catalogPrimary);
  const [secondary, setSecondary] = useState(initial.catalogSecondary);
  const [bg, setBg] = useState(initial.catalogBg);
  const [font, setFont] = useState(initial.catalogFont);
  const [logoSize, setLogoSize] = useState(initial.catalogLogoSize);
  const [colors, setColors] = useState(initialColors);
  const [sizes, setSizes] = useState(initialSizes);
  const [newColor, setNewColor] = useState({ name: "", hex: "#c94f7c" });
  const [newSize, setNewSize] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function uploadLogo(file: File) {
    const dataUrl = await fileToDataUrl(file, 1000, 0.92);
    setLogo(dataUrl);
  }

  async function saveIdentity() {
    setSaving(true);
    const res = await fetch("/api/company", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        logoUrl: logo,
        catalogPrimary: primary,
        catalogSecondary: secondary,
        catalogBg: bg,
        catalogFont: font,
        catalogLogoSize: logoSize,
      }),
    });
    setSaving(false);
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      router.refresh();
    }
  }

  async function addColor() {
    if (!newColor.name.trim()) return;
    const res = await fetch("/api/catalog-colors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newColor),
    });
    if (res.ok) {
      const created = await res.json();
      setColors((prev) => [
        ...prev.filter((c) => c.id !== created.id),
        created,
      ].sort((a, b) => a.name.localeCompare(b.name)));
      setNewColor({ name: "", hex: newColor.hex });
    }
  }

  async function removeColor(id: string) {
    setColors((prev) => prev.filter((c) => c.id !== id));
    await fetch(`/api/catalog-colors/${id}`, { method: "DELETE" });
  }

  async function addSize() {
    if (!newSize.trim()) return;
    const res = await fetch("/api/catalog-sizes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newSize }),
    });
    if (res.ok) {
      const created = await res.json();
      setSizes((prev) =>
        prev.some((s) => s.id === created.id) ? prev : [...prev, created]
      );
      setNewSize("");
    }
  }

  async function removeSize(id: string) {
    setSizes((prev) => prev.filter((s) => s.id !== id));
    await fetch(`/api/catalog-sizes/${id}`, { method: "DELETE" });
  }

  const fontCss = FONTS.find((f) => f.key === font)?.css;

  return (
    <div className="space-y-5">
      {/* Identidade visual */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold flex items-center gap-2">
            <Palette className="size-4 text-brand-600" />
            Identidade visual
          </h2>
          <a
            href={`/catalogo/${slug}`}
            target="_blank"
            className="flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:text-brand-700"
          >
            <ExternalLink className="size-3.5" />
            Ver catálogo
          </a>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-4">
            {/* Logo */}
            <div>
              <p className="text-sm font-medium mb-2">Logo da marca</p>
              <div className="flex items-center gap-3">
                <div
                  className="h-16 min-w-16 px-3 rounded-xl flex items-center justify-center border border-gray-100"
                  style={{ background: primary }}
                >
                  {logo ? (
                    <img src={logo} alt="Logo" className="max-h-12 max-w-40 object-contain" />
                  ) : (
                    <span className="text-sm font-bold" style={{ color: secondary }}>
                      {slug.split("-")[0]}
                    </span>
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadLogo(f);
                  }}
                />
                <button
                  disabled={!canEdit}
                  onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-1.5 rounded-xl border border-gray-200 hover:border-brand-300 text-gray-600 text-xs font-medium px-3 py-2 transition disabled:opacity-50"
                >
                  <Upload className="size-3.5" />
                  Enviar logo
                </button>
                {logo && canEdit && (
                  <button
                    onClick={() => setLogo(null)}
                    className="text-xs text-gray-400 hover:text-rose-500"
                  >
                    Remover
                  </button>
                )}
              </div>
            </div>

            {/* Paleta */}
            <div>
              <p className="text-sm font-medium mb-2">Paleta de cores</p>
              <div className="grid grid-cols-3 gap-3">
                {(
                  [
                    ["Principal", primary, setPrimary],
                    ["Apoio", secondary, setSecondary],
                    ["Fundo", bg, setBg],
                  ] as const
                ).map(([label, value, set]) => (
                  <label key={label} className="block cursor-pointer">
                    <span className="text-[11px] text-gray-500 font-medium">{label}</span>
                    <span
                      className="mt-1 flex items-center justify-between rounded-xl border border-gray-200 px-2.5 py-2"
                      style={{ background: value, color: readableOn(value) }}
                    >
                      <span className="text-[11px] font-mono font-semibold uppercase">
                        {value}
                      </span>
                      <input
                        type="color"
                        disabled={!canEdit}
                        value={value}
                        onChange={(e) => set(e.target.value)}
                        className="size-6 rounded cursor-pointer bg-transparent border-0 p-0"
                      />
                    </span>
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                {PRESETS.map((p) => (
                  <button
                    key={p.name}
                    disabled={!canEdit}
                    onClick={() => {
                      setPrimary(p.colors[0]);
                      setSecondary(p.colors[1]);
                      setBg(p.colors[2]);
                    }}
                    className="flex items-center gap-1.5 rounded-full border border-gray-200 hover:border-brand-300 px-2.5 py-1 text-[11px] font-medium text-gray-600 transition"
                  >
                    {p.colors.map((c) => (
                      <span
                        key={c}
                        className="size-3 rounded-full border border-black/10"
                        style={{ background: c }}
                      />
                    ))}
                    {p.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Tipografia */}
            <div>
              <p className="text-sm font-medium mb-2">Logo no topo do catálogo</p>
              <div className="grid grid-cols-2 gap-2">
                {([["normal","Padrão (canto)"],["grande","Grande centralizado"]] as const).map(([k,txt]) => (
                  <label key={k} className={`rounded-xl border px-3 py-2.5 text-sm text-center cursor-pointer transition ${logoSize===k ? "border-brand-400 bg-brand-50 font-medium" : "border-gray-200 hover:border-gray-300"}`}>
                    <input type="radio" name="logoSize" disabled={!canEdit} checked={logoSize===k} onChange={() => setLogoSize(k)} className="sr-only" />
                    {txt}
                  </label>
                ))}
              </div>
              <p className="text-[11px] text-gray-400 mt-1.5">
                Grande: o logo preenche o topo, centralizado. Envie um logo em
                boa resolução (ideal ~1000×300 px, PNG com fundo transparente).
              </p>
            </div>

            <div>
              <p className="text-sm font-medium mb-2 flex items-center gap-1.5">
                <Type className="size-3.5 text-gray-400" />
                Tipografia
              </p>
              <div className="space-y-1.5">
                {FONTS.map((f) => (
                  <label
                    key={f.key}
                    className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 cursor-pointer transition ${
                      font === f.key
                        ? "border-brand-400 bg-brand-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name="font"
                      disabled={!canEdit}
                      checked={font === f.key}
                      onChange={() => setFont(f.key)}
                      className="accent-brand-600"
                    />
                    <span className="text-sm">{f.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {canEdit && (
              <button
                onClick={saveIdentity}
                disabled={saving}
                className="rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-5 py-2.5 transition disabled:opacity-60"
              >
                {saving ? "Salvando..." : saved ? "Salvo ✓" : "Salvar identidade"}
              </button>
            )}
          </div>

          {/* Prévia ao vivo */}
          <div>
            <p className="text-sm font-medium mb-2">Prévia</p>
            <div
              className="rounded-2xl overflow-hidden border border-gray-100 shadow-card"
              style={{ background: bg, fontFamily: fontCss }}
            >
              <div className="px-4 py-3 flex items-center justify-between" style={{ background: primary }}>
                {logo ? (
                  <img src={logo} alt="" className="h-7 max-w-32 object-contain" />
                ) : (
                  <span className="font-extrabold text-lg lowercase" style={{ color: secondary }}>
                    sua marca
                  </span>
                )}
                <span
                  className="size-8 rounded-full flex items-center justify-center text-xs font-bold"
                  style={{ background: secondary, color: primary }}
                >
                  3
                </span>
              </div>
              <div className="p-4">
                <p className="font-extrabold uppercase text-lg" style={{ color: readableOn(bg) }}>
                  Catálogo <em className="not-italic" style={{ color: primary }}>Verão</em>
                </p>
                <div className="flex gap-1.5 mt-2">
                  {["Vestidos", "Blusas"].map((c, i) => (
                    <span
                      key={c}
                      className="rounded-full px-3 py-1 text-[11px] font-semibold border"
                      style={
                        i === 0
                          ? { background: primary, color: secondary, borderColor: primary }
                          : { color: primary, borderColor: secondary }
                      }
                    >
                      {c}
                    </span>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2.5 mt-3">
                  {[0, 1].map((i) => (
                    <div key={i} className="rounded-xl overflow-hidden border" style={{ borderColor: secondary }}>
                      <img
                        src={i === 0 ? "/products/vestido-rosa.svg" : "/products/blusa-tricot.svg"}
                        alt=""
                        className="w-full aspect-[4/3] object-cover"
                        style={i === 1 ? { filter: "grayscale(1) opacity(.65)" } : undefined}
                      />
                      <div className="px-2.5 py-2">
                        <p className="text-xs font-bold" style={{ color: readableOn(bg) }}>
                          {i === 0 ? "Vestido Aurora" : "Blusa Nuvem"}
                        </p>
                        <p className="text-xs font-bold" style={{ color: primary }}>
                          {i === 0 ? "R$ 149,90" : "Indisponível"}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  className="mt-3 w-full rounded-xl py-2.5 text-xs font-bold"
                  style={{ background: primary, color: secondary }}
                >
                  Enviar pedido pelo WhatsApp
                </button>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Biblioteca de cores */}
      <Card className="p-5">
        <h2 className="font-semibold flex items-center gap-2 mb-1">
          <Palette className="size-4 text-brand-600" />
          Suas cores
        </h2>
        <p className="text-xs text-gray-500 mb-4">
          Crie a tonalidade e dê o nome — elas viram as bolinhas de cor dos
          produtos no catálogo e as opções da grade.
        </p>
        <div className="flex flex-wrap gap-2 mb-4">
          {colors.map((c) => (
            <span
              key={c.id}
              className="group flex items-center gap-2 rounded-full border border-gray-200 pl-1.5 pr-2.5 py-1.5 text-xs font-medium"
            >
              <span
                className="size-5 rounded-full border border-black/10"
                style={{ background: c.hex }}
              />
              {c.name}
              {canEdit && (
                <button
                  onClick={() => removeColor(c.id)}
                  className="text-gray-300 hover:text-rose-500 transition"
                  title="Remover cor"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </span>
          ))}
          {colors.length === 0 && (
            <p className="text-xs text-gray-400">Nenhuma cor criada ainda.</p>
          )}
        </div>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="color"
              value={newColor.hex}
              onChange={(e) => setNewColor((c) => ({ ...c, hex: e.target.value }))}
              className="size-10 rounded-xl cursor-pointer border border-gray-200 p-1 bg-white"
              title="Escolher tonalidade"
            />
            <input
              value={newColor.name}
              onChange={(e) => setNewColor((c) => ({ ...c, name: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && addColor()}
              placeholder="Nome da cor (ex.: Rosa Millennial)"
              className="flex-1 min-w-44 rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400"
            />
            <button
              onClick={addColor}
              className="flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2.5 transition"
            >
              <Plus className="size-4" />
              Criar cor
            </button>
          </div>
        )}
      </Card>

      {/* Tamanhos */}
      <Card className="p-5">
        <h2 className="font-semibold flex items-center gap-2 mb-1">
          <Ruler className="size-4 text-brand-600" />
          Seus tamanhos
        </h2>
        <p className="text-xs text-gray-500 mb-4">
          P, M, G, GG, numeração ou o que fizer sentido para a sua loja.
        </p>
        <div className="flex flex-wrap gap-2 mb-4">
          {sizes.map((s) => (
            <span
              key={s.id}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold"
            >
              {s.name}
              {canEdit && (
                <button
                  onClick={() => removeSize(s.id)}
                  className="text-gray-300 hover:text-rose-500 transition"
                  title="Remover tamanho"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </span>
          ))}
          {sizes.length === 0 && (
            <p className="text-xs text-gray-400">Nenhum tamanho criado ainda.</p>
          )}
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <input
              value={newSize}
              onChange={(e) => setNewSize(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addSize()}
              placeholder="Novo tamanho (ex.: XG, 44, Único)"
              className="flex-1 max-w-64 rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400"
            />
            <button
              onClick={addSize}
              className="flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2.5 transition"
            >
              <Plus className="size-4" />
              Adicionar
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}
