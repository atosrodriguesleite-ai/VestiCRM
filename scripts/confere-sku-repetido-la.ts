/**
 * CONFERE A RN-072 contra o Postgres local — o caso da Regata Quadrada
 * (07/10/2026): na Nuvemshop, P, M, G e GG da Azul Marinho com o MESMO SKU
 * "RQD-MAR-P". Roda o `upsertProduct` de verdade, com uma Nuvemshop de
 * mentira, e prova:
 *  1. primeira sincronização com o SKU repetido lá e nenhum vínculo: SKU
 *     repetido não identifica produto — nada é escrito, tudo vira pendência;
 *  2. o estado torto que já existia em produção (a P daqui ligada à M de lá)
 *     se desfaz sozinho, MESMO com o SKU ainda repetido lá (SKU repetido não
 *     confirma vínculo nenhum; vale a cor × tamanho);
 *  2b. tamanho que só existe lá, com o SKU repetido, pelo WEBHOOK (sem
 *     relatório em curso): não cria variação com SKU ambíguo, a pendência
 *     "repetido LÁ" fica guardada no relatório da conexão e não se repete;
 *  3. corrigido o SKU lá, a P volta para a P sozinha (sem precisar soltar o
 *     vínculo na conferência) e a M vai para a M;
 *  4. a rodada seguinte não reescreve nada.
 *
 *   DATABASE_URL=... AUTH_SECRET=... npx tsx --tsconfig tsconfig.json scripts/confere-sku-repetido-la.ts
 */
import { db } from "@/lib/db";
import { upsertProduct, type SyncReport } from "@/lib/nuvemshop";

const check = (n: string, ok: boolean) => {
  console.log(ok ? "✅" : "❌", n);
  if (!ok) process.exitCode = 1;
};

const TAMANHOS = ["P", "M", "G", "GG"] as const;
const ESTOQUE_LA: Record<string, number> = { P: 4, M: 50, G: 47, GG: 47 };

function produtoDeLa(skus: Record<string, string>) {
  return {
    id: "np-rqd",
    name: { pt: "Regata Quadrada" },
    attributes: [{ pt: "Cor" }, { pt: "Tamanho" }],
    variants: TAMANHOS.map((t) => ({
      id: `ns-${t}`,
      sku: skus[t],
      price: "59.90",
      stock: ESTOQUE_LA[t],
      values: [{ pt: "Azul Marinho" }, { pt: t }],
    })),
  };
}
const repetido = { P: "RQD-MAR-P", M: "RQD-MAR-P", G: "RQD-MAR-P", GG: "RQD-MAR-P" };
const corrigido = { P: "RQD-MAR-P", M: "RQD-MAR-M", G: "RQD-MAR-G", GG: "RQD-MAR-GG" };

