/**
 * Loja de DEMONSTRAÇÃO "Bella Moda" — para apresentar o AtacadoPro.
 *
 * ADITIVO e SEGURO: cria apenas a empresa demo (slug bella-moda-demo) e os
 * dados dela. NÃO toca em nenhuma outra loja. Pode rodar quantas vezes
 * quiser: se a demo já existir, ela é apagada e recriada zerada — e só ela
 * (há uma trava que confere se a empresa do slug é mesmo a demo antes de
 * apagar qualquer coisa).
 *
 * Rodar:  npx tsx scripts/seed-demo.ts
 *
 * Logins (senha: Demo@2026):
 *   ana@demo.bellamoda.com.br    → Administradora
 *   julia@demo.bellamoda.com.br  → Vendedora
 *   renata@demo.bellamoda.com.br → Vendedora
 * Catálogo público: /catalogo/bella-moda-demo
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

const DEMO_SLUG = "bella-moda-demo";
const DEMO_DOMAIN = "@demo.bellamoda.com.br";
const SENHA = "Demo@2026";

// gerador determinístico: a demo fica igual em qualquer banco
let rngState = 42;
function rnd() {
  rngState |= 0;
  rngState = (rngState + 0x6d2b79f5) | 0;
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <X,>(arr: X[]) => arr[Math.floor(rnd() * arr.length)];
const round2 = (v: number) => Math.round(v * 100) / 100;
/** dinheiro escrito como a lojista lê: R$ 1.374,20 */
const brl = (v: number) => `R$ ${v.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?=,))/g, ".")}`;
const entre = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));

const daysAgo = (n: number, h = 10, min?: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(h, min ?? Math.floor(rnd() * 60), 0, 0);
  return d;
};
const daysAhead = (n: number, h = 10) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(h, 0, 0, 0);
  return d;
};

