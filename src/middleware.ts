import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const secret = new TextEncoder().encode(
  process.env.AUTH_SECRET ?? "vesticrm-dev-secret"
);

// /catalogo é a vitrine pública; /api/intake e /api/whatsapp/webhook são os
// webhooks de entrada de leads (protegidos por INTAKE_SECRET quando definido)
const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/catalogo",
  "/c/", // links curtos de vendedores/campanhas
  "/api/intake",
  "/api/whatsapp/webhook",
  "/api/track", // Tracking Engine (Inteligência Comercial)
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

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

  if (pathname === "/") {
    const url = req.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
