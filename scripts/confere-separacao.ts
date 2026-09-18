/**
 * PROVA CONTRA O POSTGRES (RN-060): a separação por leitor ponta a ponta —
 * fila, abrir, bipe aceito/recusado/a mais, falta, concluir (status, carimbo,
 * histórico, aviso), visibilidade (RN-007) e uma separação ativa por pedido.
 *
 *   DATABASE_URL=... AUTH_SECRET=... NODE_PATH=./node_modules npx tsx --tsconfig tsconfig.json scripts/confere-separacao.ts
 */
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import { estadoDaSeparacao as abrirSeparacao, concluirSeparacao as concluirDeVerdade, desfazerCarimboDeSeparacao, filaDeSeparacao, registrarBipe, registrarFalta } from "@/lib/etiquetas/separacao";
import { pacoteMudou } from "@/lib/etiquetas/separacao-regra";
import { sincronizarPedidoNoFinanceiro } from "@/lib/financeiro/porta-vendas";

// fora de um request do Next não existe `after()`: a porta do Financeiro é chamada direto
const concluirSeparacao = (u: SessionUser, o: string, c: { variantId: string; falta: number }[]) =>
  concluirDeVerdade(u, o, c, (id) => void sincronizarPedidoNoFinanceiro(id).catch(() => {}));

const check = (n: string, ok: boolean) => console.log(ok ? "✅" : "❌", n);
const tag = `sep-${Date.now()}`;

function sessao(u: { id: string; companyId: string; name: string; role: "ADMIN" | "SELLER" }): SessionUser {
  return { id: u.id, companyId: u.companyId, name: u.name, email: `${u.id}@x.x`, role: u.role, color: "#000", chatVisaoTotal: false, pedidosVisaoTotal: false, prefersDark: false, avatarUrl: null };
}

