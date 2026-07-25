import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePlanoCorte, planoCorteErro } from "@/lib/plano-corte-auth";
import { parseAdsx, parseDataXml } from "@/lib/plano-corte/audaces";
import { parseDxf } from "@/lib/plano-corte/dxf";
import type { ModeloCorte } from "@/lib/plano-corte/types";

/**
 * Modelos de corte importados do CAD.
 * POST: recebe o arquivo (.adsx, .dxf ou data.xml) em base64, detecta o
 * formato, extrai peças/grade/miniatura e salva. Nada de storage externo:
 * o conteúdo interpretado (JSON) é o que fica no banco.
 */

const postSchema = z.object({
  fileName: z.string().min(1).max(200),
  // ~15MB em base64 — modelos do Audaces são bem menores que isso
  contentBase64: z.string().min(1).max(20_000_000),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requirePlanoCorte();
    const parsed = postSchema.safeParse(await req.json());
    if (!parsed.success)
      return NextResponse.json({ error: "Arquivo inválido" }, { status: 400 });

    const { fileName, contentBase64 } = parsed.data;
    const buf = Buffer.from(contentBase64, "base64");
    const lower = fileName.toLowerCase();

    let modelo: ModeloCorte;
    try {
      if (lower.endsWith(".dxf")) {
        modelo = parseDxf(buf.toString("latin1"));
        // DXF não carrega o nome do modelo — usa o nome do arquivo
        modelo.nome = fileName.replace(/\.dxf$/i, "").replace(/[_-]+/g, " ").trim().toUpperCase();
      } else if (lower.endsWith(".xml")) {
        modelo = parseDataXml(buf.toString("latin1"));
      } else {
        // .adsx e variantes zipadas do Audaces
        modelo = parseAdsx(buf);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Não consegui ler o arquivo";
      return NextResponse.json({ error: msg }, { status: 422 });
    }

    const criado = await db.cutPlanModel.create({
      data: {
        companyId: user.companyId,
        name: modelo.nome,
        source: modelo.origem,
        thumbnail: modelo.thumbnail ?? null,
        sizes: JSON.stringify(modelo.tamanhos),
        pieces: JSON.stringify(modelo.pecas),
      },
    });

    return NextResponse.json({
      id: criado.id,
      name: criado.name,
      source: criado.source,
      sizes: modelo.tamanhos,
      pieces: modelo.pecas.map((p) => ({
        nome: p.nome,
        pano: p.pano,
        qtd: p.qtd,
        temContorno: Object.values(p.tamanhos).some((t) => !!t.contorno),
      })),
    });
  } catch (e) {
    return planoCorteErro(e);
  }
}

export async function GET() {
  try {
    const user = await requirePlanoCorte();
    const modelos = await db.cutPlanModel.findMany({
      where: { companyId: user.companyId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return NextResponse.json(
      modelos.map((m) => ({
        id: m.id,
        name: m.name,
        source: m.source,
        thumbnail: m.thumbnail,
        sizes: JSON.parse(m.sizes) as string[],
        pieces: (JSON.parse(m.pieces) as { nome: string; pano: string; tamanhos: Record<string, { contorno?: unknown }> }[]).map(
          (p) => ({
            nome: p.nome,
            pano: p.pano,
            temContorno: Object.values(p.tamanhos).some((t) => !!t.contorno),
          })
        ),
        createdAt: m.createdAt.toISOString(),
      }))
    );
  } catch (e) {
    return planoCorteErro(e);
  }
}
