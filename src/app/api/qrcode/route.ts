import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { requireUser, AuthError } from "@/lib/auth";

/**
 * Gera um QR Code SVG para um link do catálogo.
 * ?url=<link absoluto> — usado para sacolas, etiquetas, vitrine, eventos.
 */
export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const url = req.nextUrl.searchParams.get("url");
    if (!url) {
      return NextResponse.json({ error: "url obrigatória" }, { status: 400 });
    }
    const svg = await QRCode.toString(url, {
      type: "svg",
      margin: 1,
      color: { dark: "#1a1523", light: "#ffffff" },
      width: 320,
    });
    return new NextResponse(svg, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
