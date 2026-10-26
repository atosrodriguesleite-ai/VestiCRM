/**
 * PROVA DE PONTA A PONTA — número de fora do Brasil (RN-096) e o mesmo pedido
 * do catálogo chegando de OUTRO WhatsApp (RN-097).
 *
 * Roda contra um Postgres DE VERDADE (nunca o de produção), passando pelo
 * webhook de verdade e pela porta de verdade do pedido do catálogo. O caso
 * que motivou (Toque Leve, 26/10/2026): a cliente preenche o pedido com o
 * (19) 98839-4961 e aperta "enviar" no WhatsApp do aparelho, que é o
 * +1 781 408-6755 — nasciam dois cadastros, duas conversas e a bolha do
 * pedido duas vezes, e o número de fora virava "(17) 81408-6755".
 *
 * Com o app rodando (o webhook e a porta do pedido usam o after() do Next):
 *
 *   EVOLUTION_URL=http://127.0.0.1:4598 EVOLUTION_KEY=x npx next dev -p 3999
 *   DATABASE_URL="postgresql://postgres@127.0.0.1:5433/vesti" APP_URL=http://127.0.0.1:3999 npx tsx scripts/e2e-pedido-de-outro-numero.ts
 *
 * Cria a própria loja de teste e a apaga no fim.
 */
import http from "node:http";
import { db } from "@/lib/db";
import { juntarDepoisDoPedido } from "@/lib/comm/pedido-de-outro-numero";

const ok = (t: string) => console.log(`  ✅ ${t}`);
const falha = (t: string) => {
  console.log(`  ❌ ${t}`);
  process.exitCode = 1;
};
const conferir = (cond: boolean, t: string) => (cond ? ok(t) : falha(t));
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Evolution de mentira: o webhook pode tentar reassinar os eventos (de
// carona) — responde OK e pronto
const servidor = http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
});

