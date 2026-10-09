/**
 * PROVA DE PONTA A PONTA — pedido do catálogo numa loja SEM CORES
 * (semijoias: peças "Único" × "Único", muitas linhas, cliente com nome e
 * telefone), pela rota de verdade, com o MESMO payload que a vitrine monta.
 * E a segunda metade da RN-010: a RECUSA deixa rastro na Central de
 * Comunicação da loja (relato Sutilli, 09/10/2026).
 *
 *   npx next dev -p 3999
 *   DATABASE_URL="postgresql://postgres@127.0.0.1:5433/vesti" APP_URL=http://127.0.0.1:3999 \
 *     npx tsx scripts/e2e-pedido-catalogo-sem-cores.ts
 *
 * Cria a própria loja de teste e a apaga no fim.
 */
import { db } from "@/lib/db";
import { FONTE_RECUSA_CATALOGO, TIPO_PEDIDO_RECUSADO } from "@/lib/catalogo/recusa-do-pedido";

const ok = (t: string) => console.log(`  ✅ ${t}`);
const falha = (t: string) => {
  console.log(`  ❌ ${t}`);
  process.exitCode = 1;
};
const conferir = (cond: boolean, t: string) => (cond ? ok(t) : falha(t));

async function main() {
  const app = process.env.APP_URL ?? "http://127.0.0.1:3999";
  const marca = Date.now();
  const company = await db.company.create({
    data: {
      name: `Semijoias Teste ${marca}`,
      slug: `semijoias-${marca}`,
      whatsapp: "5511999990000",
      catalogHideColors: true,
      catalogPriceMode: "VAREJO",
    },
  });
  const cats = ["Brinco", "Geral", "Colar", "Acessórios", "Conjunto"];
  const produtos = [];
  for (let i = 0; i < 25; i++) {
    produtos.push(
      await db.product.create({
        data: {
          companyId: company.id,
          name: `Peça ${i} crav meio`,
          sku: `SKU-${marca}-${i}`,
          category: cats[i % cats.length],
          retailPrice: 45.9 + i,
          wholesalePrice: 30 + i,
          variants: { create: [{ color: "Único", size: "Único", stock: 3 }] },
        },
        include: { variants: true },
      })
    );
  }
  const items = produtos.map((p) => ({
    productId: p.id,
    color: p.variants[0].color,
    size: p.variants[0].size,
    quantity: 1,
  }));
  const mandar = async (payload: unknown, ip = `10.8.${marca % 200}.${marca % 250}`) => {
    const r = await fetch(`${app}/api/catalog/order`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-real-ip": ip },
      body: JSON.stringify(payload),
    });
    // o rastro da recusa é gravado no after() do Next, depois da resposta
    await new Promise((res) => setTimeout(res, 600));
    return { status: r.status, corpo: (await r.json().catch(() => ({}))) as Record<string, unknown> };
  };
  const base = {
    company: company.slug,
    customer: { name: "Celia Rosa", phone: "(35) 99713-3320" },
    message: `*Novo pedido — ${company.name}*\n\n` + produtos.map((p) => `• ${p.name} — Único ×1  (1 peça · R$ ${p.retailPrice})`).join("\n"),
  };

  console.log("1) pedido de 25 linhas, loja sem cores");
  const r1 = await mandar({ ...base, items, clientRef: `cat-${marca.toString(36)}-aaaaaaaaaaaaaaaa` });
  conferir(r1.status === 201, `rota respondeu 201 (veio ${r1.status} ${JSON.stringify(r1.corpo)})`);
  const pedidos = await db.order.findMany({
    where: { companyId: company.id },
    select: { status: true, _count: { select: { items: true } } },
  });
  conferir(pedidos.length === 1 && pedidos[0]._count.items === 25, "o pedido existe na loja com as 25 linhas");
  conferir(pedidos[0]?.status === "AGUARDANDO_PAGAMENTO", "nasce aguardando pagamento");

  console.log("2) recusa deixa rastro — peça que não existe mais");
  const r2 = await mandar({
    ...base,
    items: [items[0], { ...items[1], size: "M" }],
    clientRef: `cat-${marca.toString(36)}-bbbbbbbbbbbbbbbb`,
  });
  conferir(r2.status === 404, `rota recusou com 404 (veio ${r2.status})`);
  const rastro = await db.commEvent.findMany({
    where: { companyId: company.id, type: TIPO_PEDIDO_RECUSADO },
    orderBy: { createdAt: "desc" },
  });
  conferir(rastro.length === 1, "uma linha na Central de Comunicação da loja");
  conferir((rastro[0]?.error ?? "").includes("Celia Rosa"), "o rastro diz quem pediu");
  conferir((rastro[0]?.error ?? "").includes(`"${produtos[1].name}" existe, mas não tem a variação Único / M`), "o rastro diz QUAL peça e QUAL variação faltou");
  conferir((rastro[0]?.error ?? "").includes("cat-" + marca.toString(36) + "-bbbbbbbbbbbbbbbb"), "o rastro traz o protocolo");
  const saude = await db.errorLog.findFirst({
    where: { source: FONTE_RECUSA_CATALOGO, detail: { contains: company.id } },
    orderBy: { createdAt: "desc" },
  });
  conferir(!!saude && saude.message.includes(`${company.name}: pedido do catálogo recusado (404)`), "o painel de Saúde recebeu a recusa com fonte própria e o nome da loja");
  conferir((await db.order.count({ where: { companyId: company.id } })) === 1, "pedido recusado não foi gravado");

  console.log("3) recusa com dados inválidos (campo torto) também deixa rastro, achando a loja pelo endereço");
  const r3 = await mandar({ ...base, items: [{ ...items[0], size: "" }], clientRef: `cat-${marca.toString(36)}-cccccccccccccccc` });
  conferir(r3.status === 400, `rota recusou com 400 (veio ${r3.status})`);
  const rastro3 = await db.commEvent.findFirst({
    where: { companyId: company.id, type: TIPO_PEDIDO_RECUSADO, error: { contains: "tamanho da peça (items.0.size) em branco" } },
  });
  conferir(!!rastro3, "o rastro diz qual campo foi recusado, em português (tamanho da peça em branco)");

  console.log("4) o rastro tem teto por IP + loja — a resposta à cliente não muda");
  const ip = `10.9.${marca % 200}.${marca % 250}`;
  let respostas = 0;
  for (let i = 0; i < 12; i++) {
    const r = await mandar(
      { ...base, items: [{ ...items[0], size: "" }], clientRef: `cat-${marca.toString(36)}-d${i}dddddddddddddd` },
      ip
    );
    if (r.status === 400) respostas++;
  }
  conferir(respostas === 12, "as 12 recusas responderam 400 à cliente, com ou sem rastro");
  const rastrosDoIp = await db.commEvent.count({
    where: { companyId: company.id, type: TIPO_PEDIDO_RECUSADO, error: { contains: "-d" } },
  });
  conferir(rastrosDoIp === 10, `só 10 viraram rastro (vieram ${rastrosDoIp})`);
  await db.loginThrottle.deleteMany({ where: { key: { startsWith: "catrec:" } } });

  console.log("5) reenvio de pedido que JÁ ENTROU não vira recusa (mesmo com algo a recusar depois)");
  const r5 = await mandar({ ...base, items: [{ ...items[0], size: "M" }], clientRef: `cat-${marca.toString(36)}-aaaaaaaaaaaaaaaa` });
  conferir(r5.status === 200 && r5.corpo.jaRegistrado === true, "respondeu 'já registrado' pelo protocolo do passo 1");
  conferir(
    (await db.commEvent.count({ where: { companyId: company.id, type: TIPO_PEDIDO_RECUSADO } })) === 12,
    "nenhum rastro novo nasceu"
  );

  await db.errorLog.deleteMany({ where: { detail: { contains: company.id } } });
  await db.company.delete({ where: { id: company.id } });
  await db.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
