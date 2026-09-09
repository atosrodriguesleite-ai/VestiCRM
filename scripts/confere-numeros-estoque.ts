/* eslint-disable */
/**
 * OS NÚMEROS DO ESTOQUE BATEM COM AS OUTRAS TELAS?
 *
 * Pergunta do dono (09/09/2026): "os números do módulo de estoque batem com
 * os números de produção e com os da aba de pedidos?". Este script responde
 * rodando a conta de CADA TELA lado a lado, sobre os MESMOS dados — não a
 * descrição do código, o número que a lojista vê:
 *
 *   • Estoque › Produção  ×  telas Costura, Lotes e Cortes
 *   • Estoque › Inventário (reservado)  ×  ficha de cada pedido (o livro)
 *   • "No mínimo" nas QUATRO telas + no alerta do sino (RN-051)
 *   • Giro do painel  ×  a régua de venda paga do Dashboard (RN-001)
 *   • "Na loja"/"Disponível"  ×  as "un." da tela Produtos
 *
 * Achou duas divergências na primeira rodada (o filtro dos rolos cortava em
 * 0,01 kg e a tela Cortes mostra qualquer sobra) — por isso ele fica.
 *
 * Uso: set -a; source .env; set +a; npx tsx scripts/confere-numeros-estoque.ts
 */
if (!/(localhost|127\.0\.0\.1):5433\b/.test(process.env.DATABASE_URL ?? "")) throw new Error("só local");
import { db } from "../src/lib/db";
import { resumoDaProducao } from "../src/lib/estoque/producao";
import { montarInventario, reservadoPorVariacao } from "../src/lib/estoque/inventario";
import { baixasLiquidasDoPedido } from "../src/lib/estoque-do-pedido";
import { norm } from "../src/lib/nuvemshop";
import { contarNoMinimo, linhasDoEstoque } from "../src/lib/estoque/inventario";
import { montarPainel } from "../src/lib/estoque/analise";
import { decidirAlertas } from "../src/lib/estoque/alerta";
import { minimoEfetivo, noMinimo } from "../src/lib/estoque/minimos-regra";
import { PAID_ORDER_STATUSES } from "../src/lib/orders";

