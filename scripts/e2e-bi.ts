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
  const bia = await db.user.create({
    data: { companyId: company.id, name: "Bia", email: `bia-${marca}@x.com`, passwordHash: "x", role: "SELLER" },
  });
  let n = 0;
  const cliente = async (nome: string, createdAt: Date, origin: "WHATSAPP" | "CATALOGO_PUBLICO" | "MANUAL", ownerId: string | null) =>
    db.customer.create({ data: { companyId: company.id, name: nome, phone: `5511${String(marca).slice(-8)}${++n}`, createdAt, origin, ownerId } });
  const k1 = await cliente("K1", seg("10:00"), "WHATSAPP", ana.id);
  const k2 = await cliente("K2", seg("17:40"), "CATALOGO_PUBLICO", bia.id);
  const k3 = await cliente("K3", seg("16:00"), "WHATSAPP", ana.id);
  const k4 = await cliente("K4", seg("20:00"), "MANUAL", null);
  const conv = async (customerId: string, status: "OPEN" | "CLOSED" = "OPEN", assigneeId: string | null = null) =>
    db.conversation.create({ data: { companyId: company.id, customerId, status, assigneeId } });
  const c1 = await conv(k1.id, "OPEN", ana.id);
  const c2 = await conv(k2.id, "OPEN", bia.id);
  const c3 = await conv(k3.id, "OPEN", ana.id);
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
  await msg(c2.id, "OUT", ter("08:30"), { authorId: bia.id });
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
  await db.order.create({ data: { companyId: company.id, customerId: k2.id, number: 2, status: "PAGO", total: 230, netTotal: 200, subtotal: 200, shippingFee: 30, createdAt: seg("18:00"), paidAt: ter("09:00"), sellerId: bia.id } });
  // loja online (RN-005): paga, sem dona — fica só no total da loja
  await db.order.create({ data: { companyId: company.id, customerId: k4.id, number: 4, status: "PAGO", total: 70, netTotal: 70, subtotal: 70, source: "NUVEMSHOP", createdAt: seg("21:00"), paidAt: seg("21:00") } });
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
    igual([segunda.pedidos, segunda.pedidosPagos, segunda.vendido], [3, 2, 170.5], "segunda: 3 pedidos criados (o cancelado não), 2 pagos (um da loja online), R$ 170,50");
  }
  if (terca) {
    igual([terca.leads, terca.esperas, terca.pedidosPagos, terca.vendido], [0, 0, 1, 200], "terça: nada novo, mas o pagamento de k2 conta hoje (R$ 200, sem o frete)");
  }

  console.log("\n2) O painel soma os fatos e os números vivos");
  const painel = await montarPainel(company.id, { de: "2026-10-12", ate: "2026-10-13" }, agora);
  igual(painel.atual.leads, 4, "período: 4 contatos");
  igual(painel.atual.pctNoPrazo, 33, "período: 1 de 3 decididas no prazo = 33%");
  igual([painel.atual.pedidosPagos, painel.atual.vendido, painel.atual.ticket], [3, 370.5, 123.5], "período: 3 pagos, R$ 370,50, ticket R$ 123,50");
  igual(painel.funil, { leads: 4, respondidos: 2, comPedido: 3, pagaram: 3 }, "funil por fatos: 4 → 2 → 3 → 3 (o cancelado de k3 não é pedido; k4 pagou na loja online)");
  igual(painel.realizado.FATURAMENTO, 370.5, "realizado do mês: faturamento R$ 370,50");
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

  console.log("\n4) Por vendedora (RN-083): a mesma conta, recortada por pessoa, e o que sobra é 'sem vendedora'");
  const anaSeg = await db.biDiaVendedora.findUnique({ where: { companyId_dia_userId: { companyId: company.id, dia: "2026-10-12", userId: ana.id } } });
  const biaSeg = await db.biDiaVendedora.findUnique({ where: { companyId_dia_userId: { companyId: company.id, dia: "2026-10-12", userId: bia.id } } });
  const biaTer = await db.biDiaVendedora.findUnique({ where: { companyId_dia_userId: { companyId: company.id, dia: "2026-10-13", userId: bia.id } } });
  conferir(!!anaSeg && !!biaSeg && !!biaTer, "linhas de segunda (Ana, Bia) e terça (Bia) existem");
  if (anaSeg) {
    igual([anaSeg.leads, anaSeg.leadsRespondidos, anaSeg.leadsPagaram], [2, 1, 1], "Ana segunda: 2 leads na carteira (k1, k3), 1 respondido, 1 pagou");
    igual([anaSeg.respondidas, anaSeg.noPrazo, anaSeg.foraDoPrazo, anaSeg.semResposta], [1, 1, 0, 1], "Ana segunda: respondeu c1 no prazo; c3 (dela) sem resposta — e não vira 'fora do prazo' dela");
    igual([anaSeg.pedidos, anaSeg.pedidosPagos, anaSeg.vendido], [1, 1, 100.5], "Ana segunda: 1 pedido, 1 pago, R$ 100,50");
  }
  if (biaSeg) {
    igual([biaSeg.leads, biaSeg.respondidas, biaSeg.foraDoPrazo, biaSeg.medianaMin], [1, 1, 1, 40], "Bia segunda: lead k2; respondeu c2 (40 min, fora do prazo) — conta no dia da CHEGADA");
    igual([biaSeg.pedidos, biaSeg.pedidosPagos], [1, 0], "Bia segunda: pedido criado, pago só terça");
  }
  if (biaTer) igual([biaTer.pedidosPagos, biaTer.vendido, biaTer.respondidas], [1, 200, 0], "Bia terça: o pagamento de k2 (R$ 200); a resposta não conta de novo");
  const { montarVendedoras } = await import("@/lib/bi/painel");
  const v = await montarVendedoras(company.id, { de: "2026-10-12", ate: "2026-10-13" });
  igual(v.pessoas.map((p) => p.nome), ["Bia", "Ana"], "ordem pelo vendido: Bia (200) antes de Ana (100,50)");
  igual(v.semVendedora, { respondidas: 0, leads: 1, pedidosPagos: 1, vendido: 70, semResposta: 0 }, "sem vendedora: o lead k4 da loja e a venda da loja online (R$ 70)");
  igual(v.diasSemVendedoras, 0, "todos os dias do período já têm a conta por vendedora");
  // a linha de VERSÃO VELHA (gravada antes desta aba) conta como dia que falta: a rodada seguinte a refaz com as pessoas
  await db.biDia.update({ where: { companyId_dia: { companyId: company.id, dia: "2026-09-20" } }, data: { versao: 0 } });
  await db.biDiaVendedora.deleteMany({ where: { companyId: company.id, dia: "2026-09-20" } });
  const vVelha = await montarVendedoras(company.id, { de: "2026-09-20", ate: "2026-09-20" });
  igual(vVelha.diasSemVendedoras, 1, "a aba DIZ que o dia de versão velha ainda não tem a conta por vendedora");
  const r2 = await atualizarFatosDoBi(company.id, agora);
  const refeita = await db.biDia.findUnique({ where: { companyId_dia: { companyId: company.id, dia: "2026-09-20" } } });
  conferir(r2.dias >= 9 && refeita?.versao === 1, `a rodada seguinte refez o dia de versão velha (${r2.dias} dias, versão ${refeita?.versao})`);
  // o pedido da Ana é cancelado hoje: a rodada seguinte TIRA a venda de segunda da Ana (linha derivada, não upsert)
  await db.order.updateMany({ where: { companyId: company.id, number: 1 }, data: { status: "CANCELADO" } });
  await atualizarFatosDoBi(company.id, agora);
  const anaDepois = await db.biDiaVendedora.findUnique({ where: { companyId_dia_userId: { companyId: company.id, dia: "2026-10-12", userId: ana.id } } });
  igual([anaDepois?.pedidos, anaDepois?.pedidosPagos, anaDepois?.vendido], [0, 0, 0], "cancelado o pedido, a venda sai da linha da Ana na rodada seguinte");

  console.log("\n5) A carteira (RN-084): a fonte única da Recompra, as melhores do período");
  const { montarCarteira } = await import("@/lib/bi/carteira");
  const gerente = await db.user.create({
    data: { companyId: company.id, name: "Gerente", email: `ger-${marca}@x.com`, passwordHash: "x", role: "MANAGER" },
  });
  const sessao = { id: gerente.id, companyId: company.id, name: "Gerente", email: gerente.email ?? "", role: "MANAGER" as const, color: "#000", chatVisaoTotal: false, pedidosVisaoTotal: false, prefersDark: false, avatarUrl: null };
  const cart = await montarCarteira(sessao, { de: "2026-10-12", ate: "2026-10-13" });
  // compradoras: k2 (R$ 200, pago terça) e k4 (loja online, R$ 70) — o pedido 1 de k1 foi cancelado no bloco 4
  igual([cart.resumo.compradoras, cart.resumo.recorrentes, cart.resumo.taxaRecompraPct], [2, 0, 0], "carteira: 2 compradoras, nenhuma recorrente");
  igual(cart.matriz.ATIVA.UMA.clientes + cart.matriz.ESFRIANDO.UMA.clientes + cart.matriz.RISCO.UMA.clientes + cart.matriz.SUMIDA.UMA.clientes, 2, "as duas estão na coluna de 1 compra");
  igual(cart.melhoresDoPeriodo.map((m) => [m.nome, m.total, m.pedidos]), [["K2", 200, 1], ["K4", 70, 1]], "melhores do período: K2 (R$ 200) e K4 (R$ 70), pela data do pagamento");
  igual(cart.vendidoNoPeriodo, 270, "vendido no período R$ 270 (sem o cancelado, sem o frete)");
  conferir(cart.melhoresDoPeriodo.every((m) => m.vip != null), "as duas são VIP (Top 20 de uma carteira de 2)");

  console.log("\n6) Anúncios (RN-085): gasto do mês × coorte × caixa");
  const { montarAnuncios } = await import("@/lib/bi/anuncios");
  const camp = await db.marketingCampaign.create({ data: { companyId: company.id, name: "Story outubro", channel: "INSTAGRAM", utmKey: `story-${marca}` } });
  // k2 (cadastrada segunda, pagou R$ 200 terça) e k3 (cadastrada segunda, só cancelado) chegaram pelo anúncio;
  // k1 chegou pelo anúncio em SETEMBRO (fora da coorte) e não tem venda viva
  await db.customer.update({ where: { id: k2.id }, data: { campaignId: camp.id } });
  await db.customer.update({ where: { id: k3.id }, data: { campaignId: camp.id } });
  await db.customer.update({ where: { id: k1.id }, data: { campaignId: camp.id, createdAt: new Date("2026-09-10T12:00:00-03:00") } });
  await db.biGastoDeAnuncio.create({ data: { companyId: company.id, campanhaId: camp.id, mes: "2026-10", valor: 100 } });
  await db.biGastoDeAnuncio.create({ data: { companyId: company.id, campanhaId: camp.id, mes: "2026-09", valor: 999 } });
  const an = await montarAnuncios(company.id, { de: "2026-10-12", ate: "2026-10-13" });
  igual(an.meses, ["2026-10"], "o período toca só outubro");
  igual(an.linhas.length, 1, "uma campanha com número");
  const l = an.linhas[0];
  igual([l.gasto, l.leads, l.pagaram, l.vendido], [100, 2, 1, 200], "gasto de outubro R$ 100 (setembro fica fora); coorte k2 e k3, k2 pagou; vendido no período R$ 200");
  igual([l.cac, l.custoPorVenda, l.retorno, l.conversaoPct], [50, 100, 2, 50], "CAC R$ 50, custo por venda R$ 100, retorno 2×, conversão 50%");
  igual(an.semAnuncio, 1, "k4 chegou no período sem anúncio (k1 é de setembro)");
  const anSet = await montarAnuncios(company.id, { de: "2026-09-01", ate: "2026-09-30" });
  igual([anSet.linhas[0]?.gasto, anSet.linhas[0]?.leads, anSet.linhas[0]?.vendido, anSet.linhas[0]?.retorno], [999, 1, 0, 0], "setembro: gasto 999, coorte k1, nada vendido, retorno 0");

  console.log("\n7) Clicar e cavar (RN-086): as listas por trás dos números");
  const { montarLista } = await import("@/lib/bi/listas");
  const esperando = await montarLista(sessao, { tipo: "esperando-agora" }, agora);
  igual(esperando.linhas.map((l) => [l.titulo, l.href]), [["K3", `/whatsapp?conv=${c3.id}`]], "esperando agora: só K3 (c4 está encerrada), levando à conversa");
  const semResp = await montarLista(sessao, { tipo: "sem-resposta", de: "2026-10-12", ate: "2026-10-13" }, agora);
  igual(semResp.linhas.map((l) => l.titulo), ["K3"], "sem resposta no período: K3 (a espera aberta e não encerrada)");
  const semRespAna = await montarLista(sessao, { tipo: "sem-resposta", de: "2026-10-12", ate: "2026-10-13", vendedora: ana.id }, agora);
  igual(semRespAna.linhas.length, 1, "sem resposta da Ana: c3 é dela");
  const semRespBia = await montarLista(sessao, { tipo: "sem-resposta", de: "2026-10-12", ate: "2026-10-13", vendedora: bia.id }, agora);
  igual(semRespBia.linhas.length, 0, "sem resposta da Bia: nenhuma");
  const contatos = await montarLista(sessao, { tipo: "contatos", de: "2026-10-12", ate: "2026-10-13" }, agora);
  igual(contatos.total, 3, "contatos novos do período: 3 (k1 virou de setembro no bloco 6)");
  const contatosAna = await montarLista(sessao, { tipo: "contatos", de: "2026-10-12", ate: "2026-10-13", vendedora: ana.id }, agora);
  igual(contatosAna.linhas.map((l) => l.titulo), ["K3"], "carteira da Ana no período: K3 (k1 saiu do período)");
  const vendas = await montarLista(sessao, { tipo: "vendas", de: "2026-10-12", ate: "2026-10-13" }, agora);
  igual(vendas.linhas.map((l) => l.titulo.split(" · ")[1]), ["K2", "K4"], "vendas do período: K2 e K4 (o pedido 1 foi cancelado), pela data do pagamento");
  const vendasBia = await montarLista(sessao, { tipo: "vendas", de: "2026-10-12", ate: "2026-10-13", vendedora: bia.id }, agora);
  igual([vendasBia.linhas.length, vendasBia.linhas[0]?.destaque?.replace(/\u00a0/g, " ")], [1, "R$ 200"], "vendas da Bia: o pedido de R$ 200");
  const vendasCamp = await montarLista(sessao, { tipo: "vendas", de: "2026-10-12", ate: "2026-10-13", campanha: camp.id }, agora);
  igual(vendasCamp.linhas.length, 1, "vendas das clientes do anúncio: só K2");
  const celula = await montarLista(sessao, { tipo: "carteira", freq: "UMA" }, agora);
  igual(celula.total, 2, "carteira, 1 compra: K2 e K4");

  console.log("\n8) A linha de 12 meses (RN-087)");
  const { montarTendencia } = await import("@/lib/bi/tendencia");
  // A VIRADA DO MÊS NO FUSO DE SP: cadastro e pagamento às 22:30 de 30/09 em SP
  // (01:30 UTC de 1º/10) são de SETEMBRO — a conversão errada os jogaria em outubro
  const virada = new Date("2026-09-30T22:30:00-03:00");
  const kVirada = await cliente("K-virada", virada, "WHATSAPP", null);
  await db.order.create({ data: { companyId: company.id, customerId: kVirada.id, number: 9, status: "PAGO", total: 40, netTotal: 40, subtotal: 40, createdAt: virada, paidAt: virada, sellerId: ana.id } });
  const tend = await montarTendencia(company.id, agora);
  igual(tend.length, 12, "12 meses");
  const out = tend.find((m) => m.mes === "2026-10")!;
  const set = tend.find((m) => m.mes === "2026-09")!;
  igual([out.leads, out.pedidosPagos, out.vendido, out.ticket], [3, 2, 270, 135], "outubro: 3 contatos (k1 foi para setembro), 2 pagos, R$ 270, ticket R$ 135");
  igual([set.leads, set.pedidosPagos, set.vendido, set.pctNoPrazo], [2, 1, 40, null], "setembro: k1 e a cliente das 22:30 de 30/09 (SP), a venda dela de R$ 40, sem fato de atendimento (nulo)");
  conferir(out.diasComFato >= 2 && out.pctNoPrazo != null, `outubro tem fato de atendimento (${out.diasComFato} dias, no prazo ${out.pctNoPrazo}%)`);

  console.log("\n9) A faixa 'hoje' ao vivo (RN-088)");
  const { numerosDeHoje } = await import("@/lib/bi/hoje");
  const hoje = await numerosDeHoje(company.id, agora);
  igual([hoje.dia, hoje.leads, hoje.pedidosPagos, hoje.vendido, hoje.esperandoAgora], ["2026-10-13", 0, 1, 200, 1], "terça: nenhum contato novo, 1 pago (K2, R$ 200), 1 esperando (c3)");

  await db.company.delete({ where: { id: company.id } });
  console.log(process.exitCode ? "\n❌ Falhou" : "\n✅ Tudo conferido");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
