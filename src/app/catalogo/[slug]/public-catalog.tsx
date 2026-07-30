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
import {
  Montserrat,
  Inter,
  Poppins,
  Playfair_Display,
  Lora,
} from "next/font/google";
import { mixHex, readableOn } from "@/lib/color";
import {
  guardarPendente,
  protocolo,
  registrarComInsistencia,
  reenviarPendentes,
} from "@/lib/catalogo/envio-pedido";
import { compareSizes } from "@/lib/sizes";
import { descricaoDaCategoria, sortCategories } from "@/lib/categories";
import {
  CatalogTracker,
  getConsent,
  setConsent,
} from "@/lib/tracking/client";

const montserrat = Montserrat({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });
const poppins = Poppins({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });
const playfair = Playfair_Display({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });
const lora = Lora({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

const FONT_CLASS: Record<string, string> = {
  montserrat: montserrat.className,
  inter: inter.className,
  poppins: poppins.className,
  playfair: playfair.className,
  lora: lora.className,
};

export type CatalogIdentity = {
  logoUrl: string | null;
  primary: string;
  secondary: string;
  bg: string;
  font: string;
};

export type CatalogProduct = {
  id: string;
  name: string;
  sku: string;
  category: string;
  collection: string | null;
  description: string | null;
  retailPrice: number;
  wholesalePrice: number;
  // catálogo de campanha: preço cheio original (aparece riscado)
  originalRetailPrice?: number | null;
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
function makeSwatch(custom: { name: string; hex: string }[]) {
  const map = new Map(custom.map((c) => [c.name.toLowerCase(), c.hex]));
  return (color: string) =>
    map.get(color.toLowerCase()) ??
    COLOR_HEX[color.toLowerCase()] ??
    "#C9BEB0";
}

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

/**
 * Carrossel de fotos da ficha do produto: desliza pro lado (gesto no celular,
 * setas no computador), com contador e bolinhas. Uma foto só = imagem simples.
 * Na FICHA a peça aparece INTEIRA (object-contain num quadro 3:4): a grade usa
 * o corte que preenche, mas quem abriu quer ver a peça completa — sobras de
 * proporção viram faixas na cor de fundo do tema. O quadro é 3:4 de verdade
 * também no computador: a largura acompanha o teto de altura (72dvh) para o
 * quadro nunca "achatar" e cortar a foto.
 */
function PhotoCarousel({
  images,
  alt,
  soft,
  line,
  primary,
  onView,
}: {
  images: string[];
  alt: string;
  soft: string;
  line: string;
  primary: string;
  onView: () => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);

  // 72dvh de altura máxima ⇒ largura máxima = 72dvh × 3/4 (quadro 3:4 íntegro)
  const frameW = "min(100%, calc(72dvh * 3 / 4))";
  const imgStyle: React.CSSProperties = {
    aspectRatio: "3/4",
    objectFit: "contain",
    background: soft,
  };

  if (images.length <= 1) {
    return (
      <img
        onClick={onView}
        src={images[0]}
        alt={alt}
        className="block mx-auto w-full rounded-[14px] border"
        style={{ ...imgStyle, maxWidth: frameW, borderColor: line }}
      />
    );
  }

  const go = (i: number) => {
    const el = trackRef.current;
    if (!el) return;
    const clamped = Math.min(images.length - 1, Math.max(0, i));
    el.scrollTo({ left: clamped * el.clientWidth, behavior: "smooth" });
  };

  return (
    <div className="relative mx-auto" style={{ maxWidth: frameW }}>
      <div
        ref={trackRef}
        onScroll={() => {
          const el = trackRef.current;
          if (!el) return;
          const i = Math.min(
            images.length - 1,
            Math.max(0, Math.round(el.scrollLeft / el.clientWidth))
          );
          if (i !== idx) setIdx(i);
        }}
        className="flex overflow-x-auto snap-x snap-mandatory no-scrollbar rounded-[14px] border"
        style={{ borderColor: line, background: soft }}
      >
        {images.map((src, i) => (
          <img
            key={`${i}-${src.slice(-24)}`}
            onClick={onView}
            src={src}
            alt={`${alt} — foto ${i + 1}`}
            loading={i === 0 ? "eager" : "lazy"}
            className="w-full shrink-0 snap-center"
            style={imgStyle}
          />
        ))}
      </div>

      {/* setas — só no computador; no celular o gesto de deslizar resolve */}
      <button
        type="button"
        aria-label="Foto anterior"
        onClick={() => go(idx - 1)}
        className="hidden sm:flex absolute left-2.5 top-1/2 -translate-y-1/2 size-9 rounded-full items-center justify-center text-xl font-bold bg-white/90 shadow-md transition"
        style={{ color: primary, opacity: idx === 0 ? 0 : 1, pointerEvents: idx === 0 ? "none" : "auto" }}
      >
        ‹
      </button>
      <button
        type="button"
        aria-label="Próxima foto"
        onClick={() => go(idx + 1)}
        className="hidden sm:flex absolute right-2.5 top-1/2 -translate-y-1/2 size-9 rounded-full items-center justify-center text-xl font-bold bg-white/90 shadow-md transition"
        style={{
          color: primary,
          opacity: idx === images.length - 1 ? 0 : 1,
          pointerEvents: idx === images.length - 1 ? "none" : "auto",
        }}
      >
        ›
      </button>

      <span className="absolute top-2.5 right-2.5 rounded-full bg-black/50 text-white text-[11px] font-semibold px-2 py-0.5 tabular-nums">
        {idx + 1}/{images.length}
      </span>

      <div className="absolute bottom-2.5 inset-x-0 flex justify-center gap-1.5">
        {images.map((_, i) => (
          <button
            key={i}
            type="button"
            aria-label={`Ir para a foto ${i + 1}`}
            onClick={() => go(i)}
            className="size-2 rounded-full transition"
            style={{
              background: i === idx ? "#fff" : "rgba(255,255,255,.55)",
              boxShadow: "0 0 4px rgba(0,0,0,.45)",
              transform: i === idx ? "scale(1.25)" : "scale(1)",
            }}
          />
        ))}
      </div>
    </div>
  );
}

const BagIcon = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
    <path d="M3 6h18" />
    <path d="M16 10a4 4 0 0 1-8 0" />
  </svg>
);

export function PublicCatalog({
  storeSlug,
  storeName,
  tagline,
  whatsapp,
  minOrder,
  minOrderMode,
  minOrderValue,
  products,
  categoryOrder = [],
  categoryDescriptions = {},
  promo = null,
  identity,
  logoSize = "normal",
  customColors,
  tracking,
}: {
  storeSlug: string;
  storeName: string;
  tagline: string | null;
  whatsapp: string | null;
  minOrder: number;
  minOrderMode: "NONE" | "PECAS" | "VALOR";
  minOrderValue: number;
  products: CatalogProduct[];
  categoryOrder?: string[];
  /** texto escrito pela lojista para cada categoria (Produtos → Categorias) */
  categoryDescriptions?: Record<string, string>;
  // catálogo de campanha: nome + % de desconto (preços já vêm com desconto)
  promo?: { name: string; slug: string; discount: number } | null;
  identity: CatalogIdentity;
  logoSize?: "normal" | "grande";
  customColors: { name: string; hex: string }[];
  tracking: Record<string, string | null>;
}) {
  // Tema 100% personalizável pelo lojista: 3 cores base + derivadas
  const T = {
    primary: identity.primary,
    secondary: identity.secondary,
    bg: identity.bg,
    ink: readableOn(identity.bg),
    line: mixHex(identity.secondary, identity.primary, 0.06),
    soft: mixHex(identity.secondary, identity.bg, 0.55),
    muted: mixHex(identity.primary, identity.bg, 0.38),
    dark: mixHex(identity.primary, "#000000", 0.45),
  };
  const swatch = makeSwatch(customColors);
  const fontClass = FONT_CLASS[identity.font] ?? FONT_CLASS.montserrat;

  // a ordem das categorias (menu e seções) é escolhida pelo lojista em
  // Personalizar catálogo; as que ficarem fora da lista vão para o fim
  const categories = useMemo(
    () => sortCategories([...new Set(products.map((p) => p.category))], categoryOrder),
    [products, categoryOrder]
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
          // tamanhos sempre do menor para o maior (P, M, G, GG / 36, 38, 40)
          sizes: p.variants
            .filter((v) => v.color === color)
            .map((v) => ({ size: v.size, available: v.available }))
            .sort((a, b) => compareSizes(a.size, b.size)),
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

  // ---- Sacola persistente: sobrevive a sair do catálogo e voltar ----------
  // Guardada NO APARELHO do cliente (localStorage), separada por loja e por
  // campanha (preços diferem). Expira em 7 dias; itens que saíram do catálogo
  // são descartados na volta. Os dados do cliente também voltam preenchidos.
  const storeKey = `ap-sacola:${storeSlug}${promo ? `:${promo.slug}` : ""}`;
  const clientKey = `ap-cliente:${storeSlug}`;
  const cartLoadedRef = useRef(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storeKey);
      if (raw) {
        const saved = JSON.parse(raw) as { at?: number; cart?: Cart };
        const fresh = saved.at && Date.now() - saved.at < 7 * 24 * 60 * 60 * 1000;
        if (fresh && saved.cart) {
          const validKeys = new Set(allCards.map((c) => c.key));
          const restored: Cart = {};
          for (const [key, sizes] of Object.entries(saved.cart)) {
            if (!validKeys.has(key)) continue;
            const clean = Object.fromEntries(
              Object.entries(sizes).filter(
                ([, q]) => Number.isInteger(q) && (q as number) > 0
              )
            );
            if (Object.keys(clean).length) restored[key] = clean as Record<string, number>;
          }
          if (Object.keys(restored).length) setCart(restored);
        }
      }
      const rawClient = localStorage.getItem(clientKey);
      if (rawClient) {
        const c = JSON.parse(rawClient) as { loja?: string; nome?: string; fone?: string };
        setClient({ loja: c.loja ?? "", nome: c.nome ?? "", fone: c.fone ?? "" });
      }
    } catch {}
    cartLoadedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!cartLoadedRef.current) return;
    try {
      if (Object.keys(cart).length === 0) localStorage.removeItem(storeKey);
      else localStorage.setItem(storeKey, JSON.stringify({ at: Date.now(), cart }));
    } catch {}
  }, [cart, storeKey]);
  useEffect(() => {
    if (!cartLoadedRef.current) return;
    try {
      if (client.loja || client.nome || client.fone)
        localStorage.setItem(clientKey, JSON.stringify(client));
    } catch {}
  }, [client, clientKey]);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const catNavRef = useRef<HTMLDivElement | null>(null);
  const [catArrows, setCatArrows] = useState({ left: false, right: false });
  // mede a altura real do cabeçalho (varia conforme o logo) para que a barra
  // de categorias grude logo abaixo e o scroll das seções fique correto —
  // assim o cabeçalho pode "abraçar" o logo, com altura mínima.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const catNavBarRef = useRef<HTMLElement | null>(null);

  // ---- Tracking Engine (Inteligência Comercial) ----
  const trackerRef = useRef<CatalogTracker | null>(null);
  const [showConsent, setShowConsent] = useState(false);
  const orderSentRef = useRef(false);
  const cartRef = useRef({ pieces: 0, value: 0 });

  // ---- Registro do pedido: nunca perder uma venda ----
  // "enviando" enquanto o servidor não confirma; "erro" quando nem
  // insistindo deu — a cliente vê, e o pedido fica guardado para a próxima
  // vez que ela abrir o catálogo.
  const [envio, setEnvio] = useState<"parado" | "enviando" | "ok" | "erro">("parado");

  // Rede de segurança: ao abrir o catálogo, reenvia pedido que ficou para
  // trás numa visita anterior (internet caiu no momento do envio).
  useEffect(() => {
    if (typeof window === "undefined") return;
    reenviarPendentes({ storage: window.localStorage }).catch(() => {});
  }, []);
  const t = (e: Parameters<CatalogTracker["track"]>[0]) =>
    trackerRef.current?.track(e);

  useEffect(() => {
    trackerRef.current = new CatalogTracker(storeSlug);
    const consent = getConsent();
    if (consent === "granted") {
      trackerRef.current.start(tracking.ref, tracking);
    } else if (consent === null) {
      setShowConsent(true);
    }
    const onHide = () => {
      if (cartRef.current.pieces > 0 && !orderSentRef.current) {
        trackerRef.current?.track({
          type: "order_abandoned",
          value: cartRef.current.value,
          qty: cartRef.current.pieces,
        });
        trackerRef.current?.flush(true);
      }
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      trackerRef.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalPieces = Object.values(cart).reduce((a, s) => a + sum(s), 0);
  const totalValue = Object.entries(cart).reduce((acc, [key, sizes]) => {
    const card = allCards.find((c) => c.key === key);
    return card ? acc + sum(sizes) * card.product.retailPrice : acc;
  }, 0);

  useEffect(() => {
    cartRef.current = { pieces: totalPieces, value: totalValue };
  }, [totalPieces, totalValue]);

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
            setActiveCat((prev) => {
              if (prev !== idx && categories[idx]) {
                trackerRef.current?.track({
                  type: "category_view",
                  category: categories[idx],
                });
              }
              return idx;
            });
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

  /* setas ‹ › da barra de categorias — só aparecem quando há o que rolar */
  const syncCatArrows = () => {
    const el = catNavRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setCatArrows({ left: el.scrollLeft > 4, right: el.scrollLeft < max - 4 });
  };
  useEffect(() => {
    syncCatArrows();
    window.addEventListener("resize", syncCatArrows);
    return () => window.removeEventListener("resize", syncCatArrows);
  }, [categories]);

  // altura do cabeçalho + barra de categorias → CSS vars (para sticky/scroll)
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const update = () => {
      const hh = headerRef.current?.offsetHeight ?? 0;
      const nh = catNavBarRef.current?.offsetHeight ?? 0;
      root.style.setProperty("--cat-hdr", `${hh}px`);
      root.style.setProperty("--cat-sticky", `${hh + nh}px`);
    };
    update();
    const ro = new ResizeObserver(update);
    if (headerRef.current) ro.observe(headerRef.current);
    if (catNavBarRef.current) ro.observe(catNavBarRef.current);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [logoSize, identity.logoUrl]);

  // Sacola/ficha aberta: TRAVA a rolagem da página de fundo. Sem isso, o
  // teclado do iOS "empurra" a página inteira e o catálogo vaza por trás da
  // folha — bagunça visual na hora de fechar a compra.
  useEffect(() => {
    const anyOpen = bagOpen || !!sheet;
    if (!anyOpen) return;
    const y = window.scrollY;
    const b = document.body.style;
    const prev = {
      position: b.position,
      top: b.top,
      left: b.left,
      right: b.right,
      overflow: b.overflow,
    };
    b.position = "fixed";
    b.top = `-${y}px`;
    b.left = "0";
    b.right = "0";
    b.overflow = "hidden";
    return () => {
      b.position = prev.position;
      b.top = prev.top;
      b.left = prev.left;
      b.right = prev.right;
      b.overflow = prev.overflow;
      window.scrollTo(0, y);
    };
  }, [bagOpen, sheet]);
  const scrollCats = (dir: 1 | -1) => {
    const el = catNavRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(el.clientWidth * 0.75, 200), behavior: "smooth" });
  };

  function openSheet(card: CardItem) {
    t({
      type: "product_view",
      productId: card.product.id,
      productName: card.product.name,
      category: card.product.category,
      color: card.color,
    });
    t({ type: "color_select", color: card.color, productId: card.product.id });
    const existing = cart[card.key] ?? {};
    const d: Record<string, number> = {};
    for (const s of card.sizes) d[s.size] = existing[s.size] ?? 0;
    setDraft(d);
    setSheet(card);
  }
  function closeSheet() {
    setSheet(null);
  }
  function openBag() {
    t({ type: "cart_open", value: totalValue, qty: totalPieces });
    setBagOpen(true);
  }
  function closeBag() {
    t({ type: "cart_close", value: totalValue, qty: totalPieces });
    setBagOpen(false);
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
    const price = sheet.product.retailPrice;
    const prevQty = cart[sheet.key] ? sum(cart[sheet.key]) : 0;
    const newQty = sum(clean);
    const newTotal = totalValue - prevQty * price + newQty * price;
    t({
      type: newQty >= prevQty ? "cart_add" : "cart_remove",
      productId: sheet.product.id,
      productName: sheet.product.name,
      category: sheet.product.category,
      color: sheet.color,
      size: Object.keys(clean).join(","),
      qty: Math.abs(newQty - prevQty) || newQty,
      value: newTotal,
    });
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
    t({ type: "checkout_start", value: totalValue, qty: totalPieces });
    if (minOrderMode === "PECAS" && totalPieces < minOrder) {
      const falta = minOrder - totalPieces;
      showToast(`Faltam ${falta} ${falta === 1 ? "peça" : "peças"} para o mínimo de ${minOrder}`);
      return;
    }
    if (minOrderMode === "VALOR" && totalValue < minOrderValue) {
      showToast(`Faltam ${fmt(minOrderValue - totalValue)} para o pedido mínimo de ${fmt(minOrderValue)}`);
      return;
    }
    // Nome e telefone são obrigatórios: o telefone é a identificação do
    // cliente (puxa o cadastro existente na base da loja, se houver).
    const foneDigits = client.fone.replace(/\D/g, "");
    if (!client.nome.trim() || foneDigits.length < 10) {
      openBag();
      showToast("Preencha seu nome e telefone (com DDD) para enviar o pedido");
      return;
    }
    let msg = `*Novo pedido — ${storeName}*\n`;
    if (promo) msg += `_Campanha: ${promo.name} (${promo.discount}% OFF)_\n`;
    msg += `\n`;
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

    // pedido enviado: limpa a sacola salva no aparelho (uma visita futura
    // começa limpa; a sacola na tela permanece até a página fechar)
    try {
      localStorage.removeItem(storeKey);
    } catch {}

    // Tracking Engine: conversão + unificação do visitante anônimo
    orderSentRef.current = true;
    t({ type: "order_submitted", value: totalValue, qty: totalPieces });
    trackerRef.current?.flush(true);
    if (client.fone.replace(/\D/g, "").length >= 8) {
      trackerRef.current?.identify(client.fone);
    }

    // O pedido também é registrado no CRM da loja (tela Pedidos), SEMPRE —
    // mesmo sem dados do cliente. Com telefone, entra ainda como lead
    // (conversa + oportunidade) via Lead Intake Engine no servidor.
    const orderItems = allCards
      .filter((c) => cart[c.key])
      .flatMap((c) =>
        Object.entries(cart[c.key]).map(([size, quantity]) => ({
          productId: c.product.id,
          color: c.color,
          size,
          quantity,
        }))
      );
    // PROTOCOLO: o pedido é guardado no aparelho ANTES de sair. Se o envio
    // falhar, o catálogo insiste — e ainda tenta de novo na próxima visita.
    // O protocolo garante que insistir nunca cria o pedido duas vezes.
    const pendente = {
      clientRef: protocolo(),
      at: Date.now(),
      tentativas: 0,
      payload: {
        company: storeSlug,
        items: orderItems,
        customer: {
          name: client.nome || undefined,
          phone: client.fone || undefined,
          store: client.loja || undefined,
        },
        message: msg,
        // atribuição do link rastreado: vendedor (?ref) e cliente (?c)
        ref: tracking.ref || undefined,
        c: tracking.c || undefined,
        // campanha: o servidor recalcula os preços com o desconto dela
        promo: promo?.slug || undefined,
      } as Record<string, unknown>,
    };
    pendente.payload.clientRef = pendente.clientRef;
    if (typeof window !== "undefined") {
      guardarPendente(window.localStorage, pendente);
      setEnvio("enviando");
      registrarComInsistencia(pendente, { storage: window.localStorage })
        .then((ok) => setEnvio(ok ? "ok" : "erro"))
        .catch(() => setEnvio("erro"));
    }

    // O WhatsApp abre na mesma hora, como sempre: o registro acontece por
    // trás. Segurar a abertura aqui faria o navegador do celular bloquear a
    // janela (ela só abre no toque da cliente).
    const url = `https://wa.me/${whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank") ?? (window.location.href = url);
  }

  const minActive = minOrderMode === "PECAS" || minOrderMode === "VALOR";
  const minTarget = minOrderMode === "VALOR" ? minOrderValue : minOrder;
  const minCurrent = minOrderMode === "VALOR" ? totalValue : totalPieces;
  const minBlocked = minActive && minCurrent < minTarget;
  const minProgress = minTarget > 0 ? Math.min(100, Math.round((minCurrent / minTarget) * 100)) : 0;
  const minRemainingLabel =
    minOrderMode === "VALOR"
      ? `Faltam ${fmt(minTarget - minCurrent)} para fechar seu pedido`
      : `Faltam ${minTarget - minCurrent} ${minTarget - minCurrent === 1 ? "peça" : "peças"} para fechar seu pedido`;
  const minStatusLabel =
    minOrderMode === "VALOR"
      ? `${fmt(minCurrent)} de ${fmt(minTarget)} · pedido mínimo`
      : `${minCurrent} de ${minTarget} peças · pedido mínimo`;

  return (
    <div
      ref={rootRef}
      className={fontClass}
      style={{ background: T.bg, color: T.ink, minHeight: "100dvh", paddingBottom: 92 }}
    >
      {/* RECIBO DO ENVIO — a cliente enxerga que o pedido foi registrado.
          Antes isso acontecia no escuro: se falhasse, a mensagem chegava no
          WhatsApp da loja e o pedido não existia em lugar nenhum. */}
      {envio !== "parado" && (
        <div
          role="status"
          className="fixed inset-x-0 top-0 z-[60] px-3 pt-3"
          style={{ pointerEvents: "none" }}
        >
          <div
            className="mx-auto max-w-[560px] rounded-xl px-3.5 py-2.5 text-[13px] font-semibold shadow-lg"
            style={{
              background:
                envio === "erro" ? "#fef2f2" : envio === "ok" ? "#ecfdf5" : "#ffffff",
              color: envio === "erro" ? "#9f1239" : envio === "ok" ? "#065f46" : "#334155",
              border: `1px solid ${envio === "erro" ? "#fecdd3" : envio === "ok" ? "#a7f3d0" : "#e2e8f0"}`,
            }}
          >
            {envio === "enviando" && "Registrando seu pedido na loja…"}
            {envio === "ok" && "✓ Pedido registrado! A loja já está com ele."}
            {envio === "erro" &&
              "Seu pedido foi para o WhatsApp, mas não conseguimos registrar na loja. Confirme com a vendedora pelo WhatsApp, por favor."}
          </div>
        </div>
      )}

      {/* TOPBAR */}
      <header ref={headerRef} className="sticky top-0 z-40" style={{ background: T.primary }}>
        {logoSize === "grande" && identity.logoUrl ? (
          // Logo grande centralizado. O cabeçalho "abraça" o logo (altura mínima):
          // o logo ocupa a largura e a altura acompanha, sem sobra de fundo.
          // Layout em flex com espaçador à esquerda (= largura da sacola) para o
          // logo centralizar sem NUNCA sobrepor o botão da sacola.
          <div className="max-w-[680px] lg:max-w-[1200px] mx-auto px-[18px] py-2 lg:py-2.5 flex items-center gap-3">
            <span className="w-[46px] shrink-0" aria-hidden />
            {/* cabeçalho compacto: o logo fica em destaque sem roubar espaço
                das peças (celular 88px, computador 96px) */}
            <img
              src={identity.logoUrl}
              alt={storeName}
              className="flex-1 min-w-0 object-contain max-h-[88px] lg:max-h-[96px]"
            />
            <button
              onClick={openBag}
              aria-label="Abrir pedido"
              className="relative flex items-center justify-center size-[46px] rounded-full shrink-0 active:scale-95 transition"
              style={{ background: T.secondary, color: T.primary }}
            >
              <BagIcon className="size-5" />
              {totalPieces > 0 && (
                <span
                  className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full text-[11px] font-bold flex items-center justify-center"
                  style={{ background: T.dark, color: T.secondary, border: `2px solid ${T.primary}` }}
                >
                  {totalPieces}
                </span>
              )}
            </button>
          </div>
        ) : (
          <div className="max-w-[680px] lg:max-w-[1200px] mx-auto px-[18px] py-3.5 flex items-center justify-between gap-3">
            <div className="leading-none min-w-0">
              {identity.logoUrl ? (
                <img
                  src={identity.logoUrl}
                  alt={storeName}
                  className="h-9 max-w-44 object-contain"
                />
              ) : (
                <p
                  className="font-extrabold text-[23px] lowercase truncate"
                  style={{ color: T.secondary, letterSpacing: ".02em" }}
                >
                  {storeName}
                </p>
              )}
            </div>
            <button
              onClick={openBag}
              aria-label="Abrir pedido"
              className="relative flex items-center justify-center size-[46px] rounded-full shrink-0 active:scale-95 transition"
              style={{ background: T.secondary, color: T.primary }}
            >
              <BagIcon className="size-5" />
              {totalPieces > 0 && (
                <span
                  className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full text-[11px] font-bold flex items-center justify-center"
                  style={{ background: T.dark, color: T.secondary, border: `2px solid ${T.primary}` }}
                >
                  {totalPieces}
                </span>
              )}
            </button>
          </div>
        )}
      </header>

      {/* FAIXA DA CAMPANHA — desconto já aplicado nos preços */}
      {promo && (
        <div
          className="text-center px-[18px] py-2"
          style={{ background: T.primary, color: T.secondary }}
        >
          <p className="text-[13px] font-extrabold uppercase tracking-wide m-0">
            🏷 {promo.name} — {promo.discount}% OFF
          </p>
          <p className="text-[10.5px] font-medium m-0 opacity-80">
            desconto já aplicado em todos os preços deste catálogo
          </p>
        </div>
      )}

      {/* COMO FUNCIONA — passo a passo visual (orienta o cliente final).
          Celular: 3 passos dividindo a largura (como sempre foi).
          Computador: linha compacta e centralizada com setas (1 › 2 › 3) —
          esticar os passos na tela larga deixava buracos sem sentido. */}
      <section className="max-w-[680px] lg:max-w-[1200px] mx-auto px-[18px] pt-2.5 pb-2">
        <div className="flex items-center gap-2 sm:gap-3 lg:justify-center lg:gap-3.5">
          {[
            { n: 1, label: "Escolha as peças" },
            { n: 2, label: "Monte a sacola" },
            { n: 3, label: "Envie no WhatsApp" },
          ].map((s) => (
            <div key={s.n} className="flex items-center gap-2 flex-1 lg:flex-none min-w-0">
              {s.n > 1 && (
                <span
                  className="hidden lg:inline text-sm font-bold mr-1.5"
                  style={{ color: T.muted }}
                  aria-hidden
                >
                  ›
                </span>
              )}
              <span
                className="shrink-0 size-[22px] rounded-full flex items-center justify-center text-[12px] font-bold"
                style={{ background: T.primary, color: T.secondary }}
              >
                {s.n}
              </span>
              <span
                className="text-[12px] sm:text-[13px] font-semibold leading-[1.1]"
                style={{ color: T.primary }}
              >
                {s.label}
              </span>
            </div>
          ))}
        </div>
        {tagline && (
          <p
            className="mt-1.5 text-[11px] font-medium leading-tight lg:text-center"
            style={{ color: T.muted }}
          >
            {tagline}
          </p>
        )}
      </section>

      {/* BARRA DE MODELOS */}
      <nav
        ref={catNavBarRef}
        className="sticky z-30 border-b"
        style={{
          // gruda logo abaixo do cabeçalho, cuja altura é medida em runtime
          top: logoSize === "grande" ? "var(--cat-hdr, 140px)" : 74,
          background: T.bg,
          borderColor: T.line,
          boxShadow: "0 6px 12px -10px rgba(0,0,0,.3)",
        }}
      >
        <div className="relative max-w-[680px] lg:max-w-[1200px] mx-auto">
          {/* seta esquerda */}
          {catArrows.left && (
            <button
              type="button"
              aria-label="Categorias anteriores"
              onClick={() => scrollCats(-1)}
              className="hidden md:flex items-center justify-center absolute left-1 top-1/2 -translate-y-1/2 z-10 size-7 rounded-full shadow-sm border transition"
              style={{ background: T.bg, color: T.primary, borderColor: T.line }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
            </button>
          )}
          {/* fade nas bordas para indicar continuação */}
          {catArrows.left && (
            <span className="hidden md:block pointer-events-none absolute left-0 top-0 bottom-0 w-10 z-[5]" style={{ background: `linear-gradient(90deg, ${T.bg}, transparent)` }} />
          )}
          {catArrows.right && (
            <span className="hidden md:block pointer-events-none absolute right-0 top-0 bottom-0 w-10 z-[5]" style={{ background: `linear-gradient(270deg, ${T.bg}, transparent)` }} />
          )}
          <div
            ref={catNavRef}
            onScroll={syncCatArrows}
            className="flex gap-2 overflow-x-auto px-[18px] py-[5px]"
            style={{ scrollbarWidth: "none" }}
          >
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
                      ? { background: T.primary, color: T.secondary, borderColor: T.primary }
                      : { background: T.bg, color: T.primary, borderColor: T.line }
                  }
                >
                  {cat}
                  {has && (
                    <span
                      className="size-[7px] rounded-full"
                      style={{ background: active ? T.secondary : T.primary }}
                    />
                  )}
                </button>
              );
            })}
          </div>
          {/* seta direita */}
          {catArrows.right && (
            <button
              type="button"
              aria-label="Próximas categorias"
              onClick={() => scrollCats(1)}
              className="hidden md:flex items-center justify-center absolute right-1 top-1/2 -translate-y-1/2 z-10 size-7 rounded-full shadow-sm border transition"
              style={{ background: T.bg, color: T.primary, borderColor: T.line }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
            </button>
          )}
        </div>
      </nav>

      {/* SEÇÕES */}
      <main>
        {categories.map((cat, i) => {
          const cards = cardsByCategory.get(cat) ?? [];
          // Texto da CATEGORIA (escrito em Produtos → Categorias). Sem texto
          // salvo, cai no antigo: a descrição do primeiro produto — assim
          // nenhuma loja perde o que já aparecia hoje.
          const firstDesc =
            descricaoDaCategoria(categoryDescriptions, cat) ||
            cards[0]?.product.description;
          return (
            <section
              key={cat}
              data-step={i}
              ref={(el) => {
                sectionRefs.current[cat] = el;
              }}
              className="pb-2.5"
              style={{
                scrollMarginTop:
                  logoSize === "grande" ? "var(--cat-sticky, 200px)" : 140,
              }}
            >
              <div className="max-w-[680px] lg:max-w-[1200px] mx-auto px-[18px] pt-[10px]">
                <div className="flex items-baseline justify-between gap-2.5 mb-1">
                  <h2 className="font-extrabold text-[20px] uppercase m-0" style={{ letterSpacing: "-.01em" }}>
                    {cat}
                  </h2>
                  <span className="text-xs font-bold whitespace-nowrap" style={{ color: T.muted }}>
                    {cards.length} {cards.length === 1 ? "opção" : "opções"}
                  </span>
                </div>
                {firstDesc && (
                  <p className="m-0 text-[13px] font-medium leading-normal" style={{ color: T.muted }}>
                    {firstDesc}
                  </p>
                )}
              </div>
              <div className="max-w-[680px] lg:max-w-[1200px] mx-auto mt-3.5" style={{ borderTop: `1.5px dashed ${T.line}` }} />

              <div className="max-w-[680px] lg:max-w-[1200px] mx-auto grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3.5 px-3.5 pt-4 pb-2">
                {cards.map((card) => {
                  const inCart = cart[card.key] ? sum(cart[card.key]) : 0;
                  const soldOut = card.sizes.every((s) => !s.available);
                  return (
                    <button
                      key={card.key}
                      onClick={() => openSheet(card)}
                      className="relative text-left rounded-[14px] overflow-hidden flex flex-col active:scale-[0.985] transition border"
                      style={{ borderColor: T.line, background: T.bg }}
                    >
                      {inCart > 0 && (
                        <span
                          className="absolute top-2 right-2 z-10 min-w-[22px] h-[22px] px-1.5 rounded-xl text-[11px] font-bold flex items-center justify-center"
                          style={{ background: T.primary, color: T.secondary, boxShadow: "0 1px 4px rgba(0,0,0,.25)" }}
                        >
                          {inCart}
                        </span>
                      )}
                      <div className="w-full overflow-hidden relative" style={{ aspectRatio: "3/4", background: T.soft }}>
                        {card.product.images[0] && (
                          <img
                            src={card.product.images[0]}
                            alt={`${card.product.name} ${card.color}`}
                            loading="lazy"
                            decoding="async"
                            className="w-full h-full object-cover object-top"
                            style={
                              soldOut
                                ? { filter: "grayscale(1) opacity(.6)" }
                                : undefined
                            }
                          />
                        )}
                        {soldOut && (
                          <span className="absolute inset-0 flex items-center justify-center">
                            <span className="rounded-full bg-gray-800/80 text-white text-[11px] font-bold px-3.5 py-1.5 uppercase tracking-wide">
                              Indisponível
                            </span>
                          </span>
                        )}
                      </div>
                      <div className="px-3 pt-[11px] pb-[13px]">
                        <p className="text-[10px] uppercase font-semibold m-0" style={{ color: T.muted, letterSpacing: ".12em" }}>
                          {card.product.name}
                        </p>
                        <p className="text-[15px] font-bold my-1 flex items-center gap-[7px] leading-tight">
                          <span
                            className="size-3.5 rounded-full shrink-0"
                            style={{ background: swatch(card.color), border: "1px solid rgba(0,0,0,.2)" }}
                          />
                          {card.color}
                        </p>
                        <p className="text-[15px] font-bold m-0" style={{ color: T.primary }}>
                          {promo && card.product.originalRetailPrice ? (
                            <>
                              <s className="text-[12px] font-medium mr-1.5" style={{ color: T.muted }}>
                                {fmt(card.product.originalRetailPrice)}
                              </s>
                              {fmt(card.product.retailPrice)}
                            </>
                          ) : (
                            fmt(card.product.retailPrice)
                          )}{" "}
                          <small className="text-[11px] font-medium" style={{ color: T.muted }}>
                            / peça
                          </small>
                        </p>
                        {soldOut && (
                          <p className="text-[11px] font-semibold mt-1 m-0" style={{ color: "#B33939" }}>
                            Indisponível — consulte reposição
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
      <footer style={{ background: T.primary, color: T.secondary }}>
        <div className="max-w-[680px] lg:max-w-[1200px] mx-auto px-5 pt-[30px] pb-[34px] text-center">
          {identity.logoUrl ? (
            <img
              src={identity.logoUrl}
              alt={storeName}
              className="h-10 max-w-48 object-contain mx-auto mb-3.5"
            />
          ) : (
            <p className="font-extrabold text-[22px] lowercase m-0 mb-3.5" style={{ letterSpacing: ".02em" }}>
              {storeName}
            </p>
          )}
          {whatsapp && (
            <p className="text-[13px] font-medium opacity-90 m-0 mb-1 flex items-center justify-center gap-[7px]">
              <WaIcon className="size-[15px]" />
              Pedidos: +{whatsapp.replace(/\D/g, "")}
            </p>
          )}
          <p className="text-[11px] opacity-60 mt-4 m-0 font-medium">
            © {new Date().getFullYear()} {storeName}
          </p>
          {/* Powered by: cada catálogo divulga a plataforma — quem clicar cai
              na landing e vira lead, marcado com a loja de origem (utm) */}
          <a
            href={`/?utm_source=catalogo&utm_medium=powered-by&utm_campaign=${encodeURIComponent(storeSlug)}`}
            target="_blank"
            rel="noopener"
            className="inline-block text-[11px] font-semibold mt-1.5 opacity-75 hover:opacity-100 underline underline-offset-2 transition"
          >
            ⚡ Feito com AtacadoPro — crie o catálogo da sua marca
          </a>
        </div>
      </footer>

      {/* BARRA FIXA — celular/tablet: barra cheia no rodapé (como sempre) */}
      <div
        className="lg:hidden fixed inset-x-0 bottom-0 z-20 border-t"
        style={{ background: T.bg, borderColor: T.line, padding: "12px 18px calc(12px + env(safe-area-inset-bottom,0))" }}
      >
        <div className="max-w-[680px] mx-auto">
          <button
            onClick={totalPieces > 0 ? sendOrder : openBag}
            className="w-full flex items-center justify-center gap-[9px] rounded-[14px] p-4 text-[15px] font-bold active:scale-[0.985] transition"
            style={{ background: T.primary, color: T.secondary, letterSpacing: ".01em" }}
          >
            <WaIcon className="size-[19px]" />
            Enviar pedido pelo WhatsApp
            {totalPieces > 0 && (
              <span
                className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-[7px] rounded-xl text-xs font-extrabold ml-[3px]"
                style={{ background: T.secondary, color: T.primary }}
              >
                {totalPieces}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* COMPUTADOR: botão flutuante discreto no canto — não cobre o catálogo;
          fica levemente translúcido e ganha destaque ao passar o mouse */}
      <div className="hidden lg:block fixed right-6 bottom-6 z-20">
        <button
          onClick={totalPieces > 0 ? sendOrder : openBag}
          className="flex items-center gap-2.5 rounded-full pl-4 pr-5 py-3.5 text-[14px] font-bold shadow-xl opacity-75 hover:opacity-100 hover:scale-[1.04] active:scale-[0.98] transition-all"
          style={{ background: T.primary, color: T.secondary, letterSpacing: ".01em" }}
        >
          <WaIcon className="size-5" />
          Enviar pedido
          {totalPieces > 0 && (
            <span
              className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-[7px] rounded-xl text-xs font-extrabold"
              style={{ background: T.secondary, color: T.primary }}
            >
              {totalPieces}
            </span>
          )}
        </button>
      </div>

      {/* CONSENTIMENTO (LGPD) — cookies/rastreamento opcionais */}
      {showConsent && (
        <div
          className="fixed inset-x-3 z-[90] rounded-2xl p-3.5 flex flex-col sm:flex-row sm:items-center gap-2.5"
          style={{ bottom: 88, background: T.dark, color: "#fff", boxShadow: "0 8px 30px rgba(0,0,0,.35)" }}
        >
          <p className="text-[12px] leading-snug flex-1 m-0 opacity-90">
            Usamos dados de navegação para melhorar sua experiência e ajudar a
            loja a te atender melhor. Você aceita? (LGPD — nenhum dado pessoal
            é coletado sem o seu consentimento)
          </p>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => {
                setConsent("denied");
                setShowConsent(false);
              }}
              className="rounded-xl px-3.5 py-2 text-xs font-semibold border border-white/30"
            >
              Recusar
            </button>
            <button
              onClick={() => {
                setConsent("granted");
                setShowConsent(false);
                trackerRef.current?.start(tracking.ref, tracking);
              }}
              className="rounded-xl px-4 py-2 text-xs font-bold"
              style={{ background: T.secondary, color: T.primary }}
            >
              Aceitar
            </button>
          </div>
        </div>
      )}

      {/* TOAST */}
      <div
        className="fixed left-1/2 z-[80] flex items-center gap-2 rounded-[30px] px-5 py-3 text-[13px] font-semibold whitespace-nowrap transition-all duration-200 pointer-events-none"
        style={{
          bottom: 108,
          background: T.primary,
          color: T.secondary,
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
          background: T.bg,
          borderRadius: "22px 22px 0 0",
          maxHeight: "calc(88dvh - var(--kb, 0px))",
          bottom: "var(--kb, 0px)", // sobe acima do teclado no celular
          boxShadow: "0 -10px 40px rgba(0,0,0,.22)",
          transform: sheet ? "translateY(0)" : "translateY(100%)",
        }}
      >
        {sheet && (
          <>
            <div className="w-[38px] h-1 rounded mx-auto mt-2.5" style={{ background: T.line }} />
            <div className="flex items-center justify-between px-[18px] pt-2 pb-3 border-b" style={{ borderColor: T.line }}>
              <h3 className="font-extrabold text-lg uppercase m-0" style={{ color: T.primary }}>
                {sheet.product.name}
              </h3>
              <button
                onClick={closeSheet}
                aria-label="Fechar"
                className="size-10 rounded-full flex items-center justify-center text-xl shrink-0"
                style={{ background: T.secondary, color: T.primary, border: `1.5px solid ${T.line}` }}
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto p-[18px]">
              {sheet.product.images[0] && (
                <PhotoCarousel
                  key={sheet.key}
                  images={sheet.product.images}
                  alt={sheet.product.name}
                  soft={T.soft}
                  line={T.line}
                  primary={T.primary}
                  onView={() =>
                    t({ type: "image_zoom", productId: sheet.product.id, productName: sheet.product.name })
                  }
                />
              )}
              <p className="text-[10px] uppercase font-semibold mt-4 mb-0" style={{ color: T.muted, letterSpacing: ".14em" }}>
                {sheet.product.sku} · {sheet.product.category}
              </p>
              <p className="font-extrabold text-[21px] uppercase mt-1 mb-2.5">{sheet.product.name}</p>
              <span
                className="inline-flex items-center gap-2 rounded-[30px] px-3.5 py-[7px] text-[13px] font-bold"
                style={{ background: T.soft, border: `1px solid ${T.line}`, color: T.primary }}
              >
                <span className="size-[15px] rounded-full" style={{ background: swatch(sheet.color), border: "1px solid rgba(0,0,0,.2)" }} />
                Cor: {sheet.color}
              </span>
              {sheet.product.description && (
                <p className="text-sm font-medium leading-relaxed mt-3.5 mb-1" style={{ color: T.muted }}>
                  {sheet.product.description}
                </p>
              )}
              <p className="text-xl font-extrabold my-3.5" style={{ color: T.primary }}>
                {promo && sheet.product.originalRetailPrice ? (
                  <>
                    <s className="text-sm font-medium mr-2" style={{ color: T.muted }}>
                      {fmt(sheet.product.originalRetailPrice)}
                    </s>
                    {fmt(sheet.product.retailPrice)}{" "}
                    <span
                      className="align-middle ml-1 rounded-full px-2 py-0.5 text-[11px] font-bold"
                      style={{ background: T.primary, color: T.secondary }}
                    >
                      -{promo.discount}%
                    </span>
                  </>
                ) : (
                  fmt(sheet.product.retailPrice)
                )}{" "}
                <small className="text-xs font-medium" style={{ color: T.muted }}>/ peça</small>
              </p>
              {sheet.product.wholesalePrice > 0 && sheet.product.minQuantity > 1 && (
                <p className="text-xs font-semibold -mt-2 mb-3.5" style={{ color: T.muted }}>
                  💼 Atacado: {fmt(sheet.product.wholesalePrice)} / peça a partir de {sheet.product.minQuantity} unidades
                </p>
              )}
              <p className="text-[11px] uppercase font-bold mb-2.5" style={{ color: T.muted, letterSpacing: ".14em" }}>
                Tamanhos · quantidade
              </p>
              <div className="flex flex-col gap-[9px]">
                {sheet.sizes.map(({ size, available }) => (
                  <div
                    key={size}
                    className="flex items-center justify-between rounded-xl border py-[9px] pl-3.5 pr-2.5"
                    style={{ borderColor: T.line, opacity: available ? 1 : 0.45 }}
                  >
                    <span className="font-bold text-[15px] min-w-[46px]">
                      {size}
                      {!available && (
                        <small className="block text-[10px] font-semibold" style={{ color: "#B33939" }}>
                          esgotado
                        </small>
                      )}
                    </span>
                    <div className="flex items-center gap-0.5 rounded-[10px] p-[3px]" style={{ background: T.soft }}>
                      <button
                        disabled={!available}
                        onClick={() => {
                          t({ type: "qty_change", size, qty: Math.max(0, (draft[size] ?? 0) - 1), productId: sheet.product.id });
                          setDraft((d) => ({ ...d, [size]: Math.max(0, (d[size] ?? 0) - 1) }));
                        }}
                        className="size-[38px] rounded-lg text-xl font-semibold flex items-center justify-center bg-white border"
                        style={{ borderColor: T.line, color: T.primary }}
                      >
                        −
                      </button>
                      <span className="min-w-[34px] text-center font-bold text-base tabular-nums">
                        {draft[size] ?? 0}
                      </span>
                      <button
                        disabled={!available}
                        onClick={() => {
                          t({
                            type: (draft[size] ?? 0) === 0 ? "size_select" : "qty_change",
                            size,
                            qty: (draft[size] ?? 0) + 1,
                            productId: sheet.product.id,
                          });
                          setDraft((d) => ({ ...d, [size]: (d[size] ?? 0) + 1 }));
                        }}
                        className="size-[38px] rounded-lg text-xl font-semibold flex items-center justify-center bg-white border"
                        style={{ borderColor: T.line, color: T.primary }}
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
              style={{ borderColor: T.line, paddingBottom: "calc(16px + env(safe-area-inset-bottom,0))" }}
            >
              <button
                onClick={addToBag}
                disabled={sum(draft) === 0}
                className="w-full rounded-[14px] p-4 text-[15px] font-bold active:scale-[0.985] transition disabled:opacity-40"
                style={{ background: T.primary, color: T.secondary }}
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
          background: T.bg,
          borderRadius: "22px 22px 0 0",
          maxHeight: "calc(88dvh - var(--kb, 0px))",
          bottom: "var(--kb, 0px)", // sobe acima do teclado no celular
          boxShadow: "0 -10px 40px rgba(0,0,0,.22)",
          transform: bagOpen ? "translateY(0)" : "translateY(100%)",
        }}
      >
        <div className="w-[38px] h-1 rounded mx-auto mt-2.5" style={{ background: T.line }} />
        <div className="flex items-center justify-between px-[18px] pt-2 pb-3 border-b" style={{ borderColor: T.line }}>
          <h3 className="font-extrabold text-lg uppercase m-0" style={{ color: T.primary }}>
            Seu pedido
          </h3>
          <button
            onClick={closeBag}
            aria-label="Fechar"
            className="size-10 rounded-full flex items-center justify-center text-xl shrink-0"
            style={{ background: T.secondary, color: T.primary, border: `1.5px solid ${T.line}` }}
          >
            ✕
          </button>
        </div>
        <div className="overflow-y-auto p-[18px]">
          {totalPieces === 0 ? (
            <p className="text-center text-sm font-medium py-10" style={{ color: T.muted }}>
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
                    <p className="text-[11px] uppercase font-extrabold mt-3.5 mb-0.5" style={{ color: T.primary, letterSpacing: ".12em" }}>
                      {cat}
                    </p>
                    {items.map((c) => {
                      const sizes = cart[c.key];
                      const q = sum(sizes);
                      return (
                        <div
                          key={c.key}
                          className="flex gap-3 py-[13px]"
                          style={{ borderBottom: `1px dashed ${T.line}` }}
                        >
                          {c.product.images[0] && (
                            <img
                              src={c.product.images[0]}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              className="w-[58px] h-[74px] object-cover rounded-[10px] border shrink-0"
                              style={{ borderColor: T.line, background: T.soft }}
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
                                  <span className="font-medium" style={{ color: T.muted }}> ×{n}</span>
                                </span>
                              ))}
                            </p>
                            <div className="flex justify-between items-center mt-[7px]">
                              <span className="font-bold text-sm" style={{ color: T.primary }}>
                                {fmt(q * c.product.retailPrice)}
                              </span>
                              <button
                                onClick={() => {
                                  t({
                                    type: "cart_remove",
                                    productId: c.product.id,
                                    productName: c.product.name,
                                    category: c.product.category,
                                    color: c.color,
                                    qty: q,
                                    value: totalValue - q * c.product.retailPrice,
                                  });
                                  setCart((prev) => {
                                    const next = { ...prev };
                                    delete next[c.key];
                                    return next;
                                  });
                                }}
                                className="text-xs font-bold underline underline-offset-2"
                                style={{ color: T.primary }}
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

              <div className="mt-4 pt-3.5" style={{ borderTop: `1.5px solid ${T.primary}` }}>
                <div className="flex justify-between text-sm mb-1.5 font-medium" style={{ color: T.muted }}>
                  <span>Total de peças</span>
                  <span>{totalPieces}</span>
                </div>
                <div className="flex justify-between font-extrabold text-lg mt-2">
                  <span>Valor estimado</span>
                  <span>{fmt(totalValue)}</span>
                </div>
              </div>

              <div className="rounded-[14px] p-[15px] mt-[18px]" style={{ background: T.soft }}>
                <p className="text-[11px] uppercase font-bold mb-3 m-0" style={{ color: T.primary, letterSpacing: ".1em" }}>
                  Seus dados
                </p>
                {(
                  [
                    ["nome", "Nome *", "Seu nome"],
                    ["fone", "Telefone *", "(00) 00000-0000"],
                    ["loja", "Loja", "Nome da loja (opcional)"],
                  ] as const
                ).map(([key, label, ph]) => (
                  <div key={key} className="mb-[11px]">
                    <label className="block text-[11px] uppercase font-bold mb-1.5" style={{ color: T.primary, letterSpacing: ".08em" }}>
                      {label}
                    </label>
                    <input
                      value={client[key]}
                      onChange={(e) => setClient((c) => ({ ...c, [key]: e.target.value }))}
                      onBlur={() => {
                        // digitou o telefone e parou? já identifica — se
                        // abandonar agora, sabemos quem é para recuperar
                        if (key === "fone" && client.fone.replace(/\D/g, "").length >= 10) {
                          trackerRef.current?.identify(client.fone);
                        }
                      }}
                      onFocus={(e) => {
                        // teclado aberto: centraliza o campo dentro da folha
                        const el = e.currentTarget;
                        setTimeout(
                          () => el.scrollIntoView({ block: "center", behavior: "smooth" }),
                          300
                        );
                      }}
                      placeholder={ph}
                      // 16px: fonte menor faz o iOS dar zoom automático no foco
                      className="w-full rounded-xl border px-3.5 py-[13px] text-[16px] bg-white outline-none"
                      style={{ borderColor: T.line }}
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
            style={{ borderColor: T.line, background: T.bg, paddingBottom: "calc(16px + env(safe-area-inset-bottom,0))" }}
          >
            {minActive && minTarget > 0 && (
              <div className="mb-[13px]">
                <p
                  className="flex items-center gap-2 text-[13.5px] font-bold mb-[9px] m-0"
                  style={{ color: minBlocked ? T.primary : "#1F7A4D" }}
                >
                  {minBlocked ? minRemainingLabel : "Tudo certo! Pedido pronto para enviar"}
                </p>
                <div className="h-2 rounded-md overflow-hidden" style={{ background: T.soft }}>
                  <span
                    className="block h-full rounded-md transition-all duration-300"
                    style={{
                      width: `${minProgress}%`,
                      background: minBlocked ? T.primary : "#1F7A4D",
                    }}
                  />
                </div>
                <p className="text-[11px] font-semibold mt-[7px] m-0" style={{ color: T.muted }}>
                  {minStatusLabel}
                </p>
              </div>
            )}
            <button
              onClick={sendOrder}
              disabled={minBlocked}
              className="w-full flex items-center justify-center gap-[9px] rounded-[14px] p-4 text-[15px] font-bold active:scale-[0.985] transition disabled:opacity-40"
              style={{ background: T.primary, color: T.secondary }}
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
