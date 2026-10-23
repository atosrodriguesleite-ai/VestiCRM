/**
 * PROVA DE PONTA A PONTA — os AVISOS IRMÃOS da Nuvemshop (RN-014, 23/10/2026).
 *
 * A Nuvemshop manda `order/paid` + `order/updated` no mesmo segundo para o
 * MESMO pedido. Pela rota de verdade (webhook com HMAC), contra um Postgres
 * DE VERDADE (nunca o de produção) e uma Nuvemshop de mentira subida aqui
 * mesmo (porta 4598). Prova: três avisos juntos viram UM pedido, UMA cliente
 * e UM pós-venda, sem erro no painel de Saúde; a venda sem telefone não
 * deixa cliente órfã; o pedido apagado aqui e reenviado de lá reaproveita a
 * ficha; e o aviso repetido devolve o pedido que existe.
 *
 *   DATABASE_URL="postgresql://postgres@127.0.0.1:5433/vesti" \
 *     NUVEMSHOP_CLIENT_ID=teste NUVEMSHOP_CLIENT_SECRET=segredo-de-teste-nuvemshop \
 *     NUVEMSHOP_API_BASE=http://127.0.0.1:4598 npx next dev -p 3999
 *   DATABASE_URL="postgresql://postgres@127.0.0.1:5433/vesti" APP_URL=http://127.0.0.1:3999 \
 *     NUVEMSHOP_CLIENT_SECRET=segredo-de-teste-nuvemshop npx tsx scripts/e2e-nuvemshop-aviso-irmao.ts
 *
 * Cria a própria loja de teste e a apaga no fim.
 */
import crypto from "node:crypto";
import http from "node:http";
import { db } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";

const app = process.env.APP_URL ?? "http://127.0.0.1:3999";
const segredo = process.env.NUVEMSHOP_CLIENT_SECRET ?? "";
const ok = (t: string) => console.log(`  ✅ ${t}`);
const falha = (t: string) => {
  console.log(`  ❌ ${t}`);
  process.exitCode = 1;
};
const conferir = (cond: boolean, t: string) => (cond ? ok(t) : falha(t));
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** a Nuvemshop de mentira: devolve o pedido pedido, e nenhum produto */
const pedidosDeLa = new Map<string, Record<string, unknown>>();
const servidor = http.createServer((req, res) => {
  const m = /\/orders\/(\d+)/.exec(req.url ?? "");
  const o = m && pedidosDeLa.get(m[1]);
  if (!o) {
    res.writeHead(404, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: "não existe" }));
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(o));
});

const pedidoDeLa = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  number: 1000 + id,
  total: "150.00",
  shipping_cost_customer: "20.00",
  payment_status: "paid",
  status: "open",
  customer: {
    name: `Cliente ${id}`,
    email: `c${id}@x.com`,
    phone: "(11) 98888-00" + String(id).slice(-2),
  },
  shipping_address: { city: "Campinas", province: "SP" },
  products: [
    {
      product_id: 1,
      variant_id: 1,
      name: { pt: "Regata" },
      quantity: 2,
      price: "65.00",
    },
  ],
  ...extra,
});