async function main() {
  const loja = await db.company.create({ data: { name: `L ${tag}`, slug: tag, etiquetasEnabled: true } });
  const cli = await db.customer.create({ data: { companyId: loja.id, name: "Maria", phone: "5511999990000" } });
  const vend = await db.user.create({ data: { companyId: loja.id, name: "Lara", email: `v-${tag}@x.x`, passwordHash: "x", role: "SELLER" } });
  const outra = await db.user.create({ data: { companyId: loja.id, name: "Juliana", email: `j-${tag}@x.x`, passwordHash: "x", role: "SELLER" } });
  const admin = await db.user.create({ data: { companyId: loja.id, name: "Dona", email: `a-${tag}@x.x`, passwordHash: "x", role: "ADMIN" } });
  const p = await db.product.create({
    data: {
      companyId: loja.id, name: "Vestido", sku: "V", category: "Vestidos", wholesalePrice: 50,
      variants: { create: [{ color: "Azul", size: "M", stock: 4 }, { color: "Azul", size: "G", stock: 10 }, { color: "Rosa", size: "M", stock: 6 }] },
    },
    include: { variants: true },
  });
  const [vM, vG, vR] = p.variants;
  const mk = (n: number, status: string, extra: Record<string, unknown> = {}) =>
    db.order.create({ data: { companyId: loja.id, customerId: cli.id, number: n, status: status as never, sellerId: vend.id, ...extra } });
  const item = (orderId: string, variantId: string, quantity: number) =>
    db.orderItem.create({ data: { orderId, productId: p.id, variantId, name: "Vestido", quantity, unitPrice: 50, total: 50 * quantity } });

  const pago = await mk(1, "PAGO", { paidAt: new Date(Date.now() - 3600_000) });
  await item(pago.id, vM.id, 2);
  await item(pago.id, vM.id, 1); // a MESMA variação em duas linhas: vira 3 numa só
  await item(pago.id, vG.id, 1);
  const orc = await mk(2, "ORCAMENTO");
  await item(orc.id, vM.id, 1);
  const enviado = await mk(3, "ENVIADO", { paidAt: new Date() });
  await item(enviado.id, vG.id, 1);
  const daOutra = await mk(4, "PAGO", { paidAt: new Date(), sellerId: outra.id });
  await item(daOutra.id, vR.id, 1);

  const sLara = sessao({ ...vend, role: "SELLER" });
  const sAdmin = sessao({ ...admin, role: "ADMIN" });

  // 1) a fila
  const fLara = await filaDeSeparacao(sLara);
  check("fila: só pedido PAGO ainda na loja (orçamento e enviado ficam fora)", fLara.aSeparar.length === 1 && fLara.aSeparar[0].id === pago.id);
  check("fila: vendedora não vê o pedido da colega (RN-007)", !fLara.aSeparar.some((l) => l.id === daOutra.id));
  const fAdmin = await filaDeSeparacao(sAdmin);
  check("fila: gerência vê os dois pedidos pagos, o mais antigo primeiro", fAdmin.aSeparar.length === 2 && fAdmin.aSeparar[0].id === pago.id);
  check("fila: soma as peças do pedido (2 + 1 + 1 = 4)", fAdmin.aSeparar[0].pecas === 4);

  // 2) abrir
  const recusaOrc = await abrirSeparacao(sLara, orc.id);
  check("abrir: orçamento é recusado com frase", "erro" in recusaOrc && /pago/.test(recusaOrc.erro));
  const recusaColega = await abrirSeparacao(sLara, daOutra.id);
  check("abrir: pedido da colega não abre (RN-007)", "erro" in recusaColega);
  const e1 = await abrirSeparacao(sLara, pago.id);
  if ("erro" in e1) throw new Error(e1.erro);
  check("abrir: a mesma variação em duas linhas vira UMA (pedida 3) e a outra linha vem junto", e1.itens.length === 2 && e1.itens.find((i) => i.variantId === vM.id)?.pedida === 3 && e1.itens.find((i) => i.variantId === vG.id)?.pedida === 1);
  check("abrir: cada linha traz o código de barras da variação", e1.itens.every((i) => i.codigo.length === 13));
  check("abrir: só olhar NÃO cria separação ativa (ninguém vira 'em separação por' à toa)", e1.quem === null && (await db.separacao.count({ where: { orderId: pago.id } })) === 0);
  check("fila: sem bipe, ninguém aparece separando", (await filaDeSeparacao(sAdmin)).aSeparar[0].emAndamento === null);

  // 3) bipes
  const b1 = await registrarBipe(sLara, pago.id, vM.barcode!);
  check("bipe: peça do pedido é aceita (1/3)", "aceito" in b1 && b1.aceito && b1.item.bipada === 1);
  const ativas = await db.separacao.count({ where: { orderId: pago.id, concluidaEm: null } });
  const e2 = await abrirSeparacao(sAdmin, pago.id);
  check("o primeiro bipe cria a separação ativa (UMA), e quem abre depois vê de quem é e o andamento", ativas === 1 && !("erro" in e2) && e2.quem?.nome === "Lara" && e2.itens.find((i) => i.variantId === vM.id)?.bipada === 1);
  const fAdmin2 = await filaDeSeparacao(sAdmin);
  check("fila: mostra quem está separando", fAdmin2.aSeparar[0].emAndamento?.quem === "Lara");
  const bErr = await registrarBipe(sLara, pago.id, vR.barcode!);
  check("bipe: peça que NÃO está no pedido é recusada", "aceito" in bErr && !bErr.aceito && bErr.motivo === "peca-errada");
  const bIleg = await registrarBipe(sLara, pago.id, "1234567890123");
  check("bipe: código ilegível é recusado", "aceito" in bIleg && !bIleg.aceito && bIleg.motivo === "codigo-ilegivel");
  const bG = await registrarBipe(sLara, pago.id, `${vG.barcode}\n`);
  check("bipe: com o Enter do leitor colado, aceita e fecha a linha (1/1)", "aceito" in bG && bG.aceito && bG.completa);
  const bMais = await registrarBipe(sLara, pago.id, vG.barcode!);
  check("bipe: peça A MAIS na linha completa é recusada", "aceito" in bMais && !bMais.aceito && bMais.motivo === "quantidade-a-mais");
  // dois bipes ao mesmo tempo da mesma linha: a trava entra um de cada vez
  const [c1, c2] = await Promise.all([registrarBipe(sLara, pago.id, vM.barcode!), registrarBipe(sLara, pago.id, vM.barcode!)]);
  const gravado = await db.separacao.findFirst({ where: { orderId: pago.id, concluidaEm: null } });
  const itensGravados = JSON.parse(gravado!.itens) as { variantId: string; bipada: number }[];
  check("bipe: dois bipes simultâneos entram um de cada vez (3/3 gravado, nenhum perdido)", "aceito" in c1 && c1.aceito && "aceito" in c2 && c2.aceito && itensGravados.find((i) => i.variantId === vM.id)?.bipada === 3);
  const bMais2 = await registrarBipe(sLara, pago.id, vM.barcode!);
  check("bipe: a 4ª da linha de 3 é recusada", "aceito" in bMais2 && !bMais2.aceito);
  const recusaColegaBipe = await registrarBipe(sLara, daOutra.id, vR.barcode!);
  check("bipe: no pedido da colega não registra (RN-007)", "erro" in recusaColegaBipe);

  // 4) concluir: com tudo bipado
  const semAbrir = await concluirSeparacao(sLara, daOutra.id, []);
  check("concluir: pedido fora do recorte não conclui", "erro" in semAbrir);
  const ok = await concluirSeparacao(sLara, pago.id, []);
  check("concluir: com toda linha fechada, conclui e devolve a contagem", "ok" in ok && ok.pecas === 4 && ok.faltas === 0);
  const dep = await db.order.findUnique({ where: { id: pago.id }, include: { events: true } });
  check("concluir: pedido vira SEPARACAO com carimbo separadoEm", dep?.status === "SEPARACAO" && !!dep.separadoEm);
  check("concluir: o histórico do pedido diz QUEM separou", dep!.events.some((e) => e.type === "SEPARACAO" && e.description.includes("Separado com leitor por Lara") && e.userId === vend.id));
  check("concluir: a troca de status entra no histórico como toda troca", dep!.events.some((e) => e.type === "STATUS" && /Separação/.test(e.description)));
  check("concluir: a separação ativa fecha (concluidaEm)", (await db.separacao.count({ where: { orderId: pago.id, concluidaEm: null } })) === 0);
  check("concluir: sem falta, ninguém é avisado", (await db.notification.count({ where: { companyId: loja.id } })) === 0);
  const f3 = await filaDeSeparacao(sAdmin);
  check("fila: o pedido separado sai de 'a separar' e entra em 'separados'", !f3.aSeparar.some((l) => l.id === pago.id) && f3.separados.some((l) => l.id === pago.id));

  // 5) falta, no pedido sem dona (aviso vai para a gerência) e em EM_PRODUCAO
  const semDona = await mk(5, "EM_PRODUCAO", { paidAt: new Date(), sellerId: null });
  await item(semDona.id, vR.id, 2);
  const e5 = await abrirSeparacao(sAdmin, semDona.id);
  if ("erro" in e5) throw new Error(e5.erro);
  check("abrir: em produção também entra", true);
  const naoPode = await concluirSeparacao(sAdmin, semDona.id, [{ variantId: vR.id, falta: 0 }]);
  check("concluir: sem bipar nada, recusa dizendo quantas faltam (a contagem do SERVIDOR é a que vale)", "erro" in naoPode && /faltam 2/.test(naoPode.erro));
  // a lojista edita o pedido NO MEIO: mais uma peça na linha e uma linha nova — o bipe seguinte já enxerga
  await db.orderItem.updateMany({ where: { orderId: semDona.id, variantId: vR.id }, data: { quantity: 3, total: 150 } });
  await item(semDona.id, vG.id, 1);
  const bNova = await registrarBipe(sAdmin, semDona.id, vG.barcode!);
  check("bipe: peça acrescentada ao pedido DEPOIS de abrir é aceita (o servidor lê o pedido de agora)", "aceito" in bNova && bNova.aceito);
  const b3 = await Promise.all([registrarBipe(sAdmin, semDona.id, vR.barcode!), registrarBipe(sAdmin, semDona.id, vR.barcode!), registrarBipe(sAdmin, semDona.id, vR.barcode!)]);
  check("bipe: a quantidade nova da linha (3) vale no servidor", b3.every((b) => "aceito" in b && b.aceito));
  // desfaz a edição e volta ao cenário da falta
  await db.orderItem.deleteMany({ where: { orderId: semDona.id, variantId: vG.id } });
  await db.orderItem.updateMany({ where: { orderId: semDona.id, variantId: vR.id }, data: { quantity: 2, total: 100 } });
  await db.separacao.updateMany({ where: { orderId: semDona.id }, data: { itens: JSON.stringify(e5.itens) } });
  await registrarBipe(sAdmin, semDona.id, vR.barcode!);
  const falta = await registrarFalta(sAdmin, semDona.id, vR.id, 5);
  check("falta: declarar registra (e cabe no que sobrou)", "ok" in falta && (JSON.parse((await db.separacao.findFirst({ where: { orderId: semDona.id, concluidaEm: null } }))!.itens) as { falta: number }[])[0].falta === 1);
  const comFalta = await concluirSeparacao(sAdmin, semDona.id, [{ variantId: vR.id, falta: 1 }]);
  check("concluir com falta: conclui e conta a falta", "ok" in comFalta && comFalta.faltas === 1 && comFalta.pecas === 1);
  const ev = await db.orderEvent.findFirst({ where: { orderId: semDona.id, type: "SEPARACAO" }, orderBy: { createdAt: "desc" } });
  check("concluir com falta: o histórico diz o que FALTOU", !!ev && /FALTOU: 1× Vestido Rosa · M/.test(ev.description));
  const avisos = await db.notification.findMany({ where: { companyId: loja.id } });
  check("concluir com falta, pedido sem dona: o aviso vai para a gerência (só ela)", avisos.length === 1 && avisos[0].userId === admin.id && avisos[0].orderId === semDona.id && /FALTA/.test(avisos[0].title));

  // 6) status não passa por cima de ENVIADO gravado no meio
  const corrida = await mk(6, "PAGO", { paidAt: new Date() });
  await item(corrida.id, vG.id, 1);
  await abrirSeparacao(sAdmin, corrida.id);
  await registrarBipe(sAdmin, corrida.id, vG.barcode!);
  await db.order.update({ where: { id: corrida.id }, data: { status: "ENVIADO" } });
  const r6 = await concluirSeparacao(sAdmin, corrida.id, []);
  const o6 = await db.order.findUnique({ where: { id: corrida.id } });
  check("concluir: pedido que virou ENVIADO no meio não conclui nem volta para SEPARACAO (saiu da fila)", "erro" in r6 && o6?.status === "ENVIADO" && !o6.separadoEm);

  // 7) pedido CANCELADO no meio: nem bipe nem conclusão
  const canc = await mk(7, "PAGO", { paidAt: new Date() });
  await item(canc.id, vG.id, 1);
  await abrirSeparacao(sAdmin, canc.id);
  await db.order.update({ where: { id: canc.id }, data: { status: "CANCELADO" } });
  const bCanc = await registrarBipe(sAdmin, canc.id, vG.barcode!);
  const cCanc = await concluirSeparacao(sAdmin, canc.id, []);
  check("bipe e concluir: pedido CANCELADO no meio recusam com frase (nada registrado)", "erro" in bCanc && "erro" in cCanc && (await db.orderEvent.count({ where: { orderId: canc.id, type: "SEPARACAO" } })) === 0);

  // 8) pedido sem peça com código conclui como conferido na mão
  const semCod = await mk(8, "PAGO", { paidAt: new Date() });
  await db.orderItem.create({ data: { orderId: semCod.id, name: "Item da loja online", quantity: 2, unitPrice: 10, total: 20 } });
  const e8 = await abrirSeparacao(sAdmin, semCod.id);
  check("abrir: pedido só com item sem código lista o item à parte", !("erro" in e8) && e8.itens.length === 0 && e8.semCodigo.length === 1);
  const r8 = await concluirSeparacao(sAdmin, semCod.id, []);
  const ev8 = await db.orderEvent.findFirst({ where: { orderId: semCod.id, type: "SEPARACAO" } });
  check("concluir: conclui como conferido na mão e o histórico diz", "ok" in r8 && !!ev8 && /conferida\(s\) na mão/.test(ev8.description));

  // 9) pedido editado depois de separado volta para a fila — mas só se o PACOTE mudou
  check("pacote: só preço não muda o pacote; quantidade ou peça nova mudam", !pacoteMudou([{ variantId: "a", quantity: 2 }], [{ variantId: "a", quantity: 2 }]) && pacoteMudou([{ variantId: "a", quantity: 2 }], [{ variantId: "a", quantity: 3 }]) && pacoteMudou([{ variantId: "a", quantity: 2 }], [{ variantId: "a", quantity: 1 }, { variantId: "b", quantity: 1 }]));
  await desfazerCarimboDeSeparacao(db, "outra-loja", semCod.id);
  check("carimbo: de outra loja não desfaz (RN-013)", !!(await db.order.findUnique({ where: { id: semCod.id } }))?.separadoEm);
  await desfazerCarimboDeSeparacao(db, loja.id, semCod.id);
  const o9 = await db.order.findUnique({ where: { id: semCod.id } });
  const f9 = await filaDeSeparacao(sAdmin);
  check("carimbo desfeito: o pedido volta para 'a separar'", !o9?.separadoEm && f9.aSeparar.some((l) => l.id === semCod.id));

  // 10) pedido pago SEM nenhuma peça não entra na fila (não há o que separar)
  const vazio = await mk(10, "PAGO", { paidAt: new Date() });
  const f10 = await filaDeSeparacao(sAdmin);
  const e10 = await abrirSeparacao(sAdmin, vazio.id);
  check("fila: pedido sem peça fica fora, e abrir recusa com frase", !f10.aSeparar.some((l) => l.id === vazio.id) && "erro" in e10 && !f10.cortada);

  await db.company.delete({ where: { id: loja.id } });
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
