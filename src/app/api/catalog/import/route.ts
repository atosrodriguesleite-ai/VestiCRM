import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp } from "@/lib/scope";
import { parseCatalog, importCatalog } from "@/lib/catalog-import";

/**
 * Importa um arquivo de catálogo (.json) para a loja atual (tenant da sessão).
 * Funciona também com o Super Admin acessando a loja ("Acessar loja"), pois o
 * escopo segue o companyId da sessão. Requer admin/gerente.
 */

// Catálogos com muitas fotos podem levar alguns segundos: eleva o limite de
// execução na Vercel (o padrão gratuito é 10s).
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!isManagerUp(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }

    const raw = await req.json().catch(() => null);
    if (!raw) {
      return NextResponse.json(
        { error: "Arquivo inválido ou vazio." },
        { status: 400 }
      );
    }

    const data = parseCatalog(raw);
    // ?modo=fotos: só completa fotos que faltam — não cria produto, não
    // altera preço/estoque/variações (seguro para reimportar arquivo antigo)
    const mode =
      req.nextUrl.searchParams.get("modo") === "fotos" ? "fotos" : "completo";
    const summary = await importCatalog(user.companyId, data, mode);
    return NextResponse.json({ ok: true, summary }, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    if (e instanceof ZodError) {
      const first = e.issues[0];
      const path = first?.path.join(".") || "arquivo";
      return NextResponse.json(
        { error: `Formato do arquivo inválido em "${path}": ${first?.message}` },
        { status: 400 }
      );
    }
    throw e;
  }
}
