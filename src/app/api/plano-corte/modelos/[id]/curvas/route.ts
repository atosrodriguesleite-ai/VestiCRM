import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePlanoCorte, planoCorteErro } from "@/lib/plano-corte-auth";
import { parsePdfContornos, type ContornoPdf } from "@/lib/plano-corte/pdf";
import { parseDxf } from "@/lib/plano-corte/dxf";
import { casarCurvas } from "@/lib/plano-corte/casamento";
import type { ModeloCorte } from "@/lib/plano-corte/types";

/**
 * Anexa as CURVAS REAIS a um modelo já importado do .adsx: recebe o PDF
 * (ou DXF) exportado do MESMO modelo no Audaces, extrai os contornos e
 * casa cada um com a peça×tamanho certa pelo tamanho da caixa (medidas).
 */

const schema = z.object({
  fileName: z.string().min(1).max(200),
  contentBase64: z.string().min(1).max(20_000_000),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requirePlanoCorte();
    const { id } = await params;
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success)
      return NextResponse.json({ error: "Arquivo inválido" }, { status: 400 });

    const m = await db.cutPlanModel.findFirst({
      where: { id, companyId: user.companyId },
    });
    if (!m)
      return NextResponse.json({ error: "Modelo não encontrado" }, { status: 404 });

    const buf = Buffer.from(parsed.data.contentBase64, "base64");
    const lower = parsed.data.fileName.toLowerCase();

    let contornos: ContornoPdf[];
    try {
      if (lower.endsWith(".dxf")) {
        // DXF também serve de fonte de curvas: achata as peças dele
        contornos = parseDxf(buf.toString("latin1")).pecas.flatMap((p) =>
          Object.values(p.tamanhos)
            .filter((t) => t.contorno)
            .map((t) => ({ w: t.w, h: t.h, area: t.area, contorno: t.contorno! }))
        );
      } else {
        contornos = parsePdfContornos(buf);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Não consegui ler o arquivo";
      return NextResponse.json({ error: msg }, { status: 422 });
    }

    const modelo: ModeloCorte = {
      nome: m.name,
      origem: m.source as ModeloCorte["origem"],
      tamanhos: JSON.parse(m.sizes),
      pecas: JSON.parse(m.pieces),
    };
    const resultado = casarCurvas(modelo, contornos);

    if (resultado.casadas === 0)
      return NextResponse.json(
        {
          error:
            "Nenhuma curva casou com as peças deste modelo — confira se o PDF é do MESMO modelo do .adsx",
        },
        { status: 422 }
      );

    await db.cutPlanModel.update({
      where: { id: m.id },
      data: { pieces: JSON.stringify(modelo.pecas) },
    });

    return NextResponse.json(resultado);
  } catch (e) {
    return planoCorteErro(e);
  }
}
