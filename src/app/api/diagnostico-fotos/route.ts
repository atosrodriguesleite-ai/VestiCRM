import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/scope";

const DB_FP = createHash("sha256")
  .update(process.env.DATABASE_URL ?? "")
  .digest("hex")
  .slice(0, 8);
const DEPLOY = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local";

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
  cdn: string; // x-vercel-cache + age (a prova do cache envenenado)
  retry: string; // status ao furar o cache com ?v=<agora>
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
    const dbIds = new Set(images.map((i) => i.id));

    // origem pública desta própria implantação (mesmo caminho do navegador)
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    const host = req.headers.get("host") ?? "";
    const origin = `${proto}://${host}`;

    // -----------------------------------------------------------------
    // FANTASMAS: compara os códigos de foto que a PÁGINA PÚBLICA entrega
    // com os que existem no banco — nos dois domínios (principal e o de
    // catálogos). Código na página que não existe no banco = página velha
    // sendo servida (cache/CDN/implantação antiga) e foto quebrada na tela.
    // -----------------------------------------------------------------
    const extractIds = (html: string) =>
      [...html.matchAll(/\/api\/img\/([a-z0-9]+)/gi)].map((m) => m[1]);
    async function pageProbe(url: string) {
      try {
        const res = await fetch(url, {
          redirect: "follow",
          signal: AbortSignal.timeout(20000),
          headers: { Accept: "text/html" },
          cache: "no-store",
        });
        const html = await res.text();
        const ids = [...new Set(extractIds(html))];
        const ghosts = ids.filter((i) => !dbIds.has(i));
        return { url, status: res.status, ids: ids.length, ghosts };
      } catch (e) {
        return { url, status: 0, ids: 0, ghosts: [] as string[], err: String(e).slice(0, 120) };
      }
    }
    const probes = [await pageProbe(`${origin}/catalogo/${company.slug}`)];
    const catDomain = process.env.CATALOG_DOMAIN?.trim();
    if (catDomain) {
      probes.push(await pageProbe(`https://${catDomain}/${company.slug}`));
    }

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
            cdn: "",
            retry: "",
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
            row.cdn = [
              res.headers.get("x-vercel-cache") ?? "",
              res.headers.get("age") ? `age ${res.headers.get("age")}s` : "",
              res.headers.get("x-vercel-id")?.split("::")[0] ?? "",
            ]
              .filter(Boolean)
              .join(" · ");
            row.ok =
              res.ok && row.type.startsWith("image/") && buf.byteLength > 100;
            if (!row.ok) {
              row.note = buf.slice(0, 160).toString("utf-8").replace(/</g, "‹");
              // fura o cache: se com URL "nova" a foto vier 200, está provado
              // que o erro estava GUARDADO na CDN, não no servidor/banco.
              const res2 = await fetch(
                `${origin}/api/img/${img.id}?v=diag${Date.now()}`,
                {
                  redirect: "follow",
                  signal: AbortSignal.timeout(20000),
                  headers: { Accept: "image/*,*/*;q=0.8" },
                }
              );
              const buf2 = Buffer.from(await res2.arrayBuffer());
              const t2 = res2.headers.get("content-type")?.split(";")[0] ?? "";
              row.retry =
                res2.ok && t2.startsWith("image/") && buf2.byteLength > 100
                  ? `✓ 200 (${Math.round(buf2.byteLength / 1024)} KB)`
                  : `✗ ${res2.status}`;
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
          `<tr><td>✗</td><td>${r.product}</td><td>${r.status}</td><td>${r.cdn || "—"}</td><td><b>${r.retry || "—"}</b></td><td style="max-width:280px;word-break:break-all">${r.note}</td><td style="font-family:monospace;font-size:11px">${r.id}</td></tr>`
      )
      .join("");

    const probeHtml = probes
      .map((p) => {
        const okP = p.status === 200 && p.ghosts.length === 0;
        return `<li style="margin-bottom:6px"><b>${p.url}</b> — status ${p.status || "erro"}, ${p.ids} fotos na página, <b style="color:${okP ? "#059669" : "#dc2626"}">${p.ghosts.length} código(s) fantasma</b>${
          p.ghosts.length
            ? `<br><span style="font-family:monospace;font-size:11px">${p.ghosts.slice(0, 8).join(" · ")}${p.ghosts.length > 8 ? " …" : ""}</span>`
            : ""
        }</li>`;
      })
      .join("");

    const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8">
<title>Diagnóstico de fotos — ${company.name}</title>
<body style="font-family:system-ui,sans-serif;background:#f6efe5;color:#1d1710;padding:24px;max-width:960px;margin:0 auto">
<h1 style="font-size:20px">Diagnóstico de fotos — ${company.name}</h1>
<p style="font-family:monospace;font-size:12px;background:#fff;border:1px solid #e5ded2;border-radius:8px;padding:8px">Este diagnóstico roda em: código <b>${DEPLOY}</b> · banco <b>${DB_FP}</b><br>Compare com os campos "dep" e "db" dentro das respostas de erro da tabela — se forem diferentes, há duas implantações/bancos respondendo.</p>
<h2 style="font-size:15px">1) Página pública × banco (códigos fantasma)</h2>
<p style="font-size:13px;color:#6b6257">Código "fantasma" = a página entrega uma foto que não existe mais no banco (página velha em cache ou implantação antiga) — é exatamente o que quebra na tela.</p>
<ul style="font-size:13px">${probeHtml}</ul>
<h2 style="font-size:15px">2) Entrega das ${rows.length} fotos do banco</h2>
<p><b>${okCount}</b> de <b>${rows.length}</b> fotos entregues com sucesso pelo caminho público (${origin}).</p>
${
  fails.length === 0
    ? `<p style="color:#059669;font-weight:600">Todas as fotos foram entregues perfeitamente por este servidor. Se o catálogo ainda mostra foto quebrada, o problema está entre a CDN e o aparelho (me mande o print desta página mesmo assim).</p>`
    : `<p style="color:#b45309;font-weight:600">${fails.length} foto(s) FALHARAM na entrega — detalhes abaixo (mande o print desta tabela):</p>
<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;background:#fff;font-size:13px">
<tr><th></th><th>Produto</th><th>Status</th><th>Cache CDN</th><th>Furando o cache</th><th>Resposta recebida</th><th>id</th></tr>
${failRows}
</table>
<p style="font-size:12px;color:#6b6257">Se "Furando o cache" mostra ✓ 200, o erro estava GUARDADO na CDN — a correção ?v=2 publicada junto com esta página resolve o catálogo.</p>`
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
