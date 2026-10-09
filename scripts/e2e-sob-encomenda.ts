/**
 * PROVA DE PONTA A PONTA DA RN-076 — VENDE SOB ENCOMENDA.
 *
 * Roda contra um Postgres DE VERDADE (nunca o de produção) e pelas ROTAS de
 * verdade: a chavinha na categoria e na peça, o catálogo público, o Novo
 * pedido, a edição, o cancelamento, a produção que cobre o negativo, o
 * mínimo que não toca, o Dashboard e a peça vinculada que recusa.
 *
 *   DATABASE_URL="postgresql://postgres@127.0.0.1:5433/vesti" AUTH_SECRET=teste npx next dev -p 3999
 *   DATABASE_URL="postgresql://postgres@127.0.0.1:5433/vesti" APP_URL=http://127.0.0.1:3999 npx tsx --tsconfig tsconfig.json scripts/e2e-sob-encomenda.ts
 *
 * O roteiro cria a própria loja de teste e a apaga no fim.
 */
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { contarNoMinimo, linhasDoEstoque, resumirLinhas } from "@/lib/estoque/inventario";
import { extrasDosPedidos } from "@/lib/pedido-extras-data";
import { upsertProduct } from "@/lib/nuvemshop";

if (!/(localhost|127\.0\.0\.1):5433\b/.test(process.env.DATABASE_URL ?? "")) throw new Error("só local (porta 5433)");

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
  const slug = `loja-encomenda-${marca}`;
  const company = await db.company.create({
    data: { name: `Loja Confecção ${marca}`, slug, estoqueEnabled: true, catalogHideOutOfStock: true },
  });
  try {
    const vendedora = await db.user.create({
      data: { companyId: company.id, name: "Lara", email: `lara-${marca}@teste.local`, passwordHash: hash, role: "SELLER" },
    });
    const gerente = await db.user.create({
      data: { companyId: company.id, name: "Gerente", email: `ger-${marca}@teste.local`, passwordHash: hash, role: "ADMIN" },
    });
    const suporte = await db.user.create({
      data: { companyId: company.id, name: "Suporte", email: `sup-${marca}@teste.local`, passwordHash: hash, role: "SUPPORT" },
    });
    const cliente = await db.customer.create({
      data: { companyId: company.id, name: "Cliente Encomenda", phone: `5531977${String(marca).slice(-6)}`, ownerId: vendedora.id },
    });
    // "Conjuntos": a categoria que vai ligar; "Regatas": fica como sempre
    const conjunto = await db.product.create({
      data: {
        companyId: company.id,
        name: "Conjunto Linho",
        sku: `CJL-${marca}`,
        category: "Conjuntos",
        retailPrice: 120,
        wholesalePrice: 80,
        images: { create: [{ url: "data:image/png;base64,iVBORw0KGgo=", order: 0 }] },
        variants: { create: [{ color: "Preto", size: "M", stock: 2 }, { color: "Preto", size: "G", stock: 0 }] },
      },
      include: { variants: true },
    });
    const regata = await db.product.create({
      data: {
        companyId: company.id,
        name: "Regata Lisa",
        sku: `RGL-${marca}`,
        category: "Regatas",
        retailPrice: 40,
        wholesalePrice: 25,
        images: { create: [{ url: "data:image/png;base64,iVBORw0KGgo=", order: 0 }] },
        variants: { create: [{ color: "Branco", size: "M", stock: 1 }] },
      },
      include: { variants: true },
    });
    // peça "da Nuvemshop" dentro da categoria que vai ligar: nunca vende sob encomenda
    const vinculada = await db.product.create({
      data: {
        companyId: company.id,
        name: "Conjunto da Loja Online",
        sku: `CJN-${marca}`,
        category: "Conjuntos",
        nuvemshopId: `ns-${marca}`,
        retailPrice: 120,
        wholesalePrice: 80,
        images: { create: [{ url: "data:image/png;base64,iVBORw0KGgo=", order: 0 }] },
        variants: { create: [{ color: "Azul", size: "M", stock: 0, nuvemshopId: `nsv-${marca}`, sku: `CJN-AZ-M-${marca}` }] },
      },
      include: { variants: true },
    });
    // peça do JUERI na mesma categoria: a chavinha nunca a alcança
    const doJueri = await db.product.create({
      data: {
        companyId: company.id,
        name: "Conjunto do Jueri",
        sku: `CJJ-${marca}`,
        category: "Conjuntos",
        jueriId: `ju-${marca}`,
        retailPrice: 120,
        wholesalePrice: 80,
        images: { create: [{ url: "data:image/png;base64,iVBORw0KGgo=", order: 0 }] },
        variants: { create: [{ color: "Verde", size: "M", stock: 0 }] },
      },
      include: { variants: true },
    });
    const cM = conjunto.variants.find((v) => v.size === "M")!;
    const cG = conjunto.variants.find((v) => v.size === "G")!;
    const rM = regata.variants[0];
    const estoque = async (id: string) => (await db.productVariant.findUniqueOrThrow({ where: { id } })).stock;

    const cookieVend = await login(vendedora.email, senha);
    const cookieGer = await login(gerente.email, senha);
    const cookieSup = await login(suporte.email, senha);
    const api = async (cookie: string | null, metodo: string, caminho: string, corpo?: unknown) => {
      const r = await fetch(`${APP}${caminho}`, {
        method: metodo,
        headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
        body: corpo ? JSON.stringify(corpo) : undefined,
      });
      const texto = await r.text();
      let json: Record<string, unknown> | null = null;
      try {
        json = JSON.parse(texto);
      } catch {
        /* página */
      }
      return { status: r.status, json, texto };
    };
    const item = (v: { id: string; productId: string }, quantity: number, unitPrice = 80) => ({
      productId: v.productId,
      variantId: v.id,
      quantity,
      unitPrice,
    });

    // ---- 1. desligada: tudo como sempre ------------------------------------
    console.log("\n1) Chavinha desligada: a venda PARA no estoque (RN-003/RN-075)");
    const r1 = await api(cookieVend, "POST", "/api/orders", { customerId: cliente.id, items: [item(cM, 5)] });
    conferir(r1.status === 409 && Array.isArray(r1.json?.extras), `recusado com 409 e a lista de extras (${r1.status})`);
    const cat1 = await api(null, "GET", `/catalogo/${slug}`);
    conferir(cat1.status === 200 && !cat1.texto.includes("Conjunto Linho") === false, "o catálogo abre");
    // o payload da página escapa as aspas (\"), então a leitura é tolerante
    const disp = (cor: string, tam: string, n: number) =>
      new RegExp(`${cor}\\\\?",\\\\?"size\\\\?":\\\\?"${tam}\\\\?",\\\\?"disponivel\\\\?":${n}\\b`);
    conferir(!disp("Preto", "G", 9999).test(cat1.texto), "a vitrine não dá teto da linha ao G zerado");

    // ---- 2. quem liga: só gerência; vinculada recusa -----------------------
    console.log("\n2) Quem liga a chavinha");
    const r2a = await api(cookieSup, "PATCH", "/api/categories", { from: "Conjuntos", sobEncomenda: true });
    conferir(r2a.status === 403, `suporte não liga a categoria (${r2a.status})`);
    const r2b = await api(cookieVend, "PATCH", `/api/products/${conjunto.id}`, { sobEncomenda: true });
    conferir(r2b.status === 403, `vendedora não liga a peça (${r2b.status} ${r2b.json?.error ?? ""})`);
    const r2c = await api(cookieGer, "PATCH", `/api/products/${doJueri.id}`, { sobEncomenda: true });
    conferir(r2c.status === 409, `peça do Jueri recusa a chavinha (${r2c.status} ${r2c.json?.error ?? ""})`);
    const r2d = await api(cookieGer, "PATCH", "/api/categories", { from: "Conjuntos", sobEncomenda: true });
    conferir(r2d.status === 200 && r2d.json?.sobEncomenda === true, `gerência liga a categoria (${r2d.status})`);
    const cats = await api(cookieGer, "GET", "/api/categories");
    const lista = (cats.json?.categories as { name: string; sobEncomenda: boolean }[]) ?? [];
    conferir(lista.find((c) => c.name === "Conjuntos")?.sobEncomenda === true && lista.find((c) => c.name === "Regatas")?.sobEncomenda === false, "a lista diz qual categoria está ligada");
    // a vendedora que salva a ficha sem mexer na chavinha NÃO leva 403
    const r2e = await api(cookieVend, "PATCH", `/api/products/${conjunto.id}`, { name: "Conjunto Linho" });
    conferir(r2e.status === 200, `vendedora salva a ficha sem o campo (${r2e.status})`);

    // ---- 3. a API de produtos resolve por variação --------------------------
    console.log("\n3) A API de produtos manda a chavinha resolvida");
    const prods = await api(cookieVend, "GET", `/api/products?q=conjunto`);
    const lidos = (prods.json as unknown as { id: string; variants: { id: string; sobEncomenda: boolean }[] }[]) ?? [];
    const pl = lidos.find((p) => p.id === conjunto.id);
    const pv = lidos.find((p) => p.id === vinculada.id);
    conferir(pl?.variants.every((v) => v.sobEncomenda === true) === true, "Conjunto Linho: todas as variações livres");
    conferir(pv?.variants.every((v) => v.sobEncomenda === true) === true, "Conjunto da loja online: livre também (pedido do dono)");
    const pj = lidos.find((p) => p.id === doJueri.id);
    conferir(pj?.variants.every((v) => v.sobEncomenda === false) === true, "Conjunto do Jueri: nenhuma");

    // ---- 4. Novo pedido passa do estoque, sem extra -------------------------
    console.log("\n4) Novo pedido: 5 do M (tem 2) e 3 do G (tem 0), sem 'estou ciente'");
    const r4 = await api(cookieVend, "POST", "/api/orders", { customerId: cliente.id, items: [item(cM, 5), item(cG, 3)] });
    conferir(r4.status === 201, `criado (${r4.status} ${r4.status !== 201 ? r4.texto.slice(0, 200) : ""})`);
    const orderId = String(r4.json?.id);
    conferir((await estoque(cM.id)) === -3 && (await estoque(cG.id)) === -3, `M −3 e G −3 (${await estoque(cM.id)}, ${await estoque(cG.id)})`);
    const saidas = await db.inventoryMovement.findMany({ where: { orderId, type: "SAIDA" } });
    conferir(saidas.find((m) => m.variantId === cM.id)?.quantity === 5 && saidas.find((m) => m.variantId === cG.id)?.quantity === 3, "o livro guarda a quantidade INTEIRA");
    const o4 = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    conferir(((await extrasDosPedidos(db, [o4])).get(orderId)?.total ?? 0) === 0, "o pedido NÃO conta extra");
    const evs = await db.orderEvent.findMany({ where: { orderId } });
    conferir(!evs.some((e) => e.description.startsWith("🧵")), "sem linha de 'extras confirmados' no histórico");
    // a regata (categoria desligada) continua travando no MESMO pedido
    const r4b = await api(cookieVend, "POST", "/api/orders", { customerId: cliente.id, items: [item(cM, 1), item(rM, 3, 25)] });
    conferir(r4b.status === 409 && (r4b.json?.extras as { variantId: string }[])?.[0]?.variantId === rM.id, `a regata ainda trava (409 só por ela) (${r4b.status})`);

    // ---- 5. a vitrine: não some, não para ----------------------------------
    console.log("\n5) Catálogo público com 'esconder sem estoque' ligado");
    const cat5 = await api(null, "GET", `/catalogo/${slug}`);
    conferir(cat5.texto.includes("Conjunto Linho"), "o conjunto negativo continua na vitrine");
    conferir(disp("Preto", "G", 9999).test(cat5.texto), "o G recebe o teto da linha (9999)");
    conferir(disp("Azul", "M", 9999).test(cat5.texto), "a peça da Nuvemshop zerada também fica à venda (teto da linha)");
    conferir(!cat5.texto.includes("Conjunto do Jueri"), "a peça do Jueri zerada some (a chavinha não vale nela)");
    conferir(!/sob encomenda/i.test(cat5.texto), "a vitrine não diz nada para a cliente");
    const r5 = await api(null, "POST", "/api/catalog/order", {
      company: slug,
      items: [{ productId: conjunto.id, color: "Preto", size: "G", quantity: 4 }],
      customer: { name: "Cliente Vitrine", phone: `5531966${String(marca).slice(-6)}` },
      clientRef: `ref-${marca}`,
    });
    conferir(r5.status === 201 || r5.status === 200, `pedido do catálogo entra (${r5.status} ${r5.status >= 300 ? r5.texto.slice(0, 200) : ""})`);
    conferir((await estoque(cG.id)) === -7, `G foi a −7 (${await estoque(cG.id)})`);
    const idCat = String(r5.json?.id ?? r5.json?.orderId);
    const evCat = await db.orderEvent.findMany({ where: { orderId: idCat } });
    conferir(!evCat.some((e) => e.description.includes("Estoque insuficiente")), "sem aviso de 'estoque insuficiente' no pedido do catálogo");

    // ---- 6. Estoque: a produzir, fora do mínimo, Dashboard ------------------
    console.log("\n6) Estoque e Dashboard");
    const { linhas } = await linhasDoEstoque(company.id);
    const lM = linhas.find((l) => l.variantId === cM.id)!;
    const lR = linhas.find((l) => l.variantId === rM.id)!;
    const lV = linhas.find((l) => l.variantId === vinculada.variants[0].id)!;
    const lJ = linhas.find((l) => l.variantId === doJueri.variants[0].id)!;
    conferir(lM.sobEncomenda && lV.sobEncomenda && !lR.sobEncomenda && !lJ.sobEncomenda, "linhas: conjunto e Nuvemshop livres; regata e Jueri não");
    conferir(lM.disponivel === -3 && lM.reservado === 5 && lM.emEstoque === 2, `M: −3 disponível, 5 reservadas, 2 na loja (${lM.disponivel}/${lM.reservado}/${lM.emEstoque})`);
    const resumo = resumirLinhas(linhas);
    conferir(resumo.aProduzir === 10 && resumo.disponiveis === 1, `a produzir 10 (3+7), disponíveis 1 (${resumo.aProduzir}/${resumo.disponiveis})`);
    // no mínimo: a regata (1 ≤ 5) e a vinculada (0 ≤ 5); o conjunto NÃO
    conferir(resumo.baixas === 2, `'no mínimo' conta 2 (regata e Jueri), não o conjunto nem a Nuvemshop (${resumo.baixas})`);
    conferir((await contarNoMinimo(company.id)) === 2, `a SQL do Dashboard concorda: 2 (${await contarNoMinimo(company.id)})`);
    const inv = await api(cookieGer, "GET", `/api/estoque/inventario?filtro=produzir`);
    const invLinhas = (inv.json?.linhas as { variantId: string }[]) ?? [];
    conferir(invLinhas.length === 2 && invLinhas.every((l) => [cM.id, cG.id].includes(l.variantId)), `o chip 'A produzir' lista só M e G (${invLinhas.length})`);
    const folha = await api(cookieGer, "GET", `/contagem-de-estoque?filtro=produzir`);
    conferir(folha.status === 200 && folha.texto.includes("Peças para produção") && folha.texto.includes("sob encomenda a produzir"), "a folha vira lista de produção com a conta do negativo");

    // ---- 7. editar para menos e cancelar: o livro devolve ------------------
    console.log("\n7) Editar para menos e cancelar");
    const r7a = await api(cookieVend, "PATCH", `/api/orders/${orderId}`, { items: [item(cM, 4), item(cG, 3)] });
    conferir(r7a.status === 200 && (await estoque(cM.id)) === -2, `M 5→4 devolve 1: −2 (${r7a.status}, ${await estoque(cM.id)})`);
    const r7b = await api(cookieVend, "PATCH", `/api/orders/${orderId}`, { items: [item(cM, 6), item(cG, 3)] });
    conferir(r7b.status === 200 && (await estoque(cM.id)) === -4, `M 4→6 baixa 2 sem perguntar: −4 (${r7b.status}, ${await estoque(cM.id)})`);
    const r7c = await api(cookieGer, "PATCH", `/api/orders/${orderId}`, { status: "CANCELADO", restock: true });
    conferir(r7c.status === 200 && (await estoque(cM.id)) === 2 && (await estoque(cG.id)) === -4, `cancelado devolvendo: M volta a 2, G a −4 (o pedido do catálogo segue) (${await estoque(cM.id)}, ${await estoque(cG.id)})`);
    const r7d = await api(cookieGer, "PATCH", `/api/orders/${orderId}`, { status: "ORCAMENTO" });
    conferir(r7d.status === 200 && (await estoque(cM.id)) === -4, `restaurado sem perguntar: M −4 (${r7d.status}, ${await estoque(cM.id)})`);

    // ---- 8. a produção cobre o negativo ------------------------------------
    console.log("\n8) A produção lançada cobre o negativo primeiro");
    // o pedido restaurado voltou a segurar 3 do G: −4 − 3 = −7; a costura
    // lança 10 e o negativo é coberto antes de sobrar peça na arara
    conferir((await estoque(cG.id)) === -7, `G está em −7 (${await estoque(cG.id)})`);
    await db.productVariant.update({ where: { id: cG.id }, data: { stock: { increment: 10 } } });
    conferir((await estoque(cG.id)) === 3, `G −7 + 10 = 3 (${await estoque(cG.id)})`);

    // ---- 9. o ajuste digitado ----------------------------------------------
    console.log("\n9) Ajuste digitado: só de 0 para cima, condicional ao visto negativo");
    const r9a = await api(cookieGer, "PATCH", `/api/estoque/variacoes/${cM.id}`, { estoque: 0, visto: -4, motivo: "Contagem" });
    conferir(r9a.status === 200 && (await estoque(cM.id)) === 0, `−4 → 0 com o visto negativo (${r9a.status} ${r9a.json?.error ?? ""})`);
    const r9b = await api(cookieGer, "PATCH", `/api/estoque/variacoes/${cM.id}`, { estoque: -2, visto: 0, motivo: "Contagem" });
    conferir(r9b.status === 400, `número negativo digitado é recusado (${r9b.status})`);

    // ---- 10. a peça desliga por cima da categoria ---------------------------
    console.log("\n10) A ficha desliga só esta peça, com a categoria ligada");
    const r10 = await api(cookieGer, "PATCH", `/api/products/${conjunto.id}`, { sobEncomenda: false });
    conferir(r10.status === 200, `desligada na ficha (${r10.status})`);
    const r10b = await api(cookieVend, "POST", "/api/orders", { customerId: cliente.id, items: [item(cM, 3)] });
    conferir(r10b.status === 409, `volta a travar (409) com M em 0 (${r10b.status})`);
    const cat10 = await api(null, "GET", `/catalogo/${slug}`);
    conferir(!disp("Preto", "M", 9999).test(cat10.texto), "a vitrine volta a parar no estoque");

    // ---- 10b. as telas abrem (a ficha da peça, o Estoque, o pedido) ---------
    console.log("\n10b) As telas que leem a chavinha abrem de verdade");
    const telaProdutos = await api(cookieGer, "GET", "/produtos");
    // a ficha é uma janela (abre no clique); o que a página manda é o dado da chavinha de cada peça
    conferir(telaProdutos.status === 200 && telaProdutos.texto.includes("categoriaSobEncomenda"), `Produtos abre com a chavinha de cada peça (${telaProdutos.status})`);
    const telaEstoque = await api(cookieGer, "GET", "/estoque?filtro=produzir");
    conferir(telaEstoque.status === 200 && telaEstoque.texto.includes("A produzir"), `Estoque abre com o chip (${telaEstoque.status})`);
    const telaPedido = await api(cookieVend, "GET", `/pedidos/${orderId}`);
    conferir(telaPedido.status === 200, `a ficha do pedido abre (${telaPedido.status})`);
    const telaDash = await api(cookieGer, "GET", "/dashboard");
    conferir(telaDash.status === 200, `o Dashboard abre (${telaDash.status})`);

    // ---- 10c. a peça da NUVEMSHOP devendo: a sync não apaga a dívida ------
    console.log("\n10c) Peça da Nuvemshop vendida sob encomenda e a sincronização");
    const vNs = vinculada.variants[0];
    const r10c = await api(cookieVend, "POST", "/api/orders", { customerId: cliente.id, items: [item(vNs, 3)] });
    conferir(r10c.status === 201, `pedido com a peça da Nuvemshop zerada entra (${r10c.status} ${r10c.status !== 201 ? r10c.texto.slice(0, 200) : ""})`);
    conferir((await estoque(vNs.id)) === -3, `fica −3 aqui (${await estoque(vNs.id)})`);
    // o envio sai no after() da rota, depois da resposta: espera ele chegar
    let naFila = 0;
    for (let i = 0; i < 40 && naFila === 0; i++) {
      naFila = await db.nuvemshopEstoquePendente.count({ where: { variantId: vNs.id } });
      if (naFila === 0) await new Promise((r) => setTimeout(r, 250));
    }
    conferir(naFila === 1, "a baixa entrou na fila de envio para a Nuvemshop");
    // a loja online confirmou o zero que mandamos: a fila esvazia
    await db.nuvemshopEstoquePendente.deleteMany({ where: { variantId: vNs.id } });
    const daLa = (n: number) => ({
      id: `ns-${marca}`,
      name: { pt: "Conjunto da Loja Online" },
      attributes: [{ pt: "Cor" }, { pt: "Tamanho" }],
      variants: [{ id: `nsv-${marca}`, sku: `CJN-AZ-M-${marca}`, price: "120", stock: n, values: [{ pt: "Azul" }, { pt: "M" }] }],
    });
    await upsertProduct(company.id, daLa(0) as never, { casadas: 0, criadas: 0, pendencias: [] });
    conferir((await estoque(vNs.id)) === -3, `sync com 0 lá NÃO apaga o −3 (${await estoque(vNs.id)})`);
    conferir((await db.nuvemshopEstoquePendente.count({ where: { variantId: vNs.id } })) === 0, "e não pede reenvio (lá já está em 0)");
    await upsertProduct(company.id, daLa(10) as never, { casadas: 0, criadas: 0, pendencias: [] });
    conferir((await estoque(vNs.id)) === 7, `10 lançadas lá cobrem a dívida: −3 + 10 = 7 (${await estoque(vNs.id)})`);
    conferir((await db.nuvemshopEstoquePendente.count({ where: { variantId: vNs.id } })) === 1, "e o 7 entra na fila para voltar à Nuvemshop");
    const mov = await db.inventoryMovement.findFirst({ where: { variantId: vNs.id, type: "AJUSTE" }, orderBy: { createdAt: "desc" } });
    conferir(mov?.reason === "Sincronização Nuvemshop (-3 → 7)" && mov.quantity === 10, `o livro conta a entrada de 10 (${mov?.reason} / ${mov?.quantity})`);
    // enquanto o 7 não chega lá, a sync seguinte (que ainda lê 10) não grava por cima
    await upsertProduct(company.id, daLa(10) as never, { casadas: 0, criadas: 0, pendencias: [] });
    conferir((await estoque(vNs.id)) === 7, `sync com o envio pendente não mexe (${await estoque(vNs.id)})`);

    // peça devendo que é ligada à Nuvemshop AGORA (primeira vez): lá nunca
    // recebeu o nosso zero, então o número de lá é dela — vale o de lá
    // (RN-050), sem descontar a dívida de peças reais da loja online
    const solta = await db.product.create({
      data: {
        companyId: company.id,
        name: "Conjunto Novo Vínculo",
        sku: `CNV-${marca}`,
        category: "Conjuntos",
        retailPrice: 120,
        wholesalePrice: 80,
        variants: { create: [{ color: "Rosa", size: "M", stock: -2, sku: `CNV-RS-M-${marca}` }] },
      },
      include: { variants: true },
    });
    await upsertProduct(
      company.id,
      {
        id: `ns2-${marca}`,
        name: { pt: "Conjunto Novo Vínculo" },
        attributes: [{ pt: "Cor" }, { pt: "Tamanho" }],
        variants: [{ id: `nsv2-${marca}`, sku: `CNV-RS-M-${marca}`, price: "120", stock: 5, values: [{ pt: "Rosa" }, { pt: "M" }] }],
      } as never,
      { casadas: 0, criadas: 0, pendencias: [] }
    );
    const sv = await db.productVariant.findUniqueOrThrow({ where: { id: solta.variants[0].id } });
    conferir(sv.nuvemshopId === `nsv2-${marca}` && sv.stock === 5, `ligada agora: vale o número de lá, 5 (${sv.nuvemshopId} / ${sv.stock})`);

    // ---- 11. renomear a categoria leva a chavinha ---------------------------
    console.log("\n11) Renomear a categoria leva a chavinha junto");
    const r11 = await api(cookieGer, "PATCH", "/api/categories", { from: "Conjuntos", to: "Kits" });
    conferir(r11.status === 200 && r11.json?.sobEncomenda === true, `Kits segue ligada (${r11.status})`);
  } finally {
    await db.company.delete({ where: { id: company.id } }).catch((e) => console.log("limpeza:", e.message));
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