async function main() {
  // ---- trava: se o slug existir, só apaga se for MESMO a demo ----
  const existente = await db.company.findUnique({
    where: { slug: DEMO_SLUG },
    include: { users: { select: { email: true } } },
  });
  if (existente) {
    const soDemo =
      existente.users.length === 0 ||
      existente.users.every((u) => u.email.endsWith(DEMO_DOMAIN));
    if (!soDemo) {
      throw new Error(
        `A empresa com slug "${DEMO_SLUG}" tem usuários que não são da demo — abortando sem tocar em nada.`
      );
    }
    console.log("Demo anterior encontrada — recriando do zero (só ela)...");
    await db.company.delete({ where: { id: existente.id } });
  }

  const company = await db.company.create({
    data: {
      name: "Bella Moda",
      slug: DEMO_SLUG,
      tagline: "Moda feminina no atacado e varejo — loja de demonstração",
      whatsapp: "5511914327650",
      productionEnabled: true,
      marketingEnabled: true,
      mediaLibraryEnabled: true,
      // Base da comissão: VENDIDO = peças − desconto + acréscimo. É a régua
      // nova (as duas opções são sem frete) e é o que a demo precisa mostrar:
      // a vendedora é remunerada pelo que realmente vendeu.
      commissionBase: "VENDIDO",
      // identidade visual (rosé) — deixa o catálogo e a Bio com a cara da marca
      catalogPrimary: "#9D2449",
      catalogSecondary: "#F6D8E0",
      catalogBg: "#FFF9FB",
      catalogFont: "poppins",
    },
  });
  const hash = await bcrypt.hash(SENHA, 10);
  const [ana, julia, renata] = await Promise.all([
    db.user.create({
      data: {
        companyId: company.id, name: "Ana Souza", email: `ana${DEMO_DOMAIN}`,
        passwordHash: hash, role: "ADMIN", color: "#7c3aed",
      },
    }),
    db.user.create({
      data: {
        companyId: company.id, name: "Júlia Ferreira", email: `julia${DEMO_DOMAIN}`,
        passwordHash: hash, role: "SELLER", color: "#f59e0b", monthlyGoal: 18000,
      },
    }),
    db.user.create({
      data: {
        companyId: company.id, name: "Renata Alves", email: `renata${DEMO_DOMAIN}`,
        passwordHash: hash, role: "SELLER", color: "#10b981", monthlyGoal: 30000,
      },
    }),
  ]);
  // perfil Suporte: gestão de pedidos e atendimento (sem telas comerciais)
  await db.user.create({
    data: {
      companyId: company.id, name: "Paula Mendes", email: `paula${DEMO_DOMAIN}`,
      passwordHash: hash, role: "SUPPORT", color: "#0ea5e9",
    },
  });
  // ---- Central de Atendimento: setores + setor padrão do número ----
  const setorVendas = await db.setor.create({
    data: { companyId: company.id, name: "Vendas", color: "#10b981", order: 0, users: { connect: [{ id: julia.id }, { id: renata.id }] } },
  });
  await db.setor.create({
    data: { companyId: company.id, name: "Financeiro", color: "#f59e0b", order: 1, users: { connect: [{ id: ana.id }] } },
  });
  // Central de Atendimento da demo.
  //
  // `evolutionInstance` fica NULO de propósito: é ele que faz o vigia
  // (lib/health.ts) e o painel de Saúde da plataforma olharem para a loja.
  // Como a demo não tem número de verdade, deixar a instância vazia impede
  // que ela vire alarme falso ("WhatsApp da Bella Moda caiu") no painel do
  // Super Admin — e a demo continua mostrando a tela conectada, com as
  // mensagens automáticas personalizadas.
  await db.commSettings.upsert({
    where: { companyId: company.id },
    update: { defaultSetorId: setorVendas.id },
    create: {
      companyId: company.id,
      defaultSetorId: setorVendas.id,
      evolutionStatus: "CONECTADO",
      evolutionPhone: "5511914327650",
      catalogLinkMsg:
        "Oi {nome}! 💗 Esse é o nosso catálogo com os preços de atacado: {link}\nQualquer dúvida é só me chamar por aqui!",
      orderMsg:
        "{nome}, seu pedido #{pedido} está montado! Total: {total} 🛍️\nAssim que o pagamento cair eu já separo tudo com carinho.",
    },
  });

  // Cobrança da PLATAFORMA sobre esta loja.
  //
  // CORTESIA de propósito: a demo não pode entrar no MRR do painel de Gestão
  // (é loja fictícia, não é receita) nem acender "loja em risco" quando o
  // Atos passa dias sem abrir a demo. Cortesia fica fora das duas contas.
  await db.companyBilling.create({
    data: {
      companyId: company.id,
      kind: "CORTESIA",
      monthlyFee: 0,
      cycle: "MENSAL",
      notes: "Loja de demonstração da plataforma — não cobrar e não contar no MRR.",
    },
  });

  const ownerId = (k: string) => ({ julia: julia.id, renata: renata.id, ana: ana.id })[k]!;
  const sellerName = (id: string) =>
    id === julia.id ? "Júlia Ferreira" : id === renata.id ? "Renata Alves" : "Ana Souza";

  // ---- tags, interesses, cores e tamanhos ----
  const tagNames: [string, string][] = [
    ["VIP", "#7c3aed"], ["Atacado", "#0ea5e9"], ["Recorrente", "#10b981"],
    ["Ticket alto", "#f59e0b"], ["Inativa", "#94a3b8"], ["Lançamentos", "#ec4899"],
  ];
  const tags = await Promise.all(
    tagNames.map(([name, color]) => db.tag.create({ data: { companyId: company.id, name, color } }))
  );
  const tagId = (n: string) => tags.find((t) => t.name === n)!.id;

  const interestNames = [
    "Vestidos", "Blusas", "Calças", "Conjuntos", "Moda fitness",
    "Moda casual", "Atacado", "Lançamentos", "Promoções",
  ];
  const interests = await Promise.all(
    interestNames.map((name) => db.interest.create({ data: { companyId: company.id, name } }))
  );
  const interestId = (n: string) => interests.find((i) => i.name === n)!.id;

  const paletteData: [string, string][] = [
    ["Preto", "#211E1D"], ["Branco", "#FAF6EF"], ["Off-white", "#F5F0E4"],
    ["Vinho", "#6E2536"], ["Rosa", "#E8A0BF"], ["Nude", "#D9B99B"],
    ["Terracota", "#BC5836"], ["Verde", "#3E7A5E"], ["Amarelo", "#E5B93C"],
    ["Azul", "#3B5F8A"], ["Lilás", "#B49BD6"], ["Bege", "#D8C9A8"], ["Laranja", "#D97435"],
  ];
  await db.companyColor.createMany({
    data: paletteData.map(([name, hex]) => ({ companyId: company.id, name, hex })),
  });
  const sizeNames = ["P", "M", "G", "GG", "36", "38", "40", "42", "Único"];
  await db.companySize.createMany({
    data: sizeNames.map((name, i) => ({ companyId: company.id, name, order: i })),
  });

  // meios de envio (Correios / Transportadora) que a loja usa nos pedidos
  await db.shippingMethod.createMany({
    data: [
      { companyId: company.id, name: "Sedex", kind: "CORREIOS", order: 0 },
      { companyId: company.id, name: "Pac", kind: "CORREIOS", order: 1 },
      { companyId: company.id, name: "Loggi", kind: "TRANSPORTADORA", order: 2 },
      { companyId: company.id, name: "Jadlog", kind: "TRANSPORTADORA", order: 3 },
    ],
  });

  // ---- funil ----
  const pipeline = await db.pipeline.create({
    data: { companyId: company.id, name: "Funil de vendas" },
  });
  const stageDefs: [string, string, boolean, boolean][] = [
    ["Novo lead", "#94a3b8", false, false],
    ["Primeiro contato", "#38bdf8", false, false],
    ["Interesse identificado", "#818cf8", false, false],
    ["Catálogo enviado", "#a78bfa", false, false],
    ["Pedido em negociação", "#f59e0b", false, false],
    ["Pagamento pendente", "#fb923c", false, false],
    ["Pedido fechado", "#10b981", true, false],
    ["Pós-venda", "#14b8a6", false, false],
    ["Perdido", "#f43f5e", false, true],
  ];
  const stages: { id: string; name: string }[] = [];
  for (let i = 0; i < stageDefs.length; i++) {
    const [name, color, isWon, isLost] = stageDefs[i];
    stages.push(
      await db.stage.create({
        data: { pipelineId: pipeline.id, name, order: i, color, isWon, isLost },
      })
    );
  }
  const stageByName = (n: string) => stages.find((s) => s.name === n)!;

  // ---- clientes ----
  type C = {
    name: string; phone: string; city: string; state: string;
    type: "VAREJO" | "ATACADO" | "REVENDEDORA" | "LOJISTA" | "BOUTIQUE" | "SACOLEIRA";
    origin: "WHATSAPP" | "CATALOGO_PUBLICO" | "INSTAGRAM" | "SITE" | "INDICACAO" | "TRAFEGO_PAGO" | "GOOGLE" | "EVENTO" | "MANUAL";
    owner: string; size?: string; colors?: string; notes?: string;
    lastContact?: number; nextContact?: number;
    tags?: string[]; interests?: string[]; createdDaysAgo?: number;
  };
  const customersData: C[] = [
    { name: "Mariana Castro", phone: "5511998761001", city: "São Paulo", state: "SP", type: "VAREJO", origin: "INSTAGRAM", owner: "julia", size: "M", colors: "Rosa, Nude", lastContact: 1, nextContact: 2, tags: ["VIP", "Recorrente"], interests: ["Vestidos", "Lançamentos"], createdDaysAgo: 210, notes: "Adora lançamentos. Sempre responde rápido no WhatsApp." },
    { name: "Loja Estilo Mix", phone: "5531997762002", city: "Belo Horizonte", state: "MG", type: "LOJISTA", origin: "INDICACAO", owner: "renata", size: "Grade completa", colors: "Cores neutras", lastContact: 3, nextContact: 1, tags: ["Atacado", "Ticket alto"], interests: ["Atacado", "Conjuntos"], createdDaysAgo: 340, notes: "Compra grade fechada todo mês. Negociar frete." },
    { name: "Fernanda Oliveira", phone: "5511996663003", city: "Campinas", state: "SP", type: "REVENDEDORA", origin: "WHATSAPP", owner: "julia", size: "P", colors: "Preto, Vermelho", lastContact: 6, nextContact: 0, tags: ["Recorrente"], interests: ["Moda fitness", "Promoções"], createdDaysAgo: 180 },
    { name: "Boutique Charme", phone: "5541995554004", city: "Curitiba", state: "PR", type: "BOUTIQUE", origin: "EVENTO", owner: "renata", size: "Grade P-GG", colors: "Tons pastel", lastContact: 12, tags: ["Atacado"], interests: ["Atacado", "Vestidos"], createdDaysAgo: 400, notes: "Conheceu a marca na feira Minas Trend." },
    { name: "Patrícia Nunes", phone: "5521994445005", city: "Rio de Janeiro", state: "RJ", type: "VAREJO", origin: "TRAFEGO_PAGO", owner: "julia", size: "G", colors: "Azul, Branco", lastContact: 20, tags: ["Inativa"], interests: ["Blusas", "Moda casual"], createdDaysAgo: 150 },
    { name: "Camila Rodrigues", phone: "5511993336006", city: "Guarulhos", state: "SP", type: "SACOLEIRA", origin: "WHATSAPP", owner: "renata", size: "Variado", colors: "Estampas", lastContact: 2, nextContact: 3, tags: ["Recorrente", "Atacado"], interests: ["Atacado", "Promoções"], createdDaysAgo: 260 },
    { name: "Vanessa Martins", phone: "5519992227007", city: "Piracicaba", state: "SP", type: "VAREJO", origin: "INSTAGRAM", owner: "julia", size: "M", colors: "Verde, Terracota", lastContact: 4, nextContact: 1, interests: ["Vestidos", "Moda casual"], createdDaysAgo: 25 },
    { name: "Loja Vitrine Chic", phone: "5548991118008", city: "Florianópolis", state: "SC", type: "LOJISTA", origin: "SITE", owner: "renata", size: "Grade completa", lastContact: 40, tags: ["Inativa", "Atacado"], interests: ["Atacado"], createdDaysAgo: 500, notes: "Parou de comprar após atraso na entrega. Recuperar!" },
    { name: "Juliana Pires", phone: "5511990009009", city: "Osasco", state: "SP", type: "VAREJO", origin: "INDICACAO", owner: "julia", size: "P", colors: "Rosa", lastContact: 0, tags: ["VIP"], interests: ["Lançamentos", "Vestidos"], createdDaysAgo: 90 },
    { name: "Sandra Regina", phone: "5562988880010", city: "Goiânia", state: "GO", type: "REVENDEDORA", origin: "WHATSAPP", owner: "renata", size: "Variado", lastContact: 5, nextContact: 2, tags: ["Recorrente"], interests: ["Moda fitness", "Atacado"], createdDaysAgo: 310 },
    { name: "Beatriz Almeida", phone: "5511987770011", city: "Santo André", state: "SP", type: "VAREJO", origin: "INSTAGRAM", owner: "julia", size: "GG", colors: "Preto", lastContact: 1, interests: ["Blusas", "Promoções"], createdDaysAgo: 6 },
    { name: "Magazine Dona Flor", phone: "5585986660012", city: "Fortaleza", state: "CE", type: "LOJISTA", origin: "EVENTO", owner: "renata", lastContact: 15, tags: ["Atacado", "Ticket alto"], interests: ["Atacado", "Conjuntos"], createdDaysAgo: 420 },
    { name: "Tainá Barbosa", phone: "5511985550013", city: "São Paulo", state: "SP", type: "VAREJO", origin: "GOOGLE", owner: "julia", size: "M", colors: "Branco, Bege", lastContact: 2, nextContact: 0, interests: ["Moda casual"], createdDaysAgo: 12 },
    { name: "Rosana Freitas", phone: "5527984440014", city: "Vitória", state: "ES", type: "SACOLEIRA", origin: "INDICACAO", owner: "renata", lastContact: 30, tags: ["Inativa"], interests: ["Promoções", "Atacado"], createdDaysAgo: 380 },
    { name: "Larissa Mendes", phone: "5511983330015", city: "São Bernardo", state: "SP", type: "VAREJO", origin: "INSTAGRAM", owner: "julia", size: "P", colors: "Lilás", lastContact: 0, nextContact: 1, interests: ["Vestidos", "Lançamentos"], createdDaysAgo: 2 },
    { name: "Cláudia Torres", phone: "5547982220016", city: "Blumenau", state: "SC", type: "BOUTIQUE", origin: "SITE", owner: "renata", lastContact: 4, nextContact: 5, tags: ["Atacado"], interests: ["Atacado", "Vestidos", "Lançamentos"], createdDaysAgo: 200 },
    { name: "Elaine Cardoso", phone: "5511981110017", city: "Mogi das Cruzes", state: "SP", type: "VAREJO", origin: "MANUAL", owner: "julia", size: "G", lastContact: 18, interests: ["Blusas", "Calças"], createdDaysAgo: 160 },
    { name: "Débora Santana", phone: "5571980000018", city: "Salvador", state: "BA", type: "REVENDEDORA", origin: "WHATSAPP", owner: "renata", lastContact: 3, nextContact: 4, tags: ["Recorrente"], interests: ["Moda fitness", "Conjuntos"], createdDaysAgo: 230 },
    { name: "Isabela Rocha", phone: "5511979990019", city: "São Paulo", state: "SP", type: "VAREJO", origin: "CATALOGO_PUBLICO", owner: "julia", size: "M", colors: "Vinho", lastContact: 8, interests: ["Vestidos"], createdDaysAgo: 45 },
    { name: "Atacadão da Moda BH", phone: "5531978880020", city: "Belo Horizonte", state: "MG", type: "ATACADO", origin: "INDICACAO", owner: "renata", lastContact: 1, nextContact: 7, tags: ["Atacado", "Ticket alto", "VIP"], interests: ["Atacado", "Promoções"], createdDaysAgo: 600, notes: "Maior cliente atacado. Pedido mínimo R$ 5.000." },
  ];
  const customers: { id: string; name: string; city: string | null; state: string | null; type: string; ownerKey: string }[] = [];
  for (const c of customersData) {
    const created = await db.customer.create({
      data: {
        companyId: company.id,
        name: c.name, phone: c.phone, city: c.city, state: c.state,
        type: c.type, origin: c.origin, ownerId: ownerId(c.owner),
        preferredSize: c.size, preferredColors: c.colors, notes: c.notes,
        lastContactAt: c.lastContact != null ? daysAgo(c.lastContact) : null,
        nextContactAt: c.nextContact != null ? daysAhead(c.nextContact) : null,
        createdAt: daysAgo(c.createdDaysAgo ?? 30),
        tags: { create: (c.tags ?? []).map((t) => ({ tagId: tagId(t) })) },
        interests: { create: (c.interests ?? []).map((i) => ({ interestId: interestId(i) })) },
      },
    });
    customers.push({ ...created, ownerKey: c.owner, type: c.type });
    await db.customerEvent.create({
      data: {
        companyId: company.id, customerId: created.id, type: "LEAD_CRIADO",
        channel: c.origin, description: "Lead criado",
        createdAt: daysAgo(c.createdDaysAgo ?? 30),
      },
    });
  }
  const cust = (name: string) => customers.find((c) => c.name === name)!;

  // ---- produtos ----
  type P = {
    name: string; sku: string; category: string; collection?: string;
    description?: string; cost: number; wholesale: number; retail: number;
    minQty?: number; image: string; colors: string[]; sizes: string[];
    stock: number; tags?: string;
    /** peso da peça em gramas — é o que o módulo Envios usa para cotar frete */
    weight: number;
  };
  const productsData: P[] = [
    { name: "Vestido Midi Aurora", sku: "VES-001", category: "Vestidos", collection: "Primavera", description: "Vestido midi em viscose com amarração na cintura.", cost: 62, wholesale: 89, retail: 149.9, minQty: 5, image: "/products/demo/vestido-aurora.svg", colors: ["Rosa", "Nude"], sizes: ["P", "M", "G"], weight: 170, stock: 18, tags: "lançamento,festa" },
    { name: "Vestido Vinho Elegance", sku: "VES-002", category: "Vestidos", collection: "Inverno", description: "Vestido em crepe com fenda discreta.", cost: 74, wholesale: 105, retail: 189.9, minQty: 5, image: "/products/demo/vestido-vinho.svg", colors: ["Vinho", "Preto"], sizes: ["P", "M", "G", "GG"], weight: 240, stock: 12, tags: "festa" },
    { name: "Blusa Tricô Nuvem", sku: "BLU-010", category: "Blusas", collection: "Inverno", description: "Tricô macio de toque acolchoado.", cost: 38, wholesale: 55, retail: 99.9, minQty: 6, image: "/products/demo/blusa-tricot.svg", colors: ["Amarelo", "Off-white"], sizes: ["P", "M", "G"], weight: 210, stock: 22 },
    { name: "Calça Wide Leg Jeans", sku: "CAL-005", category: "Calças", description: "Jeans premium de cintura alta.", cost: 68, wholesale: 92, retail: 169.9, minQty: 4, image: "/products/demo/calca-jeans.svg", colors: ["Azul"], sizes: ["36", "38", "40", "42"], weight: 620, stock: 14, tags: "básico" },
    { name: "Conjunto Fitness Power", sku: "FIT-020", category: "Moda fitness", collection: "Verão", description: "Top + legging com compressão leve.", cost: 45, wholesale: 66, retail: 119.9, minQty: 6, image: "/products/demo/conjunto-fitness.svg", colors: ["Verde", "Preto"], sizes: ["P", "M", "G"], weight: 340, stock: 26, tags: "fitness" },
    { name: "Conjunto Linho Toscana", sku: "CON-008", category: "Conjuntos", collection: "Verão", description: "Blazer + short em linho misto.", cost: 88, wholesale: 125, retail: 219.9, minQty: 4, image: "/products/demo/conjunto-linho.svg", colors: ["Lilás", "Bege"], sizes: ["P", "M", "G"], weight: 480, stock: 9, tags: "lançamento" },
    { name: "Saia Midi Plissada", sku: "SAI-003", category: "Saias", description: "Plissado fluido com cós elástico.", cost: 42, wholesale: 59, retail: 109.9, minQty: 6, image: "/products/demo/saia-midi.svg", colors: ["Laranja", "Preto"], sizes: ["Único"], weight: 260, stock: 16 },
    { name: "Cropped Básico Comfy", sku: "CRO-015", category: "Blusas", description: "Algodão penteado, modelagem justa.", cost: 18, wholesale: 27, retail: 49.9, minQty: 10, image: "/products/demo/cropped-basico.svg", colors: ["Azul", "Branco", "Preto"], sizes: ["P", "M", "G"], weight: 160, stock: 40, tags: "básico" },
  ];
  const productBySku = new Map<string, { id: string; variants: { id: string; color: string; size: string }[] }>();
  for (const p of productsData) {
    const created = await db.product.create({
      data: {
        companyId: company.id,
        name: p.name, sku: p.sku, category: p.category, brand: "Bella Moda",
        collection: p.collection, description: p.description,
        costPrice: p.cost, wholesalePrice: p.wholesale, retailPrice: p.retail,
        minQuantity: p.minQty ?? 1, tags: p.tags, weightGrams: p.weight,
        images: { create: [{ url: p.image, order: 0 }] },
        variants: {
          create: p.colors.flatMap((color) =>
            p.sizes.map((size) => ({ color, size, stock: p.stock }))
          ),
        },
      },
      include: { variants: true },
    });
    productBySku.set(p.sku, {
      id: created.id,
      variants: created.variants.map((v) => ({ id: v.id, color: v.color, size: v.size })),
    });
    await db.inventoryMovement.createMany({
      data: created.variants.map((v) => ({
        companyId: company.id, variantId: v.id,
        type: "ENTRADA" as const, quantity: v.stock, reason: "Estoque inicial",
      })),
    });
  }

  // duas variações no limite — pro alerta de estoque baixo aparecer na demo
  await db.productVariant.update({
    where: { id: productBySku.get("CON-008")!.variants[0].id },
    data: { stock: 3 },
  });
  await db.productVariant.update({
    where: { id: productBySku.get("VES-002")!.variants[1].id },
    data: { stock: 2 },
  });

  // ---- PEDIDOS: ~65 dias de movimento com crescimento (as setinhas do
  // dashboard comparam 30d atuais × 30d anteriores e devem apontar pra cima)
  const lojistas = customers.filter((c) => ["LOJISTA", "ATACADO", "BOUTIQUE", "SACOLEIRA", "REVENDEDORA"].includes(c.type));
  const varejo = customers.filter((c) => ["VAREJO"].includes(c.type));
  const PAID = ["PAGO", "EM_PRODUCAO", "SEPARACAO", "ENVIADO", "ENTREGUE"];
  let orderSeq = 0;
  const ultimaCompra = new Map<string, Date>();
  // alguns clientes compram UMA vez só — taxa de recompra realista (~75%)
  const pedidosPor = new Map<string, number>();
  const compramUmaVez = new Set(varejo.slice(0, 4).map((c) => c.id));

  for (let dia = 65; dia >= 0; dia--) {
    const data = new Date();
    data.setDate(data.getDate() - dia);
    const diaSemana = data.getDay(); // 0=dom
    const fimDeSemana = diaSemana === 0 || diaSemana === 6;
    // crescimento: período recente vende mais que o anterior
    const fator = dia > 30 ? 0.62 : 1;
    let qtdPedidos = fimDeSemana ? (rnd() < 0.35 * fator ? 1 : 0) : Math.round(entre(1, 3) * fator);
    if (dia === 0) qtdPedidos = Math.max(qtdPedidos, 1);

    for (let k = 0; k < qtdPedidos; k++) {
      orderSeq += 1;
      const atacado = rnd() < 0.45;
      let cliente = atacado ? pick(lojistas) : pick(varejo);
      if (compramUmaVez.has(cliente.id) && (pedidosPor.get(cliente.id) ?? 0) >= 1) {
        cliente = pick(varejo.filter((c) => !compramUmaVez.has(c.id)));
      }
      pedidosPor.set(cliente.id, (pedidosPor.get(cliente.id) ?? 0) + 1);
      const vendedor = ownerId(cliente.ownerKey);
      const nItens = atacado ? entre(2, 4) : entre(1, 2);
      const usados = new Set<string>();
      const lines: { sku: string; productId: string; variantId: string; name: string; image: string; color: string; size: string; qty: number; price: number; total: number }[] = [];
      for (let i = 0; i < nItens; i++) {
        const pd = pick(productsData.filter((p) => !usados.has(p.sku)));
        usados.add(pd.sku);
        const prod = productBySku.get(pd.sku)!;
        const variant = pick(prod.variants);
        const qty = atacado ? entre(pd.minQty ?? 4, (pd.minQty ?? 4) * 3) : entre(1, 2);
        const price = atacado ? pd.wholesale : pd.retail;
        lines.push({
          sku: pd.sku, productId: prod.id, variantId: variant.id, name: pd.name,
          image: pd.image, color: variant.color, size: variant.size,
          qty, price, total: Math.round(qty * price * 100) / 100,
        });
      }
      const subtotal = round2(lines.reduce((s, l) => s + l.total, 0));
      const payMethod = pick(["PIX", "PIX", "PIX", "CARTAO", "BOLETO"]) as "PIX" | "CARTAO" | "BOLETO";

      // ---- DESCONTO: no atacado sai em PORCENTAGEM (é assim que a loja
      // negocia grade fechada); no varejo é cupom de valor fixo.
      let discount = 0;
      let discountPct: number | null = null;
      if (atacado && rnd() < 0.35) {
        discountPct = pick([5, 10]);
        discount = round2((subtotal * discountPct) / 100);
      } else if (!atacado && rnd() < 0.15) {
        discount = 20; // cupom "PRIMEIRACOMPRA20"
      }

      // ---- ACRÉSCIMO: juros do cartão parcelado (%) ou taxa de urgência
      // (valor fixo). É dinheiro que FICA na loja: entra no faturamento e na
      // comissão — diferente do frete.
      let surcharge = 0;
      let surchargePct: number | null = null;
      if (payMethod === "CARTAO" && rnd() < 0.55) {
        surchargePct = 3; // parcelamento em 3x com juros
        surcharge = round2((subtotal * surchargePct) / 100);
      } else if (rnd() < 0.05) {
        surcharge = 35; // taxa de personalização/urgência
      }

      const shippingFee = rnd() < 0.5 ? entre(18, 60) : 0;
      // VALOR VENDIDO (faturamento e comissão) × TOTAL A PAGAR (com frete).
      // O frete fica FORA do valor vendido de propósito — é dinheiro da
      // transportadora atravessando a loja.
      const netTotal = round2(subtotal - discount + surcharge);
      const total = round2(netTotal + shippingFee);

      // status pela idade: antigo = entregue; recente = em andamento
      let status: string;
      if (dia > 10) status = rnd() < 0.06 ? "CANCELADO" : "ENTREGUE";
      else if (dia > 3) status = pick(["ENVIADO", "ENTREGUE", "ENTREGUE", "EM_PRODUCAO", "SEPARACAO"]);
      else status = pick(["PAGO", "PAGO", "ENVIADO", "AGUARDANDO_PAGAMENTO", "ORCAMENTO"]);
      const pago = PAID.includes(status);
      const createdAt = daysAgo(dia, entre(9, 19));
      // DATA DO DINHEIRO: o pedido é montado e o pagamento cai um pouco
      // depois. É por `paidAt` que TODA métrica de faturamento soma — sem
      // ele preenchido, a demo mostrava R$ 0,00 em toda tela de dinheiro.
      const paidAt = pago
        ? new Date(Math.min(createdAt.getTime() + entre(20, 240) * 60000, Date.now() - 60000))
        : null;

      const order = await db.order.create({
        data: {
          companyId: company.id,
          number: orderSeq,
          customerId: cliente.id,
          sellerId: vendedor,
          status: status as "PAGO",
          stockDeducted: pago,
          subtotal, discount, discountPct, surcharge, surchargePct,
          shippingFee, netTotal, total,
          createdAt, paidAt,
          items: {
            create: lines.map((l) => ({
              productId: l.productId, variantId: l.variantId, name: l.name,
              sku: l.sku, imageUrl: l.image, color: l.color, size: l.size,
              quantity: l.qty, unitPrice: l.price, total: l.total,
            })),
          },
          payments: {
            create: {
              // a cobrança é o que a cliente paga: valor vendido + frete
              method: payMethod, amount: total,
              status: pago ? "CONFIRMADO" : "PENDENTE",
              paidAt,
              createdAt,
            },
          },
          shipping: {
            create: {
              cost: shippingFee, city: cliente.city, state: cliente.state,
              method: shippingFee > 0 ? "Transportadora" : "Retirada/Combinar",
              shippedAt: ["ENVIADO", "ENTREGUE"].includes(status) ? daysAgo(Math.max(dia - 1, 0)) : null,
              deliveredAt: status === "ENTREGUE" ? daysAgo(Math.max(dia - 3, 0)) : null,
              trackingCode: ["ENVIADO", "ENTREGUE"].includes(status) ? `BR${900000 + orderSeq * 137}BM` : null,
            },
          },
          events: {
            create: [
              { type: "CRIADO", description: `Pedido criado por ${sellerName(vendedor)}`, userId: vendedor, createdAt },
              // AUDITORIA dos valores: mexer em desconto/acréscimo é decisão
              // comercial e mexe em comissão — fica registrado quem mudou e
              // de quanto para quanto (mesmo texto que a tela grava hoje).
              ...(discount > 0 || surcharge > 0
                ? [
                    {
                      type: "NOTA",
                      description:
                        `Valores alterados por ${sellerName(vendedor)}: ` +
                        [
                          discount > 0
                            ? `desconto R$ 0.00 → R$ ${discount.toFixed(2)}${discountPct ? ` (${discountPct}%)` : ""}`
                            : null,
                          surcharge > 0
                            ? `acréscimo R$ 0.00 → R$ ${surcharge.toFixed(2)}${surchargePct ? ` (${surchargePct}%)` : ""}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join("; ") +
                        `. Valor vendido R$ ${netTotal.toFixed(2)} · total a pagar R$ ${total.toFixed(2)}`,
                      userId: vendedor,
                      createdAt: new Date(createdAt.getTime() + 8 * 60000),
                    },
                  ]
                : []),
              ...(paidAt
                ? [
                    {
                      type: "PAGAMENTO",
                      description: `Pagamento confirmado (${payMethod}) — R$ ${total.toFixed(2)}`,
                      userId: vendedor,
                      createdAt: paidAt,
                    },
                  ]
                : []),
            ],
          },
        },
      });
      if (pago && paidAt) {
        await db.sale.create({
          data: {
            companyId: company.id, customerId: cliente.id, sellerId: vendedor,
            // o registro legado acompanha o VALOR VENDIDO (sem frete), igual
            // ao que a tela de pedidos grava hoje
            orderId: order.id, total: netTotal, category: atacado ? "Atacado" : "Varejo",
            description: `Pedido #${String(orderSeq).padStart(4, "0")}`, createdAt: paidAt,
          },
        });
        const atual = ultimaCompra.get(cliente.id);
        if (!atual || paidAt > atual) ultimaCompra.set(cliente.id, paidAt);
      }
    }
  }
  // ---- PEDIDOS EM ABERTO (feitos à mão para amarrarem com o resto) ----
  //
  // O sorteio acima cria o histórico. Estes três são escritos um a um porque
  // a demo precisa que eles BATAM com a conversa do WhatsApp e com o card do
  // funil: a mesma sacola, o mesmo valor, o mesmo desconto. É o que mostra
  // Financeiro (contas a receber) e a reserva de estoque do orçamento.
  type Aberto = {
    cliente: string; vendedora: string;
    status: "AGUARDANDO_PAGAMENTO" | "ORCAMENTO";
    diasAtras: number; metodo: "PIX" | "CARTAO" | "BOLETO";
    frete: number; descontoPct?: number;
    itens: { sku: string; qtd: number; atacado: boolean }[];
    nota?: string;
  };
  const abertosData: Aberto[] = [
    {
      // "sacola de 30 peças" da Camila — a mesma do funil e do WhatsApp
      cliente: "Camila Rodrigues", vendedora: "renata", status: "AGUARDANDO_PAGAMENTO",
      diasAtras: 2, metodo: "PIX", frete: 48, descontoPct: 5,
      itens: [
        { sku: "CRO-015", qtd: 12, atacado: true },
        { sku: "BLU-010", qtd: 8, atacado: true },
        { sku: "FIT-020", qtd: 6, atacado: true },
        { sku: "SAI-003", qtd: 4, atacado: true },
      ],
      nota: "Sacola sortida — 30 peças. PIX enviado pelo WhatsApp.",
    },
    {
      // conta a receber ATRASADA: 9 dias esperando o pagamento
      cliente: "Isabela Rocha", vendedora: "julia", status: "AGUARDANDO_PAGAMENTO",
      diasAtras: 9, metodo: "BOLETO", frete: 32,
      itens: [{ sku: "VES-002", qtd: 1, atacado: false }],
      nota: "Boleto vencido — cobrar de novo.",
    },
    {
      // orçamento da grade fechada: ainda em negociação e JÁ segurando estoque
      cliente: "Loja Estilo Mix", vendedora: "renata", status: "ORCAMENTO",
      diasAtras: 1, metodo: "PIX", frete: 0, descontoPct: 10,
      itens: [
        { sku: "VES-001", qtd: 20, atacado: true },
        { sku: "CON-008", qtd: 20, atacado: true },
        { sku: "BLU-010", qtd: 20, atacado: true },
        { sku: "CAL-005", qtd: 20, atacado: true },
      ],
      nota: "Grade fechada de 80 peças. Frete CIF combinado.",
    },
  ];
  // guarda o que foi criado para a conversa e o funil citarem os MESMOS valores
  const abertos = new Map<string, { id: string; numero: number; netTotal: number; total: number; frete: number }>();
  for (const a of abertosData) {
    orderSeq += 1;
    const cliente = cust(a.cliente);
    const vendedor = ownerId(a.vendedora);
    const lines = a.itens.map((i) => {
      const pd = productsData.find((p) => p.sku === i.sku)!;
      const prod = productBySku.get(i.sku)!;
      const variant = prod.variants[0];
      const price = i.atacado ? pd.wholesale : pd.retail;
      return {
        sku: i.sku, productId: prod.id, variantId: variant.id, name: pd.name,
        image: pd.image, color: variant.color, size: variant.size,
        qty: i.qtd, price, total: round2(i.qtd * price),
      };
    });
    const subtotal = round2(lines.reduce((s, l) => s + l.total, 0));
    const discount = a.descontoPct ? round2((subtotal * a.descontoPct) / 100) : 0;
    const netTotal = round2(subtotal - discount);
    const total = round2(netTotal + a.frete);
    const createdAt = daysAgo(a.diasAtras, 15);
    const order = await db.order.create({
      data: {
        companyId: company.id, number: orderSeq,
        customerId: cliente.id, sellerId: vendedor,
        status: a.status,
        // RESERVA: orçamento/aguardando já seguram a peça (é o que o sistema
        // faz de verdade). Sem prazo: só volta ao estoque se for cancelado.
        stockDeducted: true,
        subtotal, discount, discountPct: a.descontoPct ?? null,
        surcharge: 0, surchargePct: null,
        shippingFee: a.frete, netTotal, total,
        notes: a.nota, createdAt,
        items: {
          create: lines.map((l) => ({
            productId: l.productId, variantId: l.variantId, name: l.name,
            sku: l.sku, imageUrl: l.image, color: l.color, size: l.size,
            quantity: l.qty, unitPrice: l.price, total: l.total,
          })),
        },
        payments: {
          create: { method: a.metodo, amount: total, status: "PENDENTE", createdAt },
        },
        shipping: {
          create: {
            cost: a.frete, city: cliente.city, state: cliente.state,
            method: a.frete > 0 ? "Transportadora" : "Retirada/Combinar",
          },
        },
        events: {
          create: [
            { type: "CRIADO", description: `Pedido criado por ${sellerName(vendedor)}`, userId: vendedor, createdAt },
            ...(discount > 0
              ? [
                  {
                    type: "NOTA",
                    description:
                      `Valores alterados por ${sellerName(vendedor)}: desconto R$ 0.00 → R$ ${discount.toFixed(2)} (${a.descontoPct}%)` +
                      `. Valor vendido R$ ${netTotal.toFixed(2)} · total a pagar R$ ${total.toFixed(2)}`,
                    userId: vendedor,
                    createdAt: new Date(createdAt.getTime() + 6 * 60000),
                  },
                ]
              : []),
          ],
        },
      },
    });
    for (const l of lines) {
      // a demo precisa ter a peça para reservar: se o estoque inicial não
      // cobre a grade, entra uma reposição antes (senão o catálogo da
      // apresentação abriria com estoque negativo)
      const v = await db.productVariant.findUnique({
        where: { id: l.variantId },
        select: { stock: true },
      });
      if ((v?.stock ?? 0) < l.qty) {
        const repor = l.qty - (v?.stock ?? 0) + 6;
        await db.productVariant.update({
          where: { id: l.variantId },
          data: { stock: { increment: repor } },
        });
        await db.inventoryMovement.create({
          data: {
            companyId: company.id,
            variantId: l.variantId,
            type: "ENTRADA",
            quantity: repor,
            reason: "Reposição de estoque",
          },
        });
      }
      await db.productVariant.update({
        where: { id: l.variantId },
        data: { stock: { decrement: l.qty } },
      });
    }
    await db.inventoryMovement.createMany({
      data: lines.map((l) => ({
        companyId: company.id,
        variantId: l.variantId,
        orderId: order.id,
        type: "SAIDA" as const,
        quantity: l.qty,
        reason: `Reserva — pedido ${String(orderSeq).padStart(4, "0")}`,
      })),
    });
    abertos.set(a.cliente, { id: order.id, numero: orderSeq, netTotal, total, frete: a.frete });
  }

  for (const [cid, dt] of ultimaCompra) {
    await db.customer.update({ where: { id: cid }, data: { lastPurchaseAt: dt } });
  }
  console.log(`Pedidos criados: ${orderSeq}`);

  // ---- oportunidades ----
  type O = {
    customer: string; stage: string; title: string; value: number; owner: string;
    status?: "OPEN" | "WON" | "LOST"; lostReason?: string;
    lastInteraction?: number; created?: number; closed?: number;
  };
  const oppsData: O[] = [
    { customer: "Larissa Mendes", stage: "Novo lead", title: "Interesse em vestidos de festa", value: 380, owner: "julia", lastInteraction: 0, created: 2 },
    { customer: "Beatriz Almeida", stage: "Primeiro contato", title: "Viu anúncio das blusas de tricô", value: 250, owner: "julia", lastInteraction: 1, created: 6 },
    { customer: "Tainá Barbosa", stage: "Interesse identificado", title: "Look casual para trabalho", value: 420, owner: "julia", lastInteraction: 2, created: 12 },
    { customer: "Vanessa Martins", stage: "Catálogo enviado", title: "Catálogo primavera enviado", value: 560, owner: "julia", lastInteraction: 4, created: 20 },
    { customer: "Boutique Charme", stage: "Catálogo enviado", title: "Grade de vestidos — coleção nova", value: 4800, owner: "renata", lastInteraction: 6, created: 15 },
    { customer: "Loja Estilo Mix", stage: "Pedido em negociação", title: "Pedido mensal de grade completa", value: abertos.get("Loja Estilo Mix")!.netTotal, owner: "renata", lastInteraction: 1, created: 10 },
    { customer: "Sandra Regina", stage: "Pedido em negociação", title: "Kit revenda moda fitness", value: 1350, owner: "renata", lastInteraction: 2, created: 8 },
    { customer: "Camila Rodrigues", stage: "Pagamento pendente", title: "Sacola 30 peças sortidas", value: abertos.get("Camila Rodrigues")!.netTotal, owner: "renata", lastInteraction: 1, created: 6 },
    { customer: "Isabela Rocha", stage: "Pagamento pendente", title: "Vestido vinho + frete", value: abertos.get("Isabela Rocha")!.netTotal, owner: "julia", lastInteraction: 3, created: 9 },
    { customer: "Juliana Pires", stage: "Pedido fechado", title: "Lançamentos rosa — 3 peças", value: 540, owner: "julia", status: "WON", lastInteraction: 3, created: 12, closed: 3 },
    { customer: "Atacadão da Moda BH", stage: "Pedido fechado", title: "Reposição promoções inverno", value: 8900, owner: "renata", status: "WON", lastInteraction: 5, created: 18, closed: 5 },
    { customer: "Mariana Castro", stage: "Pós-venda", title: "Vestido midi lançamento", value: 320, owner: "julia", status: "WON", lastInteraction: 8, created: 16, closed: 8 },
    { customer: "Patrícia Nunes", stage: "Perdido", title: "Blusas de verão", value: 310, owner: "julia", status: "LOST", lostReason: "Achou o preço alto", lastInteraction: 20, created: 35, closed: 20 },
    { customer: "Rosana Freitas", stage: "Perdido", title: "Sacola promoções", value: 750, owner: "renata", status: "LOST", lostReason: "Parou de responder", lastInteraction: 30, created: 50, closed: 30 },
    { customer: "Fernanda Oliveira", stage: "Interesse identificado", title: "Kit fitness nova coleção", value: 890, owner: "julia", lastInteraction: 6, created: 7 },
    { customer: "Magazine Dona Flor", stage: "Primeiro contato", title: "Reativação — coleção verão", value: 6000, owner: "renata", lastInteraction: 15, created: 15 },
  ];
  for (const o of oppsData) {
    await db.opportunity.create({
      data: {
        companyId: company.id,
        customerId: cust(o.customer).id,
        stageId: stageByName(o.stage).id,
        title: o.title, value: o.value,
        status: o.status ?? "OPEN", lostReason: o.lostReason,
        ownerId: ownerId(o.owner),
        lastInteractionAt: daysAgo(o.lastInteraction ?? 0),
        createdAt: daysAgo(o.created ?? 5),
        closedAt: o.closed != null ? daysAgo(o.closed) : null,
      },
    });
  }

  // ---- tarefas ----
  type T = {
    title: string; type: "LIGAR" | "ENVIAR_CATALOGO" | "COBRAR_PAGAMENTO" | "POS_VENDA" | "REATIVAR" | "ENVIAR_NOVIDADES" | "CONFIRMAR_ENTREGA" | "FOLLOW_UP";
    customer: string; assignee: string; due: number; hour?: number;
    priority?: "BAIXA" | "MEDIA" | "ALTA";
  };
  const tasksData: T[] = [
    { title: "Responder dúvida do frete da Mariana", type: "FOLLOW_UP", customer: "Mariana Castro", assignee: "julia", due: 0, hour: 14, priority: "ALTA" },
    { title: "Fechar negociação da grade com Estilo Mix", type: "FOLLOW_UP", customer: "Loja Estilo Mix", assignee: "renata", due: 0, hour: 16, priority: "ALTA" },
    { title: "Cobrar PIX da sacola de 30 peças", type: "COBRAR_PAGAMENTO", customer: "Camila Rodrigues", assignee: "renata", due: 1, hour: 10, priority: "ALTA" },
    { title: "Primeiro atendimento da Larissa (festa P)", type: "LIGAR", customer: "Larissa Mendes", assignee: "julia", due: 0, hour: 15, priority: "ALTA" },
    { title: "Pós-venda do pedido da Juliana", type: "POS_VENDA", customer: "Juliana Pires", assignee: "julia", due: 2, hour: 10, priority: "MEDIA" },
    { title: "Enviar catálogo fitness para Fernanda", type: "ENVIAR_CATALOGO", customer: "Fernanda Oliveira", assignee: "julia", due: 0, hour: 17, priority: "MEDIA" },
    { title: "Reativar Loja Vitrine Chic (parou após atraso)", type: "REATIVAR", customer: "Loja Vitrine Chic", assignee: "renata", due: 3, hour: 10, priority: "BAIXA" },
    { title: "Confirmar entrega do Atacadão BH", type: "CONFIRMAR_ENTREGA", customer: "Atacadão da Moda BH", assignee: "renata", due: 2, hour: 9, priority: "MEDIA" },
    { title: "Catálogo enviado para Vanessa — cobrar retorno", type: "FOLLOW_UP", customer: "Vanessa Martins", assignee: "julia", due: -1, hour: 10, priority: "ALTA" },
    { title: "Retornar contato do Magazine Dona Flor", type: "FOLLOW_UP", customer: "Magazine Dona Flor", assignee: "renata", due: -2, hour: 10, priority: "MEDIA" },
  ];
  for (const t of tasksData) {
    await db.task.create({
      data: {
        companyId: company.id,
        customerId: cust(t.customer).id,
        title: t.title, type: t.type,
        dueAt: t.due >= 0 ? daysAhead(t.due, t.hour ?? 10) : daysAgo(-t.due, t.hour ?? 10),
        priority: t.priority ?? "MEDIA",
        status: "PENDENTE",
        assigneeId: ownerId(t.assignee),
      },
    });
  }

  // ---- conversas de WhatsApp ----
  //
  // A demo exercita TUDO que a Central de Atendimento sabe fazer hoje: foto,
  // áudio, documento, localização, contato compartilhado, enquete, reação,
  // resposta citando outra mensagem, mensagem editada, mensagem que a cliente
  // apagou, recibos com horário (entregue/visto), nota interna com @menção e
  // chamado esperando na FILA (sem dono).
  type M = {
    dir: "IN" | "OUT";
    body: string;
    kind?: "TEXT" | "NOTE";
    media?: "IMAGE" | "AUDIO" | "DOCUMENT" | "VIDEO";
    mediaUrl?: string;
    fileName?: string;
    minsAgo: number;
    author?: string;
    /** apelido desta mensagem, para outra poder citá-la */
    ref?: string;
    /** cita a mensagem com este apelido (resposta específica) */
    replyTo?: string;
    /** a loja editou o texto depois de enviar (WhatsApp permite ~15min) */
    edited?: boolean;
    /** apagada para todos — o conteúdo fica guardado no sistema */
    revokedBy?: "CUSTOMER" | "STORE";
    /** enviada pelo CELULAR da loja (eco): sem autor no sistema */
    doCelular?: boolean;
  };
  type Conv = {
    customer: string;
    /** vazio = chamado esperando na FILA, sem dono (modelo da Central) */
    assignee?: string;
    status: "OPEN" | "WAITING_CLIENT" | "WAITING_PAYMENT" | "CLOSED";
    unread?: number; messages: M[];
  };
  const convsData: Conv[] = [
    {
      customer: "Mariana Castro", assignee: "julia", status: "OPEN", unread: 2,
      messages: [
        { dir: "IN", body: "Oi Jú! Vi os stories do lançamento 😍", minsAgo: 60 * 26 },
        { dir: "OUT", body: "Oi Mari!! Chegou hoje, separei as peças que são a sua cara 💜", minsAgo: 60 * 25, author: "julia" },
        {
          dir: "OUT", body: "Vestido Midi Aurora na cor rosa — o tecido é uma delícia!",
          media: "IMAGE", mediaUrl: "/products/demo/vestido-aurora.svg",
          minsAgo: 60 * 25 - 2, author: "julia", ref: "foto-aurora",
        },
        // reação: o WhatsApp entrega como mensagem própria, e é assim que o
        // sistema guarda (o leitor traduz para "[reagiu ❤️]")
        { dir: "IN", body: "[reagiu ❤️]", minsAgo: 60 * 25 - 3 },
        { dir: "IN", body: "Amei!! Quanto fica com o frete?", minsAgo: 45, replyTo: "foto-aurora" },
        { dir: "IN", body: "E tem na cor nude também?", minsAgo: 40 },
      ],
    },
    {
      customer: "Loja Estilo Mix", assignee: "renata", status: "OPEN", unread: 1,
      messages: [
        { dir: "OUT", body: "Bom dia! Segue a tabela atacado atualizada da grade 📋", minsAgo: 60 * 30, author: "renata" },
        {
          dir: "OUT", body: "[arquivo] Tabela-Atacado-Bella-Moda.pdf",
          media: "DOCUMENT", fileName: "Tabela-Atacado-Bella-Moda.pdf",
          minsAgo: 60 * 30 - 1, author: "renata",
        },
        { dir: "IN", body: "Bom dia Renata! Vou analisar com a equipe e te retorno.", minsAgo: 60 * 28 },
        { dir: "OUT", body: "@Ana Souza cliente pediu prazo até sexta. Negociar frete CIF se fechar 60+ peças.", kind: "NOTE", minsAgo: 60 * 27, author: "renata" },
        {
          dir: "IN",
          body: "[localização] Loja Estilo Mix — Rua dos Tecidos, 120, Savassi https://maps.google.com/?q=-19.9245,-43.9352",
          minsAgo: 60 * 5,
        },
        {
          dir: "IN",
          body: "[contato] Marcos Prado (compras) — +55 31 99776-2100",
          minsAgo: 60 * 5 - 2,
        },
        {
          dir: "OUT",
          body:
            `Montei o orçamento da grade de 80 peças: ${brl(abertos.get("Loja Estilo Mix")!.netTotal)} ` +
            `com os 10% de desconto. Já deixei as peças reservadas no estoque 😉`,
          minsAgo: 60 * 4, author: "renata",
        },
        { dir: "IN", body: "Conseguimos fechar 80 peças se o frete for por conta de vocês. Fechado?", minsAgo: 60 * 3 },
      ],
    },
    {
      customer: "Camila Rodrigues", assignee: "renata", status: "WAITING_PAYMENT",
      messages: [
        {
          // valores tirados do pedido de verdade — a conversa, o funil e o
          // Financeiro mostram exatamente o mesmo número
          dir: "OUT",
          body:
            `Camila, sua sacola de 30 peças ficou em ${brl(abertos.get("Camila Rodrigues")!.netTotal)} ` +
            `(já com 5% de desconto) + ${brl(abertos.get("Camila Rodrigues")!.frete)} de frete = ` +
            `${brl(abertos.get("Camila Rodrigues")!.total)}. Segue o PIX 👇`,
          minsAgo: 60 * 24 * 2, author: "renata", edited: true,
        },
        { dir: "IN", body: "[áudio]", media: "AUDIO", minsAgo: 60 * 24 * 2 - 5 },
        // a cliente apagou para todos — o sistema preserva o conteúdo e diz
        // quem apagou (o WhatsApp comum simplesmente some com a mensagem)
        { dir: "IN", body: "Consigo pagar só semana que vem?", minsAgo: 60 * 24 - 40, revokedBy: "CUSTOMER" },
        { dir: "IN", body: "Recebi! Pago até amanhã sem falta 🙏", minsAgo: 60 * 24 },
        {
          // enquete criada no CELULAR da loja: chega como eco, sem autor
          dir: "OUT", doCelular: true,
          body: "[enquete] Qual cor você quer na próxima sacola?: Vinho · Preto · Off-white",
          minsAgo: 60 * 20,
        },
        { dir: "IN", body: "[voto em enquete]", minsAgo: 60 * 19 },
      ],
    },
    {
      // CHAMADO NA FILA: lead novo do Instagram, ainda sem vendedora dona
      customer: "Larissa Mendes", status: "OPEN", unread: 1,
      messages: [
        { dir: "IN", body: "Oii, vi vocês no Instagram! Vocês têm vestido de festa tam P?", minsAgo: 60 * 5 },
      ],
    },
    {
      customer: "Vanessa Martins", assignee: "julia", status: "WAITING_CLIENT",
      messages: [
        { dir: "IN", body: "Oi! Vocês vendem pra pessoa física?", minsAgo: 60 * 30 },
        {
          // exatamente a mensagem automática do botão "enviar catálogo"
          dir: "OUT",
          body: "Oi Vanessa! 💗 Esse é o nosso catálogo com os preços de atacado: https://catalago.net/bella-moda-demo?ref=julia\nQualquer dúvida é só me chamar por aqui!",
          minsAgo: 60 * 29, author: "julia",
        },
        { dir: "IN", body: "Vou dar uma olhada e te falo 😊", minsAgo: 60 * 28 },
      ],
    },
    {
      customer: "Juliana Pires", assignee: "julia", status: "CLOSED",
      messages: [
        { dir: "IN", body: "Jú, as peças chegaram! PERFEITAS como sempre 😍😍", minsAgo: 60 * 24 * 2 },
        {
          dir: "IN", body: "Olha que lindo ficou!",
          media: "IMAGE", mediaUrl: "/products/demo/conjunto-linho.svg",
          minsAgo: 60 * 24 * 2 - 3,
        },
        { dir: "OUT", body: "Aaaah que alegria!! Obrigada pela confiança de sempre, Ju! 💜", minsAgo: 60 * 24 * 2 - 10, author: "julia" },
      ],
    },
    {
      customer: "Atacadão da Moda BH", assignee: "renata", status: "CLOSED",
      messages: [
        { dir: "OUT", body: "Pedido faturado e despachado! Rastreio: BR123456789", minsAgo: 60 * 24 * 4, author: "renata" },
        { dir: "IN", body: "Show! Mês que vem tem reposição de novo 💪", minsAgo: 60 * 24 * 4 - 25 },
      ],
    },
  ];
  const quando = (minsAgo: number) => new Date(Date.now() - minsAgo * 60000);
  const convPorCliente = new Map<string, string>();
  for (const conv of convsData) {
    const msgs = conv.messages;
    const last = msgs[msgs.length - 1];
    const lastIn = [...msgs].reverse().find((m) => m.dir === "IN");
    const lastOut = [...msgs].reverse().find((m) => m.dir === "OUT" && m.kind !== "NOTE");
    const created = await db.conversation.create({
      data: {
        companyId: company.id,
        customerId: cust(conv.customer).id,
        assigneeId: conv.assignee ? ownerId(conv.assignee) : null,
        setorId: setorVendas.id,
        channel: "WHATSAPP",
        status: conv.status,
        priority: conv.unread && conv.unread > 0 ? "ALTA" : "NORMAL",
        unreadCount: conv.unread ?? 0,
        lastMessageAt: quando(last.minsAgo),
        lastInboundAt: lastIn ? quando(lastIn.minsAgo) : null,
        lastOutboundAt: lastOut ? quando(lastOut.minsAgo) : null,
      },
    });
    convPorCliente.set(conv.customer, created.id);
    const porRef = new Map<string, string>();
    for (const m of msgs) {
      const criadaEm = quando(m.minsAgo);
      const nota = m.kind === "NOTE";
      // recibos com horário: a loja vê quando a cliente RECEBEU e quando VIU
      const entregueEm = m.dir === "OUT" && !nota ? new Date(criadaEm.getTime() + 4000) : null;
      const vistaEm = m.dir === "OUT" && !nota ? new Date(criadaEm.getTime() + 90000) : null;
      const msg = await db.message.create({
        data: {
          conversationId: created.id,
          channel: "WHATSAPP",
          direction: m.dir,
          kind: nota ? "NOTE" : "TEXT",
          mediaType: m.media ?? "TEXT",
          mediaUrl: m.mediaUrl ?? null,
          fileName: m.fileName ?? null,
          body: m.body,
          replyToId: m.replyTo ? (porRef.get(m.replyTo) ?? null) : null,
          status: m.dir === "IN" ? "RECEBIDA" : nota ? "ENVIADA" : "LIDA",
          deliveredAt: entregueEm,
          readAt: vistaEm,
          editedAt: m.edited ? new Date(criadaEm.getTime() + 3 * 60000) : null,
          revoked: !!m.revokedBy,
          revokedBy: m.revokedBy ?? null,
          // mensagem enviada pelo celular da loja não tem autor no sistema
          authorId: m.author && !m.doCelular ? ownerId(m.author) : null,
          createdAt: criadaEm,
        },
      });
      if (m.ref) porRef.set(m.ref, msg.id);

      // ---- espelho na Central de Comunicação ----
      // Toda mensagem que TRAFEGA pelo WhatsApp deixa registro. Nota interna
      // não entra: ela nunca sai do sistema. Nenhum evento com erro aqui de
      // propósito — a demo tem que abrir verde ("nenhuma falha").
      if (nota) continue;
      const telefone = customersData.find((c) => c.name === conv.customer)?.phone ?? "";
      await db.commEvent.create({
        data: {
          companyId: company.id,
          channel: "WHATSAPP",
          direction: m.dir,
          type: m.dir === "IN" ? "message.received" : "message.sent",
          status: "OK",
          payload: JSON.stringify({ to: telefone, preview: m.body.slice(0, 80) }),
          durationMs: entre(180, 900),
          createdAt: criadaEm,
        },
      });
      if (m.dir === "OUT" && vistaEm) {
        await db.commEvent.create({
          data: {
            companyId: company.id,
            channel: "WHATSAPP",
            direction: "IN",
            type: "status.update",
            status: "OK",
            payload: JSON.stringify({ to: telefone, preview: "read" }),
            durationMs: entre(40, 120),
            createdAt: vistaEm,
          },
        });
      }
    }
  }

  // pedido montado DENTRO do chat: o card do pedido aparece na conversa
  for (const [nome, ped] of abertos) {
    const convId = convPorCliente.get(nome);
    if (convId) await db.order.update({ where: { id: ped.id }, data: { conversationId: convId } });
  }

  // ---- sino de notificações (menção na nota interna + chamado na fila) ----
  await db.notification.create({
    data: {
      companyId: company.id, userId: ana.id, type: "MENTION",
      title: "Renata Alves mencionou você",
      body: "@Ana Souza cliente pediu prazo até sexta. Negociar frete CIF se fechar 60+ peças.",
      actorName: "Renata Alves",
      createdAt: daysAgo(1, 11),
    },
  });
  await db.notification.create({
    data: {
      companyId: company.id, userId: julia.id, type: "ASSIGN",
      title: "Novo atendimento na fila",
      body: "Larissa Mendes está esperando na fila do setor Vendas.",
      actorName: "Central de Atendimento",
      createdAt: daysAgo(0, 9),
    },
  });

  // ---- modelos de mensagem + campanhas ----
  const templates: [string, string, string][] = [
    ["Boas-vindas", "Oi, {{nome}}! 😊 Seja bem-vinda à Bella Moda! Sou a {{vendedora}} e vou te atender. Me conta o que você procura?", "PRIMEIRO_ATENDIMENTO"],
    ["Envio de catálogo", "{{nome}}, acabei de te enviar nosso catálogo novinho 💌 Dá uma olhada e me diz quais peças você amou!", "CATALOGO"],
    ["Cobrança gentil", "Oi {{nome}}! Passando para lembrar do seu pedido que está reservado 💜 Consegue fazer o pagamento hoje?", "COBRANCA"],
    ["Pós-venda", "{{nome}}, suas peças chegaram direitinho? Quero saber se amou! 🥰", "POS_VENDA"],
    ["Reativação", "Oi {{nome}}, sentimos sua falta por aqui! 🌸 Chegaram novidades lindas. Posso te mandar?", "CLIENTE_FRIO"],
    ["Lançamento", "{{nome}}, a nova coleção CHEGOU! 🎉 Separei as peças com a sua cara. Quer ver em primeira mão?", "PROMOCAO"],
  ];
  for (const [title, body, category] of templates) {
    await db.messageTemplate.create({
      data: { companyId: company.id, title, body, category: category as "OUTRO" },
    });
  }
  await db.campaign.create({
    data: {
      companyId: company.id,
      name: "Reativação 60+ dias sem compra",
      filterJson: JSON.stringify({ inactiveDays: 60 }),
      message: "Oi {{nome}}, sentimos sua falta! 🌸 Chegaram novidades lindas com 15% OFF exclusivo. Posso te mandar o catálogo?",
      status: "ATIVA",
    },
  });
  await db.campaign.create({
    data: {
      companyId: company.id,
      name: "Lançamento verão — clientes VIP",
      filterJson: JSON.stringify({ tag: "VIP" }),
      message: "{{nome}}, a coleção VERÃO chegou! 🌞 Você tem acesso antecipado. Quer ver as peças?",
      status: "RASCUNHO",
    },
  });

  // ================= MÓDULO PRODUÇÃO =================
  await db.productionSettings.create({
    data: {
      companyId: company.id,
      tables: JSON.stringify([{ name: "Mesa 1", lengthM: 6 }, { name: "Mesa 2", lengthM: 4 }]),
      operators: JSON.stringify(["Seu Carlos", "Dona Marta"]),
      costItems: JSON.stringify([
        { name: "Corte", value: 1.2 },
        { name: "Etiqueta", value: 0.35 },
        { name: "Embalagem", value: 0.5 },
      ]),
    },
  });

  const malha = await db.fabric.create({
    data: {
      companyId: company.id, name: "Malha Canelada Premium", type: "Malha",
      supplier: "TecMalhas", grammage: 260, composition: "96% algodão 4% elastano",
      widthM: 1.6, yieldMPerKg: 2.4,
    },
  });
  const viscose = await db.fabric.create({
    data: {
      companyId: company.id, name: "Viscose Aurora", type: "Plano",
      supplier: "Fios do Sul", grammage: 140, composition: "100% viscose",
      widthM: 1.4, yieldMPerKg: 4.8,
    },
  });
  const suplex = await db.fabric.create({
    data: {
      companyId: company.id, name: "Suplex 320", type: "Malha",
      supplier: "FitTêxtil", grammage: 320, composition: "90% poliamida 10% elastano",
      widthM: 1.5, yieldMPerKg: 2.0,
    },
  });

  // rolos (remainingKg já desconta o que os cortes abaixo usaram)
  const rolo = (fabricId: string, color: string, weightKg: number, remainingKg: number, pricePerKg: number, dias: number) =>
    db.fabricRoll.create({
      data: { fabricId, color, weightKg, remainingKg, pricePerKg, arrivedAt: daysAgo(dias) },
    });
  const rMalhaPreto = await rolo(malha.id, "Preto", 30, 5, 88, 55);
  const rMalhaOff = await rolo(malha.id, "Off-white", 20, 8, 88, 55);
  const rViscRosa = await rolo(viscose.id, "Rosa", 30, 5, 96, 50);
  const rViscNude = await rolo(viscose.id, "Nude", 18, 4, 96, 50);
  const rSupPreto = await rolo(suplex.id, "Preto", 25, 3, 105, 45);
  const rSupVerde = await rolo(suplex.id, "Verde", 20, 3, 105, 45);

  // cortes fechados — o erro da projeção CAI com o tempo (motor aprendendo)
  type Corte = {
    dias: number; rolos: { roll: { id: string }; kg: number }[]; operator: string;
    mesa: string; mesaM: number; produto: string; grade: string;
    itens: { name: string; color: string; size: string; pieces: number; pieceWeightG: number }[];
    previsto?: number; base?: number; pesoPecasKg: number;
  };
  const cortesData: Corte[] = [
    { dias: 48, rolos: [{ roll: rMalhaPreto, kg: 15 }], operator: "Seu Carlos", mesa: "Mesa 1", mesaM: 6, produto: "Cropped Básico Comfy", grade: "P24 M24 G24",
      itens: [
        { name: "Cropped Básico Comfy", color: "Preto", size: "P", pieces: 24, pieceWeightG: 155 },
        { name: "Cropped Básico Comfy", color: "Preto", size: "M", pieces: 24, pieceWeightG: 165 },
        { name: "Cropped Básico Comfy", color: "Preto", size: "G", pieces: 24, pieceWeightG: 175 },
      ], pesoPecasKg: 11.88 },
    { dias: 43, rolos: [{ roll: rViscRosa, kg: 12 }], operator: "Dona Marta", mesa: "Mesa 1", mesaM: 6, produto: "Vestido Midi Aurora", grade: "P18 M19 G18",
      itens: [
        { name: "Vestido Midi Aurora", color: "Rosa", size: "P", pieces: 18, pieceWeightG: 158 },
        { name: "Vestido Midi Aurora", color: "Rosa", size: "M", pieces: 19, pieceWeightG: 165 },
        { name: "Vestido Midi Aurora", color: "Rosa", size: "G", pieces: 18, pieceWeightG: 172 },
      ], pesoPecasKg: 9.09 },
    { dias: 38, rolos: [{ roll: rSupPreto, kg: 10 }, { roll: rSupVerde, kg: 8 }], operator: "Seu Carlos", mesa: "Mesa 2", mesaM: 4, produto: "Conjunto Fitness Power", grade: "P14 M14 G14",
      itens: [
        { name: "Conjunto Fitness Power", color: "Preto", size: "M", pieces: 12, pieceWeightG: 330 },
        { name: "Conjunto Fitness Power", color: "Preto", size: "G", pieces: 11, pieceWeightG: 345 },
        { name: "Conjunto Fitness Power", color: "Verde", size: "P", pieces: 10, pieceWeightG: 318 },
        { name: "Conjunto Fitness Power", color: "Verde", size: "M", pieces: 9, pieceWeightG: 330 },
      ], pesoPecasKg: 13.9 },
    { dias: 30, rolos: [{ roll: rMalhaOff, kg: 12 }], operator: "Dona Marta", mesa: "Mesa 1", mesaM: 6, produto: "Blusa Tricô Nuvem", grade: "P16 M16 G16",
      previsto: 45, base: 1,
      itens: [
        { name: "Blusa Tricô Nuvem", color: "Off-white", size: "P", pieces: 16, pieceWeightG: 190 },
        { name: "Blusa Tricô Nuvem", color: "Off-white", size: "M", pieces: 16, pieceWeightG: 200 },
        { name: "Blusa Tricô Nuvem", color: "Off-white", size: "G", pieces: 16, pieceWeightG: 210 },
      ], pesoPecasKg: 9.6 },
    { dias: 24, rolos: [{ roll: rViscNude, kg: 14 }], operator: "Seu Carlos", mesa: "Mesa 1", mesaM: 6, produto: "Vestido Midi Aurora", grade: "P21 M21 G21",
      previsto: 66, base: 2,
      itens: [
        { name: "Vestido Midi Aurora", color: "Nude", size: "P", pieces: 21, pieceWeightG: 158 },
        { name: "Vestido Midi Aurora", color: "Nude", size: "M", pieces: 21, pieceWeightG: 165 },
        { name: "Vestido Midi Aurora", color: "Nude", size: "G", pieces: 21, pieceWeightG: 172 },
      ], pesoPecasKg: 10.4 },
    { dias: 17, rolos: [{ roll: rSupPreto, kg: 12 }], operator: "Seu Carlos", mesa: "Mesa 2", mesaM: 4, produto: "Conjunto Fitness Power", grade: "P10 M10 G9",
      previsto: 27.5, base: 2,
      itens: [
        { name: "Conjunto Fitness Power", color: "Preto", size: "P", pieces: 10, pieceWeightG: 318 },
        { name: "Conjunto Fitness Power", color: "Preto", size: "M", pieces: 10, pieceWeightG: 330 },
        { name: "Conjunto Fitness Power", color: "Preto", size: "G", pieces: 9, pieceWeightG: 345 },
      ], pesoPecasKg: 9.39 },
    { dias: 10, rolos: [{ roll: rMalhaPreto, kg: 10 }], operator: "Dona Marta", mesa: "Mesa 1", mesaM: 6, produto: "Cropped Básico Comfy", grade: "P18 M19 G18",
      previsto: 53.8, base: 3, usaSobra: true,
      itens: [
        { name: "Cropped Básico Comfy", color: "Preto", size: "P", pieces: 18, pieceWeightG: 155 },
        { name: "Cropped Básico Comfy", color: "Preto", size: "M", pieces: 19, pieceWeightG: 165 },
        { name: "Cropped Básico Comfy", color: "Preto", size: "G", pieces: 18, pieceWeightG: 175 },
      ], pesoPecasKg: 9.08 },
    { dias: 5, rolos: [{ roll: rViscRosa, kg: 13 }], operator: "Seu Carlos", mesa: "Mesa 1", mesaM: 6, produto: "Vestido Midi Aurora", grade: "P20 M20 G19",
      previsto: 58.2, base: 4,
      itens: [
        { name: "Vestido Midi Aurora", color: "Rosa", size: "P", pieces: 20, pieceWeightG: 158 },
        { name: "Vestido Midi Aurora", color: "Rosa", size: "M", pieces: 20, pieceWeightG: 165 },
        { name: "Vestido Midi Aurora", color: "Rosa", size: "G", pieces: 19, pieceWeightG: 172 },
      ], pesoPecasKg: 9.75 },
  ] as (Corte & { usaSobra?: boolean })[];

  const extras = [
    { name: "Corte", value: 1.2 },
    { name: "Etiqueta", value: 0.35 },
    { name: "Embalagem", value: 0.5 },
  ];
  const extrasTotal = extras.reduce((a, e) => a + e.value, 0);
  const priceOf = new Map([
    [rMalhaPreto.id, 88], [rMalhaOff.id, 88],
    [rViscRosa.id, 96], [rViscNude.id, 96],
    [rSupPreto.id, 105], [rSupVerde.id, 105],
  ]);

  let corteCode = 0;
  let sobraConsumidaId: string | null = null;
  const cortesCriados: { id: string; code: number; dias: number; produto: string }[] = [];
  for (const c of cortesData as (Corte & { usaSobra?: boolean })[]) {
    corteCode += 1;
    const plannedKg = c.rolos.reduce((a, r) => a + r.kg, 0) + (c.usaSobra ? 1.2 : 0);
    const usedKg = plannedKg;
    const pieces = c.itens.reduce((a, i) => a + i.pieces, 0);
    const fabricCost =
      c.rolos.reduce((a, r) => a + r.kg * (priceOf.get(r.roll.id) ?? 90), 0) +
      (c.usaSobra ? 1.2 * 88 : 0);
    const util = (c.pesoPecasKg / usedKg) * 100;
    const corte = await db.cutTicket.create({
      data: {
        companyId: company.id,
        code: corteCode,
        status: "FECHADO",
        date: daysAgo(c.dias, 8),
        operator: c.operator,
        tableName: c.mesa,
        tableLengthM: c.mesaM,
        plannedKg, usedKg,
        productName: c.produto,
        gradeInfo: c.grade,
        lengthM: Math.round(plannedKg * 2.5 * 10) / 10,
        sheets: Math.floor((plannedKg * 2.5) / c.mesaM),
        piecesFirst: pieces,
        piecesTotal: pieces,
        predictedTotal: c.previsto ?? null,
        predictedBasis: c.base ?? 0,
        errorPieces: c.previsto != null ? Math.round((pieces - c.previsto) * 10) / 10 : null,
        piecesWeightKg: c.pesoPecasKg,
        utilizationPct: Math.round(util * 10) / 10,
        wasteKg: Math.round((usedKg - c.pesoPecasKg) * 100) / 100,
        fabricCost: Math.round(fabricCost * 100) / 100,
        costItems: JSON.stringify(extras),
        costPerPiece: Math.round((fabricCost / pieces + extrasTotal) * 100) / 100,
        finalizedAt: daysAgo(c.dias, 17),
        rolls: { create: c.rolos.map((r) => ({ rollId: r.roll.id, plannedKg: r.kg })) },
        items: { create: c.itens.map((i) => ({ stage: "PRIMEIRA", ...i })) },
      },
    });
    // genealogia: corte feito a partir de sobra aponta pra sobra de origem
    if (c.usaSobra && sobraConsumidaId) {
      await db.cutTicket.update({
        where: { id: corte.id },
        data: { sourceScrapId: sobraConsumidaId },
      });
    }
    cortesCriados.push({ id: corte.id, code: corteCode, dias: c.dias, produto: c.produto });

    // sobra consumida nasce do corte 1 (ponta de rolo) — genealogia
    if (corteCode === 1) {
      const s = await db.fabricScrap.create({
        data: {
          companyId: company.id, cutId: corte.id,
          fabricName: "Malha Canelada Premium", color: "Preto", grammage: 260,
          widthM: 1.6, weightKg: 1.2, estimatedM: 2.9, value: 105.6,
          geometry: "FAIXA", quality: "BOA", status: "CONSUMIDA",
          notes: "Ponta de rolo do corte #000001",
        },
      });
      sobraConsumidaId = s.id;
    }
  }
  // aponta a sobra consumida pro corte que a reaproveitou (corte 7)
  const corte7 = cortesCriados.find((c) => c.code === 7)!;
  if (sobraConsumidaId) {
    await db.fabricScrap.update({
      where: { id: sobraConsumidaId },
      data: { usedInCutId: corte7.id },
    });
  }

  // ocorrências + sobras disponíveis/descartada
  const corte3 = cortesCriados.find((c) => c.code === 3)!;
  const corte5 = cortesCriados.find((c) => c.code === 5)!;
  await db.cutOccurrence.create({
    data: { cutId: corte3.id, type: "Furo", description: "Furo no meio do rolo verde", lostKg: 0.4, createdAt: daysAgo(38, 10) },
  });
  await db.cutOccurrence.create({
    data: { cutId: corte5.id, type: "Mancha", description: "Mancha de óleo na borda", lostKg: 0.3, createdAt: daysAgo(24, 11) },
  });
  await db.fabricScrap.create({
    data: {
      companyId: company.id, cutId: corte3.id,
      fabricName: "Suplex 320", color: "Verde", grammage: 320, widthM: 1.5,
      weightKg: 0.4, estimatedM: 0.8, value: 42,
      geometry: "RETANGULO", quality: "BOA", status: "DISPONIVEL",
      notes: "Recorte ao redor do furo",
    },
  });
  await db.fabricScrap.create({
    data: {
      companyId: company.id, cutId: corte5.id,
      fabricName: "Viscose Aurora", color: "Nude", grammage: 140, widthM: 1.4,
      weightKg: 0.9, estimatedM: 4.3, value: 86.4,
      geometry: "FAIXA", quality: "REGULAR", status: "DISPONIVEL",
      notes: "Faixa final do enfesto",
    },
  });
  await db.fabricScrap.create({
    data: {
      companyId: company.id, cutId: corte5.id,
      fabricName: "Viscose Aurora", color: "Nude", grammage: 140,
      weightKg: 0.3, value: 28.8, geometry: "RETALHOS", quality: "RUIM",
      status: "DESCARTADA", notes: "Retalhos da mancha — sem aproveitamento",
    },
  });

  // corte ABERTO de hoje (pra demo mostrar o fluxo em andamento)
  corteCode += 1;
  await db.cutTicket.create({
    data: {
      companyId: company.id,
      code: corteCode,
      status: "ABERTO",
      date: daysAgo(0, 8),
      operator: "Seu Carlos",
      tableName: "Mesa 2",
      tableLengthM: 4,
      plannedKg: 9,
      productName: "Conjunto Fitness Power",
      gradeInfo: "P8 M8 G7",
      lengthM: 18,
      sheets: 4,
      rolls: { create: [{ rollId: rSupVerde.id, plannedKg: 9 }] },
    },
  });

  // estoque de costura: cortes recentes ainda com peças na costura
  const sewing = [
    { corte: 6, name: "Conjunto Fitness Power", color: "Preto", size: "P", cut: 10, done: 10 },
    { corte: 6, name: "Conjunto Fitness Power", color: "Preto", size: "M", cut: 10, done: 10 },
    { corte: 6, name: "Conjunto Fitness Power", color: "Preto", size: "G", cut: 9, done: 9 },
    { corte: 7, name: "Cropped Básico Comfy", color: "Preto", size: "P", cut: 18, done: 12 },
    { corte: 7, name: "Cropped Básico Comfy", color: "Preto", size: "M", cut: 19, done: 12 },
    { corte: 7, name: "Cropped Básico Comfy", color: "Preto", size: "G", cut: 18, done: 6 },
    { corte: 8, name: "Vestido Midi Aurora", color: "Rosa", size: "P", cut: 20, done: 4 },
    { corte: 8, name: "Vestido Midi Aurora", color: "Rosa", size: "M", cut: 20, done: 4 },
    { corte: 8, name: "Vestido Midi Aurora", color: "Rosa", size: "G", cut: 19, done: 0 },
  ];
  for (const s of sewing) {
    const c = cortesCriados.find((x) => x.code === s.corte)!;
    await db.sewingItem.create({
      data: {
        companyId: company.id, cutId: c.id, cutCode: c.code,
        productName: s.name, color: s.color, size: s.size,
        cutPieces: s.cut, donePieces: s.done,
        createdAt: daysAgo(cortesData[s.corte - 1]?.dias ?? 5, 18),
      },
    });
  }

  // facções + lotes (ranking e custo real da facção)
  const maria = await db.sewingFaction.create({
    data: { companyId: company.id, name: "Costura da Maria", contact: "5511977770101", pricePerPiece: 4.5 },
  });
  const pontoCerto = await db.sewingFaction.create({
    data: { companyId: company.id, name: "Ponto Certo Confecções", contact: "5511977770202", pricePerPiece: 5.2 },
  });
  let loteCode = 0;
  const lote = async (
    kind: string, destination: string, factionId: string | null, status: string,
    sentDias: number, closedDias: number | null,
    items: { name: string; color: string; size: string; sent: number; good: number; defect: number }[]
  ) => {
    loteCode += 1;
    return db.sewingBatch.create({
      data: {
        companyId: company.id, code: loteCode, kind, destination,
        factionId, status,
        sentAt: daysAgo(sentDias, 9),
        closedAt: closedDias != null ? daysAgo(closedDias, 16) : null,
        items: {
          create: items.map((i) => ({
            productName: i.name, color: i.color, size: i.size,
            sent: i.sent, good: i.good, defect: i.defect,
          })),
        },
      },
    });
  };
  await lote("COSTURA", "FACCAO", maria.id, "FECHADO", 22, 15, [
    { name: "Vestido Midi Aurora", color: "Nude", size: "P", sent: 21, good: 20, defect: 1 },
    { name: "Vestido Midi Aurora", color: "Nude", size: "M", sent: 21, good: 21, defect: 0 },
    { name: "Vestido Midi Aurora", color: "Nude", size: "G", sent: 21, good: 19, defect: 1 },
  ]);
  await lote("COSTURA", "FACCAO", pontoCerto.id, "FECHADO", 16, 10, [
    { name: "Blusa Tricô Nuvem", color: "Off-white", size: "P", sent: 16, good: 15, defect: 1 },
    { name: "Blusa Tricô Nuvem", color: "Off-white", size: "M", sent: 16, good: 16, defect: 0 },
    { name: "Blusa Tricô Nuvem", color: "Off-white", size: "G", sent: 16, good: 15, defect: 1 },
  ]);
  await lote("CONSERTO", "FACCAO", maria.id, "FECHADO", 9, 6, [
    { name: "Vestido Midi Aurora", color: "Nude", size: "P", sent: 2, good: 2, defect: 0 },
  ]);
  await lote("COSTURA", "FACCAO", maria.id, "ENVIADO", 3, null, [
    { name: "Cropped Básico Comfy", color: "Preto", size: "P", sent: 12, good: 0, defect: 0 },
    { name: "Cropped Básico Comfy", color: "Preto", size: "M", sent: 12, good: 0, defect: 0 },
  ]);
  await db.defectItem.create({
    data: {
      companyId: company.id, productName: "Blusa Tricô Nuvem", color: "Off-white", size: "P",
      pieces: 1, status: "AGUARDANDO", notes: "Costura da gola torta", createdAt: daysAgo(10),
    },
  });
  await db.defectItem.create({
    data: {
      companyId: company.id, productName: "Blusa Tricô Nuvem", color: "Off-white", size: "G",
      pieces: 1, status: "AGUARDANDO", notes: "Ponto solto na barra", createdAt: daysAgo(10),
    },
  });
  await db.defectItem.create({
    data: {
      companyId: company.id, productName: "Vestido Midi Aurora", color: "Nude", size: "P",
      pieces: 2, status: "RESOLVIDA", notes: "Consertadas no lote L-000003", createdAt: daysAgo(15),
    },
  });

  // ---- Inteligência Comercial: sessões de navegação no catálogo ----
  const catalogForTracking = productsData.map((p) => ({
    id: productBySku.get(p.sku)!.id,
    name: p.name, category: p.category, colors: p.colors, sizes: p.sizes, price: p.retail,
  }));
  const campVerao = await db.trackCampaign.create({
    data: { companyId: company.id, name: "Campanha Verão", slug: "campanha-verao", channel: "instagram", ownerId: julia.id, goal: 8000 },
  });
  const campQr = await db.trackCampaign.create({
    data: { companyId: company.id, name: "QR da Vitrine", slug: "qr-vitrine", channel: "loja-fisica", goal: 3000 },
  });
  const devices = ["mobile", "mobile", "mobile", "desktop", "tablet"];
  const oses = ["Android", "iOS", "Windows", "macOS"];
  const browsers = ["Chrome", "Safari", "Instagram", "Firefox"];
  const channelPool: [string, string | null, string | null][] = [
    ["instagram", "julia", "campanha-verao"],
    ["whatsapp", "julia", null],
    ["whatsapp", "renata", null],
    ["google", null, null],
    ["loja-fisica", null, "qr-vitrine"],
    ["direto", null, null],
    ["indicacao", null, null],
    // quem veio da página de links do Instagram (Gestor de Bio): é este
    // utm_source que fecha a conta "da bio para a sacola"
    ["bio", "julia", null],
    ["bio", null, null],
  ];
  const campId = (slug: string | null) =>
    slug === "campanha-verao" ? campVerao.id : slug === "qr-vitrine" ? campQr.id : null;
  for (let i = 0; i < 80; i++) {
    const [channel, sellerKey, campSlug] = pick(channelPool);
    const started = daysAgo(Math.floor(rnd() * 30), 8 + Math.floor(rnd() * 13));
    const linkedCustomer = rnd() < 0.45 ? pick(customers.slice(0, 12)) : null;
    const visitor = await db.visitor.create({
      data: {
        companyId: company.id, customerId: linkedCustomer?.id ?? null,
        firstSeenAt: started, lastSeenAt: started, visits: 1 + Math.floor(rnd() * 3),
      },
    });
    const productsSeen = 1 + Math.floor(rnd() * 4);
    const willAddCart = rnd() < 0.5;
    const willConvert = willAddCart && rnd() < 0.5;
    const events: { type: string; productId?: string; productName?: string; category?: string; color?: string; size?: string; qty?: number; value?: number; at: Date }[] = [];
    let clock = started.getTime();
    const step = (min: number) => { clock += min * 60000; return new Date(clock); };
    events.push({ type: "page_view", at: step(0) });
    let cartValue = 0;
    const seenCats = new Set<string>();
    for (let v = 0; v < productsSeen; v++) {
      const prod = pick(catalogForTracking);
      if (!seenCats.has(prod.category)) {
        seenCats.add(prod.category);
        events.push({ type: "category_view", category: prod.category, at: step(0.5) });
      }
      const color = pick(prod.colors);
      events.push({ type: "product_view", productId: prod.id, productName: prod.name, category: prod.category, color, at: step(0.8) });
      if (willAddCart && v === 0) {
        cartValue += prod.price;
        events.push({ type: "cart_add", productId: prod.id, productName: prod.name, category: prod.category, color, size: pick(prod.sizes), qty: 1, value: cartValue, at: step(0.4) });
      }
    }
    if (willAddCart) {
      events.push({ type: "cart_open", value: cartValue, qty: 1, at: step(0.5) });
      if (willConvert) {
        events.push({ type: "checkout_start", value: cartValue, qty: 1, at: step(0.8) });
        events.push({ type: "order_submitted", value: cartValue, qty: 1, at: step(0.5) });
      } else {
        events.push({ type: "order_abandoned", value: cartValue, qty: 1, at: step(1.5) });
      }
    }
    const session = await db.trackSession.create({
      data: {
        companyId: company.id, visitorId: visitor.id,
        customerId: linkedCustomer?.id ?? null,
        ref: campSlug ?? sellerKey ?? null,
        channel,
        sellerId: sellerKey ? ownerId(sellerKey) : null,
        campaignId: campId(campSlug),
        utmSource:
          channel === "instagram" ? "instagram"
          : channel === "google" ? "google"
          : channel === "bio" ? "bio"
          : null,
        utmCampaign: campSlug ?? null,
        device: pick(devices), os: pick(oses), browser: pick(browsers),
        city: pick(["São Paulo", "Belo Horizonte", "Rio de Janeiro", "Curitiba", "Goiânia"]),
        state: pick(["SP", "MG", "RJ", "PR", "GO"]),
        country: "BR",
        startedAt: started, lastEventAt: new Date(clock),
        pages: 1 + seenCats.size, productsViewed: productsSeen,
        cartAdds: willAddCart ? 1 : 0, cartValue, converted: willConvert,
      },
    });
    await db.trackEvent.createMany({
      data: events.map((e) => ({
        companyId: company.id, sessionId: session.id, type: e.type,
        productId: e.productId, productName: e.productName, category: e.category,
        color: e.color, size: e.size, qty: e.qty, value: e.value, createdAt: e.at,
      })),
    });
  }

  // ================= MÓDULO MARKETING =================
  // Campanhas de AQUISIÇÃO — de onde vieram os clientes que compram. O
  // faturamento por campanha vem sozinho: cada pedido pago herda a campanha
  // de origem do cliente (atribuição first-touch).
  const mkCampaign = (name: string, channel: string, utmKey: string, dias: number) =>
    db.marketingCampaign.create({
      data: { companyId: company.id, name, channel, utmKey, active: true, createdAt: daysAgo(dias) },
    });
  const cInsta = await mkCampaign("Inverno no Instagram", "INSTAGRAM", "inverno-insta", 40);
  const cWpp = await mkCampaign("Frete Grátis no WhatsApp", "WHATSAPP", "frete-gratis-wpp", 35);
  const cGoogle = await mkCampaign("Google — Atacado Moda", "GOOGLE", "google-atacado", 30);
  const cMeta = await mkCampaign("Conjuntos — Meta Ads", "FACEBOOK", "conjuntos-meta", 25);

  const atribuir = async (nome: string, campId: string) =>
    db.customer.update({ where: { id: cust(nome).id }, data: { campaignId: campId } });
  for (const n of ["Mariana Castro", "Vanessa Martins", "Beatriz Almeida", "Larissa Mendes"]) await atribuir(n, cInsta.id);
  for (const n of ["Fernanda Oliveira", "Camila Rodrigues", "Sandra Regina", "Débora Santana"]) await atribuir(n, cWpp.id);
  for (const n of ["Tainá Barbosa", "Isabela Rocha"]) await atribuir(n, cGoogle.id);
  for (const n of ["Boutique Charme", "Cláudia Torres", "Magazine Dona Flor"]) await atribuir(n, cMeta.id);

  // ---- Gestor de Bio (página de links do Instagram, publicada) ----
  const bio = await db.bioPage.create({
    data: {
      companyId: company.id,
      slug: DEMO_SLUG,
      published: true,
      headline: "Bella Moda",
      tagline: "Moda feminina no atacado 💗 novidades toda semana · envio pra todo Brasil",
      views: 1284,
    },
  });
  const bioLink = (
    title: string, subtitle: string | null,
    type: "CATALOGO" | "WHATSAPP" | "SITE" | "EXTERNO",
    url: string | null, order: number, clicks: number
  ) =>
    db.bioLink.create({
      data: { bioPageId: bio.id, companyId: company.id, title, subtitle, type, url, order, clicks },
    });
  // cliques acumulados dão ~34% de aproveitamento sobre as visitas — que é
  // o que uma página de links saudável faz (antes somavam 97%, impossível)
  const linkCatalogo = await bioLink("Ver catálogo completo", "Novidades toda semana ✨", "CATALOGO", null, 0, 236);
  const linkWpp = await bioLink("Falar com uma vendedora", "Tira dúvidas e faz seu pedido", "WHATSAPP", null, 1, 118);
  const linkSite = await bioLink("Nossa loja online", "Compre no varejo com entrega", "SITE", "https://bellamoda.com.br", 2, 51);
  const linkInsta = await bioLink("Instagram @bellamoda", "Bastidores e lançamentos", "EXTERNO", "https://instagram.com/bellamoda", 3, 34);

  // ---- métricas da Bio COM DATA ----
  // Os contadores acumulados respondem "desde sempre". O filtro por período
  // (7/30 dias) lê estas linhas — sem elas, escolher "últimos 30 dias" na
  // tela mostrava zero em tudo.
  const bioViews: { bioPageId: string; companyId: string; createdAt: Date }[] = [];
  const bioClicks: { bioLinkId: string; bioPageId: string; companyId: string; createdAt: Date }[] = [];
  const pesoDosLinks: [string, number][] = [
    [linkCatalogo.id, 0.55], [linkWpp.id, 0.27], [linkSite.id, 0.11], [linkInsta.id, 0.07],
  ];
  for (let dia = 44; dia >= 0; dia--) {
    // movimento sobe no fim de semana (é quando a cliente rola o Instagram)
    const d = new Date();
    d.setDate(d.getDate() - dia);
    const fds = d.getDay() === 0 || d.getDay() === 6;
    const visitas = entre(6, fds ? 22 : 14);
    for (let v = 0; v < visitas; v++) {
      const at = daysAgo(dia, entre(8, 22));
      bioViews.push({ bioPageId: bio.id, companyId: company.id, createdAt: at });
      if (rnd() < 0.34) {
        // sorteio ponderado: o catálogo leva a maior parte dos cliques
        let r = rnd();
        const alvo = pesoDosLinks.find(([, p]) => (r -= p) <= 0)?.[0] ?? linkCatalogo.id;
        bioClicks.push({
          bioLinkId: alvo, bioPageId: bio.id, companyId: company.id,
          createdAt: new Date(at.getTime() + entre(5, 90) * 1000),
        });
      }
    }
  }
  await db.bioView.createMany({ data: bioViews });
  await db.bioClick.createMany({ data: bioClicks });

  console.log("");
  console.log("✅ Loja de demonstração criada!");
  console.log(`   Empresa: Bella Moda (slug ${DEMO_SLUG})`);
  console.log(`   Logins (senha ${SENHA}):`);
  console.log(`     ana${DEMO_DOMAIN}    → Administradora`);
  console.log(`     julia${DEMO_DOMAIN}  → Vendedora`);
  console.log(`     renata${DEMO_DOMAIN} → Vendedora`);
  console.log(`   Catálogo público: /catalogo/${DEMO_SLUG}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
