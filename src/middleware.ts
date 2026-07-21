import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { AUTH_SECRET } from "./lib/env";

const secret = new TextEncoder().encode(AUTH_SECRET);

// /catalogo é a vitrine pública; /api/intake e /api/whatsapp/webhook são os
// webhooks de entrada de leads (protegidos por INTAKE_SECRET quando definido)
const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/catalogo",
  "/bio/", // Gestor de Bio: página pública de links da loja
  "/api/bio/", // redirecionador de cliques da bio (conta o clique)
  "/c/", // links curtos de vendedores/campanhas
  "/api/intake",
  "/api/demo", // formulário de demonstração da landing page
  "/api/whatsapp/webhook",
  "/api/whatsapp/evolution/webhook", // eventos do servidor Evolution (token na URL)
  "/api/nuvemshop/webhook", // eventos da Nuvemshop (assinatura HMAC)
  "/api/nuvemshop/callback", // retorno do OAuth (estado assinado)
  "/api/track", // Tracking Engine (Inteligência Comercial)
  "/api/catalog/order", // pedido enviado pelo catálogo público
  "/api/img", // fotos de produto (catálogo público carrega daqui)
];

// Domínio dedicado aos catálogos (ex.: "pedidosatacado.com.br").
// Quando CATALOG_DOMAIN está definido, esse host serve APENAS catálogos com
// link curto — seudominio.com/toque-leve — sem expor a marca da plataforma.
// O domínio principal (landing + CRM) continua funcionando normalmente.
const CATALOG_DOMAIN = process.env.CATALOG_DOMAIN?.trim().toLowerCase();
// Para onde mandar quem acessa a raiz do domínio de catálogos
const MAIN_SITE_URL =
  process.env.MAIN_SITE_URL?.trim() || "https://www.atacadopro.com";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const host = req.headers.get("host")?.split(":")[0].toLowerCase();
  if (
    CATALOG_DOMAIN &&
    (host === CATALOG_DOMAIN || host === `www.${CATALOG_DOMAIN}`)
  ) {
    if (pathname === "/") {
      // preserva ?utm_... (ex.: link "Feito com AtacadoPro" dos catálogos)
      return NextResponse.redirect(MAIN_SITE_URL + req.nextUrl.search);
    }
    // Links curtos e limpos no domínio de catálogos:
    //   catalago.net/toque-leve               → catálogo da loja
    //   catalago.net/toque-leve/nivia         → ?ref=nivia (vendedor/campanha)
    //   catalago.net/toque-leve/nivia/a3f9c2b → ?ref=nivia&c=a3f9c2b (cliente
    //     rastreado — código curto amigável, nada de ?c= comprido na URL).
    //   Um segmento sozinho também tenta como cliente (?c) — o servidor
    //     resolve o que for (vendedor/campanha/cliente) e ignora o resto.
    if (
      !pathname.startsWith("/api") &&
      !pathname.startsWith("/catalogo") &&
      !pathname.startsWith("/c/") &&
      !pathname.startsWith("/_next") &&
      !pathname.includes(".")
    ) {
      const segs = pathname.split("/").filter(Boolean);
      // catálogo de CAMPANHA: catalago.net/<loja>/c/<campanha>
      if (segs.length === 3 && segs[1] === "c") {
        const url = req.nextUrl.clone();
        url.pathname = `/catalogo/${segs[0]}/c/${segs[2]}`;
        return NextResponse.rewrite(url);
      }
      if (segs.length >= 1 && segs.length <= 3) {
        const url = req.nextUrl.clone();
        url.pathname = `/catalogo/${segs[0]}`;
        if (segs[1] && !url.searchParams.get("ref")) {
          url.searchParams.set("ref", segs[1]);
        }
        const code = segs[2] ?? segs[1];
        if (code && !url.searchParams.get("c")) {
          url.searchParams.set("c", code);
        }
        return NextResponse.rewrite(url);
      }
    }
  }

  // Landing page oficial é pública (raiz do site)
  if (pathname === "/") {
    return NextResponse.next();
  }

  if (
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith("/_next") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  const token = req.cookies.get("vesticrm_session")?.value;
  let valid = false;
  if (token) {
    try {
      await jwtVerify(token, secret);
      valid = true;
    } catch {
      valid = false;
    }
  }

  if (!valid) {
    if (pathname.startsWith("/api")) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
