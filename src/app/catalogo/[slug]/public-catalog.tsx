"use client";

/* eslint-disable @next/next/no-img-element */

/**
 * Catálogo público — mesmo layout do catálogo "toque leve":
 * topbar com sacola, barra de modelos fixa com scroll-spy, cards por cor
 * com swatch, sheet de produto com quantidade por tamanho, sacola agrupada
 * com pedido mínimo (barra de progresso), dados do cliente e envio do
 * pedido completo pelo WhatsApp.
 *
 * Tudo vem do CRM: a loja edita produtos, fotos, cores, tamanhos, preços
 * e estoque na tela Produtos e o catálogo reflete na hora.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Montserrat } from "next/font/google";

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export type CatalogProduct = {
  id: string;
  name: string;
  sku: string;
  category: string;
  collection: string | null;
  description: string | null;
  retailPrice: number;
  wholesalePrice: number;
  minQuantity: number;
  tags: string | null;
  images: string[];
  variants: { color: string; size: string; available: boolean }[];
};

/* nome da cor → cor real do swatch (fallback neutro) */
const COLOR_HEX: Record<string, string> = {
  preto: "#211E1D", branco: "#FAF6EF", "off-white": "#F5F0E4",
  vinho: "#6E2536", caramelo: "#B07636", terracota: "#BC5836",
  rosa: "#E8A0BF", nude: "#D9B99B", azul: "#3B5F8A", verde: "#3E7A5E",
  amarelo: "#E5B93C", lilás: "#B49BD6", lilas: "#B49BD6", bege: "#D8C9A8",
  laranja: "#D97435", vermelho: "#B33939", cinza: "#8C8C8C", marrom: "#4B3621",
};
const swatch = (color: string) =>
  COLOR_HEX[color.toLowerCase()] ?? "#C9BEB0";

const fmt = (n: number) =>
  "R$ " + n.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/* card = produto × cor (como no exemplo, 1 card por cor) */
type CardItem = {
  key: string;
  product: CatalogProduct;
  color: string;
  sizes: { size: string; available: boolean }[];
};

type Cart = Record<string, Record<string, number>>; // key -> size -> qty
const sum = (o: Record<string, number>) =>
  Object.values(o).reduce((a, b) => a + b, 0);

const WaIcon = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2Zm5.8 14.18c-.24.68-1.42 1.3-1.95 1.34-.5.05-1.13.07-1.83-.11-.42-.13-.96-.31-1.66-.61-2.92-1.26-4.82-4.2-4.97-4.4-.14-.2-1.19-1.58-1.19-3.01 0-1.43.75-2.13 1.02-2.42a1.06 1.06 0 0 1 .77-.36c.19 0 .39 0 .55.01.18.01.42-.07.65.5.24.58.82 2.01.89 2.16.07.14.12.31.02.5-.09.2-.14.31-.28.48-.14.16-.29.37-.42.49-.14.14-.28.29-.12.57.16.28.71 1.17 1.53 1.9 1.05.94 1.94 1.23 2.22 1.37.28.14.44.12.6-.07.16-.2.69-.8.87-1.08.18-.28.36-.23.6-.14.24.09 1.55.73 1.81.87.27.14.45.2.51.31.07.12.07.65-.17 1.32Z" />
  </svg>
);

const BagIcon = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
    <path d="M3 6h18" />
    <path d="M16 10a4 4 0 0 1-8 0" />
  </svg>
);

