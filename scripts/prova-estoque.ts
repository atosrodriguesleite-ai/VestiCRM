/* eslint-disable */
/**
 * PROVA PONTA A PONTA DO MÓDULO ESTOQUE (RN-050/051/052) contra o Postgres
 * LOCAL. Cria lojas de teste com nome sorteado, roda os cenários e apaga
 * tudo no fim. NUNCA roda contra produção: a trava abaixo exige a porta
 * 5433 do Postgres local (regra da casa: "NUNCA rodar db:seed em produção").
 *
 * Uso: set -a; source .env; set +a; npx tsx scripts/prova-estoque.ts
 */
if (!/(localhost|127\.0\.0\.1):5433\b/.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("prova-estoque só roda contra o Postgres LOCAL (porta 5433)");
}
import { db } from "../src/lib/db";
import { linhasDoEstoque, contarNoMinimo, montarInventario } from "../src/lib/estoque/inventario";
import { varrerMinimos, varrerMinimosSeDevido } from "../src/lib/estoque/alerta";
import { montarPainel } from "../src/lib/estoque/analise";
import { noMinimo } from "../src/lib/estoque/minimos-regra";
import { resumoDaProducao } from "../src/lib/estoque/producao";
import { salvarMinimoDaCategoria, salvarMinimoDaPeca } from "../src/lib/estoque/minimos";

