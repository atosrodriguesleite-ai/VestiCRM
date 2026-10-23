/**
 * PROVA DE PONTA A PONTA — o RFM do BI (RN-092).
 *
 * Roda contra um Postgres DE VERDADE (nunca o de produção): cria uma loja
 * com clientes de perfis conhecidos (a campeã, a novata, a que parou, a
 * sumida de mais de um ano), pedidos pagos, cancelados, orçamentos e pago
 * sem data, e uma OUTRA loja; monta o RFM e a lista de cada grupo, e confere
 * contra a conta feita direto no banco e contra a carteira da Recompra (a
 * MESMA população). Apaga as lojas no fim.
 *
 *   DATABASE_URL="postgresql://…" npx tsx scripts/e2e-rfm.ts
 */
import { db } from "@/lib/db";
import { montarRfm, clientesDoRfm } from "@/lib/bi/rfm";
import { IDS_DOS_GRUPOS } from "@/lib/bi/rfm-regra";
import { montarLista } from "@/lib/bi/listas";
import { dadosDaAbaRecompra } from "@/lib/recompra";

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
  await db.company.deleteMany({ where: { slug: { startsWith: "loja-rfm-" } } });
  const marca = Date.now();
  const agora = new Date();
  const ha = (dias: number) => new Date(agora.getTime() - dias * DIA);

  const loja = await db.company.create({ data: { name: `Loja RFM ${marca}`, slug: `loja-rfm-${marca}`, biEnabled: true } });
  const outra = await db.company.create({ data: { name: `Outra RFM ${marca}`, slug: `loja-rfm-outra-${marca}` } });
  const gerente = await db.user.create({
    data: { companyId: loja.id, name: "Gerente", email: `ger-rfm-${marca}@x.com`, passwordHash: "x", role: "MANAGER" },
  });
  const sessao = {
    id: gerente.id,
    companyId: loja.id,
    name: "Gerente",
    email: gerente.email ?? "",
    role: "MANAGER" as const,
    color: "#000",
    chatVisaoTotal: false,
    pedidosVisaoTotal: false,
    prefersDark: false,
    avatarUrl: null,
  };

  let n = 0;
  let numero = 0;
  const cliente = async (companyId: string, nome: string) =>
    db.customer.create({ data: { companyId, name: nome, phone: `5511${String(marca).slice(-7)}${String(++n).padStart(2, "0")}`, origin: "MANUAL" } });
  const pedido = async (
    companyId: string,
    customerId: string,
    valor: number,
    paidAt: Date | null,
    status: "PAGO" | "ENTREGUE" | "CANCELADO" | "ORCAMENTO" = "PAGO",
    frete = 0
  ) =>
    db.order.create({
      data: {
        companyId,
        customerId,
        number: ++numero,
        status,
        subtotal: valor,
        netTotal: valor,
        shippingFee: frete,
        total: valor + frete,
        createdAt: paidAt ?? agora,
        paidAt,
      },
    });

  const ana = await db.user.create({
    data: { companyId: loja.id, name: "Ana Souza", email: `ana-rfm-${marca}@x.com`, passwordHash: "x", role: "SELLER" },
  });

  console.log("\n1) A loja: perfis conhecidos");
  // a campeã: compra todo mês, a última há 3 dias, muito dinheiro (e frete que NÃO conta)
  const campea = await cliente(loja.id, "Camila Campeã");
  await db.customer.update({ where: { id: campea.id }, data: { ownerId: ana.id } });
  for (const d of [3, 33, 63, 93, 123, 153]) await pedido(loja.id, campea.id, 900, ha(d), "ENTREGUE", 35);
  // a novata: primeira compra da vida, há 2 dias
  const novata = await cliente(loja.id, "Nina Novata");
  await pedido(loja.id, novata.id, 150, ha(2));
  // a que parou: comprava muito, a última há 200 dias
  const parou = await cliente(loja.id, "Paula Parou");
  for (const d of [200, 230, 260, 290, 320]) await pedido(loja.id, parou.id, 800, ha(d));
  // a sumida: só compras de mais de um ano atrás
  const sumida = await cliente(loja.id, "Sara Sumida");
  await pedido(loja.id, sumida.id, 5000, ha(400));
  await pedido(loja.id, sumida.id, 3000, ha(500));
  // gente comum, para o percentil ter corpo
  const comuns: { id: string }[] = [];
  for (let i = 0; i < 16; i++) {
    const c = await cliente(loja.id, `Comum ${i}`);
    comuns.push(c);
    await pedido(loja.id, c.id, 100 + i * 20, ha(10 + i * 18));
    if (i % 3 === 0) await pedido(loja.id, c.id, 120, ha(40 + i * 18));
  }
  // o que NÃO é venda: cancelado, orçamento e pago sem data de pagamento
  const so = await cliente(loja.id, "Só Orçamento");
  await pedido(loja.id, so.id, 999, ha(5), "ORCAMENTO");
  await pedido(loja.id, so.id, 999, ha(5), "CANCELADO");
  await pedido(loja.id, campea.id, 7777, ha(1), "CANCELADO");
  const semData = await cliente(loja.id, "Pago Sem Data");
  await pedido(loja.id, semData.id, 444, null, "PAGO");
  // outra loja: nunca entra
  const deFora = await cliente(outra.id, "De Fora");
  await pedido(outra.id, deFora.id, 99999, ha(1));

  console.log("\n2) A população é a MESMA da carteira (pedido pago com data)");
  const rfm = await montarRfm(loja.id, agora);
  const carteira = await dadosDaAbaRecompra(sessao, { leve: true });
  igual(rfm.resumo.clientes, carteira.clientes.length, "RFM e carteira contam as mesmas compradoras");
  igual(rfm.resumo.clientes, 20, "20 compradoras: 4 perfis + 16 comuns (orçamento, cancelado, sem data e outra loja ficam fora)");
  igual(rfm.resumo.ativas, 19, "19 com nota (a Sumida não compra há mais de 12 meses)");

  const clientes = await clientesDoRfm(loja.id, agora);
  const de = (id: string) => clientes.find((c) => c.id === id)!;
  igual(de(campea.id).grupo, "CAMPEAS", "Camila: comprou há 3 dias, todo mês, muito dinheiro → Campeã");
  igual([de(campea.id).compras, de(campea.id).ltv], [6, 5400], "o cancelado de R$ 7.777 não conta, e o frete também não (6 × R$ 900)");
  igual(de(novata.id).grupo, "NOVATAS", "Nina: primeira compra da vida, há 2 dias → Novata");
  igual(de(parou.id).grupo, "NAO_PERDER", "Paula: valia muito e parou há 200 dias → Não posso perder");
  igual([de(sumida.id).grupo, de(sumida.id).r, de(sumida.id).valor12, de(sumida.id).ltv], ["PERDIDAS", null, 0, 8000], "Sara: nada nos 12 meses → Perdida, sem nota, LTV R$ 8.000");
  conferir(!clientes.some((c) => c.id === deFora.id || c.id === so.id || c.id === semData.id), "nem a cliente da outra loja, nem a do orçamento, nem a do pago sem data");

  console.log("\n3) Os números batem com o banco");
  const desde = new Date(agora.getTime() - 365 * DIA);
  const [direto] = await db.$queryRaw<{ v12: number; vida: number }[]>`
    SELECT COALESCE(SUM(CASE WHEN "paidAt" >= ${desde} THEN "netTotal" END), 0)::float AS v12,
           COALESCE(SUM("netTotal"), 0)::float AS vida
    FROM "Order"
    WHERE "companyId" = ${loja.id} AND "paidAt" IS NOT NULL
      AND "status" IN ('PAGO','EM_PRODUCAO','SEPARACAO','ENVIADO','ENTREGUE')
  `;
  igual(rfm.resumo.valor12, direto.v12, "vendido nos 12 meses = a soma direta no banco");
  const somaVida = IDS_DOS_GRUPOS.reduce((s, g) => s + rfm.resumo.porGrupo[g].totalVida, 0);
  igual(Math.round(somaVida * 100), Math.round(direto.vida * 100), "o LTV somado dos grupos = tudo o que a loja vendeu");
  const somaCarteira = carteira.clientes.reduce((s, c) => s + c.total, 0);
  igual(Math.round(somaVida * 100), Math.round(somaCarteira * 100), "e = o total comprado da carteira da Recompra");
  igual(IDS_DOS_GRUPOS.reduce((s, g) => s + rfm.resumo.porGrupo[g].pctClientes, 0), 100, "as porcentagens de clientes fecham 100");
  igual(IDS_DOS_GRUPOS.reduce((s, g) => s + (rfm.resumo.porGrupo[g].pctReceita ?? 0), 0), 100, "as porcentagens de receita fecham 100");
  igual(rfm.matriz.flat().reduce((s, x) => s + x, 0), rfm.resumo.ativas, "a matriz tem exatamente as clientes com nota");

  console.log("\n4) A lista de cada grupo, com o Chamar");
  let somaListas = 0;
  for (const grupo of IDS_DOS_GRUPOS) {
    const lista = await montarLista(sessao, { tipo: "rfm", grupo }, agora);
    igual(lista.total, rfm.resumo.porGrupo[grupo].clientes, `lista ${grupo}: o mesmo número do card`);
    somaListas += lista.total;
    conferir(
      lista.linhas.every((l) => l.chamar?.customerId === l.id && l.chamar.mensagem.includes(loja.slug)),
      `lista ${grupo}: cada linha chama a própria cliente, com o link do catálogo da loja`
    );
  }
  igual(somaListas, rfm.resumo.clientes, "as oito listas somam todas as clientes");
  const campeas = await montarLista(sessao, { tipo: "rfm", grupo: "CAMPEAS" }, agora);
  conferir(campeas.linhas[0]?.titulo === "Camila Campeã", "a Campeã que mais vale vem primeiro");
  conferir(campeas.linhas[0]?.chamar?.mensagem.startsWith("Oi Camila!") ?? false, "a mensagem saúda pelo primeiro nome");
  const c = de(campea.id);
  const celula = await montarLista(sessao, { tipo: "rfm", r: c.r!, fv: c.fv! }, agora);
  conferir(celula.linhas.some((l) => l.id === campea.id), "a célula da matriz da Camila a mostra");
  igual(celula.total, rfm.matriz[c.r! - 1][c.fv! - 1], "a lista da célula tem o mesmo número do quadrado");

  console.log("\n4b) O link da mensagem: a cliente e a dona da carteira");
  const camila = campeas.linhas.find((l) => l.id === campea.id)!;
  const codigo = (await db.customer.findUnique({ where: { id: campea.id }, select: { linkCode: true } }))!.linkCode!;
  conferir(camila.chamar!.mensagem.includes(codigo), "o link leva o código pessoal da Camila (RN-021)");
  conferir(/ref=ana|\/ana\//.test(camila.chamar!.mensagem), "e a ref da Ana, dona da carteira: a venda é dela, não de quem clicou (RN-005)");
  conferir(camila.subtitulo?.includes("carteira de Ana Souza") ?? false, "a linha diz de quem é a carteira");
  const semDona = (await montarLista(sessao, { tipo: "rfm", grupo: de(novata.id).grupo }, agora)).linhas.find((l) => l.id === novata.id)!;
  conferir(!/ref=|\/gerente\//.test(semDona.chamar!.mensagem), "cliente sem dona: o link não leva a ref de quem clicou (a carteira não muda para a gerência)");
  await db.customer.update({ where: { id: parou.id }, data: { blockedAt: new Date() } });
  await db.customer.update({ where: { id: comuns[0].id }, data: { phone: "" } });
  const bloqueada = (await montarLista(sessao, { tipo: "rfm", grupo: de(parou.id).grupo }, agora)).linhas.find((l) => l.id === parou.id)!;
  conferir(!bloqueada.chamar && (bloqueada.subtitulo?.includes("bloqueada") ?? false), "cliente bloqueada: sem botão, e a linha diz por quê");
  const semFone = (await montarLista(sessao, { tipo: "rfm", grupo: de(comuns[0].id).grupo }, agora)).linhas.find((l) => l.id === comuns[0].id)!;
  conferir(!semFone.chamar && (semFone.subtitulo?.includes("sem telefone") ?? false), "cliente sem telefone: sem botão, e a linha diz por quê");

  console.log("\n5) Cancelar a venda muda o grupo na hora (é calculado, não gravado)");
  await db.order.updateMany({ where: { customerId: novata.id }, data: { status: "CANCELADO" } });
  const depois = await clientesDoRfm(loja.id, agora);
  conferir(!depois.some((x) => x.id === novata.id), "a Nina sem venda paga sai do RFM");

  await db.company.deleteMany({ where: { id: { in: [loja.id, outra.id] } } });
  console.log(process.exitCode ? "\n❌ FALHOU" : "\n✅ TUDO CERTO");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
