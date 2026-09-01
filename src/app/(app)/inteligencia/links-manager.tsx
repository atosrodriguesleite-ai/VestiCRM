"use client";

/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import Link from "next/link";
import { Portal } from "@/components/portal";
import { useRouter } from "next/navigation";
import { Check, Copy, Pencil, Plus, QrCode, Store, Trash2, X } from "lucide-react";
import { brl, numeroBR } from "@/lib/format";
import { TETO_DE_DESCONTO } from "@/lib/catalogo/condicoes-da-campanha";
import { Card, Badge, EmptyState } from "@/components/ui";

type Campaign = {
  id: string;
  name: string;
  slug: string;
  channel: string;
  clicks: number;
  orders: number;
  revenue: number;
  active: boolean;
  // CONDIÇÕES DO LINK (RN-040): editáveis a qualquer hora; o endereço não
  discount: number;
  minOrderMode: string | null;
  minOrderPieces: number;
  minOrderValue: number;
  goal: number;
  ownerId: string | null;
};

/** Como o mínimo próprio do link aparece na lista, em duas palavras. */
function seloDoMinimo(c: {
  minOrderMode: string | null;
  minOrderPieces: number;
  minOrderValue: number;
}) {
  if (c.minOrderMode === "PECAS")
    return c.minOrderPieces > 0 ? `mín. ${c.minOrderPieces} pç` : "sem mínimo";
  if (c.minOrderMode === "VALOR")
    return c.minOrderValue > 0 ? `mín. ${brl(c.minOrderValue)}` : "sem mínimo";
  return "sem mínimo";
}

const CHANNELS = [
  ["campanha", "Campanha"], ["instagram", "Instagram"], ["facebook", "Facebook"],
  ["google", "Google"], ["google-meu-negocio", "Google Meu Negócio"],
  ["whatsapp", "WhatsApp"], ["qr", "QR Code"], ["loja-fisica", "Loja Física"],
  ["marketplace", "Marketplace"], ["tiktok", "TikTok"],
];

// QR Codes prontos para a loja física
const STORE_QRS = [
  { slug: "qr-vitrine", name: "QR da Vitrine" },
  { slug: "qr-balcao", name: "QR do Balcão" },
  { slug: "qr-provador", name: "QR do Provador" },
  { slug: "qr-caixa", name: "QR do Caixa" },
];

function baseUrl() {
  return typeof window !== "undefined" ? window.location.origin : "";
}

