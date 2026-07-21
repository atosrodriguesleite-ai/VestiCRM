"use client";

/**
 * Atalho "Novo lead + link do catálogo": a vendedora recebe o pedido de
 * catálogo no WhatsApp, preenche nome + WhatsApp aqui e sai com o link
 * rastreado pronto — o lead já entra na base (e no funil, conforme a
 * política da loja) sem cadastro duplo. Quem abrir o link entra
 * identificado no catálogo desde o primeiro toque.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, X, Check, Copy, MessageCircle } from "lucide-react";
import { trackedCatalogLink } from "@/lib/catalog-url";

export function QuickLeadLink({
  base,
  sellerRef,
}: {
  base: string; // catalogUrl(slug) — absoluto com domínio ou /catalogo/slug
  sellerRef: string | null; // primeiro nome de quem copia (vendedor/gerente)
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ link: string; phone: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // iPhone/Safari não encolhem a página quando o teclado abre (ignoram o
  // interactiveWidget). Então medimos o teclado pela Visual Viewport e
  // empurramos a janela pra cima dele, garantindo que o botão apareça.
  useEffect(() => {
    if (!open) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      if (wrapRef.current) wrapRef.current.style.paddingBottom = `${kb}px`;
      if (panelRef.current) panelRef.current.style.maxHeight = `${vv.height - 16}px`;
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [open]);

  const linkFor = (code: string) => trackedCatalogLink(base, sellerRef, code);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const digits = phone.replace(/\D/g, "");
    if (!name.trim() || digits.length < 10) {
      setError("Informe o nome e o WhatsApp com DDD.");
      return;
    }
    setSaving(true);
    setError("");
    const res = await fetch("/api/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), phone: digits, origin: "WHATSAPP" }),
    });
    setSaving(false);
    if (!res.ok) {
      setError("Não foi possível cadastrar o lead. Tente de novo.");
      return;
    }
    const customer = await res.json();
    const link = linkFor(customer.linkCode ?? customer.id);
    await navigator.clipboard.writeText(link).catch(() => {});
    setResult({ link, phone: digits });
    router.refresh();
  }

  function reset() {
    setOpen(false);
    setResult(null);
    setName("");
    setPhone("");
    setError("");
  }

  const waHref = result
    ? `https://wa.me/${result.phone.length <= 11 ? "55" + result.phone : result.phone}?text=${encodeURIComponent(
        `Oi${name ? " " + name.split(" ")[0] : ""}! Aqui está o nosso catálogo 😍 ${result.link}`
      )}`
    : "#";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-xl border border-brand-200 bg-brand-50 hover:bg-brand-100 text-brand-700 text-sm font-medium px-3.5 py-2.5 transition"
        title="Cadastra o lead e gera o link rastreado do catálogo em um passo"
      >
        <Link2 className="size-4" />
        <span className="hidden sm:inline">Lead + link do catálogo</span>
        <span className="sm:hidden">Lead + link</span>
      </button>

      {open && (
        <div ref={wrapRef} className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
          <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={reset} />
          <div ref={panelRef} className="relative bg-white rounded-t-2xl md:rounded-2xl shadow-pop w-full md:max-w-sm p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] max-h-[90dvh] overflow-y-auto animate-fade-up">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-semibold text-lg">
                {result ? "Link pronto! 🎉" : "Novo lead + link"}
              </h3>
              <button onClick={reset} className="text-gray-400 p-1">
                <X className="size-5" />
              </button>
            </div>

            {!result ? (
              <form onSubmit={submit} className="space-y-3 mt-3">
                <p className="text-xs text-gray-400 -mt-2">
                  Pediram o catálogo? Cadastre em 10 segundos e mande o link
                  rastreado — tudo que a pessoa fizer aparece com o nome dela.
                </p>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Nome do lead *"
                  className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400"
                />
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="WhatsApp com DDD *"
                  inputMode="tel"
                  className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400"
                />
                {error && (
                  <p className="text-xs font-medium text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
                    {error}
                  </p>
                )}
                <button
                  disabled={saving}
                  className="w-full rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-medium py-2.5 text-sm transition disabled:opacity-60"
                >
                  {saving ? "Cadastrando..." : "Cadastrar e gerar link"}
                </button>
              </form>
            ) : (
              <div className="mt-3 space-y-3">
                <p className="text-xs text-gray-500">
                  Lead cadastrado e link <b>já copiado</b>. Se este WhatsApp já
                  existia na base, o cadastro foi reaproveitado (sem duplicar).
                </p>
                <div className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2.5 text-xs font-mono break-all text-gray-600">
                  {result.link}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={async () => {
                      await navigator.clipboard.writeText(result.link);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 hover:border-brand-300 text-gray-600 text-sm font-medium py-2.5 transition"
                  >
                    {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
                    {copied ? "Copiado!" : "Copiar link"}
                  </button>
                  <a
                    href={waHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium py-2.5 transition"
                  >
                    <MessageCircle className="size-4" />
                    Enviar no WhatsApp
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
