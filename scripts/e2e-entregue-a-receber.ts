/**
 * PROVA DE PONTA A PONTA DA RN-069 — "Entregue · a receber" (venda a prazo).
 *
 * Roda contra um Postgres DE VERDADE (nunca o de produção) e pelas ROTAS de
 * verdade (login, POST /api/orders, PATCH /api/orders/[id]), porque o que se
 * quer provar é o encadeamento: estoque → status → financeiro (no after()) →
 * comissão → faturamento. Teste de unidade não enxerga a corrida do after().
 *
 * Como rodar:
 *
 *   pg_ctl -D /var/lib/postgresql/vesti -o "-p 5433" start
 *   DATABASE_URL="postgresql://postgres@127.0.0.1:5433/vesti" node scripts/migrate-deploy.mjs
 *   DATABASE_URL="postgresql://postgres@127.0.0.1:5433/vesti" AUTH_SECRET=teste npx next dev -p 3999
 *   DATABASE_URL="postgresql://postgres@127.0.0.1:5433/vesti" APP_URL=http://127.0.0.1:3999 npx tsx scripts/e2e-entregue-a-receber.ts
 *
 * O roteiro cria a própria loja de teste e a apaga no fim.
 */
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import {
  COMMISSION_ORDER_STATUSES,
  PAID_ORDER_STATUSES,
  PRAZO_ENTREGUE_A_RECEBER_DIAS,
  whereComissaoNoPeriodo,
} from "@/lib/orders";