async function webhook(storeId: string, event: string, id: number) {
  const raw = JSON.stringify({ store_id: storeId, event, id });
  const mac = crypto.createHmac("sha256", segredo).update(raw).digest("hex");
  const r = await fetch(`${app}/api/nuvemshop/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-linkedstore-hmac-sha256": mac,
    },
    body: raw,
  });
  return r.status;
}

async function errosDeWebhookDesde(t: Date) {
  return db.errorLog.count({
    where: {
      createdAt: { gte: t },
      message: { contains: "Nuvemshop: webhook" },
    },
  });
}

async function main() {
  await new Promise<void>((r) => servidor.listen(4598, r));
  const marca = Date.now();
  const storeId = String(marca % 1_000_000_000);
  const company = await db.company.create({
    data: { name: `Loja NS ${marca}`, slug: `loja-ns-${marca}` },
  });
  await db.nuvemshopConnection.create({
    data: {
      companyId: company.id,
      storeId,
      accessToken: encryptSecret("tok-teste"),
    },
  });
  const pedidosDaLoja = () =>
    db.order.findMany({ where: { companyId: company.id } });
  const clientesDaLoja = () =>
    db.customer.findMany({ where: { companyId: company.id } });

  console.log(
    "1) três avisos JUNTOS (paid + updated + updated) para a mesma venda, cliente COM telefone",
  );
  const id1 = 101;
  pedidosDeLa.set(String(id1), pedidoDeLa(id1));
  let inicio = new Date();
  let status = await Promise.all([
    webhook(storeId, "order/paid", id1),
    webhook(storeId, "order/updated", id1),
    webhook(storeId, "order/updated", id1),
  ]);
  conferir(
    status.every((s) => s === 200),
    `os três avisos respondem 200 (veio ${status.join(", ")})`,
  );
  let pedidos = await pedidosDaLoja();
  conferir(
    pedidos.length === 1 && pedidos[0].nuvemshopId === String(id1),
    "nasceu UM pedido",
  );
  conferir(
    pedidos[0]?.status === "PAGO" && pedidos[0]?.source === "NUVEMSHOP",
    "pago, da loja online",
  );
  const clientes = await clientesDaLoja();
  conferir(clientes.length === 1, `UMA cliente (veio ${clientes.length})`);
  await dormir(1500); // o after() do financeiro/aviso
  const eventosPedido = await db.customerEvent.count({
    where: { companyId: company.id, type: "PEDIDO" },
  });
  conferir(
    eventosPedido === 1,
    `UM evento "Compra na loja online" (veio ${eventosPedido})`,
  );
  conferir(
    (await errosDeWebhookDesde(inicio)) === 0,
    "nenhum erro de webhook no painel de Saúde",
  );

  console.log(
    "2) três avisos juntos, cliente SEM telefone (a ficha nasce dentro da fila)",
  );
  const id2 = 102;
  pedidosDeLa.set(
    String(id2),
    pedidoDeLa(id2, { customer: { name: "Sem Fone", email: "s@x.com" } }),
  );
  inicio = new Date();
  status = await Promise.all([
    webhook(storeId, "order/paid", id2),
    webhook(storeId, "order/updated", id2),
    webhook(storeId, "order/updated", id2),
  ]);
  conferir(
    status.every((s) => s === 200),
    `os três respondem 200 (veio ${status.join(", ")})`,
  );
  pedidos = await pedidosDaLoja();
  conferir(
    pedidos.filter((p) => p.nuvemshopId === String(id2)).length === 1,
    "UM pedido da venda 102",
  );
  const orfas = await db.customer.findMany({
    where: { companyId: company.id, phone: `ns-${id2}` },
  });
  conferir(
    orfas.length === 1,
    `UMA cliente "ns-102", sem órfã (veio ${orfas.length})`,
  );
  conferir(
    (await errosDeWebhookDesde(inicio)) === 0,
    "nenhum erro de webhook no painel de Saúde",
  );

  console.log(
    "3) o pedido 102 é apagado aqui e a Nuvemshop reenvia: reaproveita a ficha, sem 500",
  );
  await db.order.deleteMany({
    where: { companyId: company.id, nuvemshopId: String(id2) },
  });
  inicio = new Date();
  const s3 = await webhook(storeId, "order/updated", id2);
  conferir(s3 === 200, `responde 200 (veio ${s3})`);
  const denovo = await db.order.findMany({
    where: { companyId: company.id, nuvemshopId: String(id2) },
  });
  conferir(denovo.length === 1, "o pedido renasce");
  const fichas = await db.customer.findMany({
    where: { companyId: company.id, phone: `ns-${id2}` },
  });
  conferir(
    fichas.length === 1 && denovo[0]?.customerId === fichas[0]?.id,
    "na MESMA ficha ns-102",
  );
  conferir(
    (await errosDeWebhookDesde(inicio)) === 0,
    "nenhum erro no painel de Saúde",
  );

  console.log(
    "4) aviso repetido minutos depois: devolve o que existe, nada muda",
  );
  const antes = (await pedidosDaLoja()).length;
  const s4 = await webhook(storeId, "order/paid", id1);
  conferir(
    s4 === 200 && (await pedidosDaLoja()).length === antes,
    "200 e o mesmo número de pedidos",
  );

  console.log(
    "5) pedido que não existe lá: o GET falha, nada é criado e a resposta é 200 mudo (contrato de sempre)",
  );
  // o GET falha → ingestPaidOrder devolve null sem criar e sem erro: 200 mudo é o contrato
  const s5 = await webhook(storeId, "order/paid", 999);
  conferir(
    s5 === 200 && (await pedidosDaLoja()).length === antes,
    "pedido inexistente lá: 200, nada criado",
  );

  await db.company.delete({ where: { id: company.id } });
  servidor.close();
  await db.$disconnect();
  console.log(process.exitCode ? "\n❌ FALHOU" : "\n✅ TUDO CERTO");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
