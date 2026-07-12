"use client";

import { useState } from "react";
import { Link2, Check } from "lucide-react";

/**
 * Link rastreado do catálogo para ESTE cliente: quem abrir por ele já entra
 * identificado — navegação, sacola e abandono aparecem com o nome na
 * Inteligência. Se quem copia é vendedor(a), o link também carrega a sua
 * atribuição (?ref) e o pedido chega com o vendedor preenchido.
 */
export function CatalogLinkButton({
  url,
}: {
  url: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
      title="Quem abrir este link já entra identificado como este cliente"
      className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 hover:border-brand-300 text-gray-600 text-sm font-medium px-4 py-2.5 transition"
    >
      {copied ? (
        <>
          <Check className="size-4 text-emerald-500" /> Link copiado!
        </>
      ) : (
        <>
          <Link2 className="size-4 text-brand-500" /> Link do catálogo p/ cliente
        </>
      )}
    </button>
  );
}