async function main() {
  const tag = `sku-${Date.now()}`;
  const co = await db.company.create({ data: { name: tag, slug: tag } });
  const prod = await db.product.create({
    data: {
      companyId: co.id,
      name: "Regata Quadrada",
      sku: `RQD-${tag}`,
      category: "Regatas",
      wholesalePrice: 30,
      retailPrice: 59.9,
      variants: {
        create: TAMANHOS.map((t) => ({ color: "Azul Marinho", size: t, stock: 0, sku: `RQD-MAR-${t}` })),
      },
    },
  });
  const ler = async () =>
    Object.fromEntries(
      (await db.productVariant.findMany({ where: { productId: prod.id } })).map((v) => [
        v.size,
        { stock: v.stock, ns: v.nuvemshopId },
      ])
    );
  const rodar = async (skus: Record<string, string>) => {
    const report: SyncReport = { casadas: 0, criadas: 0, pendencias: [] };
    await upsertProduct(co.id, produtoDeLa(skus), report);
    return report;
  };

  // 1. primeira sincronização, SKU repetido lá e nenhum vínculo: SKU
  //    repetido não identifica produto nenhum — nada é escrito, e cada
  //    variação vira pendência "repetido LÁ" (o código antigo punha o número
  //    do GG na P e deixava os outros zerados)
  const r1 = await rodar(repetido);
  let v = await ler();
  check(
    `1ª rodada sem vínculo, SKU repetido lá: nada escrito (${JSON.stringify(v)})`,
    TAMANHOS.every((t) => v[t].stock === 0 && v[t].ns === null)
  );
  check(
    `…4 pendências "repetido LÁ", sem a pista falsa de "repetido aqui" (${JSON.stringify(r1.pendencias.map((x) => [x.tamanho, x.repetidoLa, x.repetido]))})`,
    r1.pendencias.length === 4 && r1.pendencias.every((x) => x.repetidoLa === true && x.repetido === false && !x.skuParecido)
  );

  // 2. o estado de produção: a P daqui ligada à M de lá, M sem vínculo, G e
  //    GG ligadas certinho — com o SKU AINDA repetido lá
  for (const t of TAMANHOS) {
    await db.productVariant.updateMany({
      where: { productId: prod.id, size: t },
      data: {
        nuvemshopId: t === "P" ? "ns-M" : t === "M" ? null : `ns-${t}`,
        nuvemshopProductId: t === "M" ? null : "np-rqd",
        stock: t === "P" ? 50 : t === "M" ? 0 : ESTOQUE_LA[t],
      },
    });
  }
  await rodar(repetido);
  v = await ler();
  check(
    `estado torto + SKU ainda repetido: cada tamanho volta para o seu (${JSON.stringify(v)})`,
    TAMANHOS.every((t) => v[t].stock === ESTOQUE_LA[t] && v[t].ns === `ns-${t}`)
  );
  const carimbos = (await db.productVariant.findMany({ where: { product: { companyId: co.id }, nuvemshopId: { not: null } } })).map((x) => x.nuvemshopId);
  check("…e nenhuma peça de lá ficou ligada a duas daqui", new Set(carimbos).size === carimbos.length);

  // 2a. a mesma desordem, agora com a ordem da API ao contrário
  await db.productVariant.updateMany({ where: { productId: prod.id, size: "M" }, data: { nuvemshopId: null, nuvemshopProductId: null } });
  await db.productVariant.updateMany({ where: { productId: prod.id, size: "P" }, data: { nuvemshopId: "ns-M", stock: 50 } });
  const invertido = produtoDeLa(repetido);
  invertido.variants.reverse();
  await upsertProduct(co.id, invertido, { casadas: 0, criadas: 0, pendencias: [] });
  v = await ler();
  check(
    `…e com a ordem da API ao contrário dá o mesmo (${JSON.stringify(v)})`,
    TAMANHOS.every((t) => v[t].stock === ESTOQUE_LA[t] && v[t].ns === `ns-${t}`)
  );
  const produtoDeLaGravado = await db.productVariant.findMany({ where: { productId: prod.id } });
  check(
    `…com o produto de lá gravado em todas — sem ele a venda não avisaria a Nuvemshop (${JSON.stringify(produtoDeLaGravado.map((x) => [x.size, x.nuvemshopProductId]))})`,
    produtoDeLaGravado.every((x) => x.nuvemshopProductId === "np-rqd")
  );

  // 2b. um XG que só existe lá, pelo webhook (sem relatório)
  await db.nuvemshopConnection.create({
    data: { companyId: co.id, storeId: tag, accessToken: "x", lastSyncReport: JSON.stringify({ pendencias: [] }) },
  });
  const comXG = () => {
    const prodLa = produtoDeLa(repetido);
    prodLa.variants.push({ id: "ns-XG", sku: "RQD-MAR-P", price: "59.90", stock: 9, values: [{ pt: "Azul Marinho" }, { pt: "XG" }] });
    return prodLa;
  };
  await upsertProduct(co.id, comXG());
  await upsertProduct(co.id, comXG());
  const conn = await db.nuvemshopConnection.findUnique({ where: { companyId: co.id } });
  const guardadas = JSON.parse(conn!.lastSyncReport!).pendencias as { tamanho: string; repetidoLa?: boolean }[];
  check(
    `webhook: o XG com SKU repetido NÃO vira variação daqui (${await db.productVariant.count({ where: { productId: prod.id } })} variações)`,
    (await db.productVariant.count({ where: { productId: prod.id } })) === 4
  );
  check(
    `…a pendência "repetido LÁ" fica guardada UMA vez (${JSON.stringify(guardadas)})`,
    guardadas.length === 1 && guardadas[0].tamanho === "XG" && guardadas[0].repetidoLa === true
  );
  check("…e nenhum SKU ambíguo foi copiado para cá", (await db.productVariant.count({ where: { productId: prod.id, sku: "RQD-MAR-P" } })) === 1);

  // 3. a lojista corrige os SKUs na Nuvemshop
  const r3 = await rodar(corrigido);
  v = await ler();
  check(
    `SKU corrigido lá: P=4 ligada à P, M=50 ligada à M, sem soltar nada à mão (${JSON.stringify(v)})`,
    TAMANHOS.every((t) => v[t].stock === ESTOQUE_LA[t] && v[t].ns === `ns-${t}`)
  );
  check(`…sem pendência (${r3.pendencias.length})`, r3.pendencias.length === 0);

  // 4. rodada seguinte: nada muda, nada novo no livro
  const movs = await db.inventoryMovement.count({ where: { companyId: co.id } });
  await rodar(corrigido);
  check(
    "rodada seguinte não reescreve nada",
    (await db.inventoryMovement.count({ where: { companyId: co.id } })) === movs
  );

  // 5. produto NOVO lá (sem candidato aqui) com o SKU repetido na grade:
  //    entra espelhado, ligado pelo vínculo, mas sem copiar o SKU ambíguo
  await upsertProduct(
    co.id,
    {
      id: "np-nova",
      name: { pt: "Regata Nova" },
      attributes: [{ pt: "Cor" }, { pt: "Tamanho" }],
      variants: ["P", "M"].map((t) => ({ id: `nn-${t}`, sku: "NOVA-P", price: "50", stock: 3, values: [{ pt: "Preto" }, { pt: t }] })),
    },
    { casadas: 0, criadas: 0, pendencias: [] }
  );
  const novas = await db.productVariant.findMany({ where: { nuvemshopProductId: "np-nova", product: { companyId: co.id } } });
  check(
    `produto novo com SKU repetido lá: entra ligado, sem copiar o SKU (${JSON.stringify(novas.map((x) => [x.size, x.sku, x.nuvemshopId]))})`,
    novas.length === 2 && novas.every((x) => x.sku === null && x.nuvemshopId)
  );

  // 6. TRAVA DA COR vale também para a cor × tamanho: num produto que
  //    declara a cor no nome, a cor de fora que sobrou dentro dele (o
  //    incidente do Café no Branco) não é casada pelo SKU repetido
  const branco = await db.product.create({
    data: {
      companyId: co.id,
      name: "Baby Look — Branco",
      sku: `BL-${tag}`,
      category: "Baby Look",
      wholesalePrice: 20,
      retailPrice: 40,
      variants: {
        create: [
          { color: "Branco", size: "P", stock: 1, sku: "BL-BR-P" },
          { color: "Café", size: "P", stock: 1, sku: null },
        ],
      },
    },
  });
  await upsertProduct(
    co.id,
    {
      id: "np-bl",
      name: { pt: "Baby Look" },
      attributes: [{ pt: "Cor" }, { pt: "Tamanho" }],
      variants: [
        { id: "bl-br-p", sku: "BL-BR-P", price: "40", stock: 8, values: [{ pt: "Branco" }, { pt: "P" }] },
        { id: "bl-cf-p", sku: "BL-CAFE", price: "40", stock: 9, values: [{ pt: "Café" }, { pt: "P" }] },
        { id: "bl-cf-m", sku: "BL-CAFE", price: "40", stock: 9, values: [{ pt: "Café" }, { pt: "M" }] },
      ],
    },
    { casadas: 0, criadas: 0, pendencias: [] }
  );
  const vb = await db.productVariant.findMany({ where: { productId: branco.id }, orderBy: { color: "asc" } });
  check(
    `trava da cor: o Branco casa, o Café de fora não é casado nem criado (${JSON.stringify(vb.map((x) => [x.color, x.size, x.stock, x.nuvemshopId]))})`,
    vb.length === 2 &&
      vb.find((x) => x.color === "Branco")?.stock === 8 &&
      vb.find((x) => x.color === "Café")?.nuvemshopId === null &&
      vb.find((x) => x.color === "Café")?.stock === 1
  );

  await db.company.delete({ where: { id: co.id } });
  console.log("limpo");
}
main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
