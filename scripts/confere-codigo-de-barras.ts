/**
 * PROVA CONTRA O POSTGRES (RN-059, ADR-017): a conta do EAN-13 em SQL e em
 * TypeScript concordam, toda variação nasce com código (gatilho), o código
 * é único e nunca fica nulo. Roda contra o banco local:
 *
 *   DATABASE_URL=... NODE_PATH=./node_modules npx tsx --tsconfig tsconfig.json scripts/confere-codigo-de-barras.ts
 */
import { db } from "@/lib/db";
import { ean13Interno, ean13Valido } from "@/lib/etiquetas/ean13";
import { dadosParaImprimir } from "@/lib/etiquetas/imprimir";
import { modeloPadraoDaLoja, salvarOpcoesDoPadrao } from "@/lib/etiquetas/modelos";
import { pdfDoLote } from "@/lib/etiquetas/pdf";
import { zplDoLote } from "@/lib/etiquetas/zpl";
import { PDFDocument } from "pdf-lib";

const check = (n: string, ok: boolean) => console.log(ok ? "✅" : "❌", n);

async function main() {
  // 1) as duas contas concordam numa amostra larga
  const amostra = [0, 1, 2, 9, 10, 99, 12345, 999_999, 7_654_321, 99_999_999_999];
  const sql = await db.$queryRawUnsafe<{ n: bigint; c: string }[]>(
    `SELECT n, ean13_interno(n) AS c FROM unnest(ARRAY[${amostra.join(",")}]::bigint[]) AS n`
  );
  check(
    "SQL e TypeScript dão o MESMO código para a mesma sequência",
    sql.every((r) => ean13Interno(Number(r.n)) === r.c && ean13Valido(r.c))
  );

  // 2) toda variação nasce com código, por qualquer caminho (create aninhado, upsert, createMany)
  const tag = `cb-${Date.now()}`;
  const co = await db.company.create({ data: { name: tag, slug: tag, etiquetasEnabled: true } });
  const p = await db.product.create({
    data: {
      companyId: co.id, name: "Regata Nadador", sku: `RN-${tag}`, category: "Regata", wholesalePrice: 39.9, retailPrice: 79.9,
      variants: { create: [{ color: "Preto", size: "G", stock: 3 }, { color: "Preto", size: "M", stock: 0 }] },
    },
    include: { variants: true },
  });
  check("create aninhado: as duas variações nasceram com código válido", p.variants.every((v) => v.barcode && ean13Valido(v.barcode)));
  const up = await db.productVariant.upsert({
    where: { productId_color_size: { productId: p.id, color: "Bordô", size: "G" } },
    create: { productId: p.id, color: "Bordô", size: "G", stock: 1 },
    update: {},
  });
  check("upsert (caminho do PATCH da ficha): nasceu com código", !!up.barcode && ean13Valido(up.barcode!));
  await db.productVariant.createMany({ data: [{ productId: p.id, color: "Azul", size: "P" }] });
  const todas = await db.productVariant.findMany({ where: { productId: p.id } });
  check("createMany: também", todas.every((v) => v.barcode && ean13Valido(v.barcode)));
  check("nenhum código repetido entre elas", new Set(todas.map((v) => v.barcode)).size === todas.length);
  const nulos = await db.productVariant.count({ where: { barcode: null } });
  check("nenhuma variação sem código no banco inteiro (backfill)", nulos === 0);

  // 3) o código não se reescreve: update sem barcode mantém
  const antes = todas[0].barcode;
  await db.productVariant.update({ where: { id: todas[0].id }, data: { stock: 9 } });
  const depois = await db.productVariant.findUnique({ where: { id: todas[0].id } });
  check("update de estoque não mexe no código", depois?.barcode === antes);

  // 4) impressão: dados do cadastro, recorte por loja, modelo padrão da loja
  const outra = await db.company.create({ data: { name: `${tag}-b`, slug: `${tag}-b` } });
  const recusa = await dadosParaImprimir(outra.id, [{ variantId: todas[0].id, quantidade: 1 }]);
  check("peça de OUTRA loja recusa o lote inteiro (RN-013)", !recusa.ok);
  const ok = await dadosParaImprimir(co.id, todas.map((v) => ({ variantId: v.id, quantidade: 2 })));
  check("lote da própria loja monta os dados do cadastro", ok.ok && ok.lote.length === todas.length && ok.lote[0].dados.loja === tag && ok.lote[0].dados.produto === "Regata Nadador");
  const teto = await dadosParaImprimir(co.id, [{ variantId: todas[0].id, quantidade: 501 }]);
  check("acima de 500 etiquetas recusa com frase", !teto.ok && /500/.test(teto.ok ? "" : teto.erro));

  const m1 = await modeloPadraoDaLoja(co.id);
  const m2 = await modeloPadraoDaLoja(co.id);
  check("o modelo padrão nasce uma vez só (idempotente)", m1.id === m2.id && m1.opcoes.larguraMm === 50);
  const novo = await salvarOpcoesDoPadrao(co.id, { larguraMm: 40, alturaMm: 25, colunas: 2, espacoMm: 2, girar: "auto", mostrarLoja: false, mostrarSku: true, preco: "atacado" });
  const m3 = await modeloPadraoDaLoja(co.id);
  check("salvar opções muda o modelo padrão da loja", novo.larguraMm === 40 && m3.opcoes.alturaMm === 25 && m3.opcoes.preco === "atacado");

  if (ok.ok) {
    const pdf = await PDFDocument.load(await pdfDoLote(m3.modelo, ok.lote));
    // 2 colunas: 2 etiquetas por página → metade das páginas
    check("PDF: uma página por LINHA do rolo (2 colunas × 2 de cada variação)", pdf.getPageCount() === Math.ceil((todas.length * 2) / 2));
    const zpl = zplDoLote(m3.modelo, ok.lote);
    check("ZPL: cada EAN aparece e as linhas iguais viram ^PQ", todas.every((v) => zpl.includes(`^FD${v.barcode!.slice(0, 12)}^FS`)) && zpl.includes("^PQ1"));
  }

  await db.company.delete({ where: { id: co.id } });
  await db.company.delete({ where: { id: outra.id } });
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
