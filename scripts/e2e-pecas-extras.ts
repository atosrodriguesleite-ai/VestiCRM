/**
 * PROVA DE PONTA A PONTA DA RN-075 — PEÇAS EXTRAS.
 *
 * Roda contra um Postgres DE VERDADE (nunca o de produção) e pelas ROTAS de
 * verdade, porque o que se quer provar é o encadeamento com o estoque:
 * criar, editar para mais e para menos, cancelar devolvendo, restaurar,
 * cancelar baixando e reabrir — e que o extra nunca mexe em estoque.
 *
 *   DATABASE_URL=... AUTH_SECRET=teste npx next dev -p 3999
 *   DATABASE_URL=... APP_URL=http://127.0.0.1:3999 npx tsx --tsconfig tsconfig.json scripts/e2e-pecas-extras.ts
 *
 * O roteiro cria a própria loja de teste e a apaga no fim.
 */
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { extrasDosPedidos } from "@/lib/pedido-extras-data";

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
  return r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

async function main() {
  const marca = Date.now();
  const senha = "senha-de-teste-123";
  const hash = await bcrypt.hash(senha, 4);
  const company = await db.company.create({
    data: { name: `Loja Extras ${marca}`, slug: `loja-extras-${marca}` },
  });
  try {
    const vendedora = await db.user.create({
      data: { companyId: company.id, name: "Lara", email: `lara-${marca}@teste.local`, passwordHash: hash, role: "SELLER" },
    });
    const gerente = await db.user.create({
      data: { companyId: company.id, name: "Gerente", email: `ger-${marca}@teste.local`, passwordHash: hash, role: "ADMIN" },
    });
    const cliente = await db.customer.create({
      data: { companyId: company.id, name: "Cliente Extra", phone: `5531988${String(marca).slice(-6)}`, ownerId: vendedora.id },
    });
    const produto = await db.product.create({
      data: {
        companyId: company.id,
        name: "Regata Quadrada",
        sku: `RQD-${marca}`,
        category: "Regatas",
        retailPrice: 60,
        wholesalePrice: 30,
        variants: {
          create: [
            { color: "Azul", size: "P", stock: 2 },
            { color: "Azul", size: "M", stock: 0 },
            { color: "Azul", size: "G", stock: 10 },
          ],
        },
      },
      include: { variants: true },
    });
    const v = Object.fromEntries(produto.variants.map((x) => [x.size, x]));
    const estoque = async () =>
      Object.fromEntries(
        (await db.productVariant.findMany({ where: { productId: produto.id } })).map((x) => [x.size, x.stock])
      );
    const item = (size: string, quantity: number) => ({
      productId: produto.id,
      variantId: v[size].id,
      quantity,
      unitPrice: 30,
    });
    const extrasDe = async (orderId: string) => {
      const o = await db.order.findUniqueOrThrow({ where: { id: orderId } });
      return (await extrasDosPedidos(db, [o])).get(orderId)?.total ?? 0;
    };

    const cookieVend = await login(vendedora.email, senha);
    const cookieGer = await login(gerente.email, senha);
    const api = async (cookie: string, metodo: string, caminho: string, corpo?: unknown) => {
      const r = await fetch(`${APP}${caminho}`, {
        method: metodo,
        headers: { "content-type": "application/json", cookie },
        body: corpo ? JSON.stringify(corpo) : undefined,
      });
      const texto = await r.text();
      let json: Record<string, unknown> | null = null;
      try {
        json = JSON.parse(texto);
      } catch {
        /* página ou resposta sem corpo */
      }
      return { status: r.status, json, texto };
    };
    type Extra = { variantId: string; precisa: number; doEstoque: number; extra: number };
    const extrasDaResposta = (j: Record<string, unknown> | null) => (j?.extras as Extra[] | undefined) ?? [];

    // ---- 1. sem confirmação: recusa, nada criado, estoque intacto ----------
    console.log("\n1) Pedido acima do estoque SEM confirmar");
    const r1 = await api(cookieVend, "POST", "/api/orders", {
      customerId: cliente.id,
      items: [item("P", 5), item("G", 3)],
    });
    const e1 = extrasDaResposta(r1.json);
    conferir(r1.status === 409, `recusado com 409 (${r1.status})`);
    conferir(
      e1.length === 1 && e1[0].variantId === v.P.id && e1[0].precisa === 5 && e1[0].doEstoque === 2 && e1[0].extra === 3,
      `a lista diz: P precisa 5, 2 do estoque, 3 extras (${JSON.stringify(e1)})`
    );
    conferir(String(r1.json?.error).startsWith("Estoque insuficiente de Regata Quadrada (Azul P): restam 2"), `frase de sempre para as telas sem extra (${r1.json?.error})`);
    conferir((await db.order.count({ where: { companyId: company.id } })) === 0, "nenhum pedido criado");
    let s = await estoque();
    conferir(s.P === 2 && s.G === 10, `estoque intacto (${JSON.stringify(s)})`);

    // ---- 2. com confirmação: cria, segura o que há, extra fora do estoque --
    console.log("\n2) O mesmo pedido COM 'estou ciente'");
    const r2 = await api(cookieVend, "POST", "/api/orders", {
      customerId: cliente.id,
      items: [item("P", 5), item("G", 3)],
      extrasConfirmados: { [v.P.id]: 3 },
    });
    conferir(r2.status === 201, `criado (${r2.status} ${r2.status !== 201 ? r2.texto : ""})`);
    const orderId = String(r2.json?.id);
    s = await estoque();
    conferir(s.P === 0 && s.G === 7, `P segurou as 2 que havia, G segurou 3 — nunca negativo (${JSON.stringify(s)})`);
    const livro = await db.inventoryMovement.findMany({ where: { orderId } });
    const saidaP = livro.filter((m) => m.variantId === v.P.id).reduce((a, m) => a + m.quantity, 0);
    conferir(saidaP === 2, `o livro registra a SAÍDA de 2 da P, não 5 (${saidaP})`);
    conferir((await extrasDe(orderId)) === 3, `o pedido conta 3 extras (${await extrasDe(orderId)})`);
    const ev = await db.orderEvent.findFirst({ where: { orderId, description: { contains: "EXTRA" } } });
    conferir(!!ev && ev.description.includes("confirmadas por Lara"), `histórico diz quem confirmou (${ev?.description})`);

    // ---- 3. corrida: confirmou 3, mas agora faltam 5 → pergunta de novo ----
    console.log("\n3) A peça acabou entre a janela e o clique");
    const r3 = await api(cookieVend, "POST", "/api/orders", {
      customerId: cliente.id,
      items: [item("P", 5)],
      extrasConfirmados: { [v.P.id]: 3 },
    });
    const e3 = extrasDaResposta(r3.json);
    conferir(r3.status === 409 && e3[0]?.extra === 5, `recusado, com o número NOVO (5 extras) (${r3.status} ${JSON.stringify(e3)})`);
    conferir((await db.order.count({ where: { companyId: company.id } })) === 1, "nada criado na corrida");

    // ---- 4. editar para MAIS ------------------------------------------------
    console.log("\n4) Editar: P de 5 para 6 (sem estoque)");
    const r4a = await api(cookieVend, "PATCH", `/api/orders/${orderId}`, { items: [item("P", 6), item("G", 3)] });
    const e4 = extrasDaResposta(r4a.json);
    conferir(r4a.status === 409 && e4[0]?.extra === 1 && e4[0]?.precisa === 1, `sem confirmar: pergunta 1 extra (${r4a.status} ${JSON.stringify(e4)})`);
    const r4b = await api(cookieVend, "PATCH", `/api/orders/${orderId}`, {
      items: [item("P", 6), item("G", 3)],
      extrasConfirmados: { [v.P.id]: 1 },
    });
    conferir(r4b.status === 200, `confirmado: salvo (${r4b.status} ${r4b.status !== 200 ? r4b.texto : ""})`);
    s = await estoque();
    conferir(s.P === 0, `estoque da P continua 0 (${s.P})`);
    conferir((await extrasDe(orderId)) === 4, `extras: 4 (${await extrasDe(orderId)})`);

    // ---- 5. editar para MENOS: tira primeiro do extra ----------------------
    console.log("\n5) Editar para menos");
    const r5a = await api(cookieVend, "PATCH", `/api/orders/${orderId}`, { items: [item("P", 4), item("G", 3)] });
    s = await estoque();
    conferir(r5a.status === 200 && s.P === 0 && (await extrasDe(orderId)) === 2, `P 6→4: nada volta ao estoque, extras 2 (${s.P}, ${await extrasDe(orderId)})`);
    const r5b = await api(cookieVend, "PATCH", `/api/orders/${orderId}`, { items: [item("P", 1), item("G", 3)] });
    s = await estoque();
    conferir(r5b.status === 200 && s.P === 1 && (await extrasDe(orderId)) === 0, `P 4→1: volta 1 (das 2 seguradas), extras 0 (${s.P}, ${await extrasDe(orderId)})`);
    const r5c = await api(cookieVend, "PATCH", `/api/orders/${orderId}`, {
      items: [item("P", 4), item("G", 3)],
      extrasConfirmados: { [v.P.id]: 2 },
    });
    s = await estoque();
    conferir(r5c.status === 200 && s.P === 0 && (await extrasDe(orderId)) === 2, `P 1→4 com 1 no estoque: segura 1, extras 2 (${r5c.status}, ${s.P}, ${await extrasDe(orderId)})`);

    // ---- 6. a tela mostra ------------------------------------------------------
    console.log("\n6) Ficha e lista mostram o extra");
    const ficha = await api(cookieVend, "GET", `/pedidos/${orderId}`);
    conferir(ficha.texto.includes("peças extras"), "a ficha mostra o aviso de peças extras");
    const lista = await api(cookieVend, "GET", `/pedidos`);
    conferir(/🧵\s*(<!-- -->)?2(<!-- -->)?\s*(<!-- -->)?extras/.test(lista.texto), "a lista mostra o selo '🧵 2 extras'");

    // ---- 7. cancelar devolvendo: só o que saiu volta --------------------------
    console.log("\n7) Cancelar devolvendo as peças");
    const r7 = await api(cookieGer, "PATCH", `/api/orders/${orderId}`, { status: "CANCELADO", restock: true });
    s = await estoque();
    conferir(r7.status === 200 && s.P === 2 && s.G === 10, `voltaram as 2 da P e as 3 da G — os extras não viram estoque (${JSON.stringify(s)})`);
    conferir((await extrasDe(orderId)) === 0, "cancelado não mostra extra");

    // ---- 8. restaurar: o que faltar vira extra de novo -----------------------
    console.log("\n8) Restaurar como orçamento");
    const r8a = await api(cookieVend, "PATCH", `/api/orders/${orderId}`, { status: "ORCAMENTO" });
    const e8 = extrasDaResposta(r8a.json);
    conferir(r8a.status === 409 && e8[0]?.extra === 2 && e8[0]?.doEstoque === 2, `sem confirmar: pergunta (P 4 = 2 do estoque + 2 extras) (${r8a.status} ${JSON.stringify(e8)})`);
    const r8b = await api(cookieVend, "PATCH", `/api/orders/${orderId}`, {
      status: "ORCAMENTO",
      extrasConfirmados: { [v.P.id]: 2 },
    });
    s = await estoque();
    conferir(r8b.status === 200 && s.P === 0 && s.G === 7, `restaurado: segura de novo o que há (${r8b.status} ${JSON.stringify(s)})`);
    conferir((await extrasDe(orderId)) === 2, `extras: 2 (${await extrasDe(orderId)})`);
    const alarme = await db.orderEvent.findFirst({ where: { orderId, description: { contains: "Baixa de estoque incompleta" } } });
    conferir(!alarme, "extra confirmado não dispara o alarme de 'baixa incompleta'");

    // ---- 9. cancelar BAIXANDO e reabrir: nada desconta de novo ---------------
    console.log("\n9) Cancelar sem devolver e reabrir");
    await api(cookieGer, "PATCH", `/api/orders/${orderId}`, { status: "CANCELADO", restock: false });
    const r9 = await api(cookieVend, "PATCH", `/api/orders/${orderId}`, { status: "ORCAMENTO" });
    s = await estoque();
    conferir(r9.status === 200 && s.P === 0 && s.G === 7, `reaberto sem descontar de novo (${r9.status} ${JSON.stringify(s)})`);
    conferir((await extrasDe(orderId)) === 2, `extras seguem 2 (${await extrasDe(orderId)})`);

    // ---- 10. tudo extra: peça sem nenhum estoque ------------------------------
    console.log("\n10) Pedido todo de peça sem estoque");
    const r10 = await api(cookieVend, "POST", "/api/orders", {
      customerId: cliente.id,
      items: [item("M", 4)],
      extrasConfirmados: { [v.M.id]: 4 },
    });
    s = await estoque();
    conferir(r10.status === 201 && s.M === 0, `criado, M continua 0 (${r10.status} ${s.M})`);
    conferir((await extrasDe(String(r10.json?.id))) === 4, `extras: 4 (${await extrasDe(String(r10.json?.id))})`);
    // ---- 11. o que já saiu da loja não fica marcado --------------------------
    console.log("\n11) Enviado: o selo some");
    const id10 = String(r10.json?.id);
    await db.order.update({ where: { id: id10 }, data: { status: "ENVIADO" } });
    conferir((await extrasDe(id10)) === 0, "pedido enviado não mostra extra");
    await db.order.update({ where: { id: id10 }, data: { status: "ORCAMENTO" } });

    // ---- 12. falta que ninguém confirmou fala diferente -----------------------
    console.log("\n12) Falta sem confirmação (o pedido do catálogo que entrou com estoque a menos)");
    await db.orderEvent.deleteMany({ where: { orderId: id10, description: { startsWith: "🧵" } } });
    const o12 = await db.order.findUniqueOrThrow({ where: { id: id10 } });
    const e12 = (await extrasDosPedidos(db, [o12])).get(id10);
    conferir(e12?.total === 4 && e12.confirmados === false, `conta 4, NÃO confirmados (${JSON.stringify(e12)})`);
    const lista12 = await api(cookieVend, "GET", `/pedidos`);
    conferir(/4(<!-- -->)?\s*(<!-- -->)?sem estoque/.test(lista12.texto), "a lista diz '4 sem estoque', não 'extras'");
    const ficha12 = await api(cookieVend, "GET", `/pedidos/${id10}`);
    conferir(ficha12.texto.includes("ninguém confirmou extra"), "a ficha manda produzir, trocar ou combinar com a cliente");
  } finally {
    await db.company.delete({ where: { id: company.id } }).catch((e) => console.log("limpeza:", e.message));
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