const APP = process.env.APP_URL ?? "http://127.0.0.1:3999";
const ok = (t: string) => console.log(`  ✅ ${t}`);
const falha = (t: string) => {
  console.log(`  ❌ ${t}`);
  process.exitCode = 1;
};
const conferir = (cond: boolean, t: string) => (cond ? ok(t) : falha(t));
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function login(email: string, password: string): Promise<string> {
  const r = await fetch(`${APP}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
    redirect: "manual",
  });
  if (!r.ok) throw new Error(`login ${email} falhou: ${r.status} ${await r.text()}`);
  const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  if (!cookie) throw new Error("login sem cookie");
  return cookie;
}

async function main() {
  const marca = Date.now();
  const senha = "senha-de-teste-123";
  const hash = await bcrypt.hash(senha, 4);

  // ---- cenário: loja com Financeiro ligado e conta padrão -------------------
  const company = await db.company.create({
    data: { name: `Loja Prazo ${marca}`, slug: `loja-prazo-${marca}`, financeEnabled: true },
  });
  const conta = await db.finConta.create({
    data: { companyId: company.id, nome: "Caixa", padrao: true },
  });
  const vendedora = await db.user.create({
    data: {
      companyId: company.id,
      name: "Lara",
      email: `lara-${marca}@teste.local`,
      passwordHash: hash,
      role: "SELLER",
      commissionRate: 10,
    },
  });
  const admin = await db.user.create({
    data: {
      companyId: company.id,
      name: "Gerente",
      email: `gerente-${marca}@teste.local`,
      passwordHash: hash,
      role: "ADMIN",
    },
  });
  const cliente = await db.customer.create({
    data: {
      companyId: company.id,
      name: "Cliente Prazo",
      phone: `5531999${String(marca).slice(-6)}`,
      ownerId: vendedora.id,
    },
  });
  const produto = await db.product.create({
    data: {
      companyId: company.id,
      name: "Regata Prazo",
      sku: `REG-${marca}`,
      category: "Regatas",
      retailPrice: 100,
      wholesalePrice: 80,
      variants: { create: [{ color: "Preto", size: "M", stock: 10 }] },
    },
    include: { variants: true },
  });
  const variante = produto.variants[0];
  const estoque = async () =>
    (await db.productVariant.findUniqueOrThrow({ where: { id: variante.id } })).stock;

  const cookie = await login(vendedora.email, senha);
  const api = async (metodo: string, caminho: string, corpo?: unknown) => {
    const r = await fetch(`${APP}${caminho}`, {
      method: metodo,
      headers: { "content-type": "application/json", cookie },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    const texto = await r.text();
    let json: unknown = null;
    try { json = JSON.parse(texto); } catch { /* resposta sem corpo */ }
    return { status: r.status, json: json as Record<string, unknown> | null, texto };
  };

  // ---- 1. pedido nasce aguardando pagamento, 3 peças → estoque 7 ----------
  console.log("\n1) Pedido de 3 peças, aguardando pagamento");
  const criado = await api("POST", "/api/orders", {
    customerId: cliente.id,
    status: "AGUARDANDO_PAGAMENTO",
    items: [{ productId: produto.id, variantId: variante.id, quantity: 3, unitPrice: 80 }],
  });
  if (criado.status !== 201 && criado.status !== 200) {
    throw new Error(`POST /api/orders: ${criado.status} ${criado.texto}`);
  }
  const orderId = (criado.json as { id?: string; order?: { id: string } }).id
    ?? (criado.json as { order?: { id: string } }).order?.id;
  if (!orderId) throw new Error(`sem id na resposta: ${criado.texto}`);
  conferir((await estoque()) === 7, "estoque desceu para 7 (reserva, RN-003)");
  await dormir(1500); // o after() do financeiro
  const lanc0 = await db.finLancamento.findFirst({
    where: { companyId: company.id, origem: "PEDIDO", origemId: orderId },
    include: { parcelas: { include: { baixas: true } } },
  });
  conferir(!!lanc0 && lanc0.parcelas[0].baixas.length === 0, "conta a receber criada, sem baixa");

  // ---- 2. vira ENTREGUE · A RECEBER ------------------------------------------
  console.log("\n2) Entregue · a receber");
  const r2 = await api("PATCH", `/api/orders/${orderId}`, { status: "ENTREGUE_A_RECEBER" });
  conferir(r2.status === 200, `PATCH aceitou o status (${r2.status})`);
  await dormir(1500);
  const o2 = await db.order.findUniqueOrThrow({ where: { id: orderId } });
  conferir(o2.status === "ENTREGUE_A_RECEBER", "status gravado");
  conferir(!!o2.entregueAReceberEm, "carimbo da entrega gravado");
  conferir(o2.paidAt === null, "NÃO tem data de pagamento");
  conferir((await estoque()) === 7, "estoque continua 7 (a peça saiu com a cliente)");

  const lanc2 = await db.finLancamento.findFirstOrThrow({
    where: { companyId: company.id, origem: "PEDIDO", origemId: orderId },
    include: { parcelas: { include: { baixas: true } }, eventos: true },
  });
  const parcela2 = lanc2.parcelas[0];
  // o vencimento é DIA (meio-dia UTC, RN-030) e o dia é o de São Paulo: a
  // entrega às 22h de SP é dia 2 em SP e dia 3 em UTC — conta-se em SP
  const diaSP = (d: Date) =>
    Date.UTC(...(d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }).split("-").map(Number) as [number, number, number]).map((n, i) => (i === 1 ? n - 1 : n)) as [number, number, number]);
  const dias = Math.round((diaSP(parcela2.vencimento) - diaSP(o2.entregueAReceberEm!)) / 86_400_000);
  conferir(parcela2.baixas.length === 0, "conta a receber SEM baixa (dinheiro não entrou)");
  conferir(
    dias === PRAZO_ENTREGUE_A_RECEBER_DIAS,
    `vencimento ${dias} dias depois da entrega (esperado ${PRAZO_ENTREGUE_A_RECEBER_DIAS})`
  );
  conferir(lanc2.canceladoEm === null, "lançamento vivo");

  const faturamento = await db.order.aggregate({
    where: { companyId: company.id, status: { in: PAID_ORDER_STATUSES } },
    _sum: { netTotal: true },
  });
  conferir((faturamento._sum.netTotal ?? 0) === 0, "faturamento = 0 (RN-001 intacta)");

  const inicioMes = new Date(); inicioMes.setDate(1); inicioMes.setHours(0, 0, 0, 0);
  const fimMes = new Date(inicioMes); fimMes.setMonth(fimMes.getMonth() + 1);
  const comissao = async () =>
    db.order.count({
      where: { companyId: company.id, sellerId: vendedora.id, ...whereComissaoNoPeriodo(inicioMes, fimMes) },
    });
  conferir((await comissao()) === 1, "ENTRA na comissão do mês da entrega");

  const naRua = await db.order.aggregate({
    where: { companyId: company.id, status: "ENTREGUE_A_RECEBER" },
    _sum: { total: true }, _count: true, // frete-ok: é o cartão "a receber" do Dashboard
  });
  conferir(naRua._count === 1 && (naRua._sum.total ?? 0) === 240, "Dashboard: R$ 240 na rua");

  // Idempotência: sincronizar de novo não mexe no vencimento nem duplica
  const { sincronizarPedidoNoFinanceiro } = await import("@/lib/financeiro/porta-vendas");
  await sincronizarPedidoNoFinanceiro(orderId);
  const lanc2b = await db.finLancamento.findMany({
    where: { companyId: company.id, origem: "PEDIDO", origemId: orderId },
    include: { parcelas: true, eventos: true },
  });
  conferir(lanc2b.length === 1, "1 pedido = 1 lançamento, depois de sincronizar de novo");
  conferir(
    lanc2b[0].parcelas[0].vencimento.getTime() === parcela2.vencimento.getTime(),
    "vencimento não anda a cada sincronização"
  );
  const eventosPrazo = lanc2b[0].eventos.filter((e) => /Venda a prazo/.test(e.descricao ?? ""));
  conferir(eventosPrazo.length === 1, `o evento 'Venda a prazo' aparece UMA vez (${eventosPrazo.length})`);

  // ---- 3. vira PAGO -----------------------------------------------------------
  console.log("\n3) Cliente pagou → PAGO");
  const r3 = await api("PATCH", `/api/orders/${orderId}`, { status: "PAGO" });
  conferir(r3.status === 200, `PATCH aceitou PAGO (${r3.status})`);
  await dormir(1500);
  const o3 = await db.order.findUniqueOrThrow({ where: { id: orderId } });
  conferir(!!o3.paidAt, "data do pagamento gravada");
  conferir(
    o3.entregueAReceberEm?.getTime() === o2.entregueAReceberEm?.getTime(),
    "carimbo da entrega PRESERVADO"
  );
  const lanc3 = await db.finLancamento.findFirstOrThrow({
    where: { companyId: company.id, origem: "PEDIDO", origemId: orderId },
    include: { parcelas: { include: { baixas: true } } },
  });
  const baixasVivas = lanc3.parcelas[0].baixas.filter((b) => !b.estornadaEm);
  conferir(baixasVivas.length === 1, "UMA baixa automática viva");
  conferir(baixasVivas[0]?.valor === 240 && baixasVivas[0]?.contaId === conta.id, "baixa de R$ 240 na conta padrão");
  const fat3 = await db.order.aggregate({
    where: { companyId: company.id, status: { in: PAID_ORDER_STATUSES } },
    _sum: { netTotal: true },
  });
  conferir((fat3._sum.netTotal ?? 0) === 240, "faturamento agora soma R$ 240 (netTotal)");
  conferir((await comissao()) === 1, "comissão continua contando UMA vez (não dobrou ao pagar)");
  conferir((await estoque()) === 7, "estoque segue 7 (pago não desconta de novo)");

  // Comissão pela data da entrega, não do pagamento: num mês futuro (o do
  // pagamento fictício) o pedido NÃO aparece
  const proxMes = new Date(fimMes); const fimProx = new Date(proxMes); fimProx.setMonth(fimProx.getMonth() + 1);
  await db.order.update({ where: { id: orderId }, data: { paidAt: new Date(proxMes.getTime() + 86_400_000) } });
  const noProximo = await db.order.count({
    where: { companyId: company.id, ...whereComissaoNoPeriodo(proxMes, fimProx) },
  });
  conferir(noProximo === 0, "pago no mês seguinte NÃO conta comissão no mês seguinte (já contou na entrega)");
  conferir((await comissao()) === 1, "...e continua contando no mês da entrega");
  await db.order.update({ where: { id: orderId }, data: { paidAt: o3.paidAt } });

  // ---- 4. volta para a receber (pagamento não confirmou) ---------------------
  console.log("\n4) Volta de PAGO para Entregue · a receber");
  const r4 = await api("PATCH", `/api/orders/${orderId}`, { status: "ENTREGUE_A_RECEBER" });
  conferir(r4.status === 200, `PATCH aceitou a volta (${r4.status})`);
  await dormir(1500);
  const o4 = await db.order.findUniqueOrThrow({ where: { id: orderId } });
  conferir(o4.paidAt === null, "data do pagamento apagada");
  conferir(!!o4.entregueAReceberEm, "carimbo da entrega continua");
  const lanc4 = await db.finLancamento.findFirstOrThrow({
    where: { companyId: company.id, origem: "PEDIDO", origemId: orderId },
    include: { parcelas: { include: { baixas: true } } },
  });
  conferir(
    lanc4.parcelas[0].baixas.every((b) => !!b.estornadaEm) && lanc4.canceladoEm === null,
    "baixa automática ESTORNADA, lançamento vivo (volta a ser conta a receber)"
  );
  conferir((await comissao()) === 1, "comissão: ainda 1 (a entrega aconteceu)");

  // ---- 5. cancela devolvendo as peças -----------------------------------------
  console.log("\n5) Cancelar (devolvendo peças)");
  const r5 = await api("PATCH", `/api/orders/${orderId}`, { status: "CANCELADO", restock: true });
  conferir(r5.status === 200, `PATCH aceitou cancelar (${r5.status})`);
  await dormir(1500);
  conferir((await estoque()) === 10, "estoque voltou a 10");
  const lanc5 = await db.finLancamento.findFirstOrThrow({
    where: { companyId: company.id, origem: "PEDIDO", origemId: orderId },
  });
  conferir(lanc5.canceladoEm !== null, "lançamento cancelado");
  conferir((await comissao()) === 0, "cancelado não paga comissão");
  conferir(
    !COMMISSION_ORDER_STATUSES.includes("CANCELADO"),
    "(lista da comissão não tem cancelado)"
  );

  // ---- 6. caminho PAGO → a receber (o Pix voltou) ------------------------------
  console.log("\n6) Outro pedido: aguardando → PAGO → Entregue · a receber");
  const criadoB = await api("POST", "/api/orders", {
    customerId: cliente.id,
    status: "AGUARDANDO_PAGAMENTO",
    items: [{ productId: produto.id, variantId: variante.id, quantity: 2, unitPrice: 80 }],
  });
  const orderB = (criadoB.json as { id?: string }).id!;
  await dormir(1200);
  const rB1 = await api("PATCH", `/api/orders/${orderB}`, { status: "PAGO" });
  conferir(rB1.status === 200, `PAGO aceito (${rB1.status})`);
  await dormir(1500);
  const oB1 = await db.order.findUniqueOrThrow({ where: { id: orderB } });
  const rB2 = await api("PATCH", `/api/orders/${orderB}`, { status: "ENTREGUE_A_RECEBER" });
  conferir(rB2.status === 200, `volta para a receber aceita (${rB2.status})`);
  await dormir(1500);
  const oB2 = await db.order.findUniqueOrThrow({ where: { id: orderB } });
  conferir(
    oB2.entregueAReceberEm?.getTime() === oB1.paidAt?.getTime(),
    "carimbo da entrega = data do pagamento de antes (a comissão já contou naquele mês)"
  );
  const lancB = await db.finLancamento.findFirstOrThrow({
    where: { companyId: company.id, origem: "PEDIDO", origemId: orderB },
    include: { parcelas: { include: { baixas: true } } },
  });
  conferir(lancB.parcelas[0].baixas.every((b) => !!b.estornadaEm), "baixa automática estornada");
  const diasB = Math.round((diaSP(lancB.parcelas[0].vencimento) - diaSP(oB2.entregueAReceberEm!)) / 86_400_000);
  conferir(diasB === PRAZO_ENTREGUE_A_RECEBER_DIAS, `vencimento MOVIDO para +${diasB} dias (a foto velha da baixa não trava mais)`);
  // o primeiro pedido foi cancelado no passo 5: sobra só este
  conferir((await comissao()) === 1, "comissão do mês: 1 pedido (o cancelado saiu), nenhum em dobro");

  // ---- 6b. previsão de recebimento combinada com a cliente ---------------------
  console.log("\n6b) Previsão de recebimento combinada (no pedido a receber)");
  const diaPrevisto = new Date(oB2.entregueAReceberEm!.getTime() + 15 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const rP1 = await api("PATCH", `/api/orders/${orderB}`, { previsaoRecebimentoEm: diaPrevisto });
  conferir(rP1.status === 200, `previsão aceita (${rP1.status})`);
  await dormir(1500);
  const lancP1 = await db.finLancamento.findFirstOrThrow({
    where: { companyId: company.id, origem: "PEDIDO", origemId: orderB },
    include: { parcelas: true, eventos: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  conferir(
    lancP1.parcelas[0].vencimento.toISOString().slice(0, 10) === diaPrevisto,
    `vencimento da conta a receber = previsão (${diaPrevisto})`
  );
  conferir(/previsão combinada/.test(lancP1.eventos[0]?.descricao ?? ""), "o lançamento diz que foi a previsão combinada");
  const histP = await db.orderEvent.findFirst({
    where: { orderId: orderB, description: { contains: "Previsão de recebimento combinada" } },
  });
  conferir(!!histP, "a história do pedido registra quem combinou");

  const rP2 = await api("PATCH", `/api/orders/${orderB}`, { previsaoRecebimentoEm: null });
  conferir(rP2.status === 200, `tirar a previsão aceita (${rP2.status})`);
  await dormir(1500);
  const lancP2 = await db.finLancamento.findFirstOrThrow({
    where: { companyId: company.id, origem: "PEDIDO", origemId: orderB },
    include: { parcelas: true },
  });
  const diasP2 = Math.round((diaSP(lancP2.parcelas[0].vencimento) - diaSP(oB2.entregueAReceberEm!)) / 86_400_000);
  conferir(diasP2 === PRAZO_ENTREGUE_A_RECEBER_DIAS, `sem previsão volta aos ${PRAZO_ENTREGUE_A_RECEBER_DIAS} dias (${diasP2})`);

  // sinal registrado À MÃO não segura o vencimento combinado (achado da revisão)
  await db.finBaixa.create({
    data: {
      companyId: company.id,
      parcelaId: lancP2.parcelas[0].id,
      contaId: conta.id,
      valor: 50,
      data: new Date(),
      autorNome: "Gerente",
    },
  });
  const rP2b = await api("PATCH", `/api/orders/${orderB}`, { previsaoRecebimentoEm: diaPrevisto });
  conferir(rP2b.status === 200, `previsão com sinal à mão aceita (${rP2b.status})`);
  await dormir(1500);
  const lancP2b = await db.finLancamento.findFirstOrThrow({
    where: { companyId: company.id, origem: "PEDIDO", origemId: orderB },
    include: { parcelas: { include: { baixas: true } } },
  });
  conferir(
    lancP2b.parcelas[0].vencimento.toISOString().slice(0, 10) === diaPrevisto,
    "vencimento foi para a previsão mesmo com baixa à mão viva"
  );
  conferir(
    lancP2b.parcelas[0].baixas.some((b) => b.autorNome === "Gerente" && !b.estornadaEm),
    "e o sinal à mão continua intocado"
  );
  await db.finBaixa.deleteMany({ where: { parcelaId: lancP2.parcelas[0].id, autorNome: "Gerente" } });

  const antes = new Date(oB2.entregueAReceberEm!.getTime() - 3 * 86_400_000).toISOString().slice(0, 10);
  const rP3 = await api("PATCH", `/api/orders/${orderB}`, { previsaoRecebimentoEm: antes });
  conferir(rP3.status === 400, `previsão antes da entrega recusada (${rP3.status})`);
  // em pedido PAGO não há conta em aberto para vencer: recusa
  const rP4 = await api("PATCH", `/api/orders/${orderB}`, { status: "PAGO" });
  conferir(rP4.status === 200, `volta a PAGO (${rP4.status})`);
  await dormir(1200);
  const rP5 = await api("PATCH", `/api/orders/${orderB}`, { previsaoRecebimentoEm: diaPrevisto });
  conferir(rP5.status === 409, `previsão em pedido pago recusada (${rP5.status})`);
  conferir(
    (await db.order.findUniqueOrThrow({ where: { id: orderB } })).previsaoRecebimentoEm === null,
    "ao virar pago a previsão combinada foi apagada (voltar a prazo recomeça nos 30 dias)"
  );

  // ---- 7. sem vendedora não entra (RN-006 vale para comissão) ------------------
  console.log("\n7) Pedido sem dona não vira a receber");
  const criadoC = await api("POST", "/api/orders", {
    customerId: cliente.id,
    status: "AGUARDANDO_PAGAMENTO",
    items: [{ productId: produto.id, variantId: variante.id, quantity: 1, unitPrice: 80 }],
  });
  const orderC = (criadoC.json as { id?: string }).id!;
  await db.order.update({ where: { id: orderC }, data: { sellerId: null } });
  // sem dona, a vendedora nem enxerga o pedido (RN-007): quem tenta é a gerência
  const cookieAdmin = await login(admin.email, senha);
  const rC = await (async () => {
    const r = await fetch(`${APP}/api/orders/${orderC}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: cookieAdmin },
      body: JSON.stringify({ status: "ENTREGUE_A_RECEBER" }),
    });
    const json = (await r.json().catch(() => null)) as Record<string, unknown> | null;
    return { status: r.status, json };
  })();
  conferir(rC.status === 409, `recusado com 409 (${rC.status}): ${String(rC.json?.error ?? "").slice(0, 60)}`);
  conferir(
    (await db.order.findUniqueOrThrow({ where: { id: orderC } })).status === "AGUARDANDO_PAGAMENTO",
    "status não mudou"
  );

  // ---- limpeza ----------------------------------------------------------------
  // a baixa aponta para a conta sem cascata: sai antes da loja
  await db.finBaixa.deleteMany({ where: { conta: { companyId: company.id } } });
  await db.company.delete({ where: { id: company.id } });
  console.log(process.exitCode ? "\n❌ Houve falhas." : "\n✅ Tudo conferido.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
