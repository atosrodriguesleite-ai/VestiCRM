/**
 * PROVA DE PONTA A PONTA — os fatos diários do BI e o painel (RN-082).
 *
 * Roda contra um Postgres DE VERDADE (nunca o de produção): cria uma loja
 * com horário seg–sex 8h–18h, contatos, conversas, mensagens (robô incluso)
 * e pedidos em dois dias, roda a rodada de fatos e monta o painel, e confere
 * cada número contra a conta feita à mão. Apaga a loja no fim.
 *
 *   DATABASE_URL="postgresql://…" npx tsx scripts/e2e-bi.ts
 */
import { db } from "@/lib/db";
import { atualizarFatosDoBi, atualizarFatosDoBiSeDevido } from "@/lib/bi/fatos";
import { montarPainel } from "@/lib/bi/painel";
import { HORARIO_SUGERIDO } from "@/lib/bi/horario-comercial";

const ok = (t: string) => console.log(`  ✅ ${t}`);
const falha = (t: string) => {
  console.log(`  ❌ ${t}`);
  process.exitCode = 1;
};
const conferir = (cond: boolean, t: string) => (cond ? ok(t) : falha(t));
const igual = (a: unknown, b: unknown, t: string) =>
  conferir(JSON.stringify(a) === JSON.stringify(b), `${t} — esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);

async function main() {
  const marca = Date.now();
  // sobras de uma rodada que falhou no meio
  await db.company.deleteMany({ where: { slug: { startsWith: "loja-bi-" } } });
  // "agora" = uma terça às 12:00 SP; ontem (segunda) é o dia cheio
  const agora = new Date("2026-10-13T12:00:00-03:00");
  const seg = (h: string) => new Date(`2026-10-12T${h}:00-03:00`);
  const ter = (h: string) => new Date(`2026-10-13T${h}:00-03:00`);

  const company = await db.company.create({
    data: {
      name: `Loja BI ${marca}`,
      slug: `loja-bi-${marca}`,
      horarioComercial: JSON.stringify(HORARIO_SUGERIDO),
      intakeSlaMinutes: 30,
    },
  });
  const ana = await db.user.create({
    data: { companyId: company.id, name: "Ana", email: `ana-${marca}@x.com`, passwordHash: "x", role: "SELLER" },
  });
  let n = 0;
  const cliente = async (nome: string, createdAt: Date, origin: "WHATSAPP" | "CATALOGO_PUBLICO" | "MANUAL") =>
    db.customer.create({ data: { companyId: company.id, name: nome, phone: `5511${String(marca).slice(-8)}${++n}`, createdAt, origin } });
  const k1 = await cliente("K1", seg("10:00"), "WHATSAPP");
  const k2 = await cliente("K2", seg("17:40"), "CATALOGO_PUBLICO");
  const k3 = await cliente("K3", seg("16:00"), "WHATSAPP");
  const k4 = await cliente("K4", seg("20:00"), "MANUAL");
  const conv = async (customerId: string, status: "OPEN" | "CLOSED" = "OPEN") =>
    db.conversation.create({ data: { companyId: company.id, customerId, status } });
  const c1 = await conv(k1.id);
  const c2 = await conv(k2.id);
  const c3 = await conv(k3.id);
  const c4 = await conv(k4.id, "CLOSED");
  const msg = (conversationId: string, direction: "IN" | "OUT", createdAt: Date, extra: { automatica?: boolean; authorId?: string | null } = {}) =>
    db.message.create({
      data: {
        conversationId,
        direction,
        kind: "TEXT",
        body: "oi",
        createdAt,
        authorId: direction === "OUT" ? (extra.authorId === undefined ? ana.id : extra.authorId) : null,
        automatica: extra.automatica ?? false,
      },
    });
  // c1: 10:00 → robô 10:05 (não conta) → humana 10:20: 20 min, no prazo
  await msg(c1.id, "IN", seg("10:00"));
  await msg(c1.id, "OUT", seg("10:05"), { automatica: true, authorId: null });
  await msg(c1.id, "OUT", seg("10:20"));
  // c2: 17:50 de segunda → 08:30 de terça: 40 min de atendimento, fora do prazo, conta na SEGUNDA
  await msg(c2.id, "IN", seg("17:50"));
  await msg(c2.id, "OUT", ter("08:30"));
  // c3: 16:00 sem resposta até agora (terça 12:00): aberta, estourou
  await msg(c3.id, "IN", seg("16:00"));
  // c4: conversa encerrada, cliente escreveu 20:30 e ninguém respondeu: não é "esperando"
  await msg(c4.id, "IN", seg("20:30"));
  // o portão de entrada carimba lastInboundAt/lastOutboundAt na conversa (é o que a
  // Fila e o "esperando agora" leem); aqui as mensagens entraram direto, então carimba à mão
  await db.conversation.update({ where: { id: c1.id }, data: { lastInboundAt: seg("10:00"), lastOutboundAt: seg("10:20") } });
  await db.conversation.update({ where: { id: c2.id }, data: { lastInboundAt: seg("17:50"), lastOutboundAt: ter("08:30") } });
  await db.conversation.update({ where: { id: c3.id }, data: { lastInboundAt: seg("16:00") } });
  await db.conversation.update({ where: { id: c4.id }, data: { lastInboundAt: seg("20:30") } });
  // pedidos: k1 criado e pago segunda (100,50); k2 criado segunda, pago terça (200); k3 cancelado
  await db.order.create({ data: { companyId: company.id, customerId: k1.id, number: 1, status: "PAGO", total: 100.5, netTotal: 100.5, subtotal: 100.5, createdAt: seg("10:30"), paidAt: seg("11:00"), sellerId: ana.id } });
  await db.order.create({ data: { companyId: company.id, customerId: k2.id, number: 2, status: "PAGO", total: 230, netTotal: 200, subtotal: 200, shippingFee: 30, createdAt: seg("18:00"), paidAt: ter("09:00"), sellerId: ana.id } });
  await db.order.create({ data: { companyId: company.id, customerId: k3.id, number: 3, status: "CANCELADO", total: 50, netTotal: 50, subtotal: 50, createdAt: seg("13:00") } });

  console.log("\n1) A rodada de fatos grava segunda e terça");
  const r = await atualizarFatosDoBi(company.id, agora);
  conferir(r.dias >= 8 && !r.cortou, `rodada calculou ${r.dias} dias sem cortar`);
  const segunda = await db.biDia.findUnique({ where: { companyId_dia: { companyId: company.id, dia: "2026-10-12" } } });
  const terca = await db.biDia.findUnique({ where: { companyId_dia: { companyId: company.id, dia: "2026-10-13" } } });
  conferir(!!segunda && !!terca, "linhas de segunda e terça existem");
  if (segunda) {
    igual(segunda.leads, 4, "segunda: 4 contatos novos");
    igual(JSON.parse(segunda.origens), { WHATSAPP: 2, CATALOGO_PUBLICO: 1, MANUAL: 1 }, "segunda: origens");
    igual(segunda.leadsRespondidos, 2, "segunda: k1 e k2 respondidos por uma pessoa (o robô não conta)");
    igual([segunda.esperas, segunda.respondidas, segunda.noPrazo, segunda.foraDoPrazo, segunda.semResposta, segunda.encerradasSemResposta], [4, 2, 1, 2, 1, 1], "segunda: esperas 4, respondidas 2, no prazo 1, fora 2 (c2 + c3 aberta), sem resposta 1, encerrada 1");
    igual(segunda.medianaMin, 30, "segunda: mediana 30 min (20 e 40, em minutos de atendimento)");
    igual([segunda.pedidos, segunda.pedidosPagos, segunda.vendido], [2, 1, 100.5], "segunda: 2 pedidos criados (o cancelado não), 1 pago, R$ 100,50");
  }
  if (terca) {
    igual([terca.leads, terca.esperas, terca.pedidosPagos, terca.vendido], [0, 0, 1, 200], "terça: nada novo, mas o pagamento de k2 conta hoje (R$ 200, sem o frete)");
  }

  console.log("\n2) O painel soma os fatos e os números vivos");
  const painel = await montarPainel(company.id, { de: "2026-10-12", ate: "2026-10-13" }, agora);
  igual(painel.atual.leads, 4, "período: 4 contatos");
  igual(painel.atual.pctNoPrazo, 33, "período: 1 de 3 decididas no prazo = 33%");
  igual([painel.atual.pedidosPagos, painel.atual.vendido, painel.atual.ticket], [2, 300.5, 150.25], "período: 2 pagos, R$ 300,50, ticket R$ 150,25");
  igual(painel.hoje.esperandoAgora, 1, "esperando agora: só c3 (c4 está encerrada)");
  igual(painel.funil, { leads: 4, respondidos: 2, comPedido: 2, pagaram: 2 }, "funil por fatos: 4 → 2 → 2 → 2 (o cancelado de k3 não é pedido)");
  igual(painel.realizado.FATURAMENTO, 300.5, "realizado do mês: faturamento R$ 300,50");
  igual(painel.realizado.NOVOS_CONTATOS, 4, "realizado do mês: 4 contatos");
  igual(painel.recompraPct, 0, "recompra: ninguém com 2 compras");

  console.log("\n3) Metas e a trava da carona");
  await db.biMeta.create({ data: { companyId: company.id, mes: painel.mes, tipo: "FATURAMENTO", valor: 1000 } });
  const painel2 = await montarPainel(company.id, { de: "2026-10-12", ate: "2026-10-13" }, agora);
  igual(painel2.metas.FATURAMENTO, 1000, "a meta aparece no painel");
  await atualizarFatosDoBiSeDevido(company.id);
  const c = await db.company.findUnique({ where: { id: company.id }, select: { biFatosRunAt: true } });
  conferir(!!c?.biFatosRunAt, "a carona carimbou a trava da loja");
  const antes = c!.biFatosRunAt!;
  await atualizarFatosDoBiSeDevido(company.id);
  const c2x = await db.company.findUnique({ where: { id: company.id }, select: { biFatosRunAt: true } });
  igual(c2x?.biFatosRunAt?.getTime(), antes.getTime(), "a segunda carona em 30 min não roda de novo (trava)");

  await db.company.delete({ where: { id: company.id } });
  console.log(process.exitCode ? "\n❌ Falhou" : "\n✅ Tudo conferido");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
