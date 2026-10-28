/**
 * PROVA DE PONTA A PONTA — o prazo prometido da transportadora e o "atrasado
 * de verdade" (RN-102), contra um Postgres DE VERDADE (nunca o de produção).
 *
 * Cinco envios: com prazo e vencido (atrasado); com prazo e no caminho (não);
 * sem prazo há 8 dias (parado, régua antiga); sem prazo há 3 dias (não);
 * entregue com prazo vencido (não). A cláusula do banco (`ondeAtrasado`) e a
 * função pura (`atrasoDoEnvio`) têm que concordar linha a linha. Depois, a
 * postagem de verdade (`aplicarRastreio`) carimba a previsão a partir do
 * prazo — uma vez só. Apaga a loja no fim.
 *
 *   DATABASE_URL="postgresql://…" npx tsx scripts/e2e-envios-prazo.ts
 */
import { db } from "@/lib/db";
import { atrasoDoEnvio, carimboDaPostagem, ondeAtrasado, previsaoDeEntrega } from "@/lib/envios/painel";
import { aplicarRastreio } from "@/lib/rastreio";

const ok = (t: string) => console.log(`  ✅ ${t}`);
const falha = (t: string) => {
  console.log(`  ❌ ${t}`);
  process.exitCode = 1;
};
const conferir = (cond: boolean, t: string) => (cond ? ok(t) : falha(t));
const igual = (a: unknown, b: unknown, t: string) =>
  conferir(JSON.stringify(a) === JSON.stringify(b), `${t} — esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);

const DIA = 86_400_000;

async function main() {
  await db.company.deleteMany({ where: { slug: { startsWith: "loja-prazo-" } } });
  const marca = Date.now();
  const agora = new Date();
  const ha = (dias: number) => new Date(agora.getTime() - dias * DIA);

  const loja = await db.company.create({
    data: { name: `Loja Prazo ${marca}`, slug: `loja-prazo-${marca}`, shippingEnabled: true },
  });
  const cliente = await db.customer.create({
    data: { companyId: loja.id, name: "Cliente Prazo", phone: `5511${String(marca).slice(-8)}`, origin: "MANUAL" },
  });
  let numero = 0;
  const envio = async (
    rotulo: string,
    dados: { meStatus: string; shippedAt: Date | null; prazoDias?: number | null; previstoAte?: Date | null; deliveredAt?: Date | null }
  ) => {
    const pedido = await db.order.create({
      data: {
        companyId: loja.id,
        customerId: cliente.id,
        number: ++numero,
        status: "PAGO",
        subtotal: 100,
        netTotal: 100,
        total: 100,
        paidAt: ha(10),
      },
    });
    const s = await db.shipping.create({
      data: {
        orderId: pedido.id,
        meOrderId: `me-${marca}-${numero}`,
        meStatus: dados.meStatus,
        shippedAt: dados.shippedAt,
        deliveredAt: dados.deliveredAt ?? null,
        prazoDias: dados.prazoDias ?? null,
        previstoAte: dados.previstoAte ?? null,
      },
    });
    return { rotulo, ...s };
  };

  console.log("\n1) Cinco envios, a cláusula do banco e a régua pura concordam");
  const envios = [
    await envio("prazo 3, postado há 5 dias úteis → ATRASADO", {
      meStatus: "POSTADO",
      shippedAt: ha(8),
      prazoDias: 3,
      previstoAte: previsaoDeEntrega(ha(8), 3),
    }),
    await envio("prazo 10, postado há 5 dias → no caminho", {
      meStatus: "POSTADO",
      shippedAt: ha(5),
      prazoDias: 10,
      previstoAte: previsaoDeEntrega(ha(5), 10),
    }),
    await envio("sem prazo, postado há 8 dias → PARADO (régua antiga)", { meStatus: "POSTADO", shippedAt: ha(8) }),
    await envio("sem prazo, postado há 3 dias → no caminho", { meStatus: "POSTADO", shippedAt: ha(3) }),
    await envio("entregue com prazo vencido → não é atraso", {
      meStatus: "ENTREGUE",
      shippedAt: ha(12),
      deliveredAt: ha(2),
      prazoDias: 2,
      previstoAte: previsaoDeEntrega(ha(12), 2),
    }),
    // o pedido que voltou para antes do envio: a rota limpa a postagem (e a
    // previsão); se só a previsão sobrasse, o cartão contaria sem a aba mostrar
    await envio("POSTADO sem data de postagem, previsão velha → não conta em lugar nenhum", {
      meStatus: "POSTADO",
      shippedAt: null,
      prazoDias: 2,
      previstoAte: previsaoDeEntrega(ha(12), 2),
    }),
  ];
  const esperado = [true, false, true, false, false, false];
  const atrasadosNoBanco = new Set(
    (await db.shipping.findMany({ where: { order: { companyId: loja.id }, ...ondeAtrasado(agora) }, select: { id: true } })).map((s) => s.id)
  );
  envios.forEach((e, i) => {
    const pura = atrasoDoEnvio({ meStatus: e.meStatus, postadoEm: e.shippedAt, previstoAte: e.previstoAte }, agora);
    igual(pura.atrasado, esperado[i], `pura: ${e.rotulo}`);
    igual(atrasadosNoBanco.has(e.id), esperado[i], `banco: ${e.rotulo}`);
  });
  igual(await db.shipping.count({ where: { order: { companyId: loja.id }, ...ondeAtrasado(agora) } }), 2, "o cartão conta 2 atrasados");
  const primeiro = atrasoDoEnvio({ meStatus: "POSTADO", postadoEm: envios[0].shippedAt, previstoAte: envios[0].previstoAte }, agora);
  conferir(primeiro.diasAlem >= 1 && !primeiro.pelaReguaAntiga, `o primeiro diz quantos dias além do prazo (${primeiro.diasAlem})`);
  conferir(
    atrasoDoEnvio({ meStatus: "POSTADO", postadoEm: envios[2].shippedAt, previstoAte: null }, agora).pelaReguaAntiga,
    "o sem prazo diz que foi a régua antiga (a tela escreve 'parado', não 'atrasado')"
  );

  console.log("\n2) A postagem de verdade carimba a previsão a partir do prazo — uma vez só");
  const etiqueta = await envio("etiqueta pronta, prazo 4", { meStatus: "ETIQUETA", shippedAt: null, prazoDias: 4 });
  const postouEm = ha(1);
  const depois = await aplicarRastreio({
    companyId: loja.id,
    envio: {
      id: etiqueta.id,
      orderId: etiqueta.orderId,
      meStatus: etiqueta.meStatus,
      trackingCode: null,
      shippedAt: null,
      deliveredAt: null,
      publicCode: null,
      prazoDias: 4,
      previstoAte: null,
    },
    tracking: { tracking: "BR123", status: "posted", postedAt: postouEm },
  });
  const gravado = await db.shipping.findUnique({ where: { id: etiqueta.id } });
  igual(gravado?.meStatus, "POSTADO", "virou POSTADO");
  igual(gravado?.shippedAt?.toISOString(), postouEm.toISOString(), "postado na data da transportadora");
  igual(gravado?.previstoAte?.toISOString(), previsaoDeEntrega(postouEm, 4).toISOString(), "previsão = postagem + 4 dias úteis");
  igual(depois.previstoAte?.toISOString() ?? null, gravado?.previstoAte?.toISOString() ?? null, "e o envio devolvido já traz a previsão");
  conferir(!atrasoDoEnvio({ meStatus: "POSTADO", postadoEm: gravado!.shippedAt, previstoAte: gravado!.previstoAte }, agora).atrasado, "no caminho, não atrasado");
  // segunda consulta "posted" (o ME oscila): a previsão NÃO é refeita
  await aplicarRastreio({
    companyId: loja.id,
    envio: { ...depois, previstoAte: gravado!.previstoAte },
    tracking: { tracking: "BR123", status: "posted", postedAt: ha(0.5) },
  });
  const relido = await db.shipping.findUnique({ where: { id: etiqueta.id } });
  igual(relido?.previstoAte?.toISOString(), gravado?.previstoAte?.toISOString(), "a segunda postagem não mexe na previsão");
  igual(relido?.shippedAt?.toISOString(), postouEm.toISOString(), "nem na data da postagem");

  console.log("\n2b) 'Enviado' marcado à mão ANTES da transportadora: a previsão nasce da data da mão");
  const aMao = await envio("etiqueta pronta, prazo 2, vendedora marcou Enviado", { meStatus: "ETIQUETA", shippedAt: null, prazoDias: 2 });
  const marcouEm = ha(2);
  // o que a porta do pedido faz ao marcar Enviado (a mesma função do rastreio)
  await db.shipping.update({
    where: { id: aMao.id },
    data: { shippedAt: marcouEm, ...carimboDaPostagem({ prazoDias: 2, previstoAte: null, shippedAt: null }, marcouEm) },
  });
  const marcado = await db.shipping.findUnique({ where: { id: aMao.id } });
  igual(marcado?.previstoAte?.toISOString(), previsaoDeEntrega(marcouEm, 2).toISOString(), "a mão carimba a previsão a partir da saída marcada");
  // horas depois a transportadora diz "posted": não mexe na saída nem na previsão
  await aplicarRastreio({
    companyId: loja.id,
    envio: { id: aMao.id, orderId: aMao.orderId, meStatus: "ETIQUETA", trackingCode: null, shippedAt: marcado!.shippedAt, deliveredAt: null, publicCode: null, prazoDias: 2, previstoAte: marcado!.previstoAte },
    tracking: { tracking: "BR555", status: "posted", postedAt: ha(1) },
  });
  const depoisDoPosted = await db.shipping.findUnique({ where: { id: aMao.id } });
  igual(
    [depoisDoPosted?.meStatus, depoisDoPosted?.shippedAt?.toISOString(), depoisDoPosted?.previstoAte?.toISOString()],
    ["POSTADO", marcouEm.toISOString(), marcado?.previstoAte?.toISOString()],
    "o 'posted' da transportadora vira POSTADO e deixa a saída e a previsão da mão"
  );
  // e o inverso: saída marcada à mão SEM a previsão (etiqueta de antes da coluna)
  // ganha a previsão no primeiro "posted", pela data da mão
  const legado = await envio("saída à mão, prazo gravado depois, sem previsão", { meStatus: "ETIQUETA", shippedAt: ha(3), prazoDias: 5 });
  await aplicarRastreio({
    companyId: loja.id,
    envio: { id: legado.id, orderId: legado.orderId, meStatus: "ETIQUETA", trackingCode: null, shippedAt: legado.shippedAt, deliveredAt: null, publicCode: null, prazoDias: 5, previstoAte: null },
    tracking: { tracking: "BR777", status: "posted", postedAt: ha(1) },
  });
  const legadoDepois = await db.shipping.findUnique({ where: { id: legado.id } });
  igual(legadoDepois?.previstoAte?.toISOString(), previsaoDeEntrega(legado.shippedAt!, 5).toISOString(), "com a saída já marcada, o rastreio carimba a previsão pela data da saída");

  console.log("\n3) Etiqueta SEM prazo postada: nasce sem previsão (régua antiga, dita)");
  const semPrazo = await envio("etiqueta pronta, sem prazo", { meStatus: "ETIQUETA", shippedAt: null });
  await aplicarRastreio({
    companyId: loja.id,
    envio: { id: semPrazo.id, orderId: semPrazo.orderId, meStatus: "ETIQUETA", trackingCode: null, shippedAt: null, deliveredAt: null, publicCode: null, prazoDias: null, previstoAte: null },
    tracking: { tracking: "BR999", status: "posted", postedAt: ha(1) },
  });
  const sp = await db.shipping.findUnique({ where: { id: semPrazo.id } });
  igual([sp?.meStatus, sp?.previstoAte], ["POSTADO", null], "postado sem previsão");

  await db.company.delete({ where: { id: loja.id } });
  console.log(process.exitCode ? "\n❌ FALHOU" : "\n✅ TUDO CERTO");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
