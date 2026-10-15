/**
 * PROVA DE PONTA A PONTA — a sincronização automática da Jueri (RN-077).
 *
 * Roda contra um Postgres DE VERDADE (nunca o de produção) com uma Jueri de
 * mentira subida aqui mesmo (porta 4599). Prova: estoque e fotos acompanham
 * a Jueri, a foto que a loja subiu fica, a rodada parcial retoma da página
 * certa e a falha deixa rastro no cartão, na Central e na Saúde.
 *
 *   DATABASE_URL="postgresql://postgres@127.0.0.1:5433/vesti" JUERI_API_BASE=http://127.0.0.1:4599 \
 *     npx tsx scripts/e2e-jueri-sync.ts
 *
 * Cria a própria loja de teste e a apaga no fim.
 */
import http from "node:http";
import { db } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { rodarSyncJueriDoCron, TIPO_SYNC_JUERI } from "@/lib/jueri-sync";

const ok = (t: string) => console.log(`  ✅ ${t}`);
const falha = (t: string) => {
  console.log(`  ❌ ${t}`);
  process.exitCode = 1;
};
const conferir = (cond: boolean, t: string) => (cond ? ok(t) : falha(t));

/** a Jueri de mentira: o que ela responde é trocado pelo roteiro */
const jueri = {
  produtos: [] as Record<string, unknown>[][], // por página
  falhar: false,
};
const servidor = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname.endsWith("/produto/categoria")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify([{ id: 1, nome: "Brinco" }]));
  }
  if (jueri.falhar) {
    res.writeHead(500, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: "fora do ar" }));
  }
  const page = Number(url.searchParams.get("page") ?? "1");
  const data = jueri.produtos[page - 1] ?? [];
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ data, next_page_url: page < jueri.produtos.length ? `?page=${page + 1}` : null }));
});

const produto = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  descricao: `Brinco ${id}`,
  referencia: `REF-${id}`,
  cor: "Dourado",
  quantidade: 5,
  custo_total: 10,
  fk_categoria_id: 1,
  fk_status_id: 1,
  imagem: `http://127.0.0.1:4599/f/${id}-a.jpg`,
  fotos_adicionais: [`http://127.0.0.1:4599/f/${id}-b.jpg`],
  tipo_preco: [
    { nome: "Varejo", pivot: { preco: 50 } },
    { nome: "Atacado", pivot: { preco: 30 } },
  ],
  ...extra,
});

