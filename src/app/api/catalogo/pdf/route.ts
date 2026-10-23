import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import sharp from "sharp";
import { dataUrlToBuffer } from "@/lib/img-server";
import { acervoDaVitrine } from "@/lib/catalogo/acervo";
import { secoesDaVitrine } from "@/lib/catalogo/secoes";
import { resolverLink } from "@/lib/catalogo/tabelas-de-preco-servidor";
import { parseCategoryOrder, parseCategoryTypes, chaveDeCategoria } from "@/lib/categories";
import { gerarCatalogoPdf, nomeDoArquivo } from "@/lib/catalogo/pdf";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * O CATÁLOGO EM PDF (RN-094).
 *
 * Para a cliente que não consegue abrir o link: UM arquivo, que baixa de uma
 * vez, fica no aparelho e abre sem internet, sem navegador e sem JavaScript.
 *
 * Mesmo acervo e mesmo preço da vitrine (`acervoDaVitrine` + `secoesDaVitrine`,
 * RN-094): o papel não pode mostrar peça — nem preço — que o site não mostra.
 *
 * **Toda a equipe baixa**: é material de venda, a mesma régua da impressão de
 * etiquetas (RN-059) e da galeria de fotos (RN-071), e o conteúdo é só o que
 * o catálogo público já mostra a qualquer pessoa com o link. O que a rota
 * NUNCA faz é mostrar o acervo de outra loja: tudo é recortado pelo
 * `companyId` da sessão (RN-013).
 *
 * `?l=<código>` gera pela TABELA DE PREÇO daquele link (RN-018) — é como a
 * loja manda o PDF de atacado para a lojista e o de varejo para a cliente
 * final. `?cat=` (repetível) recorta por categoria, que é a saída da loja
 * grande quando o acervo não cabe inteiro.
 */
export async function GET(req: NextRequest) {
  const comecou = Date.now();
  // orçamento: a função morre em 60s sem resposta nenhuma. Paramos antes, com
  // o PDF que deu para montar — a mesma régua da sincronização em etapas
  const restante = () => Math.max(0, 45_000 - (Date.now() - comecou));

  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const company = await db.company.findUnique({ where: { id: user.companyId } });
  if (!company) return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });

  const q = req.nextUrl.searchParams;

  // TABELA DE PREÇO do link (RN-018): só vale para loja que ativou o recurso.
  // Código que não resolve é RECUSADO — nunca cai no varejo em silêncio, que
  // seria mandar para a lojista um PDF com o preço de cliente final
  const codigo = q.get("l");
  const tabela = codigo
    ? await resolverLink(company.id, codigo, company.priceTablesEnabled)
    : null;
  if (codigo && !tabela) {
    return NextResponse.json(
      { error: "Esse link de tabela não vale mais. Gere outro na tela de Catálogo." },
      { status: 404 }
    );
  }

  const acervo = await acervoDaVitrine(company, {
    modo: tabela?.priceMode ?? company.catalogPriceMode,
  });

  let secoes = secoesDaVitrine(acervo, {
    hideSoldOut: company.catalogHideOutOfStock,
    categoryOrder: parseCategoryOrder(company.categoryOrder),
    categoryTypes: parseCategoryTypes(company.categoryTypes),
  });

  // recorte por categoria: compara pela MESMA chave normalizada das seções
  // (acento decomposto e espaço no fim não podem fazer a categoria sumir)
  const pedidas = q.getAll("cat").map(chaveDeCategoria).filter(Boolean);
  if (pedidas.length) {
    const quer = new Set(pedidas);
    secoes = secoes.filter((s) => quer.has(chaveDeCategoria(s.categoria)));
    if (secoes.length === 0) {
      return NextResponse.json(
        { error: "Nenhuma peça nessa categoria." },
        { status: 404 }
      );
    }
  }

  if (secoes.length === 0) {
    return NextResponse.json(
      { error: "O catálogo está vazio: nenhuma peça ativa e com foto." },
      { status: 404 }
    );
  }

  const [cores, logo] = await Promise.all([
    db.companyColor.findMany({
      where: { companyId: company.id },
      select: { name: true, hex: true },
    }),
    logoParaCapa(company.logoUrl),
  ]);

  const geradoEm = new Date();
  const resultado = await gerarCatalogoPdf(secoes, {
    identidade: {
      nome: company.name,
      tagline: company.tagline,
      whatsapp: company.whatsapp,
      primary: company.catalogPrimary,
      secondary: company.catalogSecondary,
      bg: company.catalogBg,
      logo,
      cores,
    },
    geradoEm,
    semCores: company.catalogHideColors,
    restante,
  });

  return new NextResponse(new Uint8Array(resultado.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(resultado.bytes.byteLength),
      "Content-Disposition": `attachment; filename="${nomeDoArquivo(company.slug, geradoEm)}"`,
      // o PDF é a fotografia de AGORA: guardar na CDN entregaria preço velho
      "Cache-Control": "no-store",
      // o que a tela usa para avisar ("45 páginas, 3 peças sem foto")
      "X-Catalogo-Paginas": String(resultado.paginas),
      "X-Catalogo-Pecas": String(resultado.pecas),
      "X-Catalogo-Cortadas": String(resultado.cortadas),
      "X-Catalogo-Sem-Foto": String(resultado.semFoto),
    },
  });
}

/**
 * A LOGO PARA A CAPA, SEMPRE COMO PNG COM TRANSPARÊNCIA.
 *
 * A data-URL do banco (dívida nº 1) pode ser enorme, então encolhe antes de
 * embutir — mas **nunca como JPEG**: a logo de loja costuma ser PNG de fundo
 * transparente, e o JPEG não tem transparência. Achatada, ela virava uma
 * CAIXA PRETA de 280 × 110 pt no meio da capa colorida (achado da revisão);
 * achatada para branco viraria um retângulo branco, igualmente errado — a
 * capa tem a cor da loja.
 *
 * SVG e outros tipos que o sharp não abre ficam de fora: a capa mostra o
 * NOME da loja, que é o que ela já faz quando não há logo nenhuma.
 */
async function logoParaCapa(
  logoUrl: string | null
): Promise<{ bytes: Buffer; png: boolean } | null> {
  const bruto = logoUrl?.trim();
  if (!bruto || !bruto.startsWith("data:")) return null;
  const lido = dataUrlToBuffer(bruto);
  if (!lido) return null;
  try {
    const bytes = await sharp(lido.buf)
      .rotate()
      .resize({ width: 560, height: 560, fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer();
    return { bytes, png: true };
  } catch {
    return null;
  }
}
