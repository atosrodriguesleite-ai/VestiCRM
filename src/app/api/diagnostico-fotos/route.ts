import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/scope";

/**
 * Diagnóstico de fotos DE PONTA A PONTA — o servidor de produção testa cada
 * foto pelo MESMO caminho público que o navegador usa (HTTP em /api/img/<id>,
 * passando por CDN/middleware/rota) e imprime um relatório legível. Assim
 * enxergamos falhas que não aparecem olhando só o banco (o médico de fotos
 * valida o dado; este valida a ENTREGA).
 * Uso: /api/diagnostico-fotos?slug=entre-linhas (logado; Super Admin pode
 * testar qualquer loja, os demais apenas a própria).
 */

export const maxDuration = 60;

type Row = {
  product: string;
  id: string;
  status: number | string;
  type: string;
  kb: number;
  ok: boolean;
  note: string;
};

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const slug = req.nextUrl.searchParams.get("slug")?.trim();

    const company = slug
      ? await db.company.findUnique({ where: { slug } })
      : await db.company.findUnique({ where: { id: user.companyId } });
    if (!company) {
      return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });
    }
    if (!isSuperAdmin(user) && company.id !== user.companyId) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }

    const images = await db.productImage.findMany({
      where: { product: { companyId: company.id } },
      select: { id: true, product: { select: { name: true } } },
      orderBy: { id: "asc" },
      take: 300,
    });

    // origem pública desta própria implantação (mesmo caminho do navegador)
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    const host = req.headers.get("host") ?? "";
    const origin = `${proto}://${host}`;

    const rows: Row[] = [];
    const CONC = 6;
    for (let i = 0; i < images.length; i += CONC) {
      await Promise.all(
        images.slice(i, i + CONC).map(async (img) => {
          const row: Row = {
            product: img.product.name,
            id: img.id,
            status: "-",
            type: "",
            kb: 0,
            ok: false,
            note: "",
          };
          try {
            const res = await fetch(`${origin}/api/img/${img.id}`, {
              redirect: "follow",
              signal: AbortSignal.timeout(20000),
              headers: { Accept: "image/*,*/*;q=0.8" },
            });
            const buf = Buffer.from(await res.arrayBuffer());
            row.status = res.status;
            row.type = res.headers.get("content-type")?.split(";")[0] ?? "";
            row.kb = Math.round(buf.byteLength / 1024);
            row.ok =
              res.ok && row.type.startsWith("image/") && buf.byteLength > 100;
            if (!row.ok) {
              row.note = buf.slice(0, 160).toString("utf-8").replace(/</g, "‹");
            }
          } catch (e) {
            row.status = "erro";
            row.note = String(e).slice(0, 160);
          }
          rows.push(row);
        })
      );
    }

    const fails = rows.filter((r) => !r.ok);
    const okCount = rows.length - fails.length;

    const failRows = fails
      .map(
        (r) =>
          `<tr><td>✗</td><td>${r.product}</td><td>${r.status}</td><td>${r.type || "—"}</td><td>${r.kb} KB</td><td style="max-width:420px;word-break:break-all">${r.note}</td><td style="font-family:monospace;font-size:11px">${r.id}</td></tr>`
      )
      .join("");

    const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8">
<title>Diagnóstico de fotos — ${company.name}</title>
<body style="font-family:system-ui,sans-serif;background:#f6efe5;color:#1d1710;padding:24px;max-width:960px;margin:0 auto">
<h1 style="font-size:20px">Diagnóstico de fotos — ${company.name}</h1>
<p><b>${okCount}</b> de <b>${rows.length}</b> fotos entregues com sucesso pelo caminho público (${origin}).</p>
${
  fails.length === 0
    ? `<p style="color:#059669;font-weight:600">Todas as fotos foram entregues perfeitamente por este servidor. Se o catálogo ainda mostra foto quebrada, o problema está entre a CDN e o aparelho (me mande o print desta página mesmo assim).</p>`
    : `<p style="color:#b45309;font-weight:600">${fails.length} foto(s) FALHARAM na entrega — detalhes abaixo (mande o print desta tabela):</p>
<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;background:#fff;font-size:13px">
<tr><th></th><th>Produto</th><th>Status</th><th>Tipo</th><th>Tamanho</th><th>Resposta recebida</th><th>id</th></tr>
${failRows}
</table>`
}
<p style="color:#8a8177;font-size:12px;margin-top:16px">Gerado em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} · ${rows.length} fotos testadas · loja ${company.slug}</p>
</body></html>`;

    return new NextResponse(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
