"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Megaphone, Loader2, Check } from "lucide-react";
import { rotuloDoAnuncio } from "@/lib/ad-match";

/**
 * DE QUAL ANÚNCIO ESSA CLIENTE VEIO — e a que campanha isso pertence.
 *
 * A vendedora vê no chat "Cliente veio de um ANÚNCIO". Este bloco fecha o
 * ciclo ali mesmo: mostra qual anúncio foi e, se ele ainda não tem campanha,
 * deixa vincular sem sair do atendimento. Quem faz esse gesto uma vez resolve
 * TODAS as clientes que chegaram por aquele anúncio (o vínculo é retroativo)
 * — daí em diante o faturamento delas soma na campanha certa.
 */
export function OrigemAnuncio({
  adRef,
  campanhaAtual,
  campanhas,
  podeVincular,
}: {
  adRef: string;
  campanhaAtual: { id: string; name: string } | null;
  campanhas: { id: string; name: string }[];
  podeVincular: boolean;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [escolha, setEscolha] = useState("");
  const [nova, setNova] = useState("");
  const [busy, setBusy] = useState(false);
  const [feito, setFeito] = useState<string | null>(null);
  const [erro, setErro] = useState("");

  async function vincular() {
    if (!escolha && !nova.trim()) return;
    setBusy(true);
    setErro("");
    const res = await fetch("/api/marketing/anuncios/vincular", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        adRef,
        ...(escolha === "__nova" || !escolha
          ? { novaCampanha: nova.trim() }
          : { campaignId: escolha }),
      }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setErro(d.error ?? "Não consegui vincular agora.");
      return;
    }
    setFeito(
      `Vinculado a “${d.campanha?.name}” — ${d.clientesVinculadas} cliente(s) desse anúncio entraram na campanha.`
    );
    setAberto(false);
    router.refresh();
  }

  return (
    <div className="mt-2 rounded-xl border border-violet-100 bg-violet-50/60 px-2.5 py-2">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold text-violet-800">
        <Megaphone className="size-3.5 shrink-0" />
        Veio de anúncio
      </p>
      <p className="mt-0.5 break-all text-[11px] text-violet-700">
        {rotuloDoAnuncio(adRef)}
      </p>

      {campanhaAtual ? (
        <p className="mt-1 text-[11px] text-violet-700">
          Campanha: <b>{campanhaAtual.name}</b>
        </p>
      ) : feito ? (
        <p className="mt-1 flex items-start gap-1 text-[11px] font-medium text-emerald-700">
          <Check className="mt-0.5 size-3 shrink-0" />
          {feito}
        </p>
      ) : podeVincular ? (
        aberto ? (
          <div className="mt-1.5 space-y-1.5">
            <select
              value={escolha}
              onChange={(e) => setEscolha(e.target.value)}
              className="w-full rounded-lg border border-violet-200 bg-white px-2 py-1.5 text-[11px] outline-none"
            >
              <option value="">Escolha a campanha…</option>
              {campanhas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value="__nova">+ Criar campanha nova</option>
            </select>
            {(escolha === "__nova" || (!escolha && campanhas.length === 0)) && (
              <input
                value={nova}
                onChange={(e) => setNova(e.target.value)}
                placeholder="Nome da campanha (ex.: Promoção de Julho)"
                className="w-full rounded-lg border border-violet-200 bg-white px-2 py-1.5 text-[11px] outline-none"
              />
            )}
            <div className="flex items-center gap-1.5">
              <button
                onClick={vincular}
                disabled={busy || (!escolha && !nova.trim()) || (escolha === "__nova" && !nova.trim())}
                className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-2.5 py-1.5 text-[11px] font-bold text-white transition hover:bg-violet-700 disabled:opacity-50"
              >
                {busy && <Loader2 className="size-3 animate-spin" />}
                Vincular
              </button>
              <button
                onClick={() => setAberto(false)}
                className="rounded-lg px-2 py-1.5 text-[11px] font-medium text-violet-700 hover:bg-violet-100"
              >
                Cancelar
              </button>
            </div>
            <p className="text-[10px] text-violet-600">
              Todas as clientes que chegaram por este anúncio e ainda estão sem
              campanha entram junto.
            </p>
            {erro && <p className="text-[11px] text-rose-600">{erro}</p>}
          </div>
        ) : (
          <button
            onClick={() => setAberto(true)}
            className="mt-1.5 rounded-lg border border-violet-300 bg-white px-2.5 py-1.5 text-[11px] font-bold text-violet-700 transition hover:bg-violet-100"
          >
            Vincular a uma campanha
          </button>
        )
      ) : (
        <p className="mt-1 text-[11px] text-violet-600">
          Sem campanha ainda — peça para a gerência vincular em Marketing.
        </p>
      )}
    </div>
  );
}