async function main() {
  await new Promise<void>((r) => servidor.listen(4599, r));
  const marca = Date.now();
  const company = await db.company.create({
    data: { name: `Loja Jueri ${marca}`, slug: `loja-jueri-${marca}` },
  });
  await db.jueriConnection.create({
    data: { companyId: company.id, clienteSistema: "11407", token: encryptSecret("tok-teste") },
  });
  const prazoLongo = () => Date.now() + 60_000;

  console.log("1) primeira rodada: cria os produtos com estoque e fotos da Jueri");
  jueri.produtos = [[produto(1), produto(2)]];
  let out = await rodarSyncJueriDoCron(company.id, prazoLongo());
  conferir(out.ok && !out.parcial, "rodada completa");
  const p1 = await db.product.findFirstOrThrow({
    where: { companyId: company.id, jueriId: "1" },
    include: { variants: true, images: { orderBy: { order: "asc" } } },
  });
  conferir(p1.variants[0].stock === 5, "estoque 5 veio da Jueri");
  conferir(p1.images.map((i) => i.url).join(",") === "http://127.0.0.1:4599/f/1-a.jpg,http://127.0.0.1:4599/f/1-b.jpg", "duas fotos da Jueri, na ordem");
  const conn1 = await db.jueriConnection.findUniqueOrThrow({ where: { companyId: company.id } });
  conferir(!!conn1.lastSyncAt && conn1.lastSyncPagina === null && conn1.lastSyncErro === null, "cartão: importação completa, sem página pendente, sem erro");
  conferir(
    (await db.commEvent.count({ where: { companyId: company.id, type: TIPO_SYNC_JUERI, status: "OK" } })) === 1,
    "uma linha OK na Central de Comunicação"
  );

  console.log("2) a cliente vendeu na Jueri (5 → 2) e trocou a foto; a loja subiu uma foto própria aqui");
  await db.productImage.create({ data: { productId: p1.id, url: "data:image/png;base64,AAAA", order: 0 } });
  jueri.produtos = [[produto(1, { quantidade: 2, imagem: "http://127.0.0.1:4599/f/1-NOVA.jpg", fotos_adicionais: [] }), produto(2)]];
  out = await rodarSyncJueriDoCron(company.id, prazoLongo());
  conferir(out.ok && out.resumo.fotosTrocadas === 1, "rodada OK e uma peça com fotos trocadas");
  const p1b = await db.product.findUniqueOrThrow({
    where: { id: p1.id },
    include: { variants: true, images: { orderBy: { order: "asc" }, select: { url: true, order: true } } },
  });
  conferir(p1b.variants[0].stock === 2, "estoque acompanhou a venda na Jueri (2)");
  // a foto nova da Jueri entra NO LUGAR da antiga (a capa continua sendo a
  // da Jueri); a foto que a loja subiu fica, atrás, onde estava
  conferir(
    p1b.images.length === 2 && p1b.images[0].url.endsWith("1-NOVA.jpg") && p1b.images[1].url.startsWith("data:"),
    `a foto da Jueri foi trocada pela nova no lugar dela e a da loja ficou (veio ${p1b.images.map((i) => i.url.slice(0, 12)).join(" | ")})`
  );
  const mov = await db.inventoryMovement.findFirst({ where: { variantId: p1.variants[0].id, reason: { contains: "5 → 2" } } });
  conferir(!!mov, "o livro de movimentos registra o ajuste da Jueri");
  const p2 = await db.product.findFirstOrThrow({ where: { companyId: company.id, jueriId: "2" }, include: { images: true } });
  conferir(p2.images.length === 2, "produto sem mudança continua com as fotos dele");

  console.log("2b) a loja tirou uma foto da Jueri e tem uma foto de link de outra origem: a Jueri sem mudança não mexe");
  const fotoNs = await db.productImage.create({ data: { productId: p1.id, url: "http://outra-origem/ns.jpg", order: 9 } });
  await db.productImage.deleteMany({ where: { productId: p1.id, source: "JUERI" } }); // a loja tirou a foto da Jueri
  out = await rodarSyncJueriDoCron(company.id, prazoLongo());
  const p1c = await db.product.findUniqueOrThrow({ where: { id: p1.id }, include: { images: { select: { id: true, source: true } } } });
  conferir(out.ok && out.resumo.fotosTrocadas === 0 && p1c.images.length === 2, "a Jueri não mudou: a foto tirada não volta e nada é recriado");
  jueri.produtos = [[produto(1, { quantidade: 2, imagem: "http://127.0.0.1:4599/f/1-NOVA2.jpg", fotos_adicionais: [] }), produto(2)]];
  out = await rodarSyncJueriDoCron(company.id, prazoLongo());
  const p1d = await db.product.findUniqueOrThrow({ where: { id: p1.id }, include: { images: { orderBy: { order: "asc" }, select: { id: true, url: true, source: true } } } });
  conferir(
    p1d.images.some((i) => i.id === fotoNs.id) && p1d.images.some((i) => i.url.endsWith("1-NOVA2.jpg") && i.source === "JUERI"),
    "a Jueri mudou: a foto nova entra marcada e a foto de outra origem (link sem marca) fica"
  );

  console.log("2c) SKU repetido na MESMA página (referência igual em duas cores) não derruba a página");
  jueri.produtos = [[produto(7, { referencia: "REF-IGUAL", cor: "Dourado" }), produto(8, { referencia: "REF-IGUAL", cor: "Prata" })]];
  out = await rodarSyncJueriDoCron(company.id, prazoLongo());
  conferir(out.ok === true, `a rodada passou (veio ${out.error ?? "ok"})`);
  conferir((await db.product.count({ where: { companyId: company.id, sku: "REF-IGUAL" } })) === 1, "um produto só com esse SKU");

  console.log("2d) peça SEM cor na Jueri nasce com a cor \"Único\" (RN-078) — cor vazia derrubava o pedido do catálogo");
  jueri.produtos = [[produto(9, { referencia: "REF-SEM-COR", cor: "" }), produto(10, { referencia: "REF-COR-NULA", cor: null })]];
  out = await rodarSyncJueriDoCron(company.id, prazoLongo());
  const semCor = await db.productVariant.findMany({
    where: { product: { companyId: company.id, jueriId: { in: ["9", "10"] } } },
    select: { color: true },
  });
  conferir(semCor.length === 2 && semCor.every((v) => v.color === "Único"), `as duas nasceram "Único" (vieram ${JSON.stringify(semCor.map((v) => v.color))})`);
  // a peça que ficou com a cor vazia (código velho rodando durante o deploy) se cura na rodada seguinte
  await db.productVariant.updateMany({ where: { product: { companyId: company.id, jueriId: { in: ["9", "10"] } } }, data: { color: "" } });
  jueri.produtos = [[produto(9, { referencia: "REF-SEM-COR", cor: "" }), produto(10, { referencia: "REF-COR-NULA", cor: null, quantidade: 1 })]];
  out = await rodarSyncJueriDoCron(company.id, prazoLongo());
  const curadas = await db.productVariant.findMany({
    where: { product: { companyId: company.id, jueriId: { in: ["9", "10"] } } },
    select: { color: true },
  });
  conferir(curadas.every((v) => v.color === "Único"), `a cor vazia se curou na sync, com e sem mudança de estoque (vieram ${JSON.stringify(curadas.map((v) => v.color))})`);

  console.log("3) catálogo grande com prazo curto: para entre páginas e RETOMA na rodada seguinte");
  jueri.produtos = [[produto(1, { quantidade: 2 })], [produto(3)], [produto(4)]];
  out = await rodarSyncJueriDoCron(company.id, Date.now() - 1);
  conferir(out.ok === true && out.parcial === true && out.proximaPagina === 2, `parou depois da página 1, próxima é a 2 (veio ${JSON.stringify({ parcial: out.parcial, proxima: out.proximaPagina })})`);
  let conn = await db.jueriConnection.findUniqueOrThrow({ where: { companyId: company.id } });
  conferir(conn.lastSyncPagina === 2 && conn.lastSyncErro === null, "cartão guarda a página 2 pendente, sem erro");
  conferir((await db.product.count({ where: { companyId: company.id, jueriId: "3" } })) === 0, "o produto da página 2 ainda não entrou");
  const antes = conn.lastSyncAt!.getTime();
  out = await rodarSyncJueriDoCron(company.id, prazoLongo());
  conferir(out.ok && !out.parcial, "a rodada seguinte terminou o catálogo");
  conn = await db.jueriConnection.findUniqueOrThrow({ where: { companyId: company.id } });
  conferir(conn.lastSyncPagina === null && conn.lastSyncAt!.getTime() > antes, "cartão: importação completa, página pendente apagada");
  conferir((await db.product.count({ where: { companyId: company.id, jueriId: { in: ["3", "4"] } } })) === 2, "os produtos das páginas 2 e 3 entraram");

  console.log("4) a Jueri fora do ar: a rodada falha COM rastro");
  jueri.falhar = true;
  out = await rodarSyncJueriDoCron(company.id, prazoLongo());
  conferir(out.ok === false && (out.error ?? "").includes("parou na página 1"), "o erro diz a página");
  conn = await db.jueriConnection.findUniqueOrThrow({ where: { companyId: company.id } });
  conferir(!!conn.lastSyncErro && conn.lastSyncPagina === 1 && !!conn.lastSyncTentativaEm, "cartão: erro, página 1 pendente e hora da tentativa");
  conferir(
    (await db.commEvent.count({ where: { companyId: company.id, type: TIPO_SYNC_JUERI, status: "ERRO" } })) === 1,
    "uma linha ERRO na Central de Comunicação"
  );
  const saude = await db.errorLog.findFirst({ where: { path: "GET /api/cron/jueri-sync", detail: { contains: company.id } } });
  conferir(!!saude, "o painel de Saúde recebeu a falha");
  jueri.falhar = false;
  out = await rodarSyncJueriDoCron(company.id, prazoLongo());
  conn = await db.jueriConnection.findUniqueOrThrow({ where: { companyId: company.id } });
  conferir(out.ok && conn.lastSyncErro === null, "a Jueri voltou: a rodada seguinte limpa o erro");

  await db.errorLog.deleteMany({ where: { detail: { contains: company.id } } });
  await db.company.delete({ where: { id: company.id } });
  await db.$disconnect();
  servidor.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