export function PublicCatalog({
  storeName,
  tagline,
  whatsapp,
  minOrder,
  products,
}: {
  storeName: string;
  tagline: string | null;
  whatsapp: string | null;
  minOrder: number;
  products: CatalogProduct[];
}) {
  const categories = useMemo(
    () => [...new Set(products.map((p) => p.category))],
    [products]
  );

  const cardsByCategory = useMemo(() => {
    const map = new Map<string, CardItem[]>();
    for (const cat of categories) map.set(cat, []);
    for (const p of products) {
      const colors = [...new Set(p.variants.map((v) => v.color))];
      for (const color of colors) {
        map.get(p.category)!.push({
          key: `${p.id}|${color}`,
          product: p,
          color,
          sizes: p.variants
            .filter((v) => v.color === color)
            .map((v) => ({ size: v.size, available: v.available })),
        });
      }
    }
    return map;
  }, [products, categories]);

  const allCards = useMemo(
    () => [...cardsByCategory.values()].flat(),
    [cardsByCategory]
  );

  const [cart, setCart] = useState<Cart>({});
  const [activeCat, setActiveCat] = useState(0);
  const [sheet, setSheet] = useState<CardItem | null>(null);
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [bagOpen, setBagOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [client, setClient] = useState({ loja: "", nome: "", fone: "" });
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  const totalPieces = Object.values(cart).reduce((a, s) => a + sum(s), 0);
  const totalValue = Object.entries(cart).reduce((acc, [key, sizes]) => {
    const card = allCards.find((c) => c.key === key);
    return card ? acc + sum(sizes) * card.product.retailPrice : acc;
  }, 0);

  const catPieces = (cat: string) =>
    (cardsByCategory.get(cat) ?? []).reduce(
      (a, c) => a + (cart[c.key] ? sum(cart[c.key]) : 0),
      0
    );

  /* scroll-spy das seções */
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.isIntersecting) {
            const idx = Number((en.target as HTMLElement).dataset.step);
            setActiveCat(idx);
          }
        }
      },
      { rootMargin: "-140px 0px -55% 0px", threshold: 0 }
    );
    Object.values(sectionRefs.current).forEach(
      (el) => el && observer.observe(el)
    );
    return () => observer.disconnect();
  }, [categories]);

  function openSheet(card: CardItem) {
    const existing = cart[card.key] ?? {};
    const d: Record<string, number> = {};
    for (const s of card.sizes) d[s.size] = existing[s.size] ?? 0;
    setDraft(d);
    setSheet(card);
    document.body.style.overflow = "hidden";
  }
  function closeSheet() {
    setSheet(null);
    document.body.style.overflow = "";
  }
  function openBag() {
    setBagOpen(true);
    document.body.style.overflow = "hidden";
  }
  function closeBag() {
    setBagOpen(false);
    document.body.style.overflow = "";
  }
  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 1900);
  }

  function addToBag() {
    if (!sheet) return;
    const clean: Record<string, number> = {};
    for (const [size, qty] of Object.entries(draft)) {
      if (qty > 0) clean[size] = qty;
    }
    setCart((prev) => {
      const next = { ...prev };
      if (Object.keys(clean).length) next[sheet.key] = clean;
      else delete next[sheet.key];
      return next;
    });
    closeSheet();
    showToast("Adicionado ao pedido");
  }

  function sendOrder() {
    if (!whatsapp) return;
    if (minOrder > 0 && totalPieces < minOrder) {
      const falta = minOrder - totalPieces;
      showToast(`Faltam ${falta} ${falta === 1 ? "peça" : "peças"} para o mínimo de ${minOrder}`);
      return;
    }
    let msg = `*Novo pedido — ${storeName}*\n\n`;
    for (const cat of categories) {
      const items = (cardsByCategory.get(cat) ?? []).filter((c) => cart[c.key]);
      if (!items.length) continue;
      msg += `*${cat}*\n`;
      for (const c of items) {
        const sizes = cart[c.key];
        const q = sum(sizes);
        const sizeStr = Object.entries(sizes)
          .map(([t, n]) => `${t} ×${n}`)
          .join(", ");
        msg += `• ${c.product.name} ${c.color} — ${sizeStr}  (${q} ${q > 1 ? "peças" : "peça"} · ${fmt(q * c.product.retailPrice)})\n`;
      }
      msg += "\n";
    }
    msg += `*Total:* ${totalPieces} peças · ${fmt(totalValue)}\n`;
    if (client.loja || client.nome || client.fone) {
      msg += "\n*Cliente*\n";
      if (client.loja) msg += `Loja: ${client.loja}\n`;
      if (client.nome) msg += `Nome: ${client.nome}\n`;
      if (client.fone) msg += `Telefone: ${client.fone}\n`;
    }
    msg += "\n_Valores sujeitos a confirmação._";
    const url = `https://wa.me/${whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank") ?? (window.location.href = url);
  }

  const minBlocked = minOrder > 0 && totalPieces < minOrder;

  return (
    <div
      className={montserrat.className}
      style={{ background: "#fff", color: "#000", minHeight: "100dvh", paddingBottom: 92 }}
    >
      {/* TOPBAR */}
      <header className="sticky top-0 z-40" style={{ background: "#4B3621" }}>
        <div className="max-w-[680px] mx-auto px-[18px] py-3.5 flex items-center justify-between gap-3">
          <div className="leading-none min-w-0">
            <p
              className="font-extrabold text-[23px] lowercase truncate"
              style={{ color: "#E7DCCC", letterSpacing: ".02em" }}
            >
              {storeName}
            </p>
          </div>
          <button
            onClick={openBag}
            aria-label="Abrir pedido"
            className="relative flex items-center justify-center size-[46px] rounded-full shrink-0 active:scale-95 transition"
            style={{ background: "#E7DCCC", color: "#4B3621" }}
          >
            <BagIcon className="size-5" />
            {totalPieces > 0 && (
              <span
                className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full text-[11px] font-bold flex items-center justify-center"
                style={{ background: "#000", color: "#E7DCCC", border: "2px solid #4B3621" }}
              >
                {totalPieces}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* INTRO */}
      <section className="max-w-[680px] mx-auto px-[18px] pt-6 pb-4">
        <h1 className="font-extrabold text-[26px] leading-[1.15] uppercase m-0 mb-2" style={{ letterSpacing: "-.01em" }}>
          Catálogo <em className="not-italic" style={{ color: "#4B3621" }}>{storeName}</em>
        </h1>
        <p className="m-0 text-sm font-medium leading-relaxed max-w-[46ch]" style={{ color: "#6F6357" }}>
          {tagline ??
            "Selecione os modelos desejados, adicione ao carrinho e finalize seu pedido pelo WhatsApp."}
        </p>
      </section>

      {/* BARRA DE MODELOS */}
      <nav
        className="sticky z-30 border-b"
        style={{ top: 74, background: "#fff", borderColor: "#E4D9C8", boxShadow: "0 6px 12px -10px rgba(0,0,0,.3)" }}
      >
        <div className="max-w-[680px] mx-auto flex gap-2 overflow-x-auto px-[18px] py-[11px]" style={{ scrollbarWidth: "none" }}>
          {categories.map((cat, i) => {
            const active = activeCat === i;
            const has = catPieces(cat) > 0;
            return (
              <button
                key={cat}
                onClick={() =>
                  sectionRefs.current[cat]?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
                className="flex items-center gap-2 shrink-0 rounded-full px-[15px] py-[9px] text-[13px] font-semibold whitespace-nowrap transition border"
                style={
                  active
                    ? { background: "#4B3621", color: "#E7DCCC", borderColor: "#4B3621" }
                    : { background: "#fff", color: "#4B3621", borderColor: "#E4D9C8" }
                }
              >
                {cat}
                {has && (
                  <span
                    className="size-[7px] rounded-full"
                    style={{ background: active ? "#E7DCCC" : "#4B3621" }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* SEÇÕES */}
      <main>
        {categories.map((cat, i) => {
          const cards = cardsByCategory.get(cat) ?? [];
          const firstDesc = cards[0]?.product.description;
          return (
            <section
              key={cat}
              data-step={i}
              ref={(el) => {
                sectionRefs.current[cat] = el;
              }}
              className="pb-2.5"
              style={{ scrollMarginTop: 140 }}
            >
              <div className="max-w-[680px] mx-auto px-[18px] pt-[22px]">
                <div className="flex items-baseline justify-between gap-2.5 mb-2">
                  <h2 className="font-extrabold text-[23px] uppercase m-0" style={{ letterSpacing: "-.01em" }}>
                    {cat}
                  </h2>
                  <span className="text-xs font-bold whitespace-nowrap" style={{ color: "#6F6357" }}>
                    {cards.length} {cards.length === 1 ? "opção" : "opções"}
                  </span>
                </div>
                {firstDesc && (
                  <p className="m-0 text-[13px] font-medium leading-normal" style={{ color: "#6F6357" }}>
                    {firstDesc}
                  </p>
                )}
              </div>
              <div className="max-w-[680px] mx-auto mt-3.5" style={{ borderTop: "1.5px dashed #E4D9C8" }} />

              <div className="max-w-[680px] mx-auto grid grid-cols-2 gap-3.5 px-3.5 pt-4 pb-2">
                {cards.map((card) => {
                  const inCart = cart[card.key] ? sum(cart[card.key]) : 0;
                  const soldOut = card.sizes.every((s) => !s.available);
                  return (
                    <button
                      key={card.key}
                      onClick={() => openSheet(card)}
                      className="relative text-left rounded-[14px] overflow-hidden flex flex-col active:scale-[0.985] transition border bg-white"
                      style={{ borderColor: "#E4D9C8" }}
                    >
                      {inCart > 0 && (
                        <span
                          className="absolute top-2 right-2 z-10 min-w-[22px] h-[22px] px-1.5 rounded-xl text-[11px] font-bold flex items-center justify-center"
                          style={{ background: "#4B3621", color: "#E7DCCC", boxShadow: "0 1px 4px rgba(0,0,0,.25)" }}
                        >
                          {inCart}
                        </span>
                      )}
                      <div className="w-full overflow-hidden" style={{ aspectRatio: "3/4", background: "#ECE6DE" }}>
                        {card.product.images[0] && (
                          <img
                            src={card.product.images[0]}
                            alt={`${card.product.name} ${card.color}`}
                            className="w-full h-full object-cover"
                          />
                        )}
                      </div>
                      <div className="px-3 pt-[11px] pb-[13px]">
                        <p className="text-[10px] uppercase font-semibold m-0" style={{ color: "#6F6357", letterSpacing: ".12em" }}>
                          {card.product.name}
                        </p>
                        <p className="text-[15px] font-bold my-1 flex items-center gap-[7px] leading-tight">
                          <span
                            className="size-3.5 rounded-full shrink-0"
                            style={{ background: swatch(card.color), border: "1px solid rgba(0,0,0,.2)" }}
                          />
                          {card.color}
                        </p>
                        <p className="text-[15px] font-bold m-0" style={{ color: "#4B3621" }}>
                          {fmt(card.product.retailPrice)}{" "}
                          <small className="text-[11px] font-medium" style={{ color: "#6F6357" }}>
                            / peça
                          </small>
                        </p>
                        {soldOut && (
                          <p className="text-[11px] font-semibold mt-1 m-0" style={{ color: "#B33939" }}>
                            Esgotado — consulte
                          </p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </main>

      {/* RODAPÉ */}
      <footer style={{ background: "#4B3621", color: "#E7DCCC" }}>
        <div className="max-w-[680px] mx-auto px-5 pt-[30px] pb-[34px] text-center">
          <p className="font-extrabold text-[22px] lowercase m-0 mb-3.5" style={{ letterSpacing: ".02em" }}>
            {storeName}
          </p>
          {whatsapp && (
            <p className="text-[13px] font-medium opacity-90 m-0 mb-1 flex items-center justify-center gap-[7px]">
              <WaIcon className="size-[15px]" />
              Pedidos: +{whatsapp.replace(/\D/g, "")}
            </p>
          )}
          <p className="text-[11px] opacity-60 mt-4 m-0 font-medium">
            © {new Date().getFullYear()} {storeName} · catálogo por VestiCRM
          </p>
        </div>
      </footer>

      {/* BARRA FIXA */}
      <div
        className="fixed inset-x-0 bottom-0 z-20 border-t"
        style={{ background: "#fff", borderColor: "#E4D9C8", padding: "12px 18px calc(12px + env(safe-area-inset-bottom,0))" }}
      >
        <div className="max-w-[680px] mx-auto">
          <button
            onClick={totalPieces > 0 ? sendOrder : openBag}
            className="w-full flex items-center justify-center gap-[9px] rounded-[14px] p-4 text-[15px] font-bold active:scale-[0.985] transition"
            style={{ background: "#4B3621", color: "#E7DCCC", letterSpacing: ".01em" }}
          >
            <WaIcon className="size-[19px]" />
            Enviar pedido pelo WhatsApp
            {totalPieces > 0 && (
              <span
                className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-[7px] rounded-xl text-xs font-extrabold ml-[3px]"
                style={{ background: "#E7DCCC", color: "#4B3621" }}
              >
                {totalPieces}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* TOAST */}
      <div
        className="fixed left-1/2 z-[80] flex items-center gap-2 rounded-[30px] px-5 py-3 text-[13px] font-semibold whitespace-nowrap transition-all duration-200 pointer-events-none"
        style={{
          bottom: 108,
          background: "#4B3621",
          color: "#E7DCCC",
          opacity: toast ? 1 : 0,
          transform: `translateX(-50%) translateY(${toast ? 0 : 20}px)`,
        }}
      >
        ✓ {toast}
      </div>

      {/* SHEET PRODUTO */}
      <div
        className="fixed inset-0 z-50 transition-opacity duration-200"
        style={{
          background: "rgba(0,0,0,.5)",
          opacity: sheet ? 1 : 0,
          pointerEvents: sheet ? "auto" : "none",
        }}
        onClick={closeSheet}
      />
      <section
        role="dialog"
        aria-modal="true"
        className="fixed inset-x-0 bottom-0 z-[60] mx-auto flex flex-col max-w-[680px] transition-transform duration-300"
        style={{
          background: "#fff",
          borderRadius: "22px 22px 0 0",
          maxHeight: "88dvh",
          boxShadow: "0 -10px 40px rgba(0,0,0,.22)",
          transform: sheet ? "translateY(0)" : "translateY(100%)",
        }}
      >
        {sheet && (
          <>
            <div className="w-[38px] h-1 rounded mx-auto mt-2.5" style={{ background: "#E4D9C8" }} />
            <div className="flex items-center justify-between px-[18px] pt-2 pb-3 border-b" style={{ borderColor: "#E4D9C8" }}>
              <h3 className="font-extrabold text-lg uppercase m-0" style={{ color: "#4B3621" }}>
                {sheet.product.name}
              </h3>
              <button
                onClick={closeSheet}
                aria-label="Fechar"
                className="size-10 rounded-full flex items-center justify-center text-xl shrink-0"
                style={{ background: "#E7DCCC", color: "#4B3621", border: "1.5px solid #E4D9C8" }}
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto p-[18px]">
              {sheet.product.images[0] && (
                <img
                  src={sheet.product.images[0]}
                  alt={sheet.product.name}
                  className="w-full rounded-[14px] border object-contain"
                  style={{ aspectRatio: "2/3", maxHeight: "50dvh", background: "#F2F2F0", borderColor: "#E4D9C8" }}
                />
              )}
              <p className="text-[10px] uppercase font-semibold mt-4 mb-0" style={{ color: "#6F6357", letterSpacing: ".14em" }}>
                {sheet.product.sku} · {sheet.product.category}
              </p>
              <p className="font-extrabold text-[21px] uppercase mt-1 mb-2.5">{sheet.product.name}</p>
              <span
                className="inline-flex items-center gap-2 rounded-[30px] px-3.5 py-[7px] text-[13px] font-bold"
                style={{ background: "#F3EDE3", border: "1px solid #E4D9C8", color: "#4B3621" }}
              >
                <span className="size-[15px] rounded-full" style={{ background: swatch(sheet.color), border: "1px solid rgba(0,0,0,.2)" }} />
                Cor: {sheet.color}
              </span>
              {sheet.product.description && (
                <p className="text-sm font-medium leading-relaxed mt-3.5 mb-1" style={{ color: "#6F6357" }}>
                  {sheet.product.description}
                </p>
              )}
              <p className="text-xl font-extrabold my-3.5" style={{ color: "#4B3621" }}>
                {fmt(sheet.product.retailPrice)}{" "}
                <small className="text-xs font-medium" style={{ color: "#6F6357" }}>/ peça</small>
              </p>
              {sheet.product.wholesalePrice > 0 && sheet.product.minQuantity > 1 && (
                <p className="text-xs font-semibold -mt-2 mb-3.5" style={{ color: "#6F6357" }}>
                  💼 Atacado: {fmt(sheet.product.wholesalePrice)} / peça a partir de {sheet.product.minQuantity} unidades
                </p>
              )}
              <p className="text-[11px] uppercase font-bold mb-2.5" style={{ color: "#6F6357", letterSpacing: ".14em" }}>
                Tamanhos · quantidade
              </p>
              <div className="flex flex-col gap-[9px]">
                {sheet.sizes.map(({ size, available }) => (
                  <div
                    key={size}
                    className="flex items-center justify-between rounded-xl border py-[9px] pl-3.5 pr-2.5"
                    style={{ borderColor: "#E4D9C8", opacity: available ? 1 : 0.45 }}
                  >
                    <span className="font-bold text-[15px] min-w-[46px]">
                      {size}
                      {!available && (
                        <small className="block text-[10px] font-semibold" style={{ color: "#B33939" }}>
                          esgotado
                        </small>
                      )}
                    </span>
                    <div className="flex items-center gap-0.5 rounded-[10px] p-[3px]" style={{ background: "#F3EDE3" }}>
                      <button
                        disabled={!available}
                        onClick={() =>
                          setDraft((d) => ({ ...d, [size]: Math.max(0, (d[size] ?? 0) - 1) }))
                        }
                        className="size-[38px] rounded-lg text-xl font-semibold flex items-center justify-center bg-white border"
                        style={{ borderColor: "#E4D9C8", color: "#4B3621" }}
                      >
                        −
                      </button>
                      <span className="min-w-[34px] text-center font-bold text-base tabular-nums">
                        {draft[size] ?? 0}
                      </span>
                      <button
                        disabled={!available}
                        onClick={() => setDraft((d) => ({ ...d, [size]: (d[size] ?? 0) + 1 }))}
                        className="size-[38px] rounded-lg text-xl font-semibold flex items-center justify-center bg-white border"
                        style={{ borderColor: "#E4D9C8", color: "#4B3621" }}
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div
              className="border-t px-[18px] pt-3.5"
              style={{ borderColor: "#E4D9C8", paddingBottom: "calc(16px + env(safe-area-inset-bottom,0))" }}
            >
              <button
                onClick={addToBag}
                disabled={sum(draft) === 0}
                className="w-full rounded-[14px] p-4 text-[15px] font-bold active:scale-[0.985] transition disabled:opacity-40"
                style={{ background: "#4B3621", color: "#E7DCCC" }}
              >
                {sum(draft) === 0
                  ? "Selecione os tamanhos"
                  : `Adicionar ${sum(draft)} ${sum(draft) > 1 ? "peças" : "peça"} ao pedido`}
              </button>
            </div>
          </>
        )}
      </section>

      {/* SHEET SACOLA */}
      <div
        className="fixed inset-0 z-50 transition-opacity duration-200"
        style={{
          background: "rgba(0,0,0,.5)",
          opacity: bagOpen ? 1 : 0,
          pointerEvents: bagOpen ? "auto" : "none",
        }}
        onClick={closeBag}
      />
      <section
        role="dialog"
        aria-modal="true"
        className="fixed inset-x-0 bottom-0 z-[60] mx-auto flex flex-col max-w-[680px] transition-transform duration-300"
        style={{
          background: "#fff",
          borderRadius: "22px 22px 0 0",
          maxHeight: "88dvh",
          boxShadow: "0 -10px 40px rgba(0,0,0,.22)",
          transform: bagOpen ? "translateY(0)" : "translateY(100%)",
        }}
      >
        <div className="w-[38px] h-1 rounded mx-auto mt-2.5" style={{ background: "#E4D9C8" }} />
        <div className="flex items-center justify-between px-[18px] pt-2 pb-3 border-b" style={{ borderColor: "#E4D9C8" }}>
          <h3 className="font-extrabold text-lg uppercase m-0" style={{ color: "#4B3621" }}>
            Seu pedido
          </h3>
          <button
            onClick={closeBag}
            aria-label="Fechar"
            className="size-10 rounded-full flex items-center justify-center text-xl shrink-0"
            style={{ background: "#E7DCCC", color: "#4B3621", border: "1.5px solid #E4D9C8" }}
          >
            ✕
          </button>
        </div>
        <div className="overflow-y-auto p-[18px]">
          {totalPieces === 0 ? (
            <p className="text-center text-sm font-medium py-10" style={{ color: "#6F6357" }}>
              Seu pedido está vazio.
              <br />
              Toque em uma peça para começar.
            </p>
          ) : (
            <>
              {categories.map((cat) => {
                const items = (cardsByCategory.get(cat) ?? []).filter((c) => cart[c.key]);
                if (!items.length) return null;
                return (
                  <div key={cat}>
                    <p className="text-[11px] uppercase font-extrabold mt-3.5 mb-0.5" style={{ color: "#4B3621", letterSpacing: ".12em" }}>
                      {cat}
                    </p>
                    {items.map((c) => {
                      const sizes = cart[c.key];
                      const q = sum(sizes);
                      return (
                        <div
                          key={c.key}
                          className="flex gap-3 py-[13px]"
                          style={{ borderBottom: "1px dashed #E4D9C8" }}
                        >
                          {c.product.images[0] && (
                            <img
                              src={c.product.images[0]}
                              alt=""
                              className="w-[58px] h-[74px] object-cover rounded-[10px] border shrink-0"
                              style={{ borderColor: "#E4D9C8", background: "#ECE6DE" }}
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-sm m-0 flex items-center gap-[7px]">
                              <span className="size-[13px] rounded-full shrink-0" style={{ background: swatch(c.color), border: "1px solid rgba(0,0,0,.2)" }} />
                              {c.product.name} · {c.color}
                            </p>
                            <p className="text-[13px] font-semibold mt-1 m-0">
                              {Object.entries(sizes).map(([t, n], i) => (
                                <span key={t}>
                                  {i > 0 && " · "}
                                  {t}
                                  <span className="font-medium" style={{ color: "#6F6357" }}> ×{n}</span>
                                </span>
                              ))}
                            </p>
                            <div className="flex justify-between items-center mt-[7px]">
                              <span className="font-bold text-sm" style={{ color: "#4B3621" }}>
                                {fmt(q * c.product.retailPrice)}
                              </span>
                              <button
                                onClick={() =>
                                  setCart((prev) => {
                                    const next = { ...prev };
                                    delete next[c.key];
                                    return next;
                                  })
                                }
                                className="text-xs font-bold underline underline-offset-2"
                                style={{ color: "#4B3621" }}
                              >
                                remover
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}

              <div className="mt-4 pt-3.5" style={{ borderTop: "1.5px solid #4B3621" }}>
                <div className="flex justify-between text-sm mb-1.5 font-medium" style={{ color: "#6F6357" }}>
                  <span>Total de peças</span>
                  <span>{totalPieces}</span>
                </div>
                <div className="flex justify-between font-extrabold text-lg mt-2">
                  <span>Valor estimado</span>
                  <span>{fmt(totalValue)}</span>
                </div>
              </div>

              <div className="rounded-[14px] p-[15px] mt-[18px]" style={{ background: "#F3EDE3" }}>
                <p className="text-[11px] uppercase font-bold mb-3 m-0" style={{ color: "#4B3621", letterSpacing: ".1em" }}>
                  Seus dados
                </p>
                {(
                  [
                    ["loja", "Loja", "Nome da loja"],
                    ["nome", "Nome", "Seu nome"],
                    ["fone", "Telefone", "(00) 00000-0000"],
                  ] as const
                ).map(([key, label, ph]) => (
                  <div key={key} className="mb-[11px]">
                    <label className="block text-[11px] uppercase font-bold mb-1.5" style={{ color: "#4B3621", letterSpacing: ".08em" }}>
                      {label}
                    </label>
                    <input
                      value={client[key]}
                      onChange={(e) => setClient((c) => ({ ...c, [key]: e.target.value }))}
                      placeholder={ph}
                      className="w-full rounded-xl border px-3.5 py-[13px] text-[15px] bg-white outline-none"
                      style={{ borderColor: "#E4D9C8" }}
                    />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        {totalPieces > 0 && (
          <div
            className="border-t px-[18px] pt-3.5"
            style={{ borderColor: "#E4D9C8", background: "#fff", paddingBottom: "calc(16px + env(safe-area-inset-bottom,0))" }}
          >
            {minOrder > 0 && (
              <div className="mb-[13px]">
                <p
                  className="flex items-center gap-2 text-[13.5px] font-bold mb-[9px] m-0"
                  style={{ color: minBlocked ? "#4B3621" : "#1F7A4D" }}
                >
                  {minBlocked
                    ? `Faltam ${minOrder - totalPieces} ${minOrder - totalPieces === 1 ? "peça" : "peças"} para fechar seu pedido`
                    : "Tudo certo! Pedido pronto para enviar"}
                </p>
                <div className="h-2 rounded-md overflow-hidden" style={{ background: "#F3EDE3" }}>
                  <span
                    className="block h-full rounded-md transition-all duration-300"
                    style={{
                      width: `${Math.min(100, Math.round((totalPieces / minOrder) * 100))}%`,
                      background: minBlocked ? "#4B3621" : "#1F7A4D",
                    }}
                  />
                </div>
                <p className="text-[11px] font-semibold mt-[7px] m-0" style={{ color: "#6F6357" }}>
                  {totalPieces} de {minOrder} peças · pedido mínimo
                </p>
              </div>
            )}
            <button
              onClick={sendOrder}
              disabled={minBlocked}
              className="w-full flex items-center justify-center gap-[9px] rounded-[14px] p-4 text-[15px] font-bold active:scale-[0.985] transition disabled:opacity-40"
              style={{ background: "#4B3621", color: "#E7DCCC" }}
            >
              <WaIcon className="size-[19px]" />
              Enviar pedido no WhatsApp
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