const tag = `rn051-${Date.now()}`;
function ok(cond: unknown, msg: string) {
  if (!cond) { console.error("❌ FALHOU:", msg); process.exitCode = 1; } else console.log("✅", msg);
}
async function main() {
  const loja = await db.company.create({ data: { name: `Loja ${tag}`, slug: tag, estoqueEnabled: true, productionEnabled: true, lowStockThreshold: 3 } });
  const semModulo = await db.company.create({ data: { name: `Sem ${tag}`, slug: `${tag}-b`, estoqueEnabled: false, lowStockThreshold: 3 } });
  const mkUser = (role: string, name: string, companyId = loja.id) =>
    db.user.create({ data: { companyId, name, email: `${name}-${tag}@x.x`, passwordHash: "x", role: role as never } });
  const admin = await mkUser("ADMIN", "Admin");
  const gerente = await mkUser("MANAGER", "Gerente");
  const vendedora = await mkUser("SELLER", "Vendedora");
  const inativa = await db.user.create({ data: { companyId: loja.id, name: "Inativa", email: `in-${tag}@x.x`, passwordHash: "x", role: "MANAGER", active: false } });

  // vestidos: mínimo da categoria 4; calça: mínimo da peça 1; blusa: loja (3)
  const vestido = await db.product.create({ data: { companyId: loja.id, name: "Vestido", sku: "V", category: "Vestidos", costPrice: 20, wholesalePrice: 50,
    variants: { create: [{ color: "Azul", size: "M", stock: 4 }, { color: "Azul", size: "G", stock: 10 }] } }, include: { variants: true } });
  const calca = await db.product.create({ data: { companyId: loja.id, name: "Calça", sku: "C", category: "Calças", minStock: 1, costPrice: 30, wholesalePrice: 80,
    variants: { create: [{ color: "Preta", size: "38", stock: 1 }, { color: "Preta", size: "40", stock: 2 }] } }, include: { variants: true } });
  const blusa = await db.product.create({ data: { companyId: loja.id, name: "Blusa", sku: "B", category: "Blusas", costPrice: 10, wholesalePrice: 25,
    variants: { create: [{ color: "Branca", size: "U", stock: 3 }, { color: "Preta", size: "U", stock: 8, nuvemshopId: "ns-1" }] } }, include: { variants: true } });
  const inativo = await db.product.create({ data: { companyId: loja.id, name: "Antigo", sku: "A", category: "Blusas", active: false,
    variants: { create: [{ color: "X", size: "U", stock: 0 }] } }, include: { variants: true } });
  await salvarMinimoDaCategoria(loja.id, "Vestidos", 4);

  // ---- mínimos efetivos
  const { linhas } = await linhasDoEstoque(loja.id);
  const li = (id: string) => linhas.find((l) => l.variantId === id)!;
  ok(li(vestido.variants[0].id).minimo === 4 && li(vestido.variants[0].id).origemDoMinimo === "CATEGORIA", "vestido: mínimo 4 da categoria");
  ok(li(calca.variants[0].id).minimo === 1 && li(calca.variants[0].id).origemDoMinimo === "PECA", "calça: mínimo 1 da peça (vence a loja)");
  ok(li(blusa.variants[0].id).minimo === 3 && li(blusa.variants[0].id).origemDoMinimo === "LOJA", "blusa: mínimo 3 da loja");
  // no mínimo: vestido M (4≤4), calça 38 (1≤1), blusa branca (3≤3) → 3
  ok((await contarNoMinimo(loja.id)) === 3, "Dashboard (SQL): 3 variações no mínimo (inativo fora)");
  ok((await contarNoMinimo(loja.id)) === linhas.filter((l) => noMinimo(l.disponivel, l.minimo)).length, "a SQL do Dashboard bate com a regra pura sobre as mesmas linhas (UMA régua)");
  const inv = await montarInventario(loja.id, { filtro: "baixo" });
  ok(inv.total === 3 && inv.resumo.baixas === 3, "Inventário filtro 'baixo' = 3, pelo mínimo de cada uma");

  // ---- alerta: variação que NASCE zerada (sem movimento) não avisa
  const nascida = await db.product.create({ data: { companyId: loja.id, name: "Nascida", sku: "N", category: "Blusas",
    variants: { create: [{ color: "X", size: "U", stock: 0 }] } }, include: { variants: true } });
  // as três no mínimo têm estoque > 0 (já tiveram peça); a nascida zerada não tem movimento
  const n1 = await varrerMinimos(loja.id);
  ok(n1 === 3, `1ª varredura avisa 3 — a nascida zerada fica fora (${n1})`);
  ok((await db.productVariant.findUnique({ where: { id: nascida.variants[0].id } }))!.lowStockAlertedAt === null, "nascida zerada: sem carimbo");
  await db.product.delete({ where: { id: nascida.id } });
  const notifs = await db.notification.findMany({ where: { companyId: loja.id, type: "ESTOQUE" } });
  ok(notifs.length === 2 && notifs.every((n) => [admin.id, gerente.id].includes(n.userId)), "aviso só para admin e gerente ATIVOS (vendedora e gerente inativa fora)");
  ok(notifs[0].title === "⚠️ 3 peças chegaram ao mínimo" && /Calça Preta 38 \(1\/1\)/.test(notifs[0].body), `texto: "${notifs[0].title}" — ${notifs[0].body}`);
  const n2 = await varrerMinimos(loja.id);
  ok(n2 === 0 && (await db.notification.count({ where: { companyId: loja.id, type: "ESTOQUE" } })) === 2, "2ª varredura: silêncio (carimbo)");
  // recuperação: blusa branca sobe para 9 → carimbo zera; depois cai de novo → avisa de novo
  await db.productVariant.update({ where: { id: blusa.variants[0].id }, data: { stock: 9 } });
  await varrerMinimos(loja.id);
  const v = await db.productVariant.findUnique({ where: { id: blusa.variants[0].id } });
  ok(v!.lowStockAlertedAt === null, "subiu acima do mínimo: carimbo zerado");
  await db.productVariant.update({ where: { id: blusa.variants[0].id }, data: { stock: 2 } });
  const n3 = await varrerMinimos(loja.id);
  ok(n3 === 1, "caiu de novo: avisa de novo (1)");
  // produto inativo com carimbo é solto e não avisa
  await db.productVariant.update({ where: { id: inativo.variants[0].id }, data: { lowStockAlertedAt: new Date() } });
  await varrerMinimos(loja.id);
  ok((await db.productVariant.findUnique({ where: { id: inativo.variants[0].id } }))!.lowStockAlertedAt === null, "inativo: carimbo solto, sem aviso");
  // trava: duas chamadas seguidas → só uma roda; loja sem módulo nunca roda
  await db.company.update({ where: { id: loja.id }, data: { estoqueAlertaRunAt: null } });
  // cai para 1 (≤ 4): tem peça, então já "teve estoque" — a nascida zerada
  // sem movimento é outro caso (provado acima)
  await db.productVariant.update({ where: { id: vestido.variants[1].id }, data: { stock: 1 } });
  const antes = await db.notification.count({ where: { companyId: loja.id, type: "ESTOQUE" } });
  await Promise.all([varrerMinimosSeDevido(loja.id), varrerMinimosSeDevido(loja.id)]);
  const depois = await db.notification.count({ where: { companyId: loja.id, type: "ESTOQUE" } });
  ok(depois - antes === 2, `trava: duas chamadas juntas, UMA rodada (2 avisos, um por gerente): ${depois - antes}`);
  const pSem = await db.product.create({ data: { companyId: semModulo.id, name: "X", sku: "X", category: "C", variants: { create: [{ color: "a", size: "b", stock: 0 }] } } });
  await db.user.create({ data: { companyId: semModulo.id, name: "AdmSem", email: `adm-${tag}@x.x`, passwordHash: "x", role: "ADMIN" } });
  await varrerMinimosSeDevido(semModulo.id);
  ok((await db.notification.count({ where: { companyId: semModulo.id } })) === 0, "loja sem o módulo: varredura não roda");
  void pSem;

  // ---- painel: vendas pagas vs orçamento
  const cli = await db.customer.create({ data: { companyId: loja.id, name: "Maria", phone: "5511999990001" } });
  const pago = await db.order.create({ data: { companyId: loja.id, customerId: cli.id, number: 1, status: "PAGO", paidAt: new Date(), sellerId: vendedora.id,
    items: { create: [{ productId: vestido.id, variantId: vestido.variants[0].id, name: "Vestido", quantity: 6, unitPrice: 50, total: 300 }] } } });
  const orc = await db.order.create({ data: { companyId: loja.id, customerId: cli.id, number: 2, status: "ORCAMENTO",
    items: { create: [{ productId: vestido.id, variantId: vestido.variants[0].id, name: "Vestido", quantity: 100, unitPrice: 50, total: 5000 }] } } });
  const velho = await db.order.create({ data: { companyId: loja.id, customerId: cli.id, number: 3, status: "ENTREGUE", paidAt: new Date(Date.now() - 70 * 86_400_000), createdAt: new Date(Date.now() - 70 * 86_400_000),
    items: { create: [{ productId: calca.id, variantId: calca.variants[1].id, name: "Calça", quantity: 2, unitPrice: 80, total: 160 }] } } });
  void orc; void pago; void velho;
  // reservado: pedido cancelado com BAIXA DEFINITIVA e reaberto não conta
  const brinde = await db.order.create({ data: { companyId: loja.id, customerId: cli.id, number: 9, status: "PAGO", stockDeducted: true, stockWrittenOff: true, paidAt: new Date(), sellerId: vendedora.id } });
  await db.inventoryMovement.create({ data: { companyId: loja.id, variantId: calca.variants[0].id, orderId: brinde.id, type: "SAIDA", quantity: 3, reason: "reserva" } });
  const invB = await montarInventario(loja.id, {});
  ok(invB.linhas.find((l) => l.variantId === calca.variants[0].id)!.reservado === 0, "baixa definitiva reaberta: reservado 0 (a peça foi embora)");
  // peça da Nuvemshop no mínimo ENTRA em "repor" (mesma régua do card), marcada com o dono
  await db.productVariant.update({ where: { id: blusa.variants[1].id }, data: { stock: 2 } });
  const painel = await montarPainel(loja.id);
  ok(painel.totais.vendidasSemPeca === 0, "sem item órfão: vendidasSemPeca 0");
  const vm = painel.maisVendidas.find((l) => l.variantId === vestido.variants[0].id);
  ok(vm && vm.analise.vendidos30 === 6 && painel.totais.vendidos30 === 6, "giro conta só pedido PAGO (6), orçamento de 100 fora");
  ok(vm!.analise.coberturaDias === Math.floor(4 / (6 / 30)), `cobertura do vestido M = ${vm!.analise.coberturaDias} dias`);
  const rep = painel.repor.find((l) => l.variantId === vestido.variants[0].id);
  ok(rep && rep.analise.repor === Math.max(6, 8) - 4, `repor vestido M: ${rep?.analise.repor} (dobro do mínimo 8 − 4)`);
  const ns = painel.repor.find((l) => l.variantId === blusa.variants[1].id);
  ok(ns !== undefined && ns.dono === "NUVEMSHOP" && painel.repor.length === painel.totais.noMinimo, `'repor' tem TODA peça no mínimo (${painel.repor.length} = ${painel.totais.noMinimo}), a da Nuvemshop com o dono`);
  const enc = painel.encalhadas.find((l) => l.variantId === calca.variants[1].id);
  ok(enc && enc.analise.diasSemVenda === 70 && enc.analise.valorParadoCusto === 2 * 30, "calça 40: encalhada (70 dias), R$ 60 a custo");
  ok(painel.totais.valorCusto === linhas.reduce((s, l) => 0, 0) + (await linhasDoEstoque(loja.id)).linhas.reduce((s, l) => s + l.emEstoque * l.custo, 0), "valor a custo = Σ em estoque × custo");
  const cat = painel.porCategoria.find((c) => c.categoria === "Vestidos");
  ok(cat && cat.vendidos30 === 6 && cat.noMinimo === 2, `por categoria Vestidos: vendidas 6, no mínimo ${cat?.noMinimo}`);
  const painelOutra = await montarPainel(semModulo.id);
  ok(painelOutra.totais.vendidos30 === 0 && painelOutra.maisVendidas.length === 0, "outra loja não vê as vendas (RN-013)");

  // ---- produção
  const tecido = await db.fabric.create({ data: { companyId: loja.id, name: "Malha", widthM: 1.6, yieldMPerKg: 3 } });
  await db.fabricRoll.createMany({ data: [
    { fabricId: tecido.id, color: "Azul", weightKg: 20, remainingKg: 12.5, pricePerKg: 40 },
    { fabricId: tecido.id, color: "Azul", weightKg: 20, remainingKg: 0, pricePerKg: 40 },
    { fabricId: tecido.id, color: "Preto", weightKg: 10, remainingKg: 3, pricePerKg: 50 },
  ] });
  await db.sewingItem.createMany({ data: [
    { companyId: loja.id, productName: "Vestido", color: "Azul", size: "M", cutPieces: 30, donePieces: 12, cutCode: 7 },
    { companyId: loja.id, productName: "Calça", color: "Preta", size: "38", cutPieces: 10, donePieces: 10 },
  ] });
  const lote = await db.sewingBatch.create({ data: { companyId: loja.id, code: 1, destination: "FACCAO", status: "ENVIADO",
    items: { create: [{ productName: "Vestido", sent: 20, good: 5, defect: 1 }] } } });
  void lote;
  const prod = await resumoDaProducao(loja.id);
  ok(prod.cortadas.aguardando === 18 && prod.cortadas.itens.length === 1, "cortadas esperando costura: 18 (a fechada não aparece)");
  ok(prod.faccao.fora === 14 && prod.faccao.naFaccao === 14 && prod.faccao.lotesAbertos === 1, "em lote de costura: 14 (facção)");
  ok(prod.rolos.quantidade === 2 && Math.abs(prod.rolos.kg - 15.5) < 1e-9 && prod.rolos.valor === 12.5 * 40 + 3 * 50, `rolos com sobra: 2, 15,5 kg, R$ ${prod.rolos.valor}`);
  ok((await resumoDaProducao(semModulo.id)).rolos.quantidade === 0, "outra loja: nada (RN-013)");

  // mínimo da peça: limpar volta à categoria
  ok(await salvarMinimoDaPeca(loja.id, calca.id, null), "limpar mínimo da peça");
  ok(!(await salvarMinimoDaPeca(semModulo.id, calca.id, 5)), "outra loja não mexe no mínimo da peça (RN-013)");
  const depoisLimpar = (await linhasDoEstoque(loja.id)).linhas.find((l) => l.variantId === calca.variants[0].id)!;
  ok(depoisLimpar.minimo === 3 && depoisLimpar.origemDoMinimo === "LOJA", "calça sem mínimo próprio → o da loja");

  await db.company.deleteMany({ where: { id: { in: [loja.id, semModulo.id] } } });
  console.log("fim");
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
