"use client";

import { useRef, useState } from "react";
import { Images, Upload, Download, Trash2, Loader2 } from "lucide-react";
import { fileToDataUrl } from "@/lib/upload";

type Asset = { id: string; name: string | null; createdAt: string };

export function BibliotecaView({ initial }: { initial: Asset[] }) {
  const [assets, setAssets] = useState<Asset[]>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setMsg("");
    let ok = 0;
    let falhou = 0;
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) {
        falhou++;
        continue;
      }
      try {
        const dataUrl = await fileToDataUrl(file);
        const res = await fetch("/api/media", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: file.name.replace(/\.[^.]+$/, ""), dataUrl }),
        });
        if (res.ok) {
          const a = (await res.json()) as Asset;
          setAssets((prev) => [a, ...prev]);
          ok++;
        } else falhou++;
      } catch {
        falhou++;
      }
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
    setMsg(
      `${ok} imagem(ns) enviada(s)${falhou ? ` · ${falhou} falharam (envie só imagens)` : ""}.`
    );
  }

  async function remover(id: string) {
    if (!window.confirm("Remover esta imagem da biblioteca? Isso não afeta os produtos que já a usam.")) return;
    const res = await fetch(`/api/media/${id}`, { method: "DELETE" });
    if (res.ok) setAssets((prev) => prev.filter((a) => a.id !== id));
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
        <div>
          <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
            <Images className="size-6 text-brand-600" />
            Biblioteca de imagens
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {assets.length} imagem(ns) guardada(s). Suba fotos pra reaproveitar
            nos produtos ou pra guardar antes de excluir uma peça.
          </p>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => onFiles(e.target.files)}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-4 py-2.5 transition disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          Enviar imagens
        </button>
      </div>

      {msg && (
        <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2 mb-3">{msg}</p>
      )}

      {assets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white py-16 text-center mt-4">
          <Images className="size-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-600">Nenhuma imagem ainda</p>
          <p className="text-xs text-gray-400 mt-1">
            Clique em <b>Enviar imagens</b> pra começar a guardar suas fotos.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 mt-4">
          {assets.map((a) => (
            <div
              key={a.id}
              className="group relative rounded-xl overflow-hidden border border-gray-100 bg-white"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/media/${a.id}/raw`}
                alt={a.name ?? "Imagem"}
                className="w-full aspect-square object-cover bg-gray-50"
                loading="lazy"
              />
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/60 to-transparent p-1.5 opacity-0 group-hover:opacity-100 transition">
                <a
                  href={`/api/media/${a.id}/raw?download=1`}
                  download
                  title="Baixar"
                  className="rounded-lg bg-white/90 hover:bg-white text-gray-700 p-1.5 transition"
                >
                  <Download className="size-3.5" />
                </a>
                <button
                  onClick={() => remover(a.id)}
                  title="Remover"
                  className="rounded-lg bg-white/90 hover:bg-white text-rose-600 p-1.5 transition"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              {a.name && (
                <p className="text-[10px] text-gray-500 truncate px-1.5 py-1">{a.name}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
