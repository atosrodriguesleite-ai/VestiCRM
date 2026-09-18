import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError } from "@/lib/auth";
import { isManagerUp, isSupport } from "@/lib/scope";
import { porteiraEtiquetas } from "@/lib/etiquetas/gate";
import { abrirModelo, arquivarModelo, definirPadrao, salvarModelo } from "@/lib/etiquetas/modelos";
import {
  ALTURA_MAX_MM,
  ALTURA_MIN_MM,
  COLUNAS_MAX,
  ESPACO_MAX_MM,
  LARGURA_LINHA_MAX_MM,
  LARGURA_MAX_MM,
  LARGURA_MIN_MM,
  TETO_IMAGEM_BYTES,
  TETO_MODELO_BYTES,
  elementosCabem,
  larguraDaLinha,
  layoutPorTipo,
  lerElementos,
} from "@/lib/etiquetas/modelo";

type Ctx = { params: Promise<{ id: string }> };

/** O modelo inteiro para o editor. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const porta = await porteiraEtiquetas();
    if (!porta.ok) return porta.resposta;
    const { id } = await params;
    const m = await abrirModelo(porta.user.companyId, id);
    if (!m) return NextResponse.json({ error: "Modelo não encontrado" }, { status: 404 });
    return NextResponse.json(m);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

const schema = z.object({
  nome: z.string().trim().min(1).max(80).optional(),
  larguraMm: z.number().min(LARGURA_MIN_MM).max(LARGURA_MAX_MM).optional(),
  alturaMm: z.number().min(ALTURA_MIN_MM).max(ALTURA_MAX_MM).optional(),
  colunas: z.number().int().min(1).max(COLUNAS_MAX).optional(),
  espacoMm: z.number().min(0).max(ESPACO_MAX_MM).optional(),
  girada: z.boolean().optional(),
  /** a lista do editor; null volta ao desenho por regra */
  elementos: z.array(z.record(z.string(), z.unknown())).max(60).nullable().optional(),
  /** ações */
  padrao: z.literal(true).optional(),
});

/**
 * SALVAR O MODELO (gerência e suporte). O desenho chega como lista de
 * elementos; o servidor lê campo a campo (`lerElementos`) — elemento torto
 * cai fora —, confere que tudo cabe na etiqueta e que a linha do rolo cabe
 * na impressora, e só então grava. `padrao: true` define este como o padrão
 * do tipo.
 */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const porta = await porteiraEtiquetas();
    if (!porta.ok) return porta.resposta;
    if (!isManagerUp(porta.user) && !isSupport(porta.user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const { id } = await params;
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: `Fora do que a impressora imprime (largura ${LARGURA_MIN_MM}–${LARGURA_MAX_MM} mm, altura ${ALTURA_MIN_MM}–${ALTURA_MAX_MM} mm, até ${COLUNAS_MAX} colunas, espaço até ${ESPACO_MAX_MM} mm).` },
        { status: 400 }
      );
    }
    const d = parsed.data;
    if (d.padrao) {
      const ok = await definirPadrao(porta.user.companyId, id);
      return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Modelo não encontrado" }, { status: 404 });
    }
    const atual = await abrirModelo(porta.user.companyId, id);
    if (!atual) return NextResponse.json({ error: "Modelo não encontrado" }, { status: 404 });

    // o desenho que vai valer depois desta gravação, conferido inteiro
    const largura = d.larguraMm ?? atual.larguraMm;
    const altura = d.alturaMm ?? atual.alturaMm;
    const colunas = d.colunas ?? atual.colunas;
    const espacoMm = d.espacoMm ?? atual.espacoMm;
    const girada = d.girada ?? atual.girada;
    let elementosJson: string | null | undefined = undefined;
    if (d.elementos !== undefined) {
      if (d.elementos === null) elementosJson = null;
      else {
        if (d.elementos.some((e) => e.tipo === "imagem" && typeof e.src === "string" && e.src.length > TETO_IMAGEM_BYTES)) {
          return NextResponse.json({ error: "Uma imagem está pesada demais (máximo ~400 KB). Use um logo menor ou mais simples." }, { status: 400 });
        }
        const json = JSON.stringify(d.elementos);
        if (json.length > TETO_MODELO_BYTES) {
          return NextResponse.json({ error: "O modelo ficou grande demais (imagens pesadas). Use imagens menores." }, { status: 400 });
        }
        const lidos = lerElementos(json);
        if (!lidos) return NextResponse.json({ error: "Desenho inválido." }, { status: 400 });
        if (lidos.length !== d.elementos.length) {
          return NextResponse.json({ error: "Um dos elementos está fora da etiqueta ou com valor inválido." }, { status: 400 });
        }
        elementosJson = JSON.stringify(lidos);
      }
    }
    // o que vai valer: o desenho novo do editor; ou, no modelo por regra, o
    // desenho REFEITO para o tamanho novo (conferir os elementos velhos,
    // posicionados para o tamanho antigo, recusava ou aceitava errado —
    // achado da revisão)
    const porRegra = elementosJson === null || (elementosJson === undefined && !atual.editado);
    const desenho = porRegra
      ? layoutPorTipo(atual.tipo, { ...atual.opcoes, larguraMm: largura, alturaMm: altura, colunas, espacoMm, girar: girada ? "sim" : "nao" })
      : {
          larguraMm: largura,
          alturaMm: altura,
          colunas,
          espacoMm,
          girada,
          elementos: elementosJson === undefined ? atual.modelo.elementos : lerElementos(elementosJson)!,
        };
    if (larguraDaLinha(desenho) > LARGURA_LINHA_MAX_MM) {
      return NextResponse.json({ error: `A linha do rolo (colunas + espaços) passa de ${LARGURA_LINHA_MAX_MM} mm, que é o máximo que a impressora imprime.` }, { status: 400 });
    }
    if (!elementosCabem(desenho)) {
      return NextResponse.json({ error: "Um dos elementos sai da etiqueta. Arraste-o para dentro ou aumente a etiqueta." }, { status: 400 });
    }
    const salvo = await salvarModelo(porta.user.companyId, id, {
      nome: d.nome,
      larguraMm: d.larguraMm,
      alturaMm: d.alturaMm,
      colunas: d.colunas,
      espacoMm: d.espacoMm,
      girada: d.girada,
      elementos: elementosJson,
    });
    if (!salvo) return NextResponse.json({ error: "Modelo não encontrado" }, { status: 404 });
    return NextResponse.json({ modelo: salvo });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    if (e instanceof Error && /grande demais/.test(e.message)) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}

/** Arquivar (some da lista, não imprime, a linha fica). */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const porta = await porteiraEtiquetas();
    if (!porta.ok) return porta.resposta;
    if (!isManagerUp(porta.user) && !isSupport(porta.user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const { id } = await params;
    const r = await arquivarModelo(porta.user.companyId, id);
    return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.erro }, { status: 400 });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
