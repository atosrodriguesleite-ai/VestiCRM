"use client";

/* eslint-disable @next/next/no-img-element */

/**
 * Editor do Gestor de Bio: publica a página, ajusta a aparência (foto/título/
 * subtítulo), cria/edita/reordena os botões e mostra uma prévia ao vivo do
 * celular — tudo com a identidade visual do catálogo da loja.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Check,
  Copy,
  ExternalLink,
  Eye,
  GripVertical,
  Globe,
  Link2,
  MessageCircle,
  Pencil,
  Plus,
  ShoppingBag,
  Trash2,
  Upload,
  X,
  QrCode,
  BarChart3,
  Star,
  Info,
  ShoppingCart,
  Loader2,
} from "lucide-react";
import { Card } from "@/components/ui";
import { brl } from "@/lib/format";
import { Portal } from "@/components/portal";
import { InstagramIcon, TiktokIcon, YoutubeIcon, FacebookIcon } from "@/components/social-icons";
import { fileToDataUrl } from "@/lib/upload";
import { mixHex, readableOn } from "@/lib/color";
import {
  BIO_LINK_KINDS,
  BIO_THEMES,
  BIO_BUTTON_ICONS,
  BIO_FONTS,
  BIO_SHAPES,
  bioColors,
  type BioLinkKind,
} from "@/lib/bio";

const FONT_LABEL: Record<string, string> = {
  montserrat: "Montserrat",
  inter: "Inter",
  poppins: "Poppins",
  playfair: "Playfair",
  lora: "Lora",
};
const SHAPE_LABEL: Record<string, string> = {
  rounded: "Arredondado",
  pill: "Pílula",
  square: "Reto",
};
const shapeClass: Record<string, string> = {
  rounded: "rounded-2xl",
  pill: "rounded-full",
  square: "rounded-lg",
};

type Link = {
  id: string;
  title: string;
  subtitle: string | null;
  type: BioLinkKind;
  url: string | null;
  imageUrl: string | null;
  layout: string;
  featured: boolean;
  active: boolean;
  clicks: number;
};
type PageState = {
  slug: string;
  published: boolean;
  headline: string | null;
  tagline: string | null;
  avatarUrl: string | null;
  coverUrl: string | null;
  hideCover: boolean;
  bgColor: string | null;
  buttonColor: string | null;
  buttonTextColor: string | null;
  font: string | null;
  buttonShape: string;
  instagram: string | null;
  tiktok: string | null;
  youtube: string | null;
  facebook: string | null;
  metaPixelId: string | null;
  gaId: string | null;
  views: number;
};
type Identity = {
  name: string;
  tagline: string | null;
  logoUrl: string | null;
  whatsapp: string | null;
  primary: string;
  secondary: string;
  bg: string;
  font: string;
};

const TYPE_ICON = { CATALOGO: ShoppingBag, WHATSAPP: MessageCircle, SITE: Globe, EXTERNO: Link2 } as const;

type Journey = {
  catalogVisits: number; // sessões no catálogo vindas da bio (utm_source=bio)
  bags: number; // dessas sessões, quantas montaram sacola (cartValue > 0)
  bagsValue: number; // soma do valor das sacolas montadas vindas da bio
};

/** Cartão de métrica com um "ⓘ" que explica o que o número significa e como
 *  é somado — some/aparece ao tocar. Toda métrica do relatório usa este. */
