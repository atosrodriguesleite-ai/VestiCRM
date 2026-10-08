/**
 * PROVA DE PONTA A PONTA DA RN-073 — TROCA DE PEÇAS.
 *
 * Roda contra um Postgres DE VERDADE (nunca o de produção) e pelas ROTAS de
 * verdade (login, POST /api/orders, PATCH /api/orders/[id], POST e PATCH
 * /api/orders/[id]/troca), porque o que se quer provar é o encadeamento:
 * estoque (livro) → troca → história → crédito → cancelar depois da troca.
 *
 * Como rodar:
 *
 *   pg_ctl -D /var/lib/postgresql/vesti -o "-p 5433" start
 *   DATABASE_URL="postgresql://postgres@127.0.0.1:5433/vesti" node scripts/migrate-deploy.mjs
 *   DATABASE_URL="postgresql://postgres@127.0.0.1:5433/vesti" AUTH_SECRET=teste npx next dev -p 3999
 *   DATABASE_URL="postgresql://postgres@127.0.0.1:5433/vesti" APP_URL=http://127.0.0.1:3999 npx tsx scripts/e2e-troca.ts
 *
 * O roteiro cria a própria loja de teste e a apaga no fim.
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

async function login(email: string, password: string): Promise<string> {
  const r = await fetch(`${APP}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
    redirect: "manual",
  });
  if (!r.ok) throw new Error(`login ${email} falhou: ${r.status} ${await r.text()}`);
  const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  if (!cookie) throw new Error("login sem cookie");
  return cookie;
}

async function main() {
  const marca = Date.now();
  const senha = "senha-de-teste-123";
  const hash = await bcrypt.hash(senha, 4);

  const company = await db.company.create({
    data: { name: `Loja Troca ${marca}`, slug: `loja-troca-${marca}` },
  });
  const vendedora = await db.user.create({
    data: { companyId: company.id, name: "Lara", email: `lara-${marca}@teste.local`, passwordHash: hash, role: "SELLER" },
  });
  const suporte = await db.user.create({
    data: { companyId: company.id, name: "Suporte", email: `sup-${marca}@teste.local`, passwordHash: hash, role: "SUPPORT" },
  });
  const cliente = await db.customer.create({
    data: { companyId: company.id, name: "Cliente Troca", phone: `5531998${String(marca).slice(-6)}`, ownerId: vendedora.id },
  });
  const regata = await db.product.create({
    data: {
      companyId: company.id, name: "Regata Alça", sku: `REG-${marca}`, category: "Regatas",
      retailPrice: 50, wholesalePrice: 32,
      variants: { create: [{ color: "Preto", size: "P", stock: 10 }, { color: "Preto", size: "M", stock: 2 }] },
    },
    include: { variants: true },
  });
  const cropped = await db.product.create({
    data: {
      companyId: company.id, name: "Cropped", sku: `CRO-${marca}`, category: "Croppeds",
      retailPrice: 80, wholesalePrice: 48,
      variants: { create: [{ color: "Azul", size: "G", stock: 1 }] },
    },
    include: { variants: true },
  });
  const pretoP = regata.variants.find((v) => v.size === "P")!;
  const pretoM = regata.variants.find((v) => v.size === "M")!;
  const azulG = cropped.variants[0];
  const estoque = async (id: string) => (await db.productVariant.findUniqueOrThrow({ where: { id } })).stock;

  const gerente = await db.user.create({ data: { companyId: company.id, name: "Gerente", email: `ger-${marca}@teste.local`, passwordHash: hash, role: "ADMIN" } });
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

  // ---- 1. pedido de 3 Preto P, pago ---------------------------------------
  console.log("\n1) Pedido de 3× Preto P a R$ 32, pago");
  const criado = await api("POST", "/api/orders", {
    customerId: cliente.id,
    status: "AGUARDANDO_PAGAMENTO",
    items: [{ productId: regata.id, variantId: pretoP.id, quantity: 3, unitPrice: 32 }],
  });
  const orderId = (criado.json as { id?: string; order?: { id: string } })?.id ?? (criado.json as { order?: { id: string } })?.order?.id;
  if (!orderId) throw new Error(`POST /api/orders: ${criado.status} ${criado.texto}`);
  conferir((await estoque(pretoP.id)) === 7, "estoque Preto P desceu para 7");
  const item = await db.orderItem.findFirstOrThrow({ where: { orderId } });
  const chaveP = `v:${pretoP.id}|32.00`;

  // ---- 2. troca em orçamento/aguardando é recusada ------------------------
  console.log("\n2) Troca antes de pagar é recusada");
  const cedo = await api("POST", `/api/orders/${orderId}/troca`, {
    volta: [{ chave: chaveP, quantity: 1, destino: "ESTOQUE" }],
    sai: [{ variantId: pretoM.id, quantity: 1, unitPrice: 32 }],
    resolucao: "SEM_DIFERENCA",
  });
  conferir(cedo.status === 409, `409 em aguardando pagamento (${cedo.status}): ${String(cedo.json?.error ?? "").slice(0, 60)}`);

  const pago = await api("PATCH", `/api/orders/${orderId}`, { status: "PAGO" });
  conferir(pago.status === 200, `virou PAGO (${pago.status})`);
  const naLoja = await api("POST", `/api/orders/${orderId}/troca`, {
    volta: [{ chave: chaveP, quantity: 1, destino: "ESTOQUE" }],
    sai: [{ variantId: pretoM.id, quantity: 1, unitPrice: 32 }],
    resolucao: "SEM_DIFERENCA",
  });
  conferir(naLoja.status === 409 && /ENVIADO ou ENTREGUE/.test(String(naLoja.json?.error)), `pago mas ainda na loja: 409 (${naLoja.status})`);
  const entregue = await api("PATCH", `/api/orders/${orderId}`, { status: "ENTREGUE" });
  conferir(entregue.status === 200, `virou ENTREGUE (${entregue.status})`);

  // ---- 3. suporte não registra ----------------------------------------------
  console.log("\n3) Suporte não registra troca");
  const cookieSup = await login(suporte.email, senha);
  const sup = await api("POST", `/api/orders/${orderId}/troca`, {
    volta: [{ chave: chaveP, quantity: 1, destino: "ESTOQUE" }],
    sai: [{ variantId: pretoM.id, quantity: 1, unitPrice: 32 }],
    resolucao: "SEM_DIFERENCA",
  }, cookieSup);
  conferir(sup.status === 403, `403 para suporte (${sup.status})`);

  // ---- 4. troca 1: 1 Preto P volta boa, leva 1 Preto M — sem diferença -----
  console.log("\n4) Troca 1: volta 1 Preto P (boa), leva 1 Preto M, sem diferença");
  const t1 = await api("POST", `/api/orders/${orderId}/troca`, {
    volta: [{ chave: chaveP, quantity: 1, destino: "ESTOQUE" }],
    sai: [{ variantId: pretoM.id, quantity: 1, unitPrice: 32 }],
    resolucao: "SEM_DIFERENCA",
    motivo: "Tamanho",
    freteCombinado: "cliente traz na loja",
  });
  conferir(t1.status === 200, `registrada (${t1.status}) ${t1.texto.slice(0, 80)}`);
  conferir((await estoque(pretoP.id)) === 8, "Preto P subiu para 8 (voltou 1)");
  conferir((await estoque(pretoM.id)) === 1, "Preto M desceu para 1 (saiu 1)");
  const ordem1 = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true, trocas: { include: { itens: true } }, events: true } });
  conferir(ordem1.netTotal === 96 && ordem1.total === 96 && ordem1.status === "ENTREGUE", "pedido NÃO mudou (R$ 96, ENTREGUE)");
  conferir(ordem1.items.length === 1 && ordem1.items[0].quantity === 3, "itens do pedido intactos (3× Preto P)");
  conferir(ordem1.trocas.length === 1 && ordem1.trocas[0].numero === 1 && ordem1.trocas[0].resolvidaEm !== null, "troca 1 gravada, acertada ao nascer");
  conferir(ordem1.trocas[0].itens.length === 2, "2 itens na troca (1 volta, 1 sai)");
  const ev1 = ordem1.events.find((e) => /Troca 1 registrada por Lara/.test(e.description));
  conferir(!!ev1 && /Frete: cliente traz na loja/.test(ev1!.description), `história: ${ev1?.description.slice(0, 90)}…`);
  const movs1 = await db.inventoryMovement.findMany({ where: { orderId }, orderBy: { createdAt: "asc" } });
  const saldoLivro = (vid: string) =>
    movs1.filter((m) => m.variantId === vid).reduce((s, m) => s + (m.type === "SAIDA" ? m.quantity : -m.quantity), 0);
  conferir(saldoLivro(pretoP.id) === 2 && saldoLivro(pretoM.id) === 1, "livro do pedido: segura 2 Preto P + 1 Preto M (o que a cliente tem agora)");

  // ---- 4b. editar itens DEPOIS da troca é recusado; o teto segue pela variação
  console.log("\n4b) Editar os itens depois da troca é recusado (os itens são o retrato da venda)");
  const ed = await api("PATCH", `/api/orders/${orderId}`, {
    items: [{ productId: regata.id, variantId: pretoP.id, quantity: 3, unitPrice: 30 }],
  });
  conferir(ed.status === 409 && /troca registrada/.test(String(ed.json?.error)), `409 (${ed.status}): ${String(ed.json?.error ?? "").slice(0, 70)}`);
  conferir((await estoque(pretoP.id)) === 8 && (await estoque(pretoM.id)) === 1, "estoque intacto: P 8, M 1");
  // mudar só o preço/frete pela porta de valores continua permitido e não mexe em estoque
  const alemDoTeto = await api("POST", `/api/orders/${orderId}/troca`, {
    volta: [{ chave: chaveP, quantity: 3, destino: "ESTOQUE" }],
    sai: [{ variantId: pretoM.id, quantity: 1, unitPrice: 32 }],
    resolucao: "DEVOLUCAO",
  });
  conferir(alemDoTeto.status === 400 && /2 peças/.test(String(alemDoTeto.json?.error)), `teto: ${String(alemDoTeto.json?.error ?? "").slice(0, 80)}`);

  // ---- 5. troca 2: volta 1 Preto P com DEFEITO, leva 1 Cropped (R$ 48): cliente paga 16
  console.log("\n5) Troca 2: 1 Preto P com defeito, leva Cropped Azul G a R$ 48 → cobrar R$ 16");
  const errada = await api("POST", `/api/orders/${orderId}/troca`, {
    volta: [{ chave: chaveP, quantity: 1, destino: "DEFEITO" }],
    sai: [{ variantId: azulG.id, quantity: 1, unitPrice: 48 }],
    resolucao: "CREDITO",
  });
  conferir(errada.status === 400, `crédito com a cliente devendo é recusado (${errada.status})`);
  const t2 = await api("POST", `/api/orders/${orderId}/troca`, {
    volta: [{ chave: chaveP, quantity: 1, destino: "DEFEITO" }],
    sai: [{ variantId: azulG.id, quantity: 1, unitPrice: 48 }],
    resolucao: "COBRAR",
  });
  conferir(t2.status === 200, `registrada (${t2.status})`);
  conferir((await estoque(pretoP.id)) === 8, "Preto P continua 8 (defeito não volta para a arara)");
  conferir((await estoque(azulG.id)) === 0, "Cropped desceu para 0");
  const troca2 = await db.troca.findFirstOrThrow({ where: { orderId, numero: 2 } });
  conferir(troca2.diferenca === 16 && troca2.resolucao === "COBRAR" && troca2.resolvidaEm === null, "diferença R$ 16, a cobrar, aguardando acerto");
  const defeito = await db.inventoryMovement.findMany({ where: { variantId: pretoP.id, reason: { contains: "defeito" } } });
  conferir(
    defeito.length === 2 && defeito.some((m) => m.type === "ENTRADA" && m.orderId === orderId) && defeito.some((m) => m.type === "SAIDA" && m.orderId === null),
    "livro: ENTRADA (com pedido) + SAÍDA solta (baixa por defeito)"
  );

  // ---- 6. sem estoque: Cropped zerou ---------------------------------------
  console.log("\n6) Peça que sai sem estoque é recusada inteira");
  const semEstoque = await api("POST", `/api/orders/${orderId}/troca`, {
    volta: [{ chave: chaveP, quantity: 1, destino: "ESTOQUE" }],
    sai: [{ variantId: azulG.id, quantity: 1, unitPrice: 48 }],
    resolucao: "COBRAR",
  });
  conferir(semEstoque.status === 409, `409 sem estoque (${semEstoque.status}): ${String(semEstoque.json?.error ?? "").slice(0, 70)}`);
  conferir((await estoque(pretoP.id)) === 8, "a ENTRADA da peça devolvida foi desfeita junto (transação inteira)");
  conferir((await db.troca.count({ where: { orderId } })) === 2, "nenhuma troca a mais");

  // ---- 7. teto do que volta: já voltaram 2 das 3 ----------------------------
  console.log("\n7) Teto do que volta");
  const demais = await api("POST", `/api/orders/${orderId}/troca`, {
    volta: [{ chave: chaveP, quantity: 2, destino: "ESTOQUE" }],
    sai: [{ variantId: pretoM.id, quantity: 1, unitPrice: 32 }],
    resolucao: "DEVOLUCAO",
  });
  conferir(demais.status === 400 && /1 peça/.test(String(demais.json?.error)), `recusa: ${String(demais.json?.error ?? "").slice(0, 80)}`);

  // ---- 8. troca 3: última Preto P volta boa, leva Preto M a R$ 20 → crédito R$ 12
  console.log("\n8) Troca 3: volta a última Preto P, leva Preto M a R$ 20 → crédito de R$ 12");
  const t3 = await api("POST", `/api/orders/${orderId}/troca`, {
    volta: [{ chave: chaveP, quantity: 1, destino: "ESTOQUE" }],
    sai: [{ variantId: pretoM.id, quantity: 1, unitPrice: 20 }],
    resolucao: "CREDITO",
  });
  conferir(t3.status === 200, `registrada (${t3.status})`);
  const creditos = await db.customerCredit.findMany({ where: { customerId: cliente.id } });
  conferir(creditos.length === 1 && creditos[0].valor === 12 && creditos[0].origem === "TROCA", "crédito de R$ 12 no livro da cliente");
  conferir((await estoque(pretoP.id)) === 9 && (await estoque(pretoM.id)) === 0, "estoque: Preto P 9, Preto M 0");

  // ---- 9. acerto da cobrança ----------------------------------------------
  console.log("\n9) Confirmar que recebeu a diferença da troca 2");
  const acertoSup = await api("PATCH", `/api/orders/${orderId}/troca`, { trocaId: troca2.id, acertada: true }, cookieSup);
  conferir(acertoSup.status === 403, `suporte não confirma (${acertoSup.status})`);
  const acerto = await api("PATCH", `/api/orders/${orderId}/troca`, { trocaId: troca2.id, acertada: true });
  conferir(acerto.status === 200, `confirmado (${acerto.status})`);
  const troca2b = await db.troca.findUniqueOrThrow({ where: { id: troca2.id } });
  conferir(troca2b.resolvidaEm !== null && troca2b.resolvidaPorNome === "Lara", "acerto gravado com quem");
  const acerto2 = await api("PATCH", `/api/orders/${orderId}/troca`, { trocaId: troca2.id, acertada: true });
  conferir(acerto2.status === 200, "confirmar de novo é idempotente");
  const evAcerto = await db.orderEvent.count({ where: { orderId, description: { contains: "recebida da cliente" } } });
  conferir(evAcerto === 1, "história ganhou UM evento de acerto");

  // ---- 10. cancelar depois das trocas devolve o que a cliente TEM -----------
  console.log("\n10) Cancelar o pedido devolve o que a cliente tem agora (2 Preto M + 1 Cropped)");
  const cancel = await api("PATCH", `/api/orders/${orderId}`, { status: "CANCELADO", restock: true });
  conferir(cancel.status === 200, `cancelado (${cancel.status})`);
  conferir((await estoque(pretoP.id)) === 9, "Preto P fica 9 (todas já tinham voltado — nada volta em dobro)");
  conferir((await estoque(pretoM.id)) === 2, "Preto M volta para 2");
  conferir((await estoque(azulG.id)) === 1, "Cropped volta para 1");
  const saldo = async () => (await db.customerCredit.findMany({ where: { customerId: cliente.id } })).reduce((s, l) => s + l.valor, 0);
  conferir((await saldo()) === 0, "crédito da troca 3 ESTORNADO no cancelamento (saldo 0)");
  const evCancel = await db.orderEvent.findFirst({ where: { orderId, description: { contains: "Pedido cancelado com troca registrada" } } });
  conferir(!!evCancel && /R\$ 12,00 estornado/.test(evCancel!.description) && /R\$ 16,00 recebido na troca 2/.test(evCancel!.description), `história: ${evCancel?.description.slice(0, 160)}`);
  // cancelar de novo (idempotência do estorno) não acontece — mas restaurar repõe
  console.log("\n10b) Restaurar como orçamento repõe o crédito; apagar estorna de vez");
  const rest = await api("PATCH", `/api/orders/${orderId}`, { status: "ORCAMENTO" });
  conferir(rest.status === 200, `restaurado (${rest.status}) ${rest.texto.slice(0, 60)}`);
  conferir((await saldo()) === 12, "crédito reposto (saldo 12)");
  conferir((await estoque(pretoP.id)) === 9 && (await estoque(pretoM.id)) === 0 && (await estoque(azulG.id)) === 0, "restaurar reservou o pacote EFETIVO (2 M + 1 Cropped), não os 3 P originais");
  const cancel2 = await api("PATCH", `/api/orders/${orderId}`, { status: "CANCELADO", restock: true });
  conferir(cancel2.status === 200 && (await saldo()) === 0, "cancelar de novo estorna de novo (saldo 0), sem dobrar");
  const rest2 = await api("PATCH", `/api/orders/${orderId}`, { status: "ORCAMENTO" });
  conferir(rest2.status === 200 && (await saldo()) === 12, "restaurar de novo repõe (saldo 12)");
  const linhasCredito = await db.customerCredit.count({ where: { customerId: cliente.id } });
  conferir(linhasCredito === 5, `livro com 5 linhas (concessão, estorno, reposição, estorno, reposição) — ${linhasCredito}`);
  // excluir é da gerência (RN-007)
  const apagar = await api("DELETE", `/api/orders/${orderId}`, undefined, cookieAdmin);
  conferir(apagar.status === 200 || apagar.status === 204, `pedido apagado (${apagar.status}) ${apagar.texto.slice(0, 60)}`);
  conferir((await saldo()) === 0, "apagar o pedido estorna o crédito (saldo 0)");
  conferir((await db.troca.count({ where: { customerId: cliente.id } })) === 0, "trocas caíram em cascata com o pedido");

  // ---- 11. venda da loja online: estoque anda, livro sem pedido -------------
  console.log("\n11) Pedido da Nuvemshop: a troca move o estoque SEM prender ao pedido");
  const ns = await db.order.create({
    data: {
      companyId: company.id, number: 9001, customerId: cliente.id, status: "ENTREGUE", source: "NUVEMSHOP", nuvemshopId: `ns-${marca}`,
      subtotal: 32, netTotal: 32, total: 32, stockDeducted: true, paidAt: new Date(),
      items: { create: [{ productId: regata.id, variantId: pretoP.id, name: "Regata Alça", color: "Preto", size: "P", quantity: 1, unitPrice: 32, total: 32 }] },
    },
    include: { items: true },
  });
  const tNs = await api("POST", `/api/orders/${ns.id}/troca`, {
    volta: [{ chave: `v:${pretoP.id}|32.00`, quantity: 1, destino: "ESTOQUE" }],
    sai: [{ variantId: pretoM.id, quantity: 1, unitPrice: 32 }],
    resolucao: "SEM_DIFERENCA",
  }, cookieAdmin);
  conferir(tNs.status === 200, `registrada (${tNs.status})`);
  conferir((await estoque(pretoP.id)) === 10 && (await estoque(pretoM.id)) === 1, "estoque andou (P 10, M 1)");
  conferir((await db.inventoryMovement.count({ where: { orderId: ns.id } })) === 0, "nenhum movimento preso ao pedido da loja online");

  // ---- limpeza ----------------------------------------------------------------
  await db.company.delete({ where: { id: company.id } });
  console.log(process.exitCode ? "\n❌ Houve falhas." : "\n✅ Tudo conferido.");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
