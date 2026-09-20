/**
 * PROVA CONTRA O POSTGRES (RN-061): a curva ABC conta as MESMAS peças e o
 * MESMO dinheiro dos outros quadros da Inteligência — unidades = soma de
 * "Vendidas" por cor; faturamento = faturamento do período (netTotal); só
 * pedido pago pela data do pagamento; período respeitado.
 *
 *   DATABASE_URL=... AUTH_SECRET=... NODE_PATH=./node_modules npx tsx --tsconfig tsconfig.json scripts/confere-curva-abc.ts
 */
import { db } from "@/lib/db";
import { colorStats, curvaAbcStats, overview } from "@/lib/tracking/insights";

const check = (n: string, ok: boolean) => console.log(ok ? "✅" : "❌", n);
const tag = `abc-${Date.now()}`;

async function main() {
  const loja = await db.company.create({ data: { name: `L ${tag}`, slug: tag } });
  const cli = await db.customer.create({ data: { companyId: loja.id, name: "Maria", phone: "5511999990000" } });
  const vend = await db.user.create({ data: { companyId: loja.id, name: "Lara", email: `v-${tag}@x.x`, passwordHash: "x", role: "SELLER" } });
  const p = await db.product.create({
    data: {
      companyId: loja.id, name: "Regata Alça", sku: "RA", category: "Regatas", wholesalePrice: 20,
      variants: { create: [{ color: "Preta", size: "M", stock: 50 }, { color: "Preta", size: "G", stock: 50 }, { color: "Branca", size: "M", stock: 50 }] },
    },
    include: { variants: true },
  });
  const [pretaM, pretaG, brancaM] = p.variants;
  const hoje = new Date();
  const mk = async (n: number, status: string, paidAt: Date | null, itens: { v: typeof pretaM; q: number; preco: number }[], desconto = 0) => {
    const subtotal = itens.reduce((s, i) => s + i.q * i.preco, 0);
    const o = await db.order.create({
      data: { companyId: loja.id, customerId: cli.id, sellerId: vend.id, number: n, status: status as never, paidAt, subtotal, discount: desconto, netTotal: subtotal - desconto, total: subtotal - desconto + 30 },
    });
    for (const i of itens) {
      await db.orderItem.create({ data: { orderId: o.id, productId: p.id, variantId: i.v.id, name: "Regata Alça", color: i.v.color, size: i.v.size, quantity: i.q, unitPrice: i.preco, total: i.q * i.preco } });
    }
    return o;
  };
  // pagos no período: 30 Preta M + 8 Preta G + 2 Branca M (com desconto de 10% num pedido)
  await mk(1, "PAGO", hoje, [{ v: pretaM, q: 20, preco: 20 }, { v: pretaG, q: 5, preco: 20 }], 50);
  await mk(2, "ENVIADO", new Date(hoje.getTime() - 2 * 86400_000), [{ v: pretaM, q: 10, preco: 20 }, { v: brancaM, q: 2, preco: 20 }]);
  await mk(3, "PAGO", hoje, [{ v: pretaG, q: 3, preco: 20 }]);
  // fora: orçamento, cancelado e pago FORA do período
  await mk(4, "ORCAMENTO", null, [{ v: brancaM, q: 40, preco: 20 }]);
  await mk(5, "CANCELADO", hoje, [{ v: brancaM, q: 40, preco: 20 }]);
  await mk(6, "PAGO", new Date(hoje.getTime() - 40 * 86400_000), [{ v: brancaM, q: 40, preco: 20 }]);

  const periodo = { from: new Date(hoje.getTime() - 30 * 86400_000), to: new Date(hoje.getTime() + 60_000) };
  const abc = await curvaAbcStats(loja.id, periodo);
  const cores = await colorStats(loja.id, periodo);
  const visao = await overview(loja.id, periodo);

  check("unidades: 40 peças pagas no período (orçamento, cancelado e fora do período ficam de fora)", abc.totalUnidades === 40);
  check("unidades batem com a soma de 'Vendidas' do quadro de Cores", cores.reduce((s, c) => s + c.sold, 0) === abc.totalUnidades);
  check("faturamento bate com o da Visão Geral (netTotal — frete e pedidos não pagos fora)", Math.abs(abc.totalFaturamento - visao.revenue) < 0.01);
  check("linha é a peça exata, rotulada pelo cadastro: 'Regata Alça · Preta · M' com 30 un.", abc.linhas[0]?.rotulo === "Regata Alça · Preta · M" && abc.linhas[0].unidades === 30);
  check("ordem e classes: Preta M (75%) A, Preta G (cruza 80→95%) A, Branca M (começa em 95%) C", abc.linhas.map((l) => l.classe).join("") === "AAC" && abc.linhas[1].rotulo === "Regata Alça · Preta · G");
  const somaLinhas = abc.linhas.reduce((s, l) => s + l.faturamento, 0);
  check("a soma das linhas fecha com o total (rateio do desconto sem perder centavo)", Math.abs(somaLinhas - abc.totalFaturamento) < 0.02);
  // renomear a peça não divide a linha
  await db.product.update({ where: { id: p.id }, data: { name: "Regata Nadador" } });
  const abc2 = await curvaAbcStats(loja.id, periodo);
  check("renomear o produto: a linha segue UMA, com o nome de hoje", abc2.linhas.length === 3 && abc2.linhas[0].rotulo === "Regata Nadador · Preta · M");
  // base por faturamento
  const porValor = await curvaAbcStats(loja.id, periodo, "faturamento");
  check("por faturamento: a mesma peça continua no topo e a soma das partes fecha 100", porValor.linhas[0].rotulo.includes("Preta · M") && Math.abs(porValor.linhas.at(-1)!.acumulado - 100) < 0.01);
  // outra loja não enxerga
  const outra = await db.company.create({ data: { name: `${tag}-b`, slug: `${tag}-b` } });
  check("outra loja vê a curva vazia (RN-013)", (await curvaAbcStats(outra.id, periodo)).linhas.length === 0);

  await db.company.delete({ where: { id: loja.id } });
  await db.company.delete({ where: { id: outra.id } });
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