function StatCard({
  value,
  label,
  hint,
  accent,
  icon,
}: {
  value: string | number;
  label: string;
  hint: string;
  accent?: boolean;
  icon?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`relative rounded-xl p-3 ${accent ? "bg-brand-50" : "bg-slate-50"}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="absolute right-1.5 top-1.5 text-slate-300 transition hover:text-slate-500"
        aria-label={`O que é ${label}?`}
        title="O que significa?"
      >
        <Info className="size-3.5" />
      </button>
      <div className="text-center">
        {icon && <div className="mb-1 flex justify-center text-slate-400">{icon}</div>}
        <p className={`text-lg font-bold ${accent ? "text-brand-700" : "text-slate-800"}`}>{value}</p>
        <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
      </div>
      {open && (
        <p className="mt-2 rounded-lg bg-white/90 p-2 text-left text-[10px] leading-snug text-slate-500 shadow-sm ring-1 ring-slate-100">
          {hint}
        </p>
      )}
    </div>
  );
}

export function BioEditor({
  initial,
  publicBase,
}: {
  initial: { page: PageState; links: Link[]; identity: Identity; journey: Journey };
  publicBase: string;
}) {
  const { identity, journey } = initial;
  const [page, setPage] = useState<PageState>(initial.page);
  const [links, setLinks] = useState<Link[]>(initial.links);
  const [editing, setEditing] = useState<Link | "new" | null>(null);
  const [copied, setCopied] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [showInsights, setShowInsights] = useState(false);

  const publicUrl = `${publicBase}/${page.slug}`;

  // insights: cliques totais, cliques por visita e ranking de botões.
  // NÃO é "taxa de clique" (%): a mesma pessoa clica em vários botões
  // (catálogo + site + WhatsApp), então cliques > visitas é normal — e o
  // antigo "103%" confundia (relato de 06/08/2026). A conta honesta com os
  // dados que temos é a MÉDIA de cliques por visita.
  const totalClicks = links.reduce((s, l) => s + l.clicks, 0);
  const ctr = page.views > 0 ? totalClicks / page.views : 0;
  const topLinks = [...links].filter((l) => l.clicks > 0).sort((a, b) => b.clicks - a.clicks).slice(0, 4);

  // Relatório por período. "Tudo" (period=0) usa os totais acumulados já
  // carregados; períodos (1/7/30 dias) buscam os eventos com data na API.
  const allData = useMemo(
    () => ({
      visitas: page.views,
      cliques: totalClicks,
      ctr,
      topLinks: topLinks.map((l) => ({ id: l.id, title: l.title, clicks: l.clicks })),
      journey,
    }),
    [page.views, totalClicks, ctr, topLinks, journey]
  );
  const [period, setPeriod] = useState(0); // 0=tudo · 1=hoje · 7 · 30
  const [report, setReport] = useState(allData);
  const [loadingReport, setLoadingReport] = useState(false);

  useEffect(() => {
    // "Tudo" (period=0) TAMBÉM busca na rota: o atalho local somava só os
    // contadores dos botões vivos — apagar um botão fazia o "Tudo" ficar
    // MENOR que o "30 dias" (a rota já soma os cliques do botão apagado);
    // o allData fica de valor inicial enquanto a resposta não chega
    let alive = true;
    setLoadingReport(true);
    fetch(`/api/marketing/bio/report?days=${period}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d) setReport(d);
      })
      .finally(() => {
        if (alive) setLoadingReport(false);
      });
    return () => {
      alive = false;
    };
  }, [period, allData]);

  const PERIODS: { v: number; label: string }[] = [
    { v: 0, label: "Tudo" },
    { v: 1, label: "Hoje" },
    { v: 7, label: "7 dias" },
    { v: 30, label: "30 dias" },
  ];

  async function patchPage(
    data: Partial<
      Pick<
        PageState,
        | "published"
        | "headline"
        | "tagline"
        | "avatarUrl"
        | "coverUrl"
        | "hideCover"
        | "bgColor"
        | "buttonColor"
        | "buttonTextColor"
        | "font"
        | "buttonShape"
        | "instagram"
        | "tiktok"
        | "youtube"
        | "facebook"
        | "metaPixelId"
        | "gaId"
      >
    >
  ) {
    setPage((p) => ({ ...p, ...data }));
    await fetch("/api/marketing/bio", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  }

  async function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= links.length) return;
    const next = [...links];
    [next[i], next[j]] = [next[j], next[i]];
    setLinks(next);
    // persiste a nova posição dos dois botões afetados
    await Promise.all(
      next.map((l, idx) =>
        fetch(`/api/marketing/bio/links/${l.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order: idx }),
        })
      )
    );
  }

  // arrastar e soltar: reordena e persiste a nova posição de todos os botões
  async function reorder(from: number, to: number) {
    if (from === to || to < 0 || to >= links.length) return;
    const next = [...links];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setLinks(next);
    await Promise.all(
      next.map((l, idx) =>
        fetch(`/api/marketing/bio/links/${l.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order: idx }),
        })
      )
    );
  }

  async function toggleActive(l: Link) {
    setLinks((prev) => prev.map((x) => (x.id === l.id ? { ...x, active: !x.active } : x)));
    await fetch(`/api/marketing/bio/links/${l.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !l.active }),
    });
  }

  async function remove(l: Link) {
    setLinks((prev) => prev.filter((x) => x.id !== l.id));
    await fetch(`/api/marketing/bio/links/${l.id}`, { method: "DELETE" });
  }

  function onSaved(saved: Link, isNew: boolean) {
    setLinks((prev) => (isNew ? [...prev, saved] : prev.map((x) => (x.id === saved.id ? saved : x))));
    setEditing(null);
  }

  const avatar = page.avatarUrl || identity.logoUrl;
  const headline = page.headline || identity.name;
  const tagline = page.tagline ?? identity.tagline;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <div className="space-y-5">
        {/* Publicação + link público */}
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold text-slate-800">Publicação</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {page.published
                  ? "Sua bio está no ar. Cole o link na bio do Instagram."
                  : "Sua bio está oculta. Publique para colocá-la no ar."}
              </p>
            </div>
            <button
              onClick={() => patchPage({ published: !page.published })}
              className={`relative h-7 w-12 shrink-0 rounded-full transition ${page.published ? "bg-emerald-500" : "bg-slate-300"}`}
              title={page.published ? "Publicada" : "Oculta"}
            >
              <span className={`absolute top-1 size-5 rounded-full bg-white shadow transition-all ${page.published ? "left-6" : "left-1"}`} />
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
              <span className="truncate text-sm text-slate-600">{publicUrl}</span>
            </div>
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(publicUrl).catch(() => {});
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm font-medium text-slate-600 transition hover:border-brand-300"
            >
              {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
              {copied ? "Copiado!" : "Copiar"}
            </button>
            {page.published ? (
              <a
                href={publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-3.5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
              >
                <ExternalLink className="size-4" />
                Abrir
              </a>
            ) : (
              // bio OCULTA não tem página pública (o link dá 404 de propósito
              // — rascunho é privado). Abrir sem publicar levava a uma página
              // preta sem explicação; agora o botão conta o que falta.
              <span
                title='Sua bio está oculta — ligue a chave "Publicar" acima para colocá-la no ar.'
                className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-xl bg-slate-300 px-3.5 py-2.5 text-sm font-semibold text-white"
              >
                <ExternalLink className="size-4" />
                Publique para abrir
              </span>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => setShowQr(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 transition hover:border-brand-300"
            >
              <QrCode className="size-4" /> QR Code
            </button>
            <button
              onClick={() => setShowInsights((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 transition hover:border-brand-300"
            >
              <BarChart3 className="size-4" /> {showInsights ? "Ocultar" : "Ver"} resultados
            </button>
            <span className="ml-auto flex items-center gap-1.5 text-[11px] text-slate-400">
              <Eye className="size-3.5" /> {page.views} {page.views === 1 ? "visita" : "visitas"}
            </span>
          </div>

          {showInsights && (
            <div className="mt-3 border-t border-slate-100 pt-3">
              {/* filtro de período */}
              <div className="mb-3 flex flex-wrap items-center gap-1.5">
                {PERIODS.map((p) => (
                  <button
                    key={p.v}
                    onClick={() => setPeriod(p.v)}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                      period === p.v
                        ? "border-brand-400 bg-brand-50 text-brand-700"
                        : "border-slate-200 text-slate-500 hover:border-slate-300"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
                {loadingReport && <Loader2 className="size-3.5 animate-spin text-slate-300" />}
                {period !== 0 && (
                  <span className="ml-auto text-[10px] text-slate-400">
                    período conta desde 23/07/2026
                  </span>
                )}
              </div>

              {/* Bloco 1 — a bio (a página de links) */}
              <p className="mb-1.5 text-[11px] font-semibold text-slate-500">📱 A sua bio</p>
              <div className="grid grid-cols-3 gap-2">
                <StatCard
                  value={report.visitas}
                  label="Visitas"
                  hint="Quantas vezes a sua bio foi aberta por pessoas reais. Robôs e as prévias de link (WhatsApp, Instagram) NÃO são contados. Cada abertura da página = 1 visita; navegar nos botões não conta de novo."
                />
                <StatCard
                  value={report.cliques}
                  label="Cliques"
                  hint="Soma dos cliques em TODOS os botões da bio (WhatsApp, catálogo, site, etc.). Cada toque num botão conta 1 clique."
                />
                <StatCard
                  value={report.ctr.toFixed(1).replace(".", ",")}
                  label="Cliques por visita"
                  hint="Média de cliques que cada visita dá na sua bio. Conta: cliques ÷ visitas. Pode passar de 1: a mesma pessoa clica em mais de um botão (catálogo + WhatsApp, por exemplo). Ex.: 10 visitas e 13 cliques = 1,3. Quanto maior, mais a sua bio converte atenção em ação."
                />
              </div>

              {/* Bloco 2 — a jornada: o que a bio levou pro catálogo */}
              <p className="mb-1.5 mt-4 text-[11px] font-semibold text-slate-500">🛒 O que a bio levou pro catálogo</p>
              <div className="grid grid-cols-3 gap-2">
                <StatCard
                  accent
                  icon={<ShoppingCart className="size-4" />}
                  value={report.journey.catalogVisits}
                  label="Foram ao catálogo"
                  hint="Quantas visitas no seu catálogo vieram do botão da bio (etiqueta utm_source=bio). Atenção na comparação com 'Visitas': a visita na bio é contada direto no servidor; a do catálogo só conta para quem ACEITOU o aviso de privacidade — bases diferentes, então a passagem bio → catálogo tende a parecer menor do que é."
                />
                <StatCard
                  accent
                  value={report.journey.bags}
                  label="Montaram sacola"
                  hint="Pessoas vindas da bio que montaram sacola no catálogo (mesmo sem finalizar). Cada pessoa conta UMA vez — quem visitou 3 vezes com a mesma sacola não conta 3."
                />
                <StatCard
                  accent
                  value={brl(report.journey.bagsValue)}
                  label="Valor em sacolas"
                  hint="Valor somado das sacolas de quem veio da bio — a sacola MAIS RECENTE de cada pessoa, uma vez só. É potencial de venda (ainda não é venda fechada)."
                />
              </div>

              {/* ranking de botões */}
              {report.topLinks.length > 0 && (
                <div className="mt-4">
                  <p className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold text-slate-500">
                    Botões que mais clicam
                    <span title="Ranking dos botões pelo total de cliques no período, do maior pro menor.">
                      <Info className="size-3 text-slate-300" />
                    </span>
                  </p>
                  <div className="space-y-1">
                    {report.topLinks.map((l) => (
                      <div key={l.id} className="flex items-center justify-between gap-2 text-xs">
                        <span className="min-w-0 truncate text-slate-600">{l.title}</span>
                        <span className="shrink-0 font-semibold text-slate-800">{l.clicks} clique{l.clicks === 1 ? "" : "s"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <p className="mt-4 rounded-lg bg-amber-50 p-2.5 text-[10px] leading-snug text-amber-800">
                💡 <b>WhatsApp</b>: o clique é contado acima; quando a pessoa envia, a mensagem já vem escrita &quot;Vim pela bio&quot;. <b>Site externo</b> (loja própria/Nuvemshop): a compra acontece fora do sistema, então não entra aqui — só o clique é contado.
              </p>
            </div>
          )}
        </Card>

        {/* Aparência */}
        <Appearance page={page} identity={identity} onSave={patchPage} />

        {/* Cores e estilo */}
        <ColorsStyle page={page} identity={identity} onSave={patchPage} />

        {/* Redes sociais */}
        <SocialLinks page={page} onSave={patchPage} />

        {/* Botões */}
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-slate-800">Botões</h2>
              <p className="text-xs text-slate-500 mt-0.5">Arraste os botões para ordenar (ou use as setas no celular). O de cima aparece primeiro.</p>
            </div>
            <button
              onClick={() => setEditing("new")}
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              <Plus className="size-4" /> Botão
            </button>
          </div>

          {links.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">
              Nenhum botão ainda. Adicione o primeiro — catálogo, WhatsApp, site...
            </p>
          ) : (
            <div className="space-y-2">
              {links.map((l, i) => {
                const Icon = TYPE_ICON[l.type] ?? Link2;
                const kind = BIO_LINK_KINDS.find((k) => k.key === l.type);
                const isBanner = l.layout === "banner";
                return (
                  <div
                    key={l.id}
                    draggable
                    onDragStart={() => setDragIndex(i)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragIndex !== null) reorder(dragIndex, i);
                      setDragIndex(null);
                    }}
                    onDragEnd={() => setDragIndex(null)}
                    className={`flex items-center gap-2.5 rounded-xl border p-2.5 transition ${l.active ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50 opacity-60"} ${dragIndex === i ? "opacity-40 ring-2 ring-brand-200" : ""}`}
                  >
                    <div className="flex flex-col items-center">
                      <button onClick={() => move(i, -1)} disabled={i === 0} className="text-slate-300 hover:text-brand-600 disabled:opacity-30" title="Subir">
                        <ChevronUp className="size-4" />
                      </button>
                      <GripVertical className="size-4 cursor-grab text-slate-300 active:cursor-grabbing" />
                      <button onClick={() => move(i, 1)} disabled={i === links.length - 1} className="text-slate-300 hover:text-brand-600 disabled:opacity-30" title="Descer">
                        <ChevronDown className="size-4" />
                      </button>
                    </div>
                    {l.imageUrl ? (
                      <img src={l.imageUrl} alt="" className={`shrink-0 rounded-lg object-cover ${isBanner ? "h-10 w-16" : "size-10"}`} />
                    ) : (
                      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-500">
                        <Icon className="size-5" />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1 truncate text-sm font-semibold text-slate-800">
                        {l.featured && <Star className="size-3.5 shrink-0 text-amber-400" fill="currentColor" />}
                        <span className="truncate">{l.title}</span>
                      </p>
                      <p className="truncate text-[11px] text-slate-400">
                        {isBanner ? "🖼️ Banner" : kind?.label}
                        {l.featured && <span className="ml-1.5 text-amber-500">· destaque</span>}
                        {l.clicks > 0 && <span className="ml-1.5 text-slate-500">· {l.clicks} clique{l.clicks === 1 ? "" : "s"}</span>}
                      </p>
                    </div>
                    <button
                      onClick={() => toggleActive(l)}
                      className={`relative h-6 w-10 shrink-0 rounded-full transition ${l.active ? "bg-emerald-500" : "bg-slate-300"}`}
                      title={l.active ? "Ativo" : "Oculto"}
                    >
                      <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${l.active ? "left-[1.125rem]" : "left-0.5"}`} />
                    </button>
                    <button onClick={() => setEditing(l)} className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-brand-600" title="Editar">
                      <Pencil className="size-4" />
                    </button>
                    <button onClick={() => remove(l)} className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-500" title="Excluir">
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Remarketing (pixel) */}
        <Advanced page={page} onSave={patchPage} />
      </div>

      {/* Prévia ao vivo */}
      <div className="lg:sticky lg:top-6 h-fit">
        <p className="mb-2 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-400">Prévia</p>
        <BioPreview
          avatar={avatar}
          cover={page.hideCover ? null : page.coverUrl}
          headline={headline}
          tagline={tagline}
          slug={page.slug}
          links={links.filter((l) => l.active)}
          colors={bioColors(page, { primary: identity.primary, secondary: identity.secondary })}
          shape={page.buttonShape}
        />
      </div>

      {editing && (
        <LinkEditor
          link={editing === "new" ? null : editing}
          identity={identity}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}

      {showQr && <QrModal url={publicUrl} onClose={() => setShowQr(false)} />}
    </div>
  );
}

/* ---------- QR Code do link da bio (modal) ---------- */
function QrModal({ url, onClose }: { url: string; onClose: () => void }) {
  const src = `/api/qrcode?url=${encodeURIComponent(url)}`;
  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={onClose} />
        <div className="relative w-full max-w-xs rounded-2xl bg-white p-6 text-center shadow-pop animate-fade-up">
          <button onClick={onClose} className="absolute right-3 top-3 grid size-8 place-items-center rounded-lg text-gray-400 hover:bg-gray-100">
            <X className="size-5" />
          </button>
          <h3 className="mb-1 text-lg font-semibold text-slate-800">QR Code da bio</h3>
          <p className="mb-4 text-xs text-slate-500">Coloque em cartões, sacolas, vitrine ou stories. Quem apontar a câmera abre a sua bio.</p>
          <div className="mx-auto w-52 overflow-hidden rounded-xl border border-slate-100 p-2">
            <img src={src} alt="QR Code da bio" className="w-full" />
          </div>
          <p className="mt-3 truncate text-[11px] text-slate-400">{url}</p>
          <a
            href={src}
            download="qrcode-bio.svg"
            className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-brand-600 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            <Upload className="size-4 rotate-180" /> Baixar QR Code
          </a>
        </div>
      </div>
    </Portal>
  );
}

/* ---------- Redes sociais (ícones no topo da bio) ---------- */
function SocialLinks({
  page,
  onSave,
}: {
  page: PageState;
  onSave: (d: Partial<Pick<PageState, "instagram" | "tiktok" | "youtube" | "facebook">>) => Promise<void>;
}) {
  const [instagram, setInstagram] = useState(page.instagram ?? "");
  const [tiktok, setTiktok] = useState(page.tiktok ?? "");
  const [youtube, setYoutube] = useState(page.youtube ?? "");
  const [facebook, setFacebook] = useState(page.facebook ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    await onSave({
      instagram: instagram.trim() || null,
      tiktok: tiktok.trim() || null,
      youtube: youtube.trim() || null,
      facebook: facebook.trim() || null,
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  const rows: { icon: (p: { className?: string }) => ReactNode; label: string; value: string; set: (v: string) => void; placeholder: string }[] = [
    { icon: InstagramIcon, label: "Instagram", value: instagram, set: setInstagram, placeholder: "@sualoja" },
    { icon: TiktokIcon, label: "TikTok", value: tiktok, set: setTiktok, placeholder: "@sualoja" },
    { icon: YoutubeIcon, label: "YouTube", value: youtube, set: setYoutube, placeholder: "@seucanal ou link" },
    { icon: FacebookIcon, label: "Facebook", value: facebook, set: setFacebook, placeholder: "sualoja ou link" },
  ];

  return (
    <Card className="p-5">
      <h2 className="mb-1 font-semibold text-slate-800">Redes sociais</h2>
      <p className="mb-4 text-xs text-slate-500">Aparecem como ícones no topo da bio. Deixe em branco para esconder.</p>
      <div className="space-y-2.5">
        {rows.map((r) => {
          const RIcon = r.icon;
          return (
            <div key={r.label} className="flex items-center gap-2.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500">
                <RIcon className="size-4.5" />
              </span>
              <input
                value={r.value}
                onChange={(e) => r.set(e.target.value)}
                placeholder={r.placeholder}
                aria-label={r.label}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400"
              />
            </div>
          );
        })}
      </div>
      <button
        onClick={save}
        disabled={saving}
        className="mt-4 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-60"
      >
        {saving ? "Salvando..." : saved ? "Salvo ✓" : "Salvar redes"}
      </button>
    </Card>
  );
}

/* ---------- Remarketing (pixel Meta / Google) ---------- */
function Advanced({
  page,
  onSave,
}: {
  page: PageState;
  onSave: (d: Partial<Pick<PageState, "metaPixelId" | "gaId">>) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [metaPixelId, setMetaPixelId] = useState(page.metaPixelId ?? "");
  const [gaId, setGaId] = useState(page.gaId ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    await onSave({ metaPixelId: metaPixelId.trim() || null, gaId: gaId.trim() || null });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  return (
    <Card className="p-5">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-3 text-left">
        <div>
          <h2 className="font-semibold text-slate-800">Remarketing (avançado)</h2>
          <p className="mt-0.5 text-xs text-slate-500">Opcional. Reimpacte no Instagram/Facebook quem visitou a sua bio.</p>
        </div>
        {open ? <ChevronUp className="size-5 shrink-0 text-slate-400" /> : <ChevronDown className="size-5 shrink-0 text-slate-400" />}
      </button>

      {open && (
        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-slate-400">Pixel da Meta (Facebook/Instagram)</label>
            <input
              value={metaPixelId}
              onChange={(e) => setMetaPixelId(e.target.value)}
              placeholder="Ex.: 1234567890123456"
              inputMode="numeric"
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-slate-400">Google Analytics (opcional)</label>
            <input
              value={gaId}
              onChange={(e) => setGaId(e.target.value)}
              placeholder="Ex.: G-XXXXXXXXXX"
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400"
            />
          </div>
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
            💡 Cole aqui o ID do seu Pixel (do Gerenciador de Anúncios da Meta). Com ele, você pode criar anúncios para quem já clicou na sua bio.
          </p>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-60"
          >
            {saving ? "Salvando..." : saved ? "Salvo ✓" : "Salvar"}
          </button>
        </div>
      )}
    </Card>
  );
}

/* ---------- Aparência (foto + título + subtítulo) ---------- */
function Appearance({
  page,
  identity,
  onSave,
}: {
  page: PageState;
  identity: Identity;
  onSave: (d: Partial<Pick<PageState, "headline" | "tagline" | "avatarUrl" | "coverUrl" | "hideCover">>) => Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  const [headline, setHeadline] = useState(page.headline ?? "");
  const [tagline, setTagline] = useState(page.tagline ?? "");
  const [avatar, setAvatar] = useState(page.avatarUrl);
  const [cover, setCover] = useState(page.coverUrl);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    await onSave({ headline: headline.trim() || null, tagline: tagline.trim() || null, avatarUrl: avatar, coverUrl: cover });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  return (
    <Card className="p-5">
      <h2 className="mb-4 font-semibold text-slate-800">Aparência</h2>

      {/* foto de capa (banner no topo) */}
      <div className="mb-4">
        <label className="mb-1.5 block text-[11px] font-medium text-slate-400">Foto de capa (opcional)</label>
        <p className="mb-1.5 text-[11px] text-slate-400">📐 Tamanho ideal: <b>1200 × 400 px</b> (deitada / paisagem).</p>
        <input
          ref={coverRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) setCover(await fileToDataUrl(f, 1200, 0.82));
          }}
        />
        {cover ? (
          <div className="relative overflow-hidden rounded-xl">
            <img src={cover} alt="" className="h-28 w-full object-cover" />
            <div className="absolute inset-x-0 bottom-0 flex justify-end gap-2 bg-gradient-to-t from-black/50 to-transparent p-2">
              <button onClick={() => coverRef.current?.click()} className="rounded-lg bg-white/90 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-white">Trocar</button>
              <button onClick={() => setCover(null)} className="rounded-lg bg-white/90 px-2 py-1 text-[11px] font-medium text-rose-600 hover:bg-white">Remover</button>
            </div>
          </div>
        ) : (
          <button onClick={() => coverRef.current?.click()} className="flex h-24 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 text-xs font-medium text-slate-400 transition hover:border-brand-300 hover:text-brand-600">
            <Upload className="size-4" /> Enviar foto de capa
          </button>
        )}

        {/* liga/desliga do banner do cabeçalho — bio mais compacta sem ele */}
        <label className="mt-2.5 flex cursor-pointer items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
          <span className="min-w-0">
            <span className="block text-xs font-medium text-slate-700">Mostrar banner do cabeçalho</span>
            <span className="block text-[11px] text-slate-400">Desligue pra uma bio mais enxuta — cabe mais botão sem rolar.</span>
          </span>
          <input
            type="checkbox"
            checked={!page.hideCover}
            onChange={(e) => onSave({ hideCover: !e.target.checked })}
            className="peer sr-only"
          />
          <span className="relative h-5 w-9 shrink-0 rounded-full bg-slate-300 transition peer-checked:bg-emerald-500 after:absolute after:left-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-4" />
        </label>
      </div>

      <div className="flex items-center gap-4">
        <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-full border border-slate-100" style={{ background: identity.secondary }}>
          {avatar ? (
            <img src={avatar} alt="" className="size-full object-cover" />
          ) : (
            <span className="text-xl font-bold" style={{ color: identity.primary }}>
              {(headline || identity.name).slice(0, 1).toUpperCase()}
            </span>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) setAvatar(await fileToDataUrl(f, 400, 0.85));
          }}
        />
        <div className="flex flex-col gap-1.5">
          <button onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 transition hover:border-brand-300">
            <Upload className="size-3.5" /> Enviar foto
          </button>
          <p className="text-[11px] text-slate-400">📐 Ideal: <b>400 × 400 px</b> (quadrada).</p>
          <div className="flex gap-2 text-[11px]">
            {identity.logoUrl && (
              <button onClick={() => setAvatar(identity.logoUrl)} className="text-brand-600 hover:underline">
                Usar logo
              </button>
            )}
            {avatar && (
              <button onClick={() => setAvatar(null)} className="text-slate-400 hover:text-rose-500">
                Remover
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-slate-400">Título</label>
          <input
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            placeholder={identity.name}
            maxLength={80}
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-slate-400">Subtítulo</label>
          <textarea
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            placeholder={identity.tagline ?? "Moda no atacado direto de fábrica ✨"}
            maxLength={160}
            rows={2}
            className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400"
          />
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-60"
        >
          {saving ? "Salvando..." : saved ? "Salvo ✓" : "Salvar aparência"}
        </button>
      </div>
    </Card>
  );
}

/* ---------- Editor de um botão (modal) ---------- */
function LinkEditor({
  link,
  identity,
  onClose,
  onSaved,
}: {
  link: Link | null;
  identity: Identity;
  onClose: () => void;
  onSaved: (l: Link, isNew: boolean) => void;
}) {
  const isNew = link === null;
  const fileRef = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<BioLinkKind>(link?.type ?? "CATALOGO");
  const [title, setTitle] = useState(link?.title ?? "");
  const [subtitle, setSubtitle] = useState(link?.subtitle ?? "");
  const [url, setUrl] = useState(link?.url ?? "");
  const [image, setImage] = useState(link?.imageUrl ?? null);
  const [layout, setLayout] = useState<string>(link?.layout ?? "normal");
  const [featured, setFeatured] = useState(link?.featured ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isBanner = layout === "banner";

  const kind = BIO_LINK_KINDS.find((k) => k.key === type)!;
  const suggestedTitle: Record<BioLinkKind, string> = {
    CATALOGO: "Ver catálogo",
    WHATSAPP: "Falar no WhatsApp",
    SITE: "Nosso site",
    EXTERNO: "",
  };

  async function save() {
    const t = title.trim() || suggestedTitle[type];
    if (!t) {
      setError("Dê um nome ao botão.");
      return;
    }
    if (kind.needsUrl && !url.trim()) {
      setError("Informe o link (endereço).");
      return;
    }
    setSaving(true);
    setError("");
    const body = JSON.stringify({ title: t, subtitle: subtitle.trim() || null, type, url: url.trim() || null, imageUrl: image, layout, featured });
    const res = isNew
      ? await fetch("/api/marketing/bio/links", { method: "POST", headers: { "Content-Type": "application/json" }, body })
      : await fetch(`/api/marketing/bio/links/${link!.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: t, subtitle: subtitle.trim() || null, url: url.trim() || null, imageUrl: image, layout, featured }),
        });
    setSaving(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Não foi possível salvar.");
      return;
    }
    const d = await res.json();
    onSaved(d.link, isNew);
  }

  const Icon = TYPE_ICON[type] ?? Link2;

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center pb-[var(--kb,0px)]">
        <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={onClose} />
        <div className="relative max-h-[calc(100dvh_-_var(--kb,0px)_-_1.5rem)] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-pop animate-fade-up sm:px-6 md:rounded-2xl">
          <div className="md:hidden mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-200" />
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-lg font-semibold">{isNew ? "Novo botão" : "Editar botão"}</h3>
            <button onClick={onClose} className="-mr-1 grid size-8 place-items-center rounded-lg text-gray-400 hover:bg-gray-100">
              <X className="size-5" />
            </button>
          </div>

          {/* tipo */}
          <label className="mb-1 block text-[11px] font-medium text-slate-400">Tipo de botão</label>
          <div className="grid grid-cols-2 gap-2">
            {BIO_LINK_KINDS.map((k) => {
              const KIcon = TYPE_ICON[k.key];
              const on = type === k.key;
              return (
                <button
                  key={k.key}
                  onClick={() => {
                    setType(k.key);
                    if (!title.trim()) setTitle(suggestedTitle[k.key]);
                  }}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm transition ${on ? "border-brand-400 bg-brand-50 font-medium text-brand-700" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}
                >
                  <KIcon className="size-4" /> {k.label}
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-[11px] text-slate-400">{kind.hint}</p>

          {/* formato do botão: normal (ícone+texto) ou banner (imagem larga) */}
          <label className="mt-3 mb-1 block text-[11px] font-medium text-slate-400">Formato</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setLayout("normal")}
              className={`rounded-xl border px-3 py-2 text-left text-sm transition ${!isBanner ? "border-brand-400 bg-brand-50" : "border-slate-200 hover:border-slate-300"}`}
            >
              <span className="block font-medium text-slate-700">Normal</span>
              <span className="block text-[10px] text-slate-400">Ícone + texto</span>
            </button>
            <button
              onClick={() => setLayout("banner")}
              className={`rounded-xl border px-3 py-2 text-left text-sm transition ${isBanner ? "border-brand-400 bg-brand-50" : "border-slate-200 hover:border-slate-300"}`}
            >
              <span className="block font-medium text-slate-700">Banner 🖼️</span>
              <span className="block text-[10px] text-slate-400">Imagem grande</span>
            </button>
          </div>

          <div className="mt-3 space-y-3">
            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-400">Nome do botão</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={suggestedTitle[type] || "Ex.: Nossa promoção"}
                maxLength={60}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-400">Descrição (opcional)</label>
              <input
                value={subtitle}
                onChange={(e) => setSubtitle(e.target.value)}
                placeholder="Uma linha de apoio"
                maxLength={80}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400"
              />
            </div>
            {kind.needsUrl && (
              <div>
                <label className="mb-1 block text-[11px] font-medium text-slate-400">
                  {type === "SITE" ? "Endereço do site/e-commerce" : "Link"}
                </label>
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="cole ou digite o link (ex.: minhaloja.com.br)"
                  inputMode="url"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400"
                />
              </div>
            )}
            {type === "WHATSAPP" && !identity.whatsapp && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
                Sua loja ainda não tem WhatsApp cadastrado no catálogo — configure em Configurações para este botão funcionar.
              </p>
            )}

            {/* imagem do botão / banner */}
            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-400">
                {isBanner ? "Imagem do banner" : "Imagem do botão (opcional)"}
              </label>
              <div className="flex items-center gap-3">
                {image ? (
                  <img src={image} alt="" className={`rounded-xl object-cover ${isBanner ? "h-12 w-24" : "size-12"}`} />
                ) : (
                  <span className={`grid place-items-center rounded-xl bg-brand-50 text-brand-400 ${isBanner ? "h-12 w-24" : "size-12"}`}>
                    <Icon className="size-5" />
                  </span>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) setImage(await fileToDataUrl(f, isBanner ? 1200 : 400, 0.85));
                  }}
                />
                <button onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 transition hover:border-brand-300">
                  <Upload className="size-3.5" /> Enviar
                </button>
                {image && (
                  <button onClick={() => setImage(null)} className="text-xs text-slate-400 hover:text-rose-500">
                    Remover
                  </button>
                )}
              </div>
              {isBanner ? (
                <p className="mt-2 rounded-lg bg-brand-50 px-3 py-2 text-[11px] text-brand-700">
                  💡 Suba uma arte no formato paisagem (deitada), feita no Canva ou pela sua equipe. Ela ocupa o botão inteiro.
                  <br />📐 Tamanho ideal: <b>1080 × 1080 px</b> (quadrada) ou <b>1200 × 628 px</b> (deitada).
                </p>
              ) : (
                <>
                  <p className="mt-2 text-[11px] text-slate-400">📐 Ideal: <b>400 × 400 px</b> (quadrada).</p>
                  {/* galeria de imagens prontas — pra quem não quer subir foto própria */}
                  <p className="mt-3 mb-1.5 text-[11px] font-medium text-slate-400">Ou escolha uma da galeria:</p>
                  <div className="grid grid-cols-7 gap-1.5">
                    {BIO_BUTTON_ICONS.map((ic) => (
                      <button
                        key={ic.key}
                        onClick={() => setImage(ic.url)}
                        title={ic.label}
                        className={`overflow-hidden rounded-lg border-2 transition ${image === ic.url ? "border-brand-500 ring-2 ring-brand-200" : "border-transparent hover:border-slate-200"}`}
                      >
                        <img src={ic.url} alt={ic.label} className="size-full" />
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* botão em destaque: ganha um brilho especial na página */}
            <button
              onClick={() => setFeatured((v) => !v)}
              className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${featured ? "border-amber-300 bg-amber-50" : "border-slate-200 hover:border-slate-300"}`}
            >
              <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${featured ? "bg-amber-400 text-white" : "bg-slate-100 text-slate-400"}`}>
                <Star className="size-5" fill={featured ? "currentColor" : "none"} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-slate-700">Botão em destaque</span>
                <span className="block text-[11px] text-slate-400">Ganha um brilho especial pra chamar mais atenção.</span>
              </span>
              <span className={`relative h-6 w-10 shrink-0 rounded-full transition ${featured ? "bg-amber-400" : "bg-slate-300"}`}>
                <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${featured ? "left-[1.125rem]" : "left-0.5"}`} />
              </span>
            </button>

            {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-600">{error}</p>}

            <button
              onClick={save}
              disabled={saving}
              className="w-full rounded-xl bg-brand-600 py-2.5 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-60"
            >
              {saving ? "Salvando..." : isNew ? "Adicionar botão" : "Salvar"}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}

/* ---------- Prévia (espelha a bio pública) ---------- */
function BioPreview({
  avatar,
  cover,
  headline,
  tagline,
  slug,
  links,
  colors,
  shape,
}: {
  avatar: string | null;
  cover: string | null;
  headline: string;
  tagline: string | null;
  slug: string;
  links: Link[];
  colors: { bg: string; button: string; buttonText: string };
  shape: string;
}) {
  const bg = colors.bg || "#4B3621";
  const top = mixHex(bg, "#ffffff", 0.18);
  const bottom = mixHex(bg, "#000000", 0.28);
  const onBg = readableOn(bg);
  const btnClass = shapeClass[shape] ?? "rounded-2xl";
  const chip = mixHex(colors.button, colors.buttonText, 0.12);

  return (
    <div className="overflow-hidden rounded-[2rem] border-[6px] border-slate-800 shadow-pop">
      <div
        className="flex min-h-[560px] flex-col items-center pb-5"
        style={{ background: `linear-gradient(165deg, ${top} 0%, ${bg} 45%, ${bottom} 100%)` }}
      >
        {/* capa opcional no topo */}
        {cover && <img src={cover} alt="" className="h-28 w-full object-cover" />}
        <div className={`flex w-full flex-col items-center px-4 ${cover ? "-mt-8 pt-0" : "pt-8"}`}>
          {avatar ? (
            <img src={avatar} alt="" className="size-16 rounded-full object-cover shadow-lg ring-2 ring-white/60" style={{ background: "#fff" }} />
          ) : (
            <div className="grid size-16 place-items-center rounded-full text-2xl font-extrabold shadow-lg ring-2 ring-white/60" style={{ background: colors.button, color: colors.buttonText }}>
              {headline.slice(0, 1).toUpperCase()}
            </div>
          )}
          <p className="mt-3 text-center text-base font-extrabold" style={{ color: onBg }}>{headline}</p>
          {tagline && <p className="mt-1.5 text-center text-[11px] leading-snug opacity-90" style={{ color: onBg }}>{tagline}</p>}
        </div>

        <div className="mt-5 flex w-full flex-col gap-2.5 px-4">
          {links.length === 0 ? (
            <p className="text-center text-[11px] opacity-70" style={{ color: onBg }}>Seus botões aparecem aqui ✨</p>
          ) : (
            links.map((l) => {
              const Icon = TYPE_ICON[l.type] ?? Link2;
              const isWa = l.type === "WHATSAPP";
              // botão em banner: imagem larga, título sobreposto (se houver)
              if (l.layout === "banner" && l.imageUrl) {
                return (
                  <div key={l.id} className={`relative overflow-hidden rounded-2xl shadow-md ${l.featured ? "ring-2 ring-white ring-offset-2" : ""}`} style={l.featured ? { ["--tw-ring-offset-color" as string]: bg } : undefined}>
                    {l.featured && <span className="absolute right-1.5 top-1.5 z-10 rounded-full bg-white/90 px-1.5 py-0.5 text-[8px] font-bold text-slate-800">✨</span>}
                    <img src={l.imageUrl} alt="" className="w-full object-cover" />
                  </div>
                );
              }
              return (
                <div key={l.id} className={`relative flex items-center gap-2.5 ${btnClass} px-2.5 py-2.5 shadow-md ${l.featured ? "ring-2 ring-white ring-offset-2" : ""}`} style={{ background: colors.button, color: colors.buttonText, ...(l.featured ? { ["--tw-ring-offset-color" as string]: bg } : {}) }}>
                  {l.featured && <span className="absolute -right-1 -top-1 text-xs">✨</span>}
                  {l.imageUrl ? (
                    <img src={l.imageUrl} alt="" className="size-9 shrink-0 rounded-lg object-cover" />
                  ) : (
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg" style={{ background: isWa ? "#25D366" : chip, color: isWa ? "#fff" : colors.buttonText }}>
                      <Icon className="size-4" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold">{l.title}</span>
                    {l.subtitle && <span className="block truncate text-[10px] opacity-60">{l.subtitle}</span>}
                  </span>
                  <ChevronRight className="size-3.5 shrink-0 opacity-40" />
                </div>
              );
            })
          )}
        </div>

        <p className="mt-auto pt-6 text-center text-[10px] opacity-70" style={{ color: onBg }}>
          feito por <b>atacadopro.com</b>
        </p>
      </div>
    </div>
  );
}

/* Campo de cor: escolhe pela paletinha (toque no quadrado) OU digita/cola o
 * código da cor (hex). Assim a lojista cria QUALQUER cor que quiser. */
function BioColorField({
  label,
  value,
  fallback,
  onChange,
  canClear,
}: {
  label: string;
  value: string | null;
  fallback: string;
  onChange: (v: string | null) => void;
  canClear?: boolean;
}) {
  const atual = (value ?? fallback).toUpperCase();
  const [texto, setTexto] = useState(atual);
  // acompanha mudanças vindas de fora (tema pronto, limpar, etc.)
  useEffect(() => setTexto(atual), [atual]);

  function digitar(v: string) {
    setTexto(v);
    const h = v.trim().replace(/^#?/, "#");
    if (/^#[0-9a-fA-F]{6}$/.test(h)) onChange(h.toUpperCase());
  }

  return (
    <div className="flex items-center gap-2">
      <label
        className="relative size-9 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-slate-200"
        style={{ background: value ?? fallback }}
        title="Escolher cor"
      >
        <input
          type="color"
          value={value ?? fallback}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-slate-600">{label}</p>
        <input
          type="text"
          value={texto}
          onChange={(e) => digitar(e.target.value)}
          onBlur={() => setTexto(atual)}
          placeholder="#RRGGBB"
          maxLength={7}
          spellCheck={false}
          className="w-full max-w-[92px] rounded-md border border-slate-200 px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-tight text-slate-600 outline-none focus:border-brand-400"
        />
        {!value && <p className="text-[9px] text-slate-400">cor do catálogo</p>}
      </div>
      {canClear && value && (
        <button onClick={() => onChange(null)} className="text-[10px] text-slate-400 hover:text-rose-500">
          limpar
        </button>
      )}
    </div>
  );
}

/* ---------- Cores e estilo (temas, cores próprias, fonte, formato) ---------- */
function ColorsStyle({
  page,
  identity,
  onSave,
}: {
  page: PageState;
  identity: Identity;
  onSave: (
    d: Partial<
      Pick<PageState, "bgColor" | "buttonColor" | "buttonTextColor" | "font" | "buttonShape">
    >
  ) => Promise<void>;
}) {
  const colors = bioColors(page, { primary: identity.primary, secondary: identity.secondary });
  const activeTheme = BIO_THEMES.find(
    (t) => t.bgColor === page.bgColor && t.buttonColor === page.buttonColor && t.buttonTextColor === page.buttonTextColor
  );

  return (
    <Card className="p-5">
      <h2 className="mb-1 font-semibold text-slate-800">Cores e estilo</h2>
      <p className="mb-4 text-xs text-slate-500">Escolha um tema pronto ou crie a sua cor: toque no quadradinho pra abrir a paleta, ou digite/cole o código da cor (ex.: #4B3621). A prévia atualiza na hora.</p>

      {/* temas prontos */}
      <div className="mb-5 flex flex-wrap gap-2">
        {BIO_THEMES.map((t) => {
          const on = activeTheme?.key === t.key;
          return (
            <button
              key={t.key}
              onClick={() => onSave({ bgColor: t.bgColor, buttonColor: t.buttonColor, buttonTextColor: t.buttonTextColor })}
              className={`flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 text-xs font-medium transition ${on ? "border-brand-400 ring-2 ring-brand-100" : "border-slate-200 hover:border-slate-300"}`}
              title={t.label}
            >
              <span className="flex -space-x-1">
                <span className="size-4 rounded-full ring-1 ring-white" style={{ background: t.bgColor }} />
                <span className="size-4 rounded-full ring-1 ring-white" style={{ background: t.buttonColor }} />
              </span>
              {t.label}
            </button>
          );
        })}
      </div>

      {/* cores próprias */}
      <div className="grid gap-3 sm:grid-cols-3">
        <BioColorField label="Fundo" value={page.bgColor} fallback={colors.bg} onChange={(v) => onSave({ bgColor: v })} canClear />
        <BioColorField label="Botão" value={page.buttonColor} fallback={colors.button} onChange={(v) => onSave({ buttonColor: v })} canClear />
        <BioColorField label="Texto do botão" value={page.buttonTextColor} fallback={colors.buttonText} onChange={(v) => onSave({ buttonTextColor: v })} canClear />
      </div>

      {/* fonte + formato dos botões */}
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-1.5 text-[11px] font-medium text-slate-400">Fonte</p>
          <div className="flex flex-wrap gap-1.5">
            {BIO_FONTS.map((f) => {
              const on = (page.font ?? identity.font) === f;
              return (
                <button
                  key={f}
                  onClick={() => onSave({ font: f })}
                  className={`rounded-lg border px-2.5 py-1.5 text-xs transition ${on ? "border-brand-400 bg-brand-50 font-medium text-brand-700" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}
                >
                  {FONT_LABEL[f]}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-[11px] font-medium text-slate-400">Formato dos botões</p>
          <div className="flex flex-wrap gap-1.5">
            {BIO_SHAPES.map((s) => {
              const on = page.buttonShape === s;
              return (
                <button
                  key={s}
                  onClick={() => onSave({ buttonShape: s })}
                  className={`flex items-center gap-1.5 border px-2.5 py-1.5 text-xs transition ${shapeClass[s]} ${on ? "border-brand-400 bg-brand-50 font-medium text-brand-700" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}
                >
                  <span className={`size-3 border border-current ${shapeClass[s]}`} />
                  {SHAPE_LABEL[s]}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Card>
  );
}