export function LinksManager({
  slug,
  catalogDomain,
  team,
  campaigns,
  periodo,
}: {
  slug: string;
  catalogDomain: string | null;
  team: { id: string; name: string }[];
  campaigns: Campaign[];
  /** o período que os números do cartão estão contando (viaja no link) */
  periodo?: { de: string; ate: string };
}) {
  const router = useRouter();
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [recado, setRecado] = useState("");
  const [qrFor, setQrFor] = useState<{ url: string; label: string } | null>(null);
  const [copied, setCopied] = useState("");

  // Link minimalista quando há domínio de catálogos configurado:
  //   catalago.net/toque-leve/nivia
  // Sem o domínio (ex.: dev/preview), usa o link curto /c/ compatível.
  const linkFor = (ref: string) =>
    catalogDomain
      ? `https://${catalogDomain}/${slug}/${ref}`
      : `${baseUrl()}/c/${slug}?ref=${ref}`;
  const shortLabelFor = (ref: string) =>
    catalogDomain ? `${catalogDomain}/${slug}/${ref}` : `/c/${slug}?ref=${ref}`;
  const copy = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopied(url);
    setTimeout(() => setCopied(""), 1500);
  };

  return (
    <>
      {/* Links por vendedor */}
      <Card className="p-5 mb-4">
        <h3 className="font-semibold text-sm mb-1">Links dos vendedores</h3>
        <p className="text-xs text-gray-500 mb-4">
          Cada vendedor tem seu link. Os acessos e vendas caem no ranking dele
          automaticamente.
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {team.map((u) => {
            const ref = u.name
              .toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .split(/\s+/)[0];
            const url = linkFor(ref);
            return (
              <div
                key={u.id}
                className="flex items-center gap-2 rounded-xl border border-gray-100 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{u.name.split(" ")[0]}</p>
                  <p className="text-[10px] text-gray-400 font-mono truncate">{shortLabelFor(ref)}</p>
                </div>
                <button
                  onClick={() => copy(url)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition"
                  title="Copiar link"
                >
                  {copied === url ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
                </button>
                <button
                  onClick={() => setQrFor({ url, label: `Link ${u.name.split(" ")[0]}` })}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition"
                  title="QR Code"
                >
                  <QrCode className="size-4" />
                </button>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Loja física */}
      <Card className="p-5 mb-4">
        <h3 className="font-semibold text-sm mb-1 flex items-center gap-2">
          <Store className="size-4 text-brand-600" />
          QR Codes da loja física
        </h3>
        <p className="text-xs text-gray-500 mb-4">
          Imprima e cole na vitrine, balcão, provador e caixa. Depois descubra
          qual ponto converte mais.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {STORE_QRS.map((q) => (
            <button
              key={q.slug}
              onClick={() => setQrFor({ url: linkFor(q.slug), label: q.name })}
              className="flex flex-col items-center gap-1.5 rounded-xl border border-gray-100 hover:border-brand-300 hover:bg-brand-50 py-3 transition"
            >
              <QrCode className="size-6 text-brand-600" />
              <span className="text-xs font-medium">{q.name}</span>
            </button>
          ))}
        </div>
      </Card>

      {/* Campanhas */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-sm">Campanhas</h3>
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium px-3 py-2 transition"
          >
            <Plus className="size-3.5" />
            Nova campanha
          </button>
        </div>
        {recado && (
          <p className="mb-3 rounded-xl bg-emerald-50 border border-emerald-100 px-3 py-2 text-xs text-emerald-800 leading-snug">
            {recado}
          </p>
        )}
        {campaigns.length === 0 ? (
          <EmptyState title="Nenhuma campanha ainda" hint="Crie uma campanha para gerar link, UTM e QR Code." />
        ) : (
          <div className="space-y-2">
            {campaigns.map((c) => {
              const url = linkFor(c.slug);
              return (
                <div key={c.id} className="flex items-center gap-3 rounded-xl border border-gray-100 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate flex items-center gap-2">
                      {c.name}
                      {!c.active && <Badge color="#94a3b8">pausada</Badge>}
                      {c.discount > 0 && <Badge color="#059669">{c.discount}% OFF</Badge>}
                      {/* TODO mínimo próprio ganha selo: sem o de R$ (e sem o
                          de "0 peças"), link com trava ficava igualzinho a
                          link sem condição, e só abrindo dava para saber */}
                      {c.minOrderMode !== null && (
                        <Badge color="#7c3aed">{seloDoMinimo(c)}</Badge>
                      )}
                    </p>
                    <p className="text-[10px] text-gray-400 font-mono truncate">{shortLabelFor(c.slug)}</p>
                  </div>
                  {/* OS NÚMEROS APARECEM NO CELULAR (relato do dono,
                      01/09/2026): estavam escondidos em tela pequena, e a
                      pergunta "como eu rastreio os pedidos vindos daqui?"
                      tinha a resposta invisível justamente onde ela é lida */}
                  {/* O NÚMERO PRECISA LEVAR AO PEDIDO (relato do dono,
                      01/09/2026: "diz que tive um pedido vindo da campanha,
                      não localizei esse pedido"). Contar sem dar o caminho é
                      deixar a lojista procurando à mão. */}
                  <Link
                    href={`/pedidos?campanha=${encodeURIComponent(c.slug)}${
                      periodo ? `&de=${periodo.de}&ate=${periodo.ate}` : ""
                    }`}
                    className="text-right shrink-0 rounded-lg px-1.5 py-1 -mr-1 hover:bg-brand-50 transition"
                    title={`Ver os pedidos da campanha ${c.name}`}
                  >
                    <p className="text-[11px] sm:text-xs font-semibold tabular-nums whitespace-nowrap">
                      {c.clicks} cliques ·{" "}
                      <span className="text-brand-700 underline decoration-brand-300 underline-offset-2">
                        {c.orders} pedidos
                      </span>
                    </p>
                    {/* R$ 0 com pedido na conta não é venda perdida: é venda
                        ainda NÃO PAGA (o faturamento soma só pedido pago,
                        RN-001). Sem dizer isso, o cartão parece defeito. */}
                    <p className="text-[11px] text-emerald-600 tabular-nums">
                      {c.orders > 0 && c.revenue === 0 ? (
                        <span className="text-amber-600">aguardando pagamento</span>
                      ) : (
                        brl(c.revenue)
                      )}
                    </p>
                  </Link>
                  <button
                    onClick={() => {
                      // recado da ação ANTERIOR não pode sobreviver à
                      // próxima: "campanha encerrada, 12 cliques" ficava na
                      // tela enquanto a lojista editava OUTRA campanha
                      setRecado("");
                      setEditing(c);
                    }}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-brand-600 hover:bg-brand-50"
                    title="Editar condições"
                  >
                    <Pencil className="size-4" />
                  </button>
                  <button onClick={() => copy(url)} className="p-1.5 rounded-lg text-gray-400 hover:text-brand-600 hover:bg-brand-50" title="Copiar">
                    {copied === url ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
                  </button>
                  <button onClick={() => setQrFor({ url, label: c.name })} className="p-1.5 rounded-lg text-gray-400 hover:text-brand-600 hover:bg-brand-50" title="QR Code">
                    <QrCode className="size-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Modal QR */}
      {qrFor && (
        <Portal><div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={() => setQrFor(null)} />
          <div className="relative bg-white rounded-2xl shadow-pop p-6 w-full max-w-xs text-center animate-fade-up">
            <button onClick={() => setQrFor(null)} className="absolute top-3 right-3 text-gray-400 p-1">
              <X className="size-5" />
            </button>
            <p className="font-semibold mb-3">{qrFor.label}</p>
            <img
              src={`/api/qrcode?url=${encodeURIComponent(qrFor.url)}`}
              alt="QR Code"
              className="w-full rounded-xl border border-gray-100"
            />
            <p className="text-[10px] text-gray-400 font-mono mt-3 break-all">{qrFor.url}</p>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => copy(qrFor.url)}
                className="flex-1 rounded-xl border border-gray-200 text-gray-600 text-xs font-medium py-2 hover:border-brand-300 transition"
              >
                {copied === qrFor.url ? "Copiado!" : "Copiar link"}
              </button>
              <a
                href={`/api/qrcode?url=${encodeURIComponent(qrFor.url)}`}
                download={`qr-${qrFor.label}.svg`}
                className="flex-1 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium py-2 transition"
              >
                Baixar QR
              </a>
            </div>
          </div>
        </div></Portal>
      )}

      {editing && (
        <EditCampaignModal
          campaign={editing}
          team={team}
          linkLabel={shortLabelFor(editing.slug)}
          onClose={() => setEditing(null)}
          onSaved={(mensagem) => {
            setEditing(null);
            // quem sabe o que aconteceu é o SERVIDOR (apagou de vez ou
            // encerrou guardando os números) — a tela repete o que ele disse,
            // e limpa quando a ação não tem recado (salvar comum)
            setRecado(mensagem ?? "");
            router.refresh();
          }}
        />
      )}

      {showNew && (
        <NewCampaignModal
          team={team}
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function NewCampaignModal({
  team,
  onClose,
  onCreated,
}: {
  team: { id: string; name: string }[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [channel, setChannel] = useState("campanha");
  const [ownerId, setOwnerId] = useState("");
  const [goal, setGoal] = useState("");
  const [cond, setCond] = useState<Cond>(CONDICOES_PADRAO);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const autoSlug = (v: string) =>
    v.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  async function submit() {
    setSaving(true);
    setError("");
    const res = await fetch("/api/track-campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        slug: slug || autoSlug(name),
        channel,
        ownerId: ownerId || null,
        goal: numeroBR(goal),
        ...condicoesParaApi(cond),
      }),
    });
    setSaving(false);
    if (res.ok) onCreated();
    else {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Erro ao criar");
    }
  }

  const input = "w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400 transition";
  const label = "block text-sm font-medium mb-1.5";

  return (
    <Portal><div className="fixed inset-0 z-50 flex items-end md:items-center justify-center pb-[var(--kb,0px)]">
      <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl md:rounded-2xl shadow-pop w-full md:max-w-md p-6 animate-fade-up">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-lg">Nova campanha</h3>
          <button onClick={onClose} className="text-gray-400 p-1"><X className="size-5" /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className={label}>Nome</label>
            <input
              value={name}
              onChange={(e) => { setName(e.target.value); setSlug(autoSlug(e.target.value)); }}
              className={input}
              placeholder="Ex.: Campanha Verão"
            />
          </div>
          <div>
            <label className={label}>Ref (aparece no link)</label>
            <input value={slug} onChange={(e) => setSlug(autoSlug(e.target.value))} className={`${input} font-mono`} placeholder="campanha-verao" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Canal</label>
              <select value={channel} onChange={(e) => setChannel(e.target.value)} className={`${input} bg-white`}>
                {CHANNELS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>Responsável</label>
              <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className={`${input} bg-white`}>
                <option value="">Loja</option>
                {team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={label}>Meta de faturamento (R$)</label>
            <input value={goal} onChange={(e) => setGoal(e.target.value)} className={input} placeholder="0,00" inputMode="decimal" />
          </div>
          <CondicoesFields cond={cond} onChange={setCond} />
          {error && <p className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{error}</p>}
          <button
            onClick={submit}
            disabled={saving || !name}
            className="w-full rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-medium py-2.5 text-sm transition disabled:opacity-60"
          >
            {saving ? "Criando..." : "Criar campanha + QR Code"}
          </button>
        </div>
      </div>
    </div></Portal>
  );
}

// ---- Condições do link (RN-040) --------------------------------------------

/**
 * O QUE A LOJA EDITA DEPOIS DE JÁ TER DIVULGADO O LINK.
 *
 * O endereço (`ref`) não está aqui de propósito: ele já foi mandado no grupo,
 * impresso no QR e colado no story (pedido do dono, 01/09/2026). Mudar o
 * endereço quebraria tudo isso sem avisar ninguém.
 */
type Cond = {
  discount: string;
  minMode: "" | "NONE" | "PECAS" | "VALOR";
  minPieces: string;
  minValue: string;
};

const CONDICOES_PADRAO: Cond = { discount: "", minMode: "", minPieces: "", minValue: "" };

/** O que vai para a API — o que a tela mostra vazio vira "herda da loja". */
function condicoesParaApi(c: Cond) {
  return {
    discount: Math.max(0, Math.min(TETO_DE_DESCONTO, Math.round(numeroBR(c.discount)))),
    minOrderMode: c.minMode === "" ? null : c.minMode,
    minOrderPieces: Math.max(0, Math.round(numeroBR(c.minPieces))),
    minOrderValue: Math.max(0, numeroBR(c.minValue)),
  };
}

function condicoesDaCampanha(c: Campaign): Cond {
  return {
    discount: c.discount > 0 ? String(c.discount) : "",
    minMode: (c.minOrderMode as Cond["minMode"]) ?? "",
    minPieces: c.minOrderPieces > 0 ? String(c.minOrderPieces) : "",
    minValue: c.minOrderValue > 0 ? String(c.minOrderValue).replace(".", ",") : "",
  };
}

function CondicoesFields({ cond, onChange }: { cond: Cond; onChange: (c: Cond) => void }) {
  const input =
    "w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400 transition";
  const label = "block text-sm font-medium mb-1.5";
  const set = (p: Partial<Cond>) => onChange({ ...cond, ...p });
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3 space-y-3">
      <p className="text-xs font-semibold text-gray-700">
        Condições deste link{" "}
        <span className="font-normal text-gray-500">— dá para mudar depois</span>
      </p>
      <div>
        <label className={label}>Desconto (%)</label>
        <input
          value={cond.discount}
          onChange={(e) => set({ discount: e.target.value.replace(/\D/g, "").slice(0, 3) })}
          className={input}
          placeholder="0 = sem desconto"
          inputMode="numeric"
        />
        <p className="text-[11px] text-gray-500 mt-1 leading-snug">
          Quem entrar por este link vê todos os preços já com o desconto.
        </p>
        {/* CORTAR CALADO É PIOR: quem digitava 100 salvava 90 e o link
            passava a cobrar 10% do catálogo, com a tela dizendo que deu certo
            (achado da revisão de 01/09/2026) */}
        {numeroBR(cond.discount) > TETO_DE_DESCONTO && (
          <p className="text-[11px] font-semibold text-amber-700 mt-1 leading-snug">
            O desconto máximo é {TETO_DE_DESCONTO}% — vai ser salvo como{" "}
            {TETO_DE_DESCONTO}%. Para dar a peça, use brinde no pedido.
          </p>
        )}
      </div>
      <div>
        <label className={label}>Pedido mínimo</label>
        <select
          value={cond.minMode}
          onChange={(e) => set({ minMode: e.target.value as Cond["minMode"] })}
          className={`${input} bg-white`}
        >
          <option value="">Usar o mínimo da loja</option>
          <option value="NONE">Sem mínimo neste link</option>
          <option value="PECAS">Mínimo de peças</option>
          <option value="VALOR">Mínimo em R$</option>
        </select>
      </div>
      {cond.minMode === "PECAS" && (
        <input
          value={cond.minPieces}
          onChange={(e) => set({ minPieces: e.target.value.replace(/\D/g, "") })}
          className={input}
          placeholder="Quantas peças, no mínimo"
          inputMode="numeric"
        />
      )}
      {cond.minMode === "VALOR" && (
        <input
          value={cond.minValue}
          onChange={(e) => set({ minValue: e.target.value })}
          className={input}
          placeholder="Valor mínimo (R$)"
          inputMode="decimal"
        />
      )}
    </div>
  );
}

function EditCampaignModal({
  campaign,
  team,
  linkLabel,
  onClose,
  onSaved,
}: {
  campaign: Campaign;
  team: { id: string; name: string }[];
  linkLabel: string;
  onClose: () => void;
  onSaved: (mensagem?: string) => void;
}) {
  const [name, setName] = useState(campaign.name);
  const [channel, setChannel] = useState(campaign.channel);
  const [ownerId, setOwnerId] = useState(campaign.ownerId ?? "");
  const [goal, setGoal] = useState(campaign.goal > 0 ? String(campaign.goal).replace(".", ",") : "");
  const [active, setActive] = useState(campaign.active);
  const [cond, setCond] = useState<Cond>(condicoesDaCampanha(campaign));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function salvar() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/track-campaigns/${campaign.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          channel,
          ownerId: ownerId || null,
          goal: numeroBR(goal),
          active,
          ...condicoesParaApi(cond),
        }),
      });
      if (res.ok) onSaved();
      else {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "Não deu para salvar. Tente de novo.");
      }
    } catch {
      // sinal caiu no meio: sem isto o botão ficava preso em "Salvando…"
      setError("A conexão caiu no meio. Nada foi salvo — tente de novo.");
    } finally {
      setSaving(false);
    }
  }

  async function excluir() {
    // A TELA NÃO PROMETE O QUE NÃO SABE: os números aqui são do PERÍODO
    // filtrado, e o servidor conta a história inteira — campanha antiga
    // aparece 0×0 e a promessa de "some de vez" sairia furada (achado da
    // revisão de 01/09/2026). Quem decide é o servidor; a tela conta depois.
    if (
      !window.confirm(
        `Tirar a campanha "${campaign.name}" da lista?\n\n` +
          "O link para de aplicar as condições e volta a abrir o catálogo " +
          "normal da loja, e o pedido que vier por ele nasce SEM VENDEDORA " +
          "(fica da loja). Se ela já tiver trazido clientes, os números dela " +
          "continuam no relatório de campanhas."
      )
    )
      return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/track-campaigns/${campaign.id}`, { method: "DELETE" });
      const d = await res.json().catch(() => null);
      if (res.ok) onSaved(d?.mensagem);
      else setError(d?.error ?? "Não deu para excluir. Tente de novo.");
    } catch {
      setError("A conexão caiu no meio. Nada foi excluído — tente de novo.");
    } finally {
      setSaving(false);
    }
  }

  const input =
    "w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400 transition";
  const label = "block text-sm font-medium mb-1.5";

  return (
    <Portal><div className="fixed inset-0 z-50 flex items-end md:items-center justify-center pb-[var(--kb,0px)]">
      <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl md:rounded-2xl shadow-pop w-full md:max-w-md p-6 animate-fade-up max-h-[92vh] overflow-y-auto thin-scroll">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-lg">Editar campanha</h3>
          <button onClick={onClose} className="text-gray-400 p-1"><X className="size-5" /></button>
        </div>

        {/* O ENDEREÇO NÃO SE EDITA — e a tela precisa DIZER isso, senão a
            ausência do campo parece defeito */}
        <div className="rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2.5 mb-4">
          <p className="text-[11px] text-gray-500 mb-0.5">Link (não muda nunca)</p>
          <p className="text-xs font-mono text-gray-700 break-all">{linkLabel}</p>
          <p className="text-[11px] text-gray-500 mt-1 leading-snug">
            Você já divulgou este endereço — ele fica congelado. As condições
            abaixo você muda quando quiser, e valem na próxima visita.
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className={label}>Nome</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className={input} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Canal</label>
              <select value={channel} onChange={(e) => setChannel(e.target.value)} className={`${input} bg-white`}>
                {CHANNELS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>Responsável</label>
              <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className={`${input} bg-white`}>
                <option value="">Loja</option>
                {team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={label}>Meta de faturamento (R$)</label>
            <input value={goal} onChange={(e) => setGoal(e.target.value)} className={input} inputMode="decimal" placeholder="0,00" />
          </div>

          <CondicoesFields cond={cond} onChange={setCond} />

          <label className="flex items-start gap-2.5 rounded-xl border border-gray-100 p-3 cursor-pointer">
            <input
              type="checkbox"
              checked={!active}
              onChange={(e) => setActive(!e.target.checked)}
              className="mt-0.5 size-4 accent-brand-600"
            />
            <span className="text-sm">
              Pausar campanha
              <span className="block text-[11px] text-gray-500 leading-snug">
                O link continua abrindo o catálogo, com o preço e o mínimo
                normais da loja. Enquanto estiver pausada, as visitas
                <b> deixam de contar</b> para esta campanha no relatório — e o
                pedido que vier por ele nasce <b>sem vendedora</b> (fica da
                loja), em vez de ir para a responsável.
              </span>
            </span>
          </label>

          {error && <p className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{error}</p>}

          <button
            onClick={salvar}
            disabled={saving || !name.trim()}
            className="w-full rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-medium py-2.5 text-sm transition disabled:opacity-60"
          >
            {saving ? "Salvando..." : "Salvar condições"}
          </button>
          <button
            onClick={excluir}
            disabled={saving}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 font-medium py-2.5 text-sm transition disabled:opacity-60"
          >
            <Trash2 className="size-4" />
            Excluir campanha
          </button>
        </div>
      </div>
    </div></Portal>
  );
}
