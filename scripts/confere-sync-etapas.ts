/**
 * CONFERE A SINCRONIZAÇÃO EM ETAPAS DA NUVEMSHOP contra o Postgres local
 * (Entre Linhas, 15/09/2026). Roda com uma Nuvemshop de mentira e prova:
 * orçamento estourado faz SEMPRE um produto e devolve parcial; a retomada
 * anda pela posição e, se a página mudou de ordem, pelo id do último feito;
 * o rastro aponta a próxima posição e some no fim; nada é reescrito à toa.
 *
 *   DATABASE_URL=... AUTH_SECRET=... NUVEMSHOP_CLIENT_ID=x NUVEMSHOP_CLIENT_SECRET=y \
 *   npx tsx --tsconfig tsconfig.json scripts/confere-sync-etapas.ts
 */
import { db } from "@/lib/db";
import { syncPaginaDeProdutos } from "@/lib/nuvemshop";
import { encryptSecret } from "@/lib/crypto";

const check = (n: string, ok: boolean) => console.log(ok ? "✅" : "❌", n);
async function main() {
  const tag = `se-${Date.now()}`;
  const co = await db.company.create({ data: { name: tag, slug: tag } });
  await db.nuvemshopConnection.create({ data: { companyId: co.id, storeId: tag, accessToken: encryptSecret("tok") } });
  for (let i = 0; i < 30; i++) {
    await db.product.create({ data: { companyId: co.id, name: `Peça ${i}`, sku: `P${i}`, category: "Blusas", wholesalePrice: 50, retailPrice: 90, nuvemshopId: `np-${i}`,
      variants: { create: [{ color: "Preto", size: "U", stock: 5, sku: `P${i}-U`, nuvemshopId: `nv-${i}` }] } } });
  }
  const pagina = (page: number) => Array.from({ length: page === 1 ? 25 : 5 }, (_, k) => {
    const i = (page - 1) * 25 + k;
    return { id: `np-${i}`, name: { pt: `Peça ${i}` }, published: true, variants: [{ id: `nv-${i}`, sku: `P${i}-U`, price: "90.00", stock: 7 + i, values: [{ pt: "Preto" }, { pt: "U" }] }] };
  });
  let gets = 0;
  (globalThis as { fetch: unknown }).fetch = async (url: string) => {
    gets++;
    const page = Number(new URL(url).searchParams.get("page"));
    return { ok: true, status: 200, json: async () => pagina(page) };
  };

  // orçamento de 0 ms: cada etapa faz UM produto e devolve parcial — é o
  // caminho da página lenta, só que rápido de testar
  let page = 1, desde = 0, etapas = 0, fim = false;
  const vistos: string[] = [];
  while (!fim && etapas < 100) {
    const r = await syncPaginaDeProdutos(co.id, page, desde, 0);
    etapas++;
    vistos.push(`${page}:${desde}+${r.produtos}${r.parcial ? "p" : ""}`);
    fim = r.fim; page = r.proximaPagina ?? page; desde = r.desde ?? 0;
    if (etapas === 3) {
      const conn = await db.nuvemshopConnection.findUnique({ where: { companyId: co.id } });
      check("rastro aponta a PRÓXIMA posição depois de 3 etapas (página 1, produto 4)", JSON.parse(conn!.lastSyncEtapa!).pagina === 1 && JSON.parse(conn!.lastSyncEtapa!).desde === 3);
    }
  }
  check("etapa com orçamento estourado faz SEMPRE 1 produto e devolve parcial com 'desde' andando", vistos[0] === "1:0+1p" && vistos[1] === "1:1+1p" && vistos[24] === "1:24+1");
  check("depois da página 1 inteira vai para a página 2 do zero e termina", vistos[25] === "2:0+1p" && fim && etapas === 30);
  const conn = await db.nuvemshopConnection.findUnique({ where: { companyId: co.id } });
  check("ao terminar, o rastro some e a data da sincronização é gravada", conn!.lastSyncEtapa === null && conn!.lastProductSync !== null);
  const v = await db.productVariant.findMany({ where: { product: { companyId: co.id } }, orderBy: { sku: "asc" } });
  check("todos os 30 estoques vieram da Nuvemshop (7 + i)", v.every((x) => x.stock === 7 + Number(x.sku!.slice(1, -2))));
  check(`o relatório somou as 30 variações casadas (${JSON.parse(conn!.lastSyncReport).casadas})`, JSON.parse(conn!.lastSyncReport).casadas === 30);

  // retomada pelo ID quando a página mudou de ordem: a etapa parcial fez
  // até "np-4" (desde=5); antes da próxima chamada a loja apagou "np-0" e a
  // página andou — pela posição pularia "np-5"; pelo id, segue certinho
  const paginaSemPrimeiro = () => pagina(1).slice(1);
  (globalThis as { fetch: unknown }).fetch = async () => ({ ok: true, status: 200, json: async () => paginaSemPrimeiro() });
  await db.productVariant.updateMany({ where: { product: { companyId: co.id } }, data: { stock: 0 } });
  const r2 = await syncPaginaDeProdutos(co.id, 1, 5, 0, "np-4");
  const v5 = await db.productVariant.findFirst({ where: { nuvemshopId: "nv-5" } });
  // a posição devolvida é a da página COMO ELA ESTÁ AGORA (np-5 é o 5º item da página sem o np-0)
  check(`retomada pelo id: fez 'np-5' (o que a posição teria pulado) [${JSON.stringify({ produtos: r2.produtos, stock: v5?.stock, apos: r2.apos, desde: r2.desde })}]`, r2.produtos === 1 && v5?.stock === 12 && r2.apos === "np-5" && r2.desde === 5);
  (globalThis as { fetch: unknown }).fetch = async (url: string) => ({ ok: true, status: 200, json: async () => pagina(Number(new URL(url).searchParams.get("page"))) });

  // orçamento normal: a página inteira numa etapa só — e, com os números
  // já iguais aos de lá, nada é reescrito (nenhum movimento novo no livro)
  await syncPaginaDeProdutos(co.id, 1, 0); // deixa tudo igual à Nuvemshop
  const movsAntes = await db.inventoryMovement.count({ where: { companyId: co.id } });
  const r = await syncPaginaDeProdutos(co.id, 1, 0);
  const movsDepois = await db.inventoryMovement.count({ where: { companyId: co.id } });
  check("página igual à Nuvemshop: 25 produtos numa etapa, sem parcial e sem reescrever nada", r.produtos === 25 && !r.parcial && movsDepois === movsAntes);

  await db.company.delete({ where: { id: co.id } });
  console.log("limpo");
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
