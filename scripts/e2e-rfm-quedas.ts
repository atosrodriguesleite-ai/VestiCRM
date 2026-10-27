/**
 * PROVA DE PONTA A PONTA — as quedas do RFM viram tarefa (RN-100).
 *
 * Roda contra um Postgres DE VERDADE (nunca o de produção): uma loja com o
 * BI e outra sem; a primeira rodada é só o ponto de partida; a queda de uma
 * cliente da Ana vira UMA tarefa para a Ana; a cliente sem dona não gera
 * tarefa; cair de novo atualiza a mesma tarefa; comprar de novo fecha a
 * tarefa sozinha; venda cancelada apaga a memória. Apaga as lojas no fim.
 *
 *   DATABASE_URL="postgresql://…" npx tsx scripts/e2e-rfm-quedas.ts
 */
import { db } from "@/lib/db";
import { ondeDaTrava, quedasDoRfmSeDevido, rodarQuedasDoRfm } from "@/lib/bi/rfm-quedas";
import { fimDeHojeSP } from "@/lib/contato-feito";
import { grupoDaChave, PREFIXO_DA_QUEDA } from "@/lib/bi/rfm-quedas-regra";
import { clientesDoRfm } from "@/lib/bi/rfm";
import { fecharTarefasResolvidas } from "@/lib/tarefas-resolvidas";

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
  await db.company.deleteMany({ where: { slug: { startsWith: "loja-quedas-" } } });
  const marca = Date.now();
  const agora = new Date();
  const ha = (dias: number) => new Date(agora.getTime() - dias * DIA);

  const loja = await db.company.create({ data: { name: `Loja Quedas ${marca}`, slug: `loja-quedas-${marca}`, biEnabled: true } });
  const semBi = await db.company.create({ data: { name: `Sem BI ${marca}`, slug: `loja-quedas-sembi-${marca}` } });
  const ana = await db.user.create({
    data: { companyId: loja.id, name: "Ana Souza", email: `ana-quedas-${marca}@x.com`, passwordHash: "x", role: "SELLER" },
  });

  let n = 0;
  let numero = 0;
  const cliente = async (companyId: string, nome: string, ownerId: string | null = null) =>
    db.customer.create({
      data: { companyId, name: nome, ownerId, phone: `5511${String(marca).slice(-7)}${String(++n).padStart(2, "0")}`, origin: "MANUAL" },
    });
  const pedido = async (companyId: string, customerId: string, valor: number, paidAt: Date | null, status: "PAGO" | "CANCELADO" = "PAGO") =>
    db.order.create({
      data: { companyId, customerId, number: ++numero, status, subtotal: valor, netTotal: valor, total: valor, createdAt: paidAt ?? agora, paidAt },
    });

  // a que parou (da Ana), a da loja que parou (sem dona), gente comum
  const paula = await cliente(loja.id, "Paula Parou", ana.id);
  for (const d of [200, 230, 260, 290, 320]) await pedido(loja.id, paula.id, 800, ha(d));
  const lina = await cliente(loja.id, "Lina Loja");
  for (const d of [210, 240, 270, 300]) await pedido(loja.id, lina.id, 700, ha(d));
  const nina = await cliente(loja.id, "Nina Novata", ana.id);
  await pedido(loja.id, nina.id, 150, ha(2));
  for (let i = 0; i < 16; i++) {
    const c = await cliente(loja.id, `Comum ${i}`);
    await pedido(loja.id, c.id, 100 + i * 20, ha(10 + i * 18));
  }
  const deFora = await cliente(semBi.id, "De Fora", null);
  await pedido(semBi.id, deFora.id, 999, ha(200));

  const tarefasDe = (customerId: string) =>
    db.task.findMany({ where: { customerId, autoRule: { startsWith: PREFIXO_DA_QUEDA } }, orderBy: { createdAt: "asc" } });
  const memoria = async (customerId: string) => (await db.rfmEstado.findUnique({ where: { customerId } }))?.grupo ?? null;

  console.log("\n1) A carona: só na loja com o BI, e a primeira rodada é o ponto de partida");
  await quedasDoRfmSeDevido(semBi.id);
  igual(await db.rfmEstado.count({ where: { companyId: semBi.id } }), 0, "loja sem o BI: nenhuma memória");
  igual((await db.company.findUnique({ where: { id: semBi.id } }))!.rfmQuedasRunAt, null, "e a trava nem é pega");
  await quedasDoRfmSeDevido(loja.id);
  const rfm = await clientesDoRfm(loja.id, agora);
  igual(await db.rfmEstado.count({ where: { companyId: loja.id } }), rfm.length, "loja com o BI: uma memória por compradora");
  igual(await db.task.count({ where: { companyId: loja.id } }), 0, "e NENHUMA tarefa no primeiro dia");
  const grupoPaula = rfm.find((c) => c.id === paula.id)!.grupo;
  igual(grupoPaula, "NAO_PERDER", "a Paula hoje é Não posso perder");

  console.log("\n2) Ontem ela era Campeã: a queda vira UMA tarefa para a dona");
  await db.rfmEstado.update({ where: { customerId: paula.id }, data: { grupo: "CAMPEAS" } });
  await db.rfmEstado.update({ where: { customerId: lina.id }, data: { grupo: "CAMPEAS" } });
  const r1 = await rodarQuedasDoRfm(loja.id, agora);
  igual([r1.novas, r1.atualizadas], [1, 0], "uma tarefa nova nesta rodada");
  const [t1] = await tarefasDe(paula.id);
  conferir(!!t1, "a tarefa da Paula existe");
  igual([t1.assigneeId, t1.priority, t1.status, t1.type], [ana.id, "ALTA", "PENDENTE", "REATIVAR"], "para a Ana, prioridade alta, pendente, reativar");
  igual(t1.title, "🚨 Paula Parou caiu para Não posso perder", "o título diz quem e para onde caiu");
  conferir(t1.description?.includes("era 🏆 Campeãs") ?? false, "a descrição diz de onde ela caiu");
  igual(grupoDaChave(t1.autoRule), "NAO_PERDER", "a chave leva o grupo (a Agenda monta a mensagem dele)");
  conferir(t1.dueAt.getTime() < fimDeHojeSP(agora).getTime() && t1.dueAt.getTime() > agora.getTime() - DIA, "vence HOJE (23:59 de SP), dentro do dia — cai em Hoje e fecha sozinha");
  igual(await memoria(paula.id), "NAO_PERDER", "a memória andou");
  igual((await tarefasDe(lina.id)).length, 0, "a Lina, sem dona, não ganha tarefa (é da loja)");
  igual(await memoria(lina.id), "CAMPEAS", "e a queda dela ESPERA: a memória não andou");
  await db.customer.update({ where: { id: lina.id }, data: { ownerId: ana.id } });
  const rLina = await rodarQuedasDoRfm(loja.id, agora);
  igual([rLina.novas, (await tarefasDe(lina.id)).length], [1, 1], "dada à Ana, a Lina ganha a tarefa na rodada seguinte");
  igual(await memoria(lina.id), "NAO_PERDER", "e aí a memória anda");

  console.log("\n3) A rodada seguinte não repete; cair de novo ATUALIZA a mesma tarefa");
  await rodarQuedasDoRfm(loja.id, agora);
  igual((await tarefasDe(paula.id)).length, 1, "nada mudou: nenhuma tarefa nova");
  // a Ana adiou a tarefa para a semana que vem ("ela pediu para ligar dia 3")
  const adiada = new Date(agora.getTime() + 7 * DIA);
  await db.task.update({ where: { id: t1.id }, data: { dueAt: adiada } });
  await db.rfmEstado.update({ where: { customerId: paula.id }, data: { grupo: "FIEIS" } });
  const r2 = await rodarQuedasDoRfm(loja.id, agora);
  igual([r2.novas, r2.atualizadas], [0, 1], "caiu de novo com a tarefa aberta: é atualização, não tarefa nova (nem aviso)");
  const depois = await tarefasDe(paula.id);
  igual(depois.length, 1, "continua UMA tarefa");
  conferir(depois[0].id === t1.id && (depois[0].description?.includes("era 💚 Fiéis") ?? false), "a mesma tarefa, com o texto da queda nova");
  igual(depois[0].dueAt.getTime(), adiada.getTime(), "e a data que a Ana escolheu fica");

  console.log("\n3b) Memória velha (BI desligado e religado) é ponto de partida, nunca tarefa");
  const nina2 = (await clientesDoRfm(loja.id, agora)).find((c) => c.id === nina.id)!;
  await db.rfmEstado.update({ where: { customerId: nina.id }, data: { grupo: "CAMPEAS" } });
  await db.company.update({ where: { id: loja.id }, data: { rfmQuedasOkEm: new Date(agora.getTime() - 10 * DIA) } });
  const r3 = await rodarQuedasDoRfm(loja.id, agora);
  igual([r3.partida, r3.novas], [true, 0], "dez dias sem rodada: recomeça do ponto de partida, sem tarefa");
  igual(await memoria(nina.id), nina2.grupo, "e a memória volta a ser a de hoje");

  console.log("\n3c) Uma rodada por dia de São Paulo");
  await db.company.update({ where: { id: loja.id }, data: { rfmQuedasRunAt: new Date(Date.now() - 60_000) } });
  const antes = (await db.company.findUnique({ where: { id: loja.id } }))!.rfmQuedasRunAt!.getTime();
  // (o freio em memória já foi gasto no passo 1; a trava do banco é a da rodada, `ondeDaTrava`)
  const pegou = await db.company.updateMany({ where: { id: loja.id, ...ondeDaTrava(new Date()) }, data: { rfmQuedasRunAt: new Date() } });
  igual(pegou.count, 0, "rodou hoje: a trava não deixa rodar de novo no mesmo dia");
  igual((await db.company.findUnique({ where: { id: loja.id } }))!.rfmQuedasRunAt!.getTime(), antes, "e não mexe nela");
  await db.company.update({ where: { id: loja.id }, data: { rfmQuedasRunAt: new Date(fimDeHojeSP(new Date()).getTime() - DIA - 60_000) } });
  const ontem = await db.company.count({ where: { id: loja.id, ...ondeDaTrava(new Date()) } });
  igual(ontem, 1, "rodou ontem às 23:59 de SP: hoje pode");
  await db.company.update({ where: { id: loja.id }, data: { biEnabled: false } });
  igual(await db.company.count({ where: { id: loja.id, ...ondeDaTrava(new Date()) } }), 0, "BI desligado: a trava não é pega");
  await db.company.update({ where: { id: loja.id }, data: { biEnabled: true } });

  console.log("\n4) Comprar de novo fecha a tarefa sozinha");
  await pedido(loja.id, paula.id, 900, new Date(Date.now() + 1000));
  await fecharTarefasResolvidas(loja.id);
  const fechada = (await tarefasDe(paula.id))[0];
  igual([fechada.status, fechada.autoDoneReason], ["CONCLUIDA", "CLIENTE_JA_COMPROU"], "concluída: a cliente comprou de novo");

  console.log("\n5) Venda cancelada tira a cliente do RFM e apaga a memória");
  await db.order.updateMany({ where: { customerId: nina.id }, data: { status: "CANCELADO" } });
  await rodarQuedasDoRfm(loja.id, agora);
  igual(await memoria(nina.id), null, "a Nina sem venda paga: memória apagada");
  igual(await db.rfmEstado.count({ where: { companyId: semBi.id } }), 0, "e a loja sem o BI segue sem nada");

  await db.company.deleteMany({ where: { id: { in: [loja.id, semBi.id] } } });
  console.log(process.exitCode ? "\n❌ FALHOU" : "\n✅ TUDO CERTO");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