async function main() {
  await new Promise<void>((r) => servidor.listen(4598, r));
  const app = process.env.APP_URL ?? "http://127.0.0.1:3999";
  const marca = Date.now();
  const company = await db.company.create({
    data: {
      name: `Loja Outro Número ${marca}`,
      slug: `loja-outro-numero-${marca}`,
      whatsapp: "5511999990000",
    },
  });
  const token = `tok-on-${marca}`;
  await db.commSettings.create({
    data: {
      companyId: company.id,
      evolutionInstance: "inst-teste",
      evolutionWebhookToken: token,
      activeProvider: "EVOLUTION",
    },
  });
  const produto = await db.product.create({
    data: {
      companyId: company.id,
      name: `Regata Alça ${marca}`,
      sku: `SKU-ON-${marca}`,
      category: "Regatas",
      retailPrice: 34,
      wholesalePrice: 25,
      variants: { create: [{ color: "Preto", size: "M", stock: 50 }] },
    },
    include: { variants: true },
  });
  const items = [{ productId: produto.id, color: "Preto", size: "M", quantity: 2 }];

  let seq = 0;
  const webhook = async (jidDigits: string, texto: string, pushName = "Cliente Teste") => {
    const id = `MSG${marca}-${++seq}`;
    const r = await fetch(`${app}/api/whatsapp/evolution/webhook/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event: "messages.upsert",
        data: {
          key: { remoteJid: `${jidDigits}@s.whatsapp.net`, fromMe: false, id },
          pushName,
          message: { conversation: texto },
          messageType: "conversation",
        },
      }),
    });
    if (!r.ok) throw new Error(`webhook respondeu ${r.status}: ${await r.text()}`);
    await esperar(400);
    return id;
  };
  const pedido = async (fone: string, texto: string, nome = "Rafaela Teste") => {
    const clientRef = `cat-${marca.toString(36)}-${String(++seq).padStart(16, "x")}`;
    const r = await fetch(`${app}/api/catalog/order`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-real-ip": `10.9.${seq % 200}.${marca % 250}` },
      body: JSON.stringify({ company: company.slug, customer: { name: nome, phone: fone }, message: texto, items, clientRef }),
    });
    const corpo = (await r.json().catch(() => ({}))) as { orderId?: string };
    if (r.status !== 201) throw new Error(`pedido respondeu ${r.status}: ${JSON.stringify(corpo)}`);
    await esperar(400);
    return corpo.orderId as string;
  };
  const textoDoPedido = (n: number) =>
    `*Novo pedido — ${company.name}*\n\n*Regatas*\n• ${produto.name} Preto — M ×2  (2 peças · R$ 68,00)\n\n*Total:* 2 peças · R$ 68,00\n\n*Cliente*\nNome: Rafaela Teste\nTelefone: (${n}) 98839-4961\n\n_Valores sujeitos a confirmação._`;
  const clientes = (phone: string) => db.customer.findMany({ where: { companyId: company.id, phone } });
  const mensagensCom = (texto: string) =>
    db.message.findMany({
      where: { conversation: { companyId: company.id }, body: texto, kind: "TEXT" },
      select: { externalId: true, conversation: { select: { customerId: true } } },
    });
  const conversasAbertas = (customerId: string) =>
    db.conversation.count({ where: { companyId: company.id, customerId, status: { not: "CLOSED" } } });

  try {
    console.log("\n1) RN-096 — a cliente dos EUA escreve: o número fica como o WhatsApp manda");
    await webhook("17814086755", "Oi, tudo bem?", "Rafaela EUA");
    const eua = await clientes("17814086755");
    conferir(eua.length === 1, "nasceu UM cadastro com o número 17814086755");
    conferir((await clientes("5517814086755")).length === 0, "nenhum cadastro com o 55 colado");
    conferir(eua[0]?.name === "Rafaela EUA", "com o nome do WhatsApp");

    console.log("\n2) RN-096 — o cadastro antigo com o 55 colado é curado na primeira mensagem");
    const antigo = await db.customer.create({
      data: { companyId: company.id, name: "Cliente Antiga", phone: "5514155552671", origin: "WHATSAPP" },
    });
    await webhook("14155552671", "Oi de novo", "Cliente Antiga");
    const curado = await db.customer.findUnique({ where: { id: antigo.id } });
    conferir(curado?.phone === "14155552671", `o MESMO cadastro passou a ter o número certo (veio ${curado?.phone})`);
    conferir((await clientes("14155552671")).length === 1, "e não nasceu um segundo");
    const eventoCura = await db.customerEvent.findFirst({
      where: { customerId: antigo.id, description: { contains: "Telefone corrigido" } },
    });
    conferir(!!eventoCura, "a linha do tempo diz que o telefone foi corrigido");

    console.log("\n3) RN-097 (A) — pedido digitado com um número, mensagem chega de um WhatsApp que a loja não conhece");
    const m1 = textoDoPedido(19);
    const pedidoA = await pedido("(19) 98839-4961", m1);
    conferir((await clientes("5519988394961")).length === 1, "o pedido nasceu no cadastro do número digitado");
    const idA = await webhook("5511977776666", m1, "Rafaela Teste");
    const yA = await db.order.findUnique({ where: { id: pedidoA }, select: { customerId: true } });
    const donoA = yA ? await db.customer.findUnique({ where: { id: yA.customerId } }) : null;
    conferir(donoA?.phone === "5511977776666", `o cadastro do pedido LEVOU o número do WhatsApp (veio ${donoA?.phone})`);
    conferir((await clientes("5519988394961")).length === 0, "o número digitado não ficou em cadastro nenhum");
    const msA = await mensagensCom(m1);
    conferir(msA.length === 1 && msA[0].externalId === idA, `UMA bolha do pedido, com o id do WhatsApp (há ${msA.length})`);
    conferir(msA[0]?.conversation.customerId === yA?.customerId, "na conversa do cadastro do pedido");
    conferir((await conversasAbertas(yA!.customerId)) === 1, "uma conversa aberta só");
    const notaA = await db.message.findFirst({
      where: { conversation: { companyId: company.id, customerId: yA!.customerId }, kind: "NOTE", body: { contains: "📱" } },
    });
    conferir(!!notaA && notaA.body.includes("(19) 98839-4961") && notaA.body.includes("(11) 97777-6666"), "a nota na conversa diz os dois números");

    console.log("\n4) RN-097 (B) — o WhatsApp já é cliente: o cadastro nascido do pedido é fundido nele");
    await webhook("5521988880000", "Oi, quero ver o catálogo", "Bia Teste");
    const [x2] = await clientes("5521988880000");
    conferir(!!x2, "a cliente X já existia pelo WhatsApp");
    const m2 = textoDoPedido(31);
    const pedidoB = await pedido("(31) 99999-0000", m2, "Bia Teste");
    const [y2] = await clientes("5531999990000");
    conferir(!!y2, "o pedido nasceu num cadastro novo com o número digitado");
    const idB = await webhook("5521988880000", m2, "Bia Teste");
    conferir((await clientes("5531999990000")).length === 0, "o cadastro do número digitado sumiu (fundido)");
    const ordB = await db.order.findUnique({ where: { id: pedidoB }, select: { customerId: true, conversationId: true } });
    conferir(ordB?.customerId === x2.id, "o pedido passou para o cadastro do WhatsApp");
    const msB = await mensagensCom(m2);
    conferir(msB.length === 1 && msB[0].externalId === idB, `UMA bolha do pedido, com o id do WhatsApp (há ${msB.length})`);
    conferir(msB[0]?.conversation.customerId === x2.id, "na conversa de X");
    conferir((await conversasAbertas(x2.id)) === 1, "X ficou com uma conversa aberta só");
    const primeiraDeX = await db.message.findFirst({
      where: { conversation: { companyId: company.id, customerId: x2.id }, body: "Oi, quero ver o catálogo" },
    });
    conferir(!!primeiraDeX, "o histórico de X ficou (a primeira mensagem dela)");
    const notaB = await db.message.findFirst({
      where: { conversation: { companyId: company.id, customerId: x2.id }, kind: "NOTE", body: { contains: "juntado" } },
    });
    conferir(!!notaB, "a nota na conversa diz que o cadastro foi juntado");

    console.log("\n5) RN-097 (C) — a mensagem chega ANTES do pedido: o pedido nasce no cadastro do WhatsApp");
    const m3 = textoDoPedido(51);
    const idC = await webhook("5541977770000", m3, "Carla Teste");
    const pedidoC = await pedido("(51) 99999-1111", m3, "Carla Teste");
    const [x3] = await clientes("5541977770000");
    const ordC = await db.order.findUnique({ where: { id: pedidoC }, select: { customerId: true } });
    conferir(ordC?.customerId === x3?.id, "o pedido é do cadastro do WhatsApp");
    conferir((await clientes("5551999991111")).length === 0, "nenhum cadastro com o número digitado");
    const msC = await mensagensCom(m3);
    conferir(msC.length === 1 && msC[0].externalId === idC, `UMA bolha do pedido (há ${msC.length})`);
    const ordCNota = await db.order.findUnique({ where: { id: pedidoC }, select: { notes: true } });
    conferir((ordCNota?.notes ?? "").includes("diferente do WhatsApp de onde mandou o pedido"), "o pedido anota que o digitado era outro");

    console.log("\n6) Limite dito — o número digitado é de uma cliente DE VERDADE: nada se junta");
    await webhook("5561988884444", "Oi, sou a Dani", "Dani Teste");
    const [y4] = await clientes("5561988884444");
    const m4 = textoDoPedido(61);
    const pedidoD = await pedido("(61) 98888-4444", m4, "Dani Teste");
    await webhook("5571977774444", m4, "Outra Pessoa");
    const ordD = await db.order.findUnique({ where: { id: pedidoD }, select: { customerId: true } });
    conferir(ordD?.customerId === y4.id, "o pedido segue com a cliente do número digitado");
    conferir((await clientes("5571977774444")).length === 1, "o outro WhatsApp virou cadastro próprio");
    conferir((await clientes("5561988884444")).length === 1 && (await db.customer.findUnique({ where: { id: y4.id } }))?.phone === "5561988884444", "a cliente de verdade não foi tocada");
    conferir((await mensagensCom(m4)).length === 2, "a bolha aparece nas duas conversas (são duas pessoas para o sistema)");

    console.log("\n7) RN-097 (corrida) — a mensagem chegou ENQUANTO o pedido nascia: a porta do pedido funde no fim");
    await webhook("5581977775555", "Oi, sou a Eva", "Eva Teste");
    const [x5] = await clientes("5581977775555");
    const m5 = textoDoPedido(82);
    const pedidoE = await pedido("(82) 99999-5555", m5, "Eva Teste");
    const [y5] = await clientes("5582999995555");
    const bolhaE = await db.message.findFirst({
      where: { conversation: { companyId: company.id, customerId: y5.id }, body: m5 },
      select: { id: true },
    });
    conferir(!!bolhaE, "a bolha do catálogo existe no cadastro do digitado");
    // o webhook teria visto a bolha sem o pedido e seguido o caminho normal:
    // a mensagem de verdade ficou na conversa de X
    const convX5 = await db.conversation.findFirst({ where: { companyId: company.id, customerId: x5.id } });
    await db.message.create({
      data: { conversationId: convX5!.id, direction: "IN", body: m5, externalId: `MSGRACE${marca}` },
    });
    const fundiu = await juntarDepoisDoPedido({ companyId: company.id, customerId: y5.id, texto: m5, bolhaDoCatalogoId: bolhaE!.id });
    conferir(fundiu, "a junção no fim da rota aconteceu");
    conferir((await clientes("5582999995555")).length === 0, "o cadastro do digitado sumiu");
    const ordE = await db.order.findUnique({ where: { id: pedidoE }, select: { customerId: true } });
    conferir(ordE?.customerId === x5.id, "o pedido passou para X");
    const msE = await mensagensCom(m5);
    conferir(msE.length === 1 && msE[0].externalId === `MSGRACE${marca}`, `ficou só a mensagem de verdade (há ${msE.length})`);
    conferir((await conversasAbertas(x5.id)) === 1, "X com uma conversa aberta só");
    const deNovo = await juntarDepoisDoPedido({ companyId: company.id, customerId: y5.id, texto: m5, bolhaDoCatalogoId: bolhaE!.id });
    conferir(deNovo === false, "chamar de novo não faz nada (idempotente)");
  } finally {
    await db.company.delete({ where: { id: company.id } }).catch(() => {});
    servidor.close();
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