const tag = `confere-${Date.now()}`;
let falhas = 0;
function cmp(rotulo: string, estoque: unknown, outra: unknown, ondeOutra: string) {
  const ok = JSON.stringify(estoque) === JSON.stringify(outra);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${rotulo}\n     Estoque: ${JSON.stringify(estoque)}   |   ${ondeOutra}: ${JSON.stringify(outra)}`);
}

async function main() {
  const loja = await db.company.create({ data: { name: `L ${tag}`, slug: tag, estoqueEnabled: true, productionEnabled: true, lowStockThreshold: 3 } });
  const cli = await db.customer.create({ data: { companyId: loja.id, name: "Maria", phone: "5511999990000" } });
  const vend = await db.user.create({ data: { companyId: loja.id, name: "Vend", email: `v-${tag}@x.x`, passwordHash: "x", role: "SELLER" } });

  const p = await db.product.create({ data: { companyId: loja.id, name: "Vestido", sku: "V", category: "Vestidos", costPrice: 20, wholesalePrice: 50,
    variants: { create: [{ color: "Azul", size: "M", stock: 4 }, { color: "Azul", size: "G", stock: 10 }, { color: "Rosa", size: "M", stock: 6 }] } }, include: { variants: true } });
  const [vM, vG, vR] = p.variants;

  // --- PEDIDOS em vários estados (o livro é a verdade)
  const mk = async (n: number, status: string, extra: Record<string, unknown> = {}) =>
    db.order.create({ data: { companyId: loja.id, customerId: cli.id, number: n, status: status as never, sellerId: vend.id, stockDeducted: true, ...extra } });
  const mov = (orderId: string, variantId: string, type: "SAIDA" | "ENTRADA", quantity: number) =>
    db.inventoryMovement.create({ data: { companyId: loja.id, variantId, orderId, type, quantity, reason: `${type} — pedido` } });

  // 1) ORÇAMENTO com reserva PARCIAL: pediu 10, segurou 3
  const orc = await mk(1, "ORCAMENTO");
  await db.orderItem.create({ data: { orderId: orc.id, productId: p.id, variantId: vM.id, name: "Vestido", quantity: 10, unitPrice: 50, total: 500 } });
  await mov(orc.id, vM.id, "SAIDA", 3);
  // 2) PAGO segurando 2 (ainda na loja, em separação)
  const pago = await mk(2, "PAGO", { paidAt: new Date() });
  await db.orderItem.create({ data: { orderId: pago.id, productId: p.id, variantId: vG.id, name: "Vestido", quantity: 2, unitPrice: 50, total: 100 } });
  await mov(pago.id, vG.id, "SAIDA", 2);
  // 3) ENVIADO (peça saiu): não é reserva
  const env = await mk(3, "ENVIADO", { paidAt: new Date() });
  await mov(env.id, vG.id, "SAIDA", 5);
  // 4) CANCELADO devolvido: líquido zero
  const canc = await mk(4, "CANCELADO", { stockDeducted: false });
  await mov(canc.id, vR.id, "SAIDA", 4); await mov(canc.id, vR.id, "ENTRADA", 4);
  // 5) BAIXA DEFINITIVA reaberta (brinde): peça foi embora
  const brinde = await mk(5, "PAGO", { stockWrittenOff: true, paidAt: new Date() });
  await mov(brinde.id, vR.id, "SAIDA", 2);

  // --- PRODUÇÃO
  await db.sewingItem.createMany({ data: [
    { companyId: loja.id, productName: "Vestido", color: "Azul", size: "M", cutPieces: 30, donePieces: 12, cutCode: 7 },
    { companyId: loja.id, productName: "Vestido", color: "Azul", size: "G", cutPieces: 20, donePieces: 20 },
    { companyId: loja.id, productName: "Calça", color: "Preta", size: "38", cutPieces: 15, donePieces: 5 },
  ] });
  await db.sewingBatch.create({ data: { companyId: loja.id, code: 1, destination: "FACCAO", status: "ENVIADO",
    items: { create: [{ productName: "Vestido", sent: 20, good: 5, defect: 1 }] } } });
  await db.sewingBatch.create({ data: { companyId: loja.id, code: 2, destination: "INTERNA", status: "PARCIAL",
    items: { create: [{ productName: "Calça", sent: 10, good: 3, defect: 0 }] } } });
  await db.sewingBatch.create({ data: { companyId: loja.id, code: 3, destination: "FACCAO", status: "FECHADO",
    items: { create: [{ productName: "Vestido", sent: 8, good: 6, defect: 1 }] } } });
  const tec = await db.fabric.create({ data: { companyId: loja.id, name: "Malha", widthM: 1.6, yieldMPerKg: 3 } });
  const tecOff = await db.fabric.create({ data: { companyId: loja.id, name: "Antigo", widthM: 1.6, yieldMPerKg: 3, active: false } });
  await db.fabricRoll.createMany({ data: [
    { fabricId: tec.id, color: "Azul", weightKg: 20, remainingKg: 12.5, pricePerKg: 40 },
    { fabricId: tec.id, color: "Preto", weightKg: 10, remainingKg: 3, pricePerKg: 50 },
    { fabricId: tec.id, color: "Verde", weightKg: 10, remainingKg: 0.005, pricePerKg: 50 }, // resto de arredondamento
    { fabricId: tec.id, color: "Cinza", weightKg: 10, remainingKg: 0, pricePerKg: 50 },     // acabou
    { fabricId: tecOff.id, color: "Bege", weightKg: 10, remainingKg: 9, pricePerKg: 30 },   // tecido inativo
  ] });

  console.log("\n========== ESTOQUE × PRODUÇÃO ==========");
  const est = await resumoDaProducao(loja.id);

  // tela Costura: soma cutPieces - donePieces (take 500)
  const itensCostura = await db.sewingItem.findMany({ where: { companyId: loja.id }, orderBy: { createdAt: "desc" }, take: 500 });
  const aMontarCostura = itensCostura.reduce((a, r) => a + (r.cutPieces - r.donePieces), 0);
  cmp("Cortado esperando costura", est.cortadas.aguardando, aMontarCostura, "tela Costura");

  // tela Lotes: pool disponível por SKU (rest > 0)
  const pool = await db.sewingItem.findMany({ where: { companyId: loja.id } });
  const grupos = new Map<string, number>();
  for (const i of pool) { const rest = i.cutPieces - i.donePieces; if (rest <= 0) continue;
    const k = `${norm(i.productName)}|${norm(i.color)}|${norm(i.size)}`; grupos.set(k, (grupos.get(k) ?? 0) + rest); }
  cmp("Cortado (total do pool da tela Lotes)", est.cortadas.aguardando, [...grupos.values()].reduce((a, b) => a + b, 0), "tela Lotes");
  cmp("Cortado (nº de linhas)", est.cortadas.itens.length, grupos.size, "tela Lotes");

  // tela Lotes: "Ainda fora" por lote não fechado
  const lotes = await db.sewingBatch.findMany({ where: { companyId: loja.id }, include: { items: true } });
  const foraTela = lotes.filter((l) => l.status !== "FECHADO").reduce((a, l) => a + l.items.reduce((s, i) => s + (i.sent - i.good - i.defect), 0), 0);
  const foraFaccao = lotes.filter((l) => l.status !== "FECHADO" && l.destination === "FACCAO").reduce((a, l) => a + l.items.reduce((s, i) => s + (i.sent - i.good - i.defect), 0), 0);
  cmp("Em lote de costura (total)", est.faccao.fora, foraTela, "tela Lotes (Ainda fora)");
  cmp("Na facção", est.faccao.naFaccao, foraFaccao, "tela Lotes (só facção)");
  cmp("Lotes abertos", est.faccao.lotesAbertos, lotes.filter((l) => l.status !== "FECHADO").length, "tela Lotes");

  // tela Cortes: rolos com sobra (tecido ativo, remainingKg > 0)
  const rolosCortes = await db.fabricRoll.findMany({ where: { fabric: { companyId: loja.id, active: true }, remainingKg: { gt: 0 } } });
  cmp("Rolos com sobra (quantidade)", est.rolos.quantidade, rolosCortes.length, "tela Cortes");
  cmp("Rolos: kg", Number(est.rolos.kg.toFixed(3)), Number(rolosCortes.reduce((a, r) => a + r.remainingKg, 0).toFixed(3)), "tela Cortes");

  console.log("\n========== ESTOQUE × PEDIDOS ==========");
  const inv = await montarInventario(loja.id, {});
  const linha = (id: string) => inv.linhas.find((l) => l.variantId === id)!;
  const reservado = await reservadoPorVariacao(loja.id);

  // ficha de CADA pedido: o que o livro diz que ele segura
  const pedidos = await db.order.findMany({ where: { companyId: loja.id }, orderBy: { number: "asc" }, include: { items: true } });
  const seguradoPorVariacao = new Map<string, number>();
  for (const o of pedidos) {
    const liq = await baixasLiquidasDoPedido(db, o.id);
    const total = [...liq.values()].reduce((a, b) => a + b, 0);
    const pedidas = o.items.reduce((s, i) => s + i.quantity, 0);
    const contaNaLoja = ["ORCAMENTO", "AGUARDANDO_PAGAMENTO", "PAGO", "EM_PRODUCAO", "SEPARACAO"].includes(o.status) && !o.stockWrittenOff;
    console.log(`   pedido #${o.number} (${o.status}${o.stockWrittenOff ? ", baixa definitiva" : ""}): ficha diz ${total} seguradas (pedido tem ${pedidas})${contaNaLoja ? "" : " — não conta como reserva na loja"}`);
    if (contaNaLoja) for (const [v, q] of liq) seguradoPorVariacao.set(v, (seguradoPorVariacao.get(v) ?? 0) + q);
  }
  for (const v of [vM, vG, vR]) {
    const rot = `${v.color} ${v.size}`;
    cmp(`Reservado ${rot}`, linha(v.id).reservado, seguradoPorVariacao.get(v.id) ?? 0, "soma das fichas de pedido");
    cmp(`  (consulta direta)`, reservado.get(v.id) ?? 0, seguradoPorVariacao.get(v.id) ?? 0, "soma das fichas");
  }

  // Estoque × Produtos: disponível é o mesmo stock
  const vars = await db.productVariant.findMany({ where: { product: { companyId: loja.id } } });
  cmp("Disponível (soma) × tela Produtos", inv.resumo.disponiveis, vars.reduce((a, v) => a + v.stock, 0), "tela Produtos (stock)");

  await db.company.delete({ where: { id: loja.id } });
  console.log(falhas === 0 ? "\n>>> TUDO BATE" : `\n>>> ${falhas} DIVERGÊNCIA(S)`);
}
async function main2() {
  const loja = await db.company.create({ data: { name: `L2 ${tag}`, slug: `${tag}-2`, estoqueEnabled: true, lowStockThreshold: 3 } });
  const cli = await db.customer.create({ data: { companyId: loja.id, name: "M", phone: "5511988880000" } });
  const vend = await db.user.create({ data: { companyId: loja.id, name: "V", email: `v-${tag}@x.x`, passwordHash: "x", role: "SELLER" } });
  await db.estoqueMinimoCategoria.create({ data: { companyId: loja.id, category: "Vestidos", minStock: 5 } });

  // Vestidos (mín. categoria 5): M=2 (no mín.), G=0 (zerada, no mín.), P=9 (ok)
  const v = await db.product.create({ data: { companyId: loja.id, name: "Vestido", sku: "V", category: "Vestidos", costPrice: 20, wholesalePrice: 50,
    variants: { create: [{ color: "Azul", size: "M", stock: 2 }, { color: "Azul", size: "G", stock: 0 }, { color: "Azul", size: "P", stock: 9 }] } }, include: { variants: true } });
  // Calça (mín. peça 1): 1 (no mín.)
  const c = await db.product.create({ data: { companyId: loja.id, name: "Calça", sku: "C", category: "Calças", minStock: 1, costPrice: 30, wholesalePrice: 80,
    variants: { create: [{ color: "Preta", size: "38", stock: 1 }] } }, include: { variants: true } });
  // Blusa (mín. loja 3): 3 (no mín.) e 8 (ok); inativa não conta
  const b = await db.product.create({ data: { companyId: loja.id, name: "Blusa", sku: "B", category: "Blusas", costPrice: 10, wholesalePrice: 25,
    variants: { create: [{ color: "Branca", size: "U", stock: 3 }, { color: "Preta", size: "U", stock: 8 }] } }, include: { variants: true } });
  await db.product.create({ data: { companyId: loja.id, name: "Velha", sku: "X", category: "Blusas", active: false,
    variants: { create: [{ color: "X", size: "U", stock: 0 }] } } });
  // dá "movimento" a todas (senão o alerta as trata como nascidas zeradas)
  const todas = await db.productVariant.findMany({ where: { product: { companyId: loja.id } } });
  await db.inventoryMovement.createMany({ data: todas.map((x) => ({ companyId: loja.id, variantId: x.id, type: "ENTRADA" as const, quantity: 10, reason: "carga" })) });

  console.log("=== 'NO MÍNIMO': quatro telas, uma régua? ===");
  const dash = await contarNoMinimo(loja.id);                       // cartão do Dashboard (SQL)
  const inv = await montarInventario(loja.id, { filtro: "baixo" }); // Inventário (filtro do sino)
  const painel = await montarPainel(loja.id);                       // Painel
  const { linhas } = await linhasDoEstoque(loja.id);
  const alerta = decidirAlertas(linhas, new Set(), new Set(linhas.map((l) => l.variantId))).avisar.length;
  // monitor da tela Produtos (mesma conta que a page faz por linha)
  const mins = new Map((await db.estoqueMinimoCategoria.findMany({ where: { companyId: loja.id } })).map((m) => [m.category, m.minStock]));
  const prods = await db.product.findMany({ where: { companyId: loja.id, active: true }, include: { variants: true } });
  const monitor = prods.flatMap((p) => p.variants.map((x) => ({ stock: x.stock, minimo: minimoEfetivo({ peca: p.minStock, categoria: mins.get(p.category), loja: 3 }).valor })))
    .filter((r) => noMinimo(r.stock, r.minimo)).length;

  cmp("Cartão do Dashboard (SQL)", dash, 4, "esperado (Vestido M, Vestido G, Calça 38, Blusa Branca)");
  cmp("Inventário — filtro do sino", inv.total, dash, "cartão do Dashboard");
  cmp("Inventário — card 'No mínimo'", inv.resumo.baixas, dash, "cartão do Dashboard");
  cmp("Painel — card 'No mínimo'", painel.totais.noMinimo, dash, "cartão do Dashboard");
  cmp("Painel — lista 'O que repor'", painel.repor.length, dash, "cartão do Dashboard");
  cmp("Alerta do sino", alerta, dash, "cartão do Dashboard");
  cmp("Monitor da tela Produtos", monitor, dash, "cartão do Dashboard");

  console.log("\n=== GIRO: mesma régua de venda do Dashboard/Relatórios (RN-001)? ===");
  const pago = await db.order.create({ data: { companyId: loja.id, customerId: cli.id, number: 1, status: "PAGO", paidAt: new Date(), sellerId: vend.id,
    items: { create: [{ productId: v.id, variantId: v.variants[0].id, name: "V", quantity: 7, unitPrice: 50, total: 350 }] } } });
  await db.order.create({ data: { companyId: loja.id, customerId: cli.id, number: 2, status: "ORCAMENTO",
    items: { create: [{ productId: v.id, variantId: v.variants[0].id, name: "V", quantity: 99, unitPrice: 50, total: 4950 }] } } });
  await db.order.create({ data: { companyId: loja.id, customerId: cli.id, number: 3, status: "CANCELADO",
    items: { create: [{ productId: v.id, variantId: v.variants[0].id, name: "V", quantity: 50, unitPrice: 50, total: 2500 }] } } });
  void pago;
  const painel2 = await montarPainel(loja.id);
  const pecasPagasComoNoDashboard = (await db.orderItem.aggregate({ _sum: { quantity: true },
    where: { order: { companyId: loja.id, status: { in: PAID_ORDER_STATUSES }, paidAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } } }))._sum.quantity ?? 0;
  cmp("Painel — vendidas em 30 dias", painel2.totais.vendidos30, pecasPagasComoNoDashboard, "régua RN-001 (pedido pago)");

  console.log("\n=== PEÇAS: 'na loja' (Estoque) × 'un.' (tela Produtos) ===");
  const semReserva = await montarInventario(loja.id, {});
  const unProdutos = (await db.productVariant.findMany({ where: { product: { companyId: loja.id, active: true } } })).reduce((a, x) => a + x.stock, 0);
  cmp("Sem nenhuma reserva: na loja = un.", semReserva.resumo.pecas, unProdutos, "tela Produtos");
  // agora com reserva viva
  const orc = await db.order.create({ data: { companyId: loja.id, customerId: cli.id, number: 4, status: "ORCAMENTO", stockDeducted: true } });
  await db.inventoryMovement.create({ data: { companyId: loja.id, variantId: v.variants[2].id, orderId: orc.id, type: "SAIDA", quantity: 4, reason: "reserva" } });
  const comReserva = await montarInventario(loja.id, {});
  console.log(`   com 4 peças reservadas: Estoque 'na loja' = ${comReserva.resumo.pecas}, 'disponível' = ${comReserva.resumo.disponiveis}, tela Produtos 'un.' = ${unProdutos}`);
  cmp("Com reserva: DISPONÍVEL = un. da tela Produtos", comReserva.resumo.disponiveis, unProdutos, "tela Produtos");
  console.log(`   → 'na loja' (${comReserva.resumo.pecas}) = disponível (${comReserva.resumo.disponiveis}) + reservado (${comReserva.resumo.reservadas}) — por desenho`);

  await db.company.delete({ where: { id: loja.id } });
}

main()
  .then(main2)
  .then(() => console.log(falhas === 0 ? "\n>>> TUDO BATE ✅" : `\n>>> ${falhas} DIVERGÊNCIA(S) ❌`)).catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
