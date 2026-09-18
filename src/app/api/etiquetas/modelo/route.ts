import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError } from "@/lib/auth";
import { isManagerUp, isSupport } from "@/lib/scope";
import { porteiraEtiquetas } from "@/lib/etiquetas/gate";
import { modeloPadraoDaLoja, salvarOpcoesDoPadrao } from "@/lib/etiquetas/modelos";
import {
  ALTURA_MAX_MM,
  ALTURA_MIN_MM,
  COLUNAS_MAX,
  ESPACO_MAX_MM,
  LARGURA_LINHA_MAX_MM,
  LARGURA_MAX_MM,
  LARGURA_MIN_MM,
  layoutEmbalagem,
  elementosCabem,
} from "@/lib/etiquetas/modelo";

/** O modelo padrão de embalagem da loja: opções + desenho (para a prévia). */
export async function GET() {
  try {
    const porta = await porteiraEtiquetas();
    if (!porta.ok) return porta.resposta;
    const m = await modeloPadraoDaLoja(porta.user.companyId);
    return NextResponse.json({ id: m.id, nome: m.nome, opcoes: m.opcoes, modelo: m.modelo });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

const schema = z.object({
  larguraMm: z.number().min(LARGURA_MIN_MM).max(LARGURA_MAX_MM),
  alturaMm: z.number().min(ALTURA_MIN_MM).max(ALTURA_MAX_MM),
  colunas: z.number().int().min(1).max(COLUNAS_MAX),
  espacoMm: z.number().min(0).max(ESPACO_MAX_MM),
  girar: z.enum(["auto", "sim", "nao"]),
  mostrarLoja: z.boolean(),
  mostrarSku: z.boolean(),
  preco: z.enum(["atacado", "varejo"]).nullable(),
});

/** Muda tamanho e campos do modelo padrão (gerência e suporte, a mesma régua da ficha da peça). */
export async function PATCH(req: NextRequest) {
  try {
    const porta = await porteiraEtiquetas();
    if (!porta.ok) return porta.resposta;
    if (!isManagerUp(porta.user) && !isSupport(porta.user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: `Fora do que a impressora imprime (largura ${LARGURA_MIN_MM}–${LARGURA_MAX_MM} mm, altura ${ALTURA_MIN_MM}–${ALTURA_MAX_MM} mm, até ${COLUNAS_MAX} colunas com espaço de até ${ESPACO_MAX_MM} mm).` },
        { status: 400 }
      );
    }
    // o desenho tem que caber: etiqueta baixa demais para o rodapé pedido é recusada com frase
    if (!elementosCabem(layoutEmbalagem(parsed.data))) {
      return NextResponse.json(
        { error: `Não cabe: ou a linha inteira passa de ${LARGURA_LINHA_MAX_MM} mm (colunas + espaços), ou a etiqueta é baixa demais para o rodapé pedido. Ajuste o tamanho, as colunas ou tire um campo.` },
        { status: 400 }
      );
    }
    const modelo = await salvarOpcoesDoPadrao(porta.user.companyId, parsed.data);
    return NextResponse.json({ ok: true, opcoes: parsed.data, modelo });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
