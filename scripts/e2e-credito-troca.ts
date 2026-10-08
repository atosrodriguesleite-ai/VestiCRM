/**
 * PROVA DE PONTA A PONTA DA RN-074 — o dinheiro da troca.
 *
 * Contra um Postgres DE VERDADE (nunca o de produção), pelas rotas de
 * verdade: troca com crédito → crédito usado num pedido novo (desconto) →
 * edição que encolhe o pedido → tirar → cancelar/apagar devolvem → teto do
 * estorno no saldo → duas abas não gastam o crédito duas vezes → acerto em
 * dinheiro entrando no Financeiro.
 *
 *   DATABASE_URL="postgresql://postgres@127.0.0.1:5433/vesti" APP_URL=http://127.0.0.1:3999 npx tsx scripts/e2e-credito-troca.ts
 */
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

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
  return r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

async function main() {
  const marca = Date.now();
  const senha = "senha-de-teste-123";
  const hash = await bcrypt.hash(senha, 4);
  const company = await db.company.create({
    data: { name: `Loja Crédito ${marca}`, slug: `loja-credito-${marca}`, financeEnabled: true },
  });
  await db.finConta.create({ data: { companyId: company.id, nome: "Caixa", padrao: true } });
  const vendedora = await db.user.create({
    data: { companyId: company.id, name: "Lara", email: `lara-${marca}@teste.local`, passwordHash: hash, role: "SELLER" },
  });
  const gerente = await db.user.create({
    data: { companyId: company.id, name: "Gerente", email: `ger-${marca}@teste.local`, passwordHash: hash, role: "ADMIN" },
  });
  const cliente = await db.customer.create({
    data: { companyId: company.id, name: "Cliente Crédito", phone: `5531997${String(marca).slice(-6)}`, ownerId: vendedora.id },
  });
  const regata = await db.product.create({
    data: {
      companyId: company.id, name: "Regata", sku: `REG-${marca}`, category: "Regatas", retailPrice: 50, wholesalePrice: 32,
      variants: { create: [{ color: "Preto", size: "P", stock: 50 }, { color: "Preto", size: "M", stock: 50 }] },
    },
    include: { variants: true },
  });
  const P = regata.variants.find((v) => v.size === "P")!;
  const M = regata.variants.find((v) => v.size === "M")!;

  const cookie = await login(vendedora.email, senha);
  const cookieAdmin = await login(gerente.email, senha);
  const api = async (metodo: string, caminho: string, corpo?: unknown, ck = cookie) => {
    const r = await fetch(`${APP}${caminho}`, {
      method: metodo,
      headers: { "content-type": "application/json", cookie: ck },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    const texto = await r.text();
    let json: Record<string, unknown> | null = null;
    try { json = JSON.parse(texto); } catch { /* sem corpo */ }
    return { status: r.status, json, texto };
  };
  const novoPedido = async (qtd: number, preco: number, frete = 0) => {
    const r = await api("POST", "/api/orders", {
      customerId: cliente.id, status: "AGUARDANDO_PAGAMENTO", shippingFee: frete,
      items: [{ productId: regata.id, variantId: P.id, quantity: qtd, unitPrice: preco }],
    });
    const id = (r.json as { id?: string; order?: { id: string } })?.id ?? (r.json as { order?: { id: string } })?.order?.id;
    if (!id) throw new Error(`POST /api/orders: ${r.status} ${r.texto}`);
    return id;
  };
  const saldo = async () => Math.round((await db.customerCredit.findMany({ where: { customerId: cliente.id } })).reduce((s, l) => s + l.valor, 0) * 100) / 100;
  const pedido = (id: string) => db.order.findUniqueOrThrow({ where: { id }, include: { payments: true } });
  const chaveP = (preco: number) => `v:${P.id}|${preco.toFixed(2)}`;

  // ---- 1. pedido A entregue + troca com crédito de R$ 12 ---------------------
  console.log("\n1) Troca que dá R$ 12 de crédito");
  const A = await novoPedido(3, 32);
  await api("PATCH", `/api/orders/${A}`, { status: "PAGO" });
  await api("PATCH", `/api/orders/${A}`, { status: "ENTREGUE" });
  const t1 = await api("POST", `/api/orders/${A}/troca`, {
    volta: [{ chave: chaveP(32), quantity: 1, destino: "ESTOQUE" }],
    sai: [{ variantId: M.id, quantity: 1, unitPrice: 20 }],
    resolucao: "CREDITO",
  });
  conferir(t1.status === 200, `troca registrada (${t1.status})`);
  conferir((await saldo()) === 12, "saldo da cliente: R$ 12");

  // ---- 2. pedido B: usar o crédito -----------------------------------------
  console.log("\n2) Usar o crédito num pedido novo (R$ 100 + R$ 15 de frete)");
  const B = await novoPedido(2, 50, 15);
  const usou = await api("POST", `/api/orders/${B}/credito`, { acao: "usar" });
  conferir(usou.status === 200 && usou.json?.abatido === 12, `abateu R$ 12 (${usou.status})`);
  let b = await pedido(B);
  conferir(b.creditoTroca === 12 && b.netTotal === 88 && b.total === 103, `valor vendido 88, total 103 (${b.netTotal}/${b.total})`);
  conferir(b.payments.filter((p) => p.status === "PENDENTE").every((p) => p.amount === 103), "a cobrança pendente acompanhou o total");
  conferir((await saldo()) === 0, "saldo zerou");
  const deNovo = await api("POST", `/api/orders/${B}/credito`, { acao: "usar" });
  conferir(deNovo.status === 409, `usar de novo sem saldo: 409 (${deNovo.status})`);
  await dormir(1500);
  const lancB = await db.finLancamento.findFirst({ where: { companyId: company.id, origem: "PEDIDO", origemId: B } });
  conferir(lancB?.valor === 103, `financeiro acompanhou: R$ ${lancB?.valor}`);

  // ---- 3. desconto que encolhe o pedido devolve a sobra ----------------------
  console.log("\n3) Desconto deixa o pedido menor que o crédito");
  const desc = await api("PATCH", `/api/orders/${B}`, { discount: 95 });
  conferir(desc.status === 200, `desconto aplicado (${desc.status})`);
  b = await pedido(B);
  conferir(b.creditoTroca === 5 && b.netTotal === 0 && b.total === 15, `crédito caiu para 5, valor vendido 0 (${b.creditoTroca}/${b.netTotal})`);
  conferir((await saldo()) === 7, "a sobra (R$ 7) voltou à ficha");
  await api("PATCH", `/api/orders/${B}`, { discount: 0 });
  b = await pedido(B);
  conferir(b.creditoTroca === 5 && b.netTotal === 95, "tirar o desconto não puxa crédito sozinho (95)");

  // ---- 4. tirar e usar de novo; cancelar devolve --------------------------
  console.log("\n4) Tirar, usar de novo, cancelar");
  const tirou = await api("POST", `/api/orders/${B}/credito`, { acao: "tirar" });
  b = await pedido(B);
  conferir(tirou.status === 200 && b.creditoTroca === 0 && b.netTotal === 100 && (await saldo()) === 12, "tirou: pedido 100, saldo 12");
  await api("POST", `/api/orders/${B}/credito`, { acao: "usar" });
  const cancel = await api("PATCH", `/api/orders/${B}`, { status: "CANCELADO", restock: true });
  b = await pedido(B);
  conferir(cancel.status === 200 && b.creditoTroca === 0 && b.netTotal === 100, `cancelado devolve: pedido 100 (${cancel.status})`);
  conferir((await saldo()) === 12, "saldo 12 de novo");
  const restaura = await api("PATCH", `/api/orders/${B}`, { status: "AGUARDANDO_PAGAMENTO" });
  b = await pedido(B);
  conferir(restaura.status === 200 && b.creditoTroca === 0 && (await saldo()) === 12, "restaurar NÃO reaplica");

  // ---- 5. apagar devolve ----------------------------------------------------
  console.log("\n5) Apagar o pedido devolve o crédito");
  await api("POST", `/api/orders/${B}/credito`, { acao: "usar" });
  conferir((await saldo()) === 0, "usado (saldo 0)");
  const apagou = await api("DELETE", `/api/orders/${B}`, undefined, cookieAdmin);
  conferir((apagou.status === 200 || apagou.status === 204) && (await saldo()) === 12, `apagado devolve: saldo 12 (${apagou.status})`);

  // ---- 6. pedido pago recusa -----------------------------------------------
  console.log("\n6) Pedido pago não usa crédito");
  const C = await novoPedido(1, 50);
  await api("PATCH", `/api/orders/${C}`, { status: "PAGO" });
  const pago = await api("POST", `/api/orders/${C}/credito`, { acao: "usar" });
  conferir(pago.status === 409, `409 (${pago.status}): ${String(pago.json?.error ?? "").slice(0, 60)}`);

  // ---- 7. duas abas ao mesmo tempo -------------------------------------------
  console.log("\n7) Duas abas usando o mesmo crédito em dois pedidos");
  const D1 = await novoPedido(1, 50);
  const D2 = await novoPedido(1, 50);
  const [r1, r2] = await Promise.all([
    api("POST", `/api/orders/${D1}/credito`, { acao: "usar" }),
    api("POST", `/api/orders/${D2}/credito`, { acao: "usar" }),
  ]);
  const somaAbatida = (await pedido(D1)).creditoTroca + (await pedido(D2)).creditoTroca;
  conferir(somaAbatida === 12 && (await saldo()) === 0, `gastou só 12 no total (${r1.status}/${r2.status}, abatido ${somaAbatida})`);

  // ---- 8. cancelar o pedido da troca com crédito já usado --------------------
  console.log("\n8) Cancelar o pedido da troca depois de o crédito ser usado");
  const cancA = await api("PATCH", `/api/orders/${A}`, { status: "CANCELADO", restock: true });
  conferir(cancA.status === 200, `cancelado (${cancA.status})`);
  conferir((await saldo()) === 0, "a ficha NÃO ficou negativa (saldo 0)");
  const evA = await db.orderEvent.findFirst({ where: { orderId: A, description: { contains: "já tinha sido usado" } } });
  conferir(!!evA, `história diz: ${evA?.description.slice(0, 120)}`);

  // ---- 8b. o crédito já usado ficou anotado: nada reaparece ---------------
  console.log("\n8b) Cancelar o pedido que usou o crédito devolve; apagar o da troca não estorna de novo");
  const quemUsou = (await pedido(D1)).creditoTroca > 0 ? D1 : D2;
  await api("PATCH", `/api/orders/${quemUsou}`, { status: "CANCELADO", restock: true });
  conferir((await saldo()) === 12, "cancelar o pedido que usou devolve os R$ 12 (a loja já os abateu na devolução do pedido da troca)");
  const tA = await db.troca.findFirstOrThrow({ where: { orderId: A } });
  conferir(tA.creditoAbatidoNaDevolucao === 12, "a troca guarda que R$ 12 foram abatidos na devolução");
  await api("DELETE", `/api/orders/${A}`, undefined, cookieAdmin);
  conferir((await saldo()) === 12, "apagar o pedido da troca NÃO estorna de novo (saldo 12)");

  // ---- 8c. troca e crédito no MESMO pedido ---------------------------------
  console.log("\n8c) Pedido que usa crédito e depois tem troca: cancelar acerta as duas coisas");
  const F = await novoPedido(3, 32);
  await api("POST", `/api/orders/${F}/credito`, { acao: "usar" }); // usa os 12
  conferir((await pedido(F)).creditoTroca === 12 && (await saldo()) === 0, "F usou 12");
  await api("PATCH", `/api/orders/${F}`, { status: "PAGO" });
  await api("PATCH", `/api/orders/${F}`, { status: "ENTREGUE" });
  const tF = await api("POST", `/api/orders/${F}/troca`, {
    volta: [{ chave: chaveP(32), quantity: 1, destino: "ESTOQUE" }],
    sai: [{ variantId: M.id, quantity: 1, unitPrice: 25 }],
    resolucao: "CREDITO",
  });
  conferir(tF.status === 200 && (await saldo()) === 7, `troca em F deu 7 (saldo ${await saldo()})`);
  await api("PATCH", `/api/orders/${F}`, { status: "CANCELADO", restock: true });
  conferir((await saldo()) === 12, `cancelar F: devolve os 12 usados e estorna os 7 da troca (saldo ${await saldo()})`);

  // ---- 8d. trocar a cliente com crédito no pedido é recusado; a prazo não usa
  console.log("\n8d) Travas: trocar a cliente com crédito; venda a prazo entregue");
  const G = await novoPedido(1, 50);
  await api("POST", `/api/orders/${G}/credito`, { acao: "usar" });
  const outra = await db.customer.create({ data: { companyId: company.id, name: "Outra", phone: `5531996${String(marca).slice(-6)}`, ownerId: vendedora.id } });
  const troca = await api("PATCH", `/api/orders/${G}`, { customerId: outra.id });
  conferir(troca.status === 409, `trocar a cliente com crédito: 409 (${troca.status})`);
  await api("POST", `/api/orders/${G}/credito`, { acao: "tirar" });
  const H = await novoPedido(1, 50);
  await api("PATCH", `/api/orders/${H}`, { status: "ENTREGUE_A_RECEBER" });
  const aPrazo = await api("POST", `/api/orders/${H}/credito`, { acao: "usar" });
  conferir(aPrazo.status === 409, `venda a prazo entregue não usa crédito: 409 (${aPrazo.status})`);

  // ---- 9. acerto em dinheiro entra no financeiro ---------------------------
  console.log("\n9) Diferença cobrada e devolução entram no Financeiro ao confirmar");
  const E = await novoPedido(3, 32);
  await api("PATCH", `/api/orders/${E}`, { status: "PAGO" });
  await api("PATCH", `/api/orders/${E}`, { status: "ENVIADO" });
  const tc = await api("POST", `/api/orders/${E}/troca`, {
    volta: [{ chave: chaveP(32), quantity: 1, destino: "ESTOQUE" }],
    sai: [{ variantId: M.id, quantity: 1, unitPrice: 48 }],
    resolucao: "COBRAR",
  });
  const td = await api("POST", `/api/orders/${E}/troca`, {
    volta: [{ chave: chaveP(32), quantity: 1, destino: "ESTOQUE" }],
    sai: [{ variantId: M.id, quantity: 1, unitPrice: 22 }],
    resolucao: "DEVOLUCAO",
  });
  conferir(tc.status === 200 && td.status === 200, "duas trocas registradas");
  await dormir(800);
  conferir((await db.finLancamento.count({ where: { companyId: company.id, origem: "TROCA" } })) === 0, "nada no financeiro antes de confirmar");
  for (const t of [tc, td]) await api("PATCH", `/api/orders/${E}/troca`, { trocaId: t.json?.trocaId, acertada: true });
  await api("PATCH", `/api/orders/${E}/troca`, { trocaId: tc.json?.trocaId, acertada: true }); // de novo: idempotente
  await dormir(2000);
  const lancs = await db.finLancamento.findMany({
    where: { companyId: company.id, origem: "TROCA" },
    include: { categoria: true, parcelas: { include: { baixas: true } } },
  });
  const rec = lancs.find((l) => l.tipo === "RECEITA");
  const desp = lancs.find((l) => l.tipo === "DESPESA");
  conferir(lancs.length === 2, `dois lançamentos (${lancs.length})`);
  conferir(rec?.valor === 16 && rec.categoria?.codigo === "01.01" && rec.parcelas[0].baixas.length === 1, `receita R$ 16 em venda atacado, baixada (${rec?.categoria?.codigo})`);
  conferir(desp?.valor === 10 && desp.categoria?.codigo === "04.06" && desp.parcelas[0].baixas.length === 1, `despesa R$ 10 em Devoluções e trocas, baixada (${desp?.categoria?.codigo})`);

  // ---- 10. sem conta padrão: fica em aberto, fora da cobrança, e é repescado
  console.log("\n10) Acerto sem conta padrão: fora da inadimplência e repescado ao definir a conta");
  await db.finConta.updateMany({ where: { companyId: company.id }, data: { padrao: false } });
  const tx3 = await api("POST", `/api/orders/${E}/troca`, {
    volta: [{ chave: chaveP(32), quantity: 1, destino: "ESTOQUE" }],
    sai: [{ variantId: M.id, quantity: 1, unitPrice: 40 }],
    resolucao: "COBRAR",
  });
  await api("PATCH", `/api/orders/${E}/troca`, { trocaId: tx3.json?.trocaId, acertada: true });
  await dormir(1500);
  const semBaixa = await db.finLancamento.findFirstOrThrow({
    where: { companyId: company.id, origem: "TROCA", origemId: String(tx3.json?.trocaId) },
    include: { parcelas: { include: { baixas: true } } },
  });
  conferir(semBaixa.parcelas[0].baixas.length === 0, "sem conta padrão: nasceu sem baixa");
  await db.finParcela.updateMany({ where: { lancamentoId: semBaixa.id }, data: { vencimento: new Date(Date.now() - 5 * 86_400_000) } });
  const { carregarInadimplencia } = await import("@/lib/financeiro/visao");
  const inad = await carregarInadimplencia(company.id);
  conferir(!inad.linhas.some((l) => l.lancamentoId === semBaixa.id), "não aparece na inadimplência (já foi recebido)");
  await db.finConta.updateMany({ where: { companyId: company.id }, data: { padrao: true } });
  const { repescarVendasSemBaixa } = await import("@/lib/financeiro/porta-vendas");
  await repescarVendasSemBaixa(company.id);
  const repescado = await db.finBaixa.count({ where: { parcela: { lancamentoId: semBaixa.id }, estornadaEm: null } });
  conferir(repescado === 1, "definida a conta padrão, a repescagem deu a baixa");

  await db.finBaixa.deleteMany({ where: { conta: { companyId: company.id } } });
  await db.company.delete({ where: { id: company.id } });
  console.log(process.exitCode ? "\n❌ Houve falhas." : "\n✅ Tudo conferido.");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
