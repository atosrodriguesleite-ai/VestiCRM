/**
 * Seed de demonstração — cria a loja "Bella Moda" com equipe, clientes,
 * funil, conversas de WhatsApp, tarefas, vendas e campanhas.
 *
 * Logins (senha: demo1234):
 *   ana@bellamoda.com.br     → Administradora
 *   carla@bellamoda.com.br   → Gerente
 *   julia@bellamoda.com.br   → Vendedora
 *   renata@bellamoda.com.br  → Vendedora
 *   super@vesticrm.com.br    → Superadmin
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

const daysAgo = (n: number, h = 10) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(h, Math.floor(Math.random() * 60), 0, 0);
  return d;
};
const daysAhead = (n: number, h = 10) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(h, 0, 0, 0);
  return d;
};

async function main() {
  console.log("Limpando banco...");
  await db.$transaction([
    db.commEvent.deleteMany(),
    db.commAudit.deleteMany(),
    db.commSettings.deleteMany(),
    db.customerEvent.deleteMany(),
    db.originRule.deleteMany(),
    db.inventoryMovement.deleteMany(),
    db.orderEvent.deleteMany(),
    db.payment.deleteMany(),
    db.shipping.deleteMany(),
    db.orderItem.deleteMany(),
    db.order.deleteMany(),
    db.productImage.deleteMany(),
    db.productVariant.deleteMany(),
    db.product.deleteMany(),
    db.message.deleteMany(),
    db.conversation.deleteMany(),
    db.task.deleteMany(),
    db.sale.deleteMany(),
    db.opportunity.deleteMany(),
    db.stage.deleteMany(),
    db.pipeline.deleteMany(),
    db.customerTag.deleteMany(),
    db.customerInterest.deleteMany(),
    db.tag.deleteMany(),
    db.interest.deleteMany(),
    db.messageTemplate.deleteMany(),
    db.campaign.deleteMany(),
    db.customer.deleteMany(),
    db.user.deleteMany(),
    db.company.deleteMany(),
  ]);

  const company = await db.company.create({
    data: { name: "Bella Moda", slug: "bella-moda" },
  });
  // segunda empresa para demonstrar o isolamento multi-tenant
  const company2 = await db.company.create({
    data: { name: "Urban Style Atacado", slug: "urban-style" },
  });

  const hash = await bcrypt.hash("demo1234", 10);

  const [ana, carla, julia, renata] = await Promise.all([
    db.user.create({
      data: {
        companyId: company.id, name: "Ana Souza", email: "ana@bellamoda.com.br",
        passwordHash: hash, role: "ADMIN", color: "#7c3aed",
      },
    }),
    db.user.create({
      data: {
        companyId: company.id, name: "Carla Lima", email: "carla@bellamoda.com.br",
        passwordHash: hash, role: "MANAGER", color: "#0ea5e9",
      },
    }),
    db.user.create({
      data: {
        companyId: company.id, name: "Júlia Ferreira", email: "julia@bellamoda.com.br",
        passwordHash: hash, role: "SELLER", color: "#f59e0b",
      },
    }),
    db.user.create({
      data: {
        companyId: company.id, name: "Renata Alves", email: "renata@bellamoda.com.br",
        passwordHash: hash, role: "SELLER", color: "#10b981",
      },
    }),
  ]);
  await db.user.create({
    data: {
      companyId: company.id, name: "Super Admin", email: "super@vesticrm.com.br",
      passwordHash: hash, role: "SUPERADMIN", color: "#ef4444",
    },
  });
  await db.user.create({
    data: {
      companyId: company2.id, name: "Marcos Dias", email: "marcos@urbanstyle.com.br",
      passwordHash: hash, role: "ADMIN", color: "#334155",
    },
  });

  const tagNames: [string, string][] = [
    ["VIP", "#7c3aed"], ["Atacado", "#0ea5e9"], ["Recorrente", "#10b981"],
    ["Ticket alto", "#f59e0b"], ["Inativa", "#94a3b8"], ["Lançamentos", "#ec4899"],
  ];
  const tags = await Promise.all(
    tagNames.map(([name, color]) =>
      db.tag.create({ data: { companyId: company.id, name, color } })
    )
  );

  const interestNames = [
    "Vestidos", "Blusas", "Calças", "Conjuntos", "Moda fitness",
    "Moda casual", "Atacado", "Lançamentos", "Promoções",
  ];
  const interests = await Promise.all(
    interestNames.map((name) =>
      db.interest.create({ data: { companyId: company.id, name } })
    )
  );
  const interestId = (name: string) => interests.find((i) => i.name === name)!.id;
  const tagId = (name: string) => tags.find((t) => t.name === name)!.id;

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

  type C = {
    name: string; phone: string; city: string; state: string;
    type: "VAREJO" | "ATACADO" | "REVENDEDORA" | "LOJISTA" | "BOUTIQUE" | "SACOLEIRA";
    origin: "WHATSAPP" | "CATALOGO_PUBLICO" | "INSTAGRAM" | "FACEBOOK" | "SITE" | "NUVEMSHOP" | "BLING" | "MARKETPLACE" | "INDICACAO" | "LOJA_FISICA" | "TRAFEGO_PAGO" | "GOOGLE" | "EVENTO" | "MANUAL";
    owner: string; size?: string; colors?: string; notes?: string;
    lastPurchase?: number; lastContact?: number; nextContact?: number;
    tags?: string[]; interests?: string[]; createdDaysAgo?: number;
  };
  const ownerId = (k: string) =>
    ({ julia: julia.id, renata: renata.id, carla: carla.id, ana: ana.id })[k]!;

  const customersData: C[] = [
    { name: "Mariana Castro", phone: "5511998761001", city: "São Paulo", state: "SP", type: "VAREJO", origin: "INSTAGRAM", owner: "julia", size: "M", colors: "Rosa, Nude", lastPurchase: 8, lastContact: 1, nextContact: 2, tags: ["VIP", "Recorrente"], interests: ["Vestidos", "Lançamentos"], createdDaysAgo: 210, notes: "Adora lançamentos. Sempre responde rápido no WhatsApp." },
    { name: "Loja Estilo Mix", phone: "5531997762002", city: "Belo Horizonte", state: "MG", type: "LOJISTA", origin: "INDICACAO", owner: "renata", size: "Grade completa", colors: "Cores neutras", lastPurchase: 18, lastContact: 3, nextContact: 1, tags: ["Atacado", "Ticket alto"], interests: ["Atacado", "Conjuntos"], createdDaysAgo: 340, notes: "Compra grade fechada todo mês. Negociar frete." },
    { name: "Fernanda Oliveira", phone: "5511996663003", city: "Campinas", state: "SP", type: "REVENDEDORA", origin: "WHATSAPP", owner: "julia", size: "P", colors: "Preto, Vermelho", lastPurchase: 35, lastContact: 6, nextContact: 0, tags: ["Recorrente"], interests: ["Moda fitness", "Promoções"], createdDaysAgo: 180 },
    { name: "Boutique Charme", phone: "5541995554004", city: "Curitiba", state: "PR", type: "BOUTIQUE", origin: "EVENTO", owner: "renata", size: "Grade P-GG", colors: "Tons pastel", lastPurchase: 45, lastContact: 12, tags: ["Atacado"], interests: ["Atacado", "Vestidos"], createdDaysAgo: 400, notes: "Conheceu a marca na feira Minas Trend." },
    { name: "Patrícia Nunes", phone: "5521994445005", city: "Rio de Janeiro", state: "RJ", type: "VAREJO", origin: "TRAFEGO_PAGO", owner: "julia", size: "G", colors: "Azul, Branco", lastPurchase: 62, lastContact: 20, tags: ["Inativa"], interests: ["Blusas", "Moda casual"], createdDaysAgo: 150 },
    { name: "Camila Rodrigues", phone: "5511993336006", city: "Guarulhos", state: "SP", type: "SACOLEIRA", origin: "WHATSAPP", owner: "renata", size: "Variado", colors: "Estampas", lastPurchase: 10, lastContact: 2, nextContact: 3, tags: ["Recorrente", "Atacado"], interests: ["Atacado", "Promoções"], createdDaysAgo: 260 },
    { name: "Vanessa Martins", phone: "5519992227007", city: "Piracicaba", state: "SP", type: "VAREJO", origin: "INSTAGRAM", owner: "julia", size: "M", colors: "Verde, Terracota", lastContact: 4, nextContact: 1, interests: ["Vestidos", "Moda casual"], createdDaysAgo: 25 },
    { name: "Loja Vitrine Chic", phone: "5548991118008", city: "Florianópolis", state: "SC", type: "LOJISTA", origin: "SITE", owner: "renata", size: "Grade completa", lastPurchase: 95, lastContact: 40, tags: ["Inativa", "Atacado"], interests: ["Atacado"], createdDaysAgo: 500, notes: "Parou de comprar após atraso na entrega. Recuperar!" },
    { name: "Juliana Pires", phone: "5511990009009", city: "Osasco", state: "SP", type: "VAREJO", origin: "INDICACAO", owner: "julia", size: "P", colors: "Rosa", lastPurchase: 3, lastContact: 0, tags: ["VIP"], interests: ["Lançamentos", "Vestidos"], createdDaysAgo: 90 },
    { name: "Sandra Regina", phone: "5562988880010", city: "Goiânia", state: "GO", type: "REVENDEDORA", origin: "WHATSAPP", owner: "renata", size: "Variado", lastPurchase: 28, lastContact: 5, nextContact: 2, tags: ["Recorrente"], interests: ["Moda fitness", "Atacado"], createdDaysAgo: 310 },
    { name: "Beatriz Almeida", phone: "5511987770011", city: "Santo André", state: "SP", type: "VAREJO", origin: "INSTAGRAM", owner: "julia", size: "GG", colors: "Preto", lastContact: 1, interests: ["Blusas", "Promoções"], createdDaysAgo: 6 },
    { name: "Magazine Dona Flor", phone: "5585986660012", city: "Fortaleza", state: "CE", type: "LOJISTA", origin: "EVENTO", owner: "renata", lastPurchase: 50, lastContact: 15, tags: ["Atacado", "Ticket alto"], interests: ["Atacado", "Conjuntos"], createdDaysAgo: 420 },
    { name: "Tainá Barbosa", phone: "5511985550013", city: "São Paulo", state: "SP", type: "VAREJO", origin: "GOOGLE", owner: "julia", size: "M", colors: "Branco, Bege", lastContact: 2, nextContact: 0, interests: ["Moda casual"], createdDaysAgo: 12 },
    { name: "Rosana Freitas", phone: "5527984440014", city: "Vitória", state: "ES", type: "SACOLEIRA", origin: "INDICACAO", owner: "renata", lastPurchase: 70, lastContact: 30, tags: ["Inativa"], interests: ["Promoções", "Atacado"], createdDaysAgo: 380 },
    { name: "Larissa Mendes", phone: "5511983330015", city: "São Bernardo", state: "SP", type: "VAREJO", origin: "INSTAGRAM", owner: "julia", size: "P", colors: "Lilás", lastContact: 0, nextContact: 1, interests: ["Vestidos", "Lançamentos"], createdDaysAgo: 2 },
    { name: "Cláudia Torres", phone: "5547982220016", city: "Blumenau", state: "SC", type: "BOUTIQUE", origin: "SITE", owner: "renata", lastPurchase: 22, lastContact: 4, nextContact: 5, tags: ["Atacado"], interests: ["Atacado", "Vestidos", "Lançamentos"], createdDaysAgo: 200 },
    { name: "Elaine Cardoso", phone: "5511981110017", city: "Mogi das Cruzes", state: "SP", type: "VAREJO", origin: "MANUAL", owner: "julia", size: "G", lastPurchase: 40, lastContact: 18, interests: ["Blusas", "Calças"], createdDaysAgo: 160 },
    { name: "Débora Santana", phone: "5571980000018", city: "Salvador", state: "BA", type: "REVENDEDORA", origin: "WHATSAPP", owner: "renata", lastPurchase: 15, lastContact: 3, nextContact: 4, tags: ["Recorrente"], interests: ["Moda fitness", "Conjuntos"], createdDaysAgo: 230 },
    { name: "Isabela Rocha", phone: "5511979990019", city: "São Paulo", state: "SP", type: "VAREJO", origin: "CATALOGO_PUBLICO", owner: "julia", size: "M", colors: "Vinho", lastContact: 8, interests: ["Vestidos"], createdDaysAgo: 45 },
    { name: "Atacadão da Moda BH", phone: "5531978880020", city: "Belo Horizonte", state: "MG", type: "ATACADO", origin: "INDICACAO", owner: "renata", lastPurchase: 5, lastContact: 1, nextContact: 7, tags: ["Atacado", "Ticket alto", "VIP"], interests: ["Atacado", "Promoções"], createdDaysAgo: 600, notes: "Maior cliente atacado. Pedido mínimo R$ 5.000." },
  ];

  const customers: { id: string; name: string; city: string | null; state: string | null }[] = [];
  for (const c of customersData) {
    const created = await db.customer.create({
      data: {
        companyId: company.id,
        name: c.name,
        phone: c.phone,
        city: c.city,
        state: c.state,
        type: c.type,
        origin: c.origin,
        ownerId: ownerId(c.owner),
        preferredSize: c.size,
        preferredColors: c.colors,
        notes: c.notes,
        lastPurchaseAt: c.lastPurchase != null ? daysAgo(c.lastPurchase) : null,
        lastContactAt: c.lastContact != null ? daysAgo(c.lastContact) : null,
        nextContactAt: c.nextContact != null ? daysAhead(c.nextContact) : null,
        createdAt: daysAgo(c.createdDaysAgo ?? 30),
        tags: {
          create: (c.tags ?? []).map((t) => ({ tagId: tagId(t) })),
        },
        interests: {
          create: (c.interests ?? []).map((i) => ({ interestId: interestId(i) })),
        },
      },
    });
    customers.push(created);
  }
  const cust = (name: string) => customers.find((c) => c.name === name)!;

  // timeline de entrada (Lead Intake Engine) para cada cliente
  const originLabels: Record<string, string> = {
    WHATSAPP: "WhatsApp", CATALOGO_PUBLICO: "Catálogo Público", INSTAGRAM: "Instagram",
    FACEBOOK: "Facebook", SITE: "Site", NUVEMSHOP: "Nuvemshop", BLING: "Bling",
    MARKETPLACE: "Marketplace", INDICACAO: "Indicação", LOJA_FISICA: "Loja física",
    TRAFEGO_PAGO: "Tráfego pago", GOOGLE: "Google", EVENTO: "Evento", MANUAL: "Cadastro Manual",
  };
  for (let i = 0; i < customers.length; i++) {
    const src = customersData[i];
    await db.customerEvent.create({
      data: {
        companyId: company.id,
        customerId: customers[i].id,
        type: "LEAD_CRIADO",
        channel: src.origin,
        description:
          src.origin === "MANUAL"
            ? "Lead criado manualmente"
            : `Lead criado via ${originLabels[src.origin]}`,
        createdAt: daysAgo(src.createdDaysAgo ?? 30),
      },
    });
  }

  // clientes da segunda empresa (prova do isolamento)
  await db.customer.create({
    data: {
      companyId: company2.id, name: "Cliente da Urban Style", phone: "5511900000000",
      city: "São Paulo", state: "SP", type: "ATACADO", origin: "SITE",
    },
  });

  // ---- Oportunidades ----
  type O = {
    customer: string; stage: string; title: string; value: number;
    owner: string; status?: "OPEN" | "WON" | "LOST"; lostReason?: string;
    lastInteraction?: number; created?: number; closed?: number;
  };
  const oppsData: O[] = [
    { customer: "Larissa Mendes", stage: "Novo lead", title: "Interesse em vestidos de festa", value: 380, owner: "julia", lastInteraction: 0, created: 2 },
    { customer: "Beatriz Almeida", stage: "Primeiro contato", title: "Viu anúncio das blusas de tricô", value: 250, owner: "julia", lastInteraction: 1, created: 6 },
    { customer: "Tainá Barbosa", stage: "Interesse identificado", title: "Look casual para trabalho", value: 420, owner: "julia", lastInteraction: 2, created: 12 },
    { customer: "Vanessa Martins", stage: "Catálogo enviado", title: "Catálogo primavera enviado", value: 560, owner: "julia", lastInteraction: 4, created: 20 },
    { customer: "Boutique Charme", stage: "Catálogo enviado", title: "Grade de vestidos — coleção nova", value: 4800, owner: "renata", lastInteraction: 6, created: 15 },
    { customer: "Loja Estilo Mix", stage: "Pedido em negociação", title: "Pedido mensal de grade completa", value: 7200, owner: "renata", lastInteraction: 1, created: 10 },
    { customer: "Sandra Regina", stage: "Pedido em negociação", title: "Kit revenda moda fitness", value: 1350, owner: "renata", lastInteraction: 2, created: 8 },
    { customer: "Camila Rodrigues", stage: "Pagamento pendente", title: "Sacola 30 peças sortidas", value: 1680, owner: "renata", lastInteraction: 1, created: 6 },
    { customer: "Isabela Rocha", stage: "Pagamento pendente", title: "Vestido vinho + frete", value: 289, owner: "julia", lastInteraction: 3, created: 9 },
    { customer: "Juliana Pires", stage: "Pedido fechado", title: "Lançamentos rosa — 3 peças", value: 540, owner: "julia", status: "WON", lastInteraction: 3, created: 12, closed: 3 },
    { customer: "Atacadão da Moda BH", stage: "Pedido fechado", title: "Reposição promoções inverno", value: 8900, owner: "renata", status: "WON", lastInteraction: 5, created: 18, closed: 5 },
    { customer: "Mariana Castro", stage: "Pós-venda", title: "Vestido midi lançamento", value: 320, owner: "julia", status: "WON", lastInteraction: 8, created: 16, closed: 8 },
    { customer: "Débora Santana", stage: "Pedido fechado", title: "Conjunto fitness revenda", value: 980, owner: "renata", status: "WON", lastInteraction: 15, created: 25, closed: 15 },
    { customer: "Patrícia Nunes", stage: "Perdido", title: "Blusas de verão", value: 310, owner: "julia", status: "LOST", lostReason: "Achou o preço alto", lastInteraction: 20, created: 35, closed: 20 },
    { customer: "Loja Vitrine Chic", stage: "Perdido", title: "Grade outono", value: 5200, owner: "renata", status: "LOST", lostReason: "Problema com prazo de entrega", lastInteraction: 40, created: 60, closed: 40 },
    { customer: "Rosana Freitas", stage: "Perdido", title: "Sacola promoções", value: 750, owner: "renata", status: "LOST", lostReason: "Parou de responder", lastInteraction: 30, created: 50, closed: 30 },
    { customer: "Fernanda Oliveira", stage: "Interesse identificado", title: "Kit fitness nova coleção", value: 890, owner: "julia", lastInteraction: 6, created: 7 },
    { customer: "Magazine Dona Flor", stage: "Primeiro contato", title: "Reativação — coleção verão", value: 6000, owner: "renata", lastInteraction: 15, created: 15 },
  ];
  const opportunities: { id: string }[] = [];
  for (const o of oppsData) {
    opportunities.push(
      await db.opportunity.create({
        data: {
          companyId: company.id,
          customerId: cust(o.customer).id,
          stageId: stageByName(o.stage).id,
          title: o.title,
          value: o.value,
          status: o.status ?? "OPEN",
          lostReason: o.lostReason,
          ownerId: ownerId(o.owner),
          lastInteractionAt: daysAgo(o.lastInteraction ?? 0),
          createdAt: daysAgo(o.created ?? 5),
          closedAt: o.closed != null ? daysAgo(o.closed) : null,
        },
      })
    );
  }

  // ---- Vendas (últimos ~90 dias, para relatórios) ----
  type S = { customer: string; seller: string; total: number; category: string; days: number; desc?: string };
  const salesData: S[] = [
    { customer: "Juliana Pires", seller: "julia", total: 540, category: "Vestidos", days: 3 },
    { customer: "Atacadão da Moda BH", seller: "renata", total: 8900, category: "Atacado", days: 5 },
    { customer: "Mariana Castro", seller: "julia", total: 320, category: "Vestidos", days: 8 },
    { customer: "Camila Rodrigues", seller: "renata", total: 1450, category: "Atacado", days: 10 },
    { customer: "Débora Santana", seller: "renata", total: 980, category: "Moda fitness", days: 15 },
    { customer: "Loja Estilo Mix", seller: "renata", total: 6800, category: "Atacado", days: 18 },
    { customer: "Cláudia Torres", seller: "renata", total: 3900, category: "Vestidos", days: 22 },
    { customer: "Sandra Regina", seller: "renata", total: 1100, category: "Moda fitness", days: 28 },
    { customer: "Fernanda Oliveira", seller: "julia", total: 680, category: "Moda fitness", days: 35 },
    { customer: "Elaine Cardoso", seller: "julia", total: 410, category: "Blusas", days: 40 },
    { customer: "Boutique Charme", seller: "renata", total: 5200, category: "Atacado", days: 45 },
    { customer: "Magazine Dona Flor", seller: "renata", total: 7400, category: "Atacado", days: 50 },
    { customer: "Patrícia Nunes", seller: "julia", total: 290, category: "Blusas", days: 62 },
    { customer: "Rosana Freitas", seller: "renata", total: 850, category: "Promoções", days: 70 },
    { customer: "Mariana Castro", seller: "julia", total: 460, category: "Conjuntos", days: 75 },
    { customer: "Loja Vitrine Chic", seller: "renata", total: 4100, category: "Atacado", days: 95 },
    { customer: "Juliana Pires", seller: "julia", total: 380, category: "Lançamentos", days: 55 },
    { customer: "Atacadão da Moda BH", seller: "renata", total: 9500, category: "Atacado", days: 80 },
  ];
  for (const s of salesData) {
    await db.sale.create({
      data: {
        companyId: company.id,
        customerId: cust(s.customer).id,
        sellerId: ownerId(s.seller),
        total: s.total,
        category: s.category,
        description: s.desc,
        createdAt: daysAgo(s.days),
      },
    });
  }

  // ---- Conversas de WhatsApp ----
  type M = { dir: "IN" | "OUT"; body: string; kind?: "TEXT" | "NOTE"; minsAgo: number; author?: string };
  type Conv = {
    customer: string; assignee: string;
    status: "OPEN" | "WAITING_CLIENT" | "WAITING_PAYMENT" | "CLOSED";
    unread?: number; messages: M[];
  };
  const convsData: Conv[] = [
    {
      customer: "Mariana Castro", assignee: "julia", status: "OPEN", unread: 2,
      messages: [
        { dir: "IN", body: "Oi Jú! Vi os stories do lançamento 😍", minsAgo: 60 * 26 },
        { dir: "OUT", body: "Oi Mari!! Chegou hoje, separei as peças que são a sua cara 💜", minsAgo: 60 * 25, author: "julia" },
        { dir: "OUT", body: "Vou te mandar as fotos do vestido midi rosa, tem no M!", minsAgo: 60 * 25, author: "julia" },
        { dir: "IN", body: "Amei!! Quanto fica com o frete?", minsAgo: 45 },
        { dir: "IN", body: "E tem na cor nude também?", minsAgo: 40 },
      ],
    },
    {
      customer: "Loja Estilo Mix", assignee: "renata", status: "OPEN", unread: 1,
      messages: [
        { dir: "OUT", body: "Bom dia! Segue a tabela atacado atualizada da grade de outubro 📋", minsAgo: 60 * 30, author: "renata" },
        { dir: "IN", body: "Bom dia Renata! Vou analisar com a equipe e te retorno.", minsAgo: 60 * 28 },
        { dir: "OUT", body: "Nota: cliente pediu prazo até sexta. Negociar frete CIF se fechar 60+ peças.", kind: "NOTE", minsAgo: 60 * 27, author: "renata" },
        { dir: "IN", body: "Conseguimos fechar 80 peças se o frete for por conta de vocês. Fechado?", minsAgo: 60 * 3 },
      ],
    },
    {
      customer: "Camila Rodrigues", assignee: "renata", status: "WAITING_PAYMENT",
      messages: [
        { dir: "OUT", body: "Camila, seu pedido de 30 peças ficou em R$ 1.680. Segue o PIX 👇", minsAgo: 60 * 24 * 2, author: "renata" },
        { dir: "OUT", body: "pix@bellamoda.com.br — qualquer coisa me chama!", minsAgo: 60 * 24 * 2, author: "renata" },
        { dir: "IN", body: "Recebi! Pago até amanhã sem falta 🙏", minsAgo: 60 * 24 },
      ],
    },
    {
      customer: "Vanessa Martins", assignee: "julia", status: "WAITING_CLIENT",
      messages: [
        { dir: "IN", body: "Oi! Queria ver opções de vestido para um casamento de dia", minsAgo: 60 * 24 * 5 },
        { dir: "OUT", body: "Que legal, Vanessa! Te mandei nosso catálogo de festa 💌 Qualquer dúvida me chama!", minsAgo: 60 * 24 * 4, author: "julia" },
      ],
    },
    {
      customer: "Boutique Charme", assignee: "renata", status: "WAITING_CLIENT",
      messages: [
        { dir: "OUT", body: "Oi! Enviei a grade da coleção nova com condições especiais para boutique 😉", minsAgo: 60 * 24 * 6, author: "renata" },
        { dir: "IN", body: "Recebi, obrigada! Vou ver com a sócia.", minsAgo: 60 * 24 * 6 },
      ],
    },
    {
      customer: "Larissa Mendes", assignee: "julia", status: "OPEN", unread: 1,
      messages: [
        { dir: "IN", body: "Oii, vi vocês no Instagram! Vocês têm vestido de festa tam P?", minsAgo: 60 * 5 },
      ],
    },
    {
      customer: "Juliana Pires", assignee: "julia", status: "CLOSED",
      messages: [
        { dir: "IN", body: "Jú, as peças chegaram! PERFEITAS como sempre 😍😍", minsAgo: 60 * 24 * 2 },
        { dir: "OUT", body: "Aaaah que alegria!! Obrigada pela confiança de sempre, Ju! 💜", minsAgo: 60 * 24 * 2, author: "julia" },
        { dir: "OUT", body: "Cliente super satisfeita. Candidata a embaixadora da marca!", kind: "NOTE", minsAgo: 60 * 24 * 2, author: "julia" },
      ],
    },
    {
      customer: "Atacadão da Moda BH", assignee: "renata", status: "CLOSED",
      messages: [
        { dir: "OUT", body: "Pedido faturado e despachado! Rastreio: BR123456789", minsAgo: 60 * 24 * 4, author: "renata" },
        { dir: "IN", body: "Show! Mês que vem tem reposição de novo 💪", minsAgo: 60 * 24 * 4 },
      ],
    },
    {
      customer: "Isabela Rocha", assignee: "julia", status: "WAITING_PAYMENT",
      messages: [
        { dir: "IN", body: "Fiquei com o vestido vinho! Como pago?", minsAgo: 60 * 24 * 3 },
        { dir: "OUT", body: "Ótima escolha! 😍 PIX ou cartão em até 3x. Total R$ 289 com frete.", minsAgo: 60 * 24 * 3, author: "julia" },
      ],
    },
    {
      customer: "Magazine Dona Flor", assignee: "renata", status: "WAITING_CLIENT",
      messages: [
        { dir: "OUT", body: "Oi! Sentimos sua falta 🌸 A coleção verão chegou com condições especiais para lojistas. Posso te mandar?", minsAgo: 60 * 24 * 15, author: "renata" },
      ],
    },
  ];
  for (const conv of convsData) {
    const msgs = conv.messages;
    const last = msgs[msgs.length - 1];
    const lastIn = [...msgs].reverse().find((m) => m.dir === "IN");
    const lastOut = [...msgs].reverse().find((m) => m.dir === "OUT" && m.kind !== "NOTE");
    const created = await db.conversation.create({
      data: {
        companyId: company.id,
        customerId: cust(conv.customer).id,
        assigneeId: ownerId(conv.assignee),
        channel: "WHATSAPP",
        status: conv.status,
        priority: conv.unread && conv.unread > 0 ? "ALTA" : "NORMAL",
        unreadCount: conv.unread ?? 0,
        lastMessageAt: new Date(Date.now() - last.minsAgo * 60000),
        lastInboundAt: lastIn ? new Date(Date.now() - lastIn.minsAgo * 60000) : null,
        lastOutboundAt: lastOut ? new Date(Date.now() - lastOut.minsAgo * 60000) : null,
      },
    });
    for (const m of msgs) {
      await db.message.create({
        data: {
          conversationId: created.id,
          channel: "WHATSAPP",
          direction: m.dir,
          kind: m.kind ?? "TEXT",
          body: m.body,
          status:
            m.dir === "IN"
              ? "RECEBIDA"
              : m.kind === "NOTE"
                ? "ENVIADA"
                : "LIDA",
          externalId: m.dir === "OUT" && m.kind !== "NOTE" ? `wamid.seed.${Math.random().toString(36).slice(2, 10)}` : null,
          authorId: m.author ? ownerId(m.author) : null,
          createdAt: new Date(Date.now() - m.minsAgo * 60000),
        },
      });
    }
  }

  // eventos da Communication Engine (para o monitor)
  const commEventsData = [
    { direction: "IN", type: "message.received", status: "OK", payload: { phone: "5511998761001", preview: "E tem na cor nude também?" }, durationMs: 38, minsAgo: 40 },
    { direction: "OUT", type: "message.sent", status: "OK", payload: { provider: "Mock (simulado)", to: "5531997762002", preview: "Bom dia! Segue a tabela atacado..." }, response: { externalId: "mock.whatsapp.seed1" }, durationMs: 112, minsAgo: 60 * 3 },
    { direction: "IN", type: "status.update", status: "OK", payload: { externalId: "mock.whatsapp.seed1", status: "LIDA" }, durationMs: 9, minsAgo: 60 * 2 },
    { direction: "OUT", type: "message.sent", status: "ERRO", payload: { provider: "Mock (simulado)", to: "5511979990019", preview: "Segue o link de pagamento" }, error: "Falha simulada pelo Mock Provider", durationMs: 205, minsAgo: 60 * 5 },
    { direction: "IN", type: "webhook.error", status: "ERRO", payload: { raw: "{ payload inválido…" }, error: "Assinatura X-Hub-Signature-256 inválida (simulado)", durationMs: 4, attempts: 3, minsAgo: 60 * 8 },
  ];
  for (const e of commEventsData) {
    await db.commEvent.create({
      data: {
        companyId: company.id,
        channel: "WHATSAPP",
        direction: e.direction,
        type: e.type,
        status: e.status,
        payload: JSON.stringify(e.payload),
        response: "response" in e && e.response ? JSON.stringify(e.response) : null,
        error: "error" in e ? (e.error as string) : null,
        durationMs: e.durationMs,
        attempts: "attempts" in e ? (e.attempts as number) : 1,
        createdAt: new Date(Date.now() - e.minsAgo * 60000),
      },
    });
  }

  // ---- Modelos de mensagem (por categoria) ----
  const templates: [string, string, string][] = [
    ["Boas-vindas", "Oi, {{nome}}! 😊 Seja bem-vinda à Bella Moda! Sou a {{vendedora}} e vou te atender. Me conta o que você procura?", "PRIMEIRO_ATENDIMENTO"],
    ["Envio de catálogo", "{{nome}}, acabei de te enviar nosso catálogo novinho 💌 Dá uma olhada e me diz quais peças você amou!", "CATALOGO"],
    ["Cobrança gentil", "Oi {{nome}}! Passando para lembrar do seu pedido que está reservado 💜 Consegue fazer o pagamento hoje? Qualquer dificuldade me avisa!", "COBRANCA"],
    ["Pós-venda", "{{nome}}, suas peças chegaram direitinho? Quero saber se amou! Qualquer ajuste estamos à disposição 🥰", "POS_VENDA"],
    ["Sugestão de recompra", "{{nome}}, faz um tempinho que você levou peças lindas com a gente! Chegou reposição e novidades — quer que eu separe algo no seu tamanho? 💜", "RECOMPRA"],
    ["Reativação", "Oi {{nome}}, sentimos sua falta por aqui! 🌸 Chegaram novidades lindas que têm tudo a ver com você. Posso te mandar?", "CLIENTE_FRIO"],
    ["Lançamento", "{{nome}}, a nova coleção CHEGOU! 🎉 Separei as peças com a sua cara antes de divulgar para todo mundo. Quer ver em primeira mão?", "PROMOCAO"],
    ["Feliz aniversário", "{{nome}}, feliz aniversário! 🎂💜 Para comemorar, você ganhou 15% OFF em qualquer peça esta semana. Aproveita, é só sua!", "ANIVERSARIO"],
  ];
  for (const [title, body, category] of templates) {
    await db.messageTemplate.create({
      data: {
        companyId: company.id,
        title,
        body,
        category: category as "OUTRO",
      },
    });
  }

  // ---- Tarefas ----
  type T = {
    title: string; type: "LIGAR" | "ENVIAR_CATALOGO" | "COBRAR_PAGAMENTO" | "POS_VENDA" | "REATIVAR" | "ENVIAR_NOVIDADES" | "CONFIRMAR_ENTREGA" | "FOLLOW_UP";
    customer: string; assignee: string; due: number; hour?: number;
    priority?: "BAIXA" | "MEDIA" | "ALTA"; status?: "PENDENTE" | "CONCLUIDA";
  };
  const tasksData: T[] = [
    { title: "Responder dúvida do frete da Mariana", type: "FOLLOW_UP", customer: "Mariana Castro", assignee: "julia", due: 0, hour: 14, priority: "ALTA" },
    { title: "Fechar negociação da grade com Estilo Mix", type: "FOLLOW_UP", customer: "Loja Estilo Mix", assignee: "renata", due: 0, hour: 16, priority: "ALTA" },
    { title: "Cobrar PIX da sacola de 30 peças", type: "COBRAR_PAGAMENTO", customer: "Camila Rodrigues", assignee: "renata", due: 1, hour: 10, priority: "ALTA" },
    { title: "Cobrar pagamento do vestido vinho", type: "COBRAR_PAGAMENTO", customer: "Isabela Rocha", assignee: "julia", due: 1, hour: 11, priority: "MEDIA" },
    { title: "Perguntar se a Boutique Charme viu a grade", type: "FOLLOW_UP", customer: "Boutique Charme", assignee: "renata", due: 1, hour: 15, priority: "MEDIA" },
    { title: "Primeiro atendimento da Larissa (festa P)", type: "LIGAR", customer: "Larissa Mendes", assignee: "julia", due: 0, hour: 15, priority: "ALTA" },
    { title: "Pós-venda do pedido da Juliana", type: "POS_VENDA", customer: "Juliana Pires", assignee: "julia", due: 2, hour: 10, priority: "MEDIA" },
    { title: "Enviar catálogo fitness para Fernanda", type: "ENVIAR_CATALOGO", customer: "Fernanda Oliveira", assignee: "julia", due: 0, hour: 17, priority: "MEDIA" },
    { title: "Reativar Loja Vitrine Chic (parou após atraso)", type: "REATIVAR", customer: "Loja Vitrine Chic", assignee: "renata", due: 3, hour: 10, priority: "BAIXA" },
    { title: "Confirmar entrega do Atacadão BH", type: "CONFIRMAR_ENTREGA", customer: "Atacadão da Moda BH", assignee: "renata", due: 2, hour: 9, priority: "MEDIA" },
    { title: "Enviar novidades para Sandra (fitness)", type: "ENVIAR_NOVIDADES", customer: "Sandra Regina", assignee: "renata", due: 4, hour: 14, priority: "BAIXA" },
    { title: "Ligar para Patrícia — recuperar negociação", type: "REATIVAR", customer: "Patrícia Nunes", assignee: "julia", due: 5, hour: 11, priority: "BAIXA" },
    { title: "Catálogo enviado para Vanessa — cobrar retorno", type: "FOLLOW_UP", customer: "Vanessa Martins", assignee: "julia", due: -1, hour: 10, priority: "ALTA" },
    { title: "Retornar contato do Magazine Dona Flor", type: "FOLLOW_UP", customer: "Magazine Dona Flor", assignee: "renata", due: -2, hour: 10, priority: "MEDIA" },
  ];
  for (const t of tasksData) {
    await db.task.create({
      data: {
        companyId: company.id,
        customerId: cust(t.customer).id,
        title: t.title,
        type: t.type,
        dueAt: t.due >= 0 ? daysAhead(t.due, t.hour ?? 10) : daysAgo(-t.due, t.hour ?? 10),
        priority: t.priority ?? "MEDIA",
        status: t.status ?? "PENDENTE",
        assigneeId: ownerId(t.assignee),
      },
    });
  }

  // ---- Campanhas ----
  await db.campaign.create({
    data: {
      companyId: company.id,
      name: "Reativação 60+ dias sem compra",
      filterJson: JSON.stringify({ inactiveDays: 60 }),
      message: "Oi {{nome}}, sentimos sua falta! 🌸 Chegaram novidades lindas com 15% OFF exclusivo para você. Posso te mandar o catálogo?",
      status: "ATIVA",
    },
  });
  await db.campaign.create({
    data: {
      companyId: company.id,
      name: "Lançamento verão — clientes VIP",
      filterJson: JSON.stringify({ tag: "VIP" }),
      message: "{{nome}}, a coleção VERÃO chegou! 🌞 Você tem acesso antecipado antes de divulgarmos. Quer ver as peças?",
      status: "RASCUNHO",
    },
  });
  await db.campaign.create({
    data: {
      companyId: company.id,
      name: "Recuperar negociações perdidas",
      filterJson: JSON.stringify({ lostDeals: true }),
      message: "Oi {{nome}}! Conseguimos uma condição especial que pode mudar sua decisão 😉 Posso te contar?",
      status: "CONCLUIDA",
    },
  });

  // ---- Catálogo de produtos ----
  type P = {
    name: string; sku: string; category: string; collection?: string;
    description?: string; cost: number; wholesale: number; retail: number;
    minQty?: number; image: string; colors: string[]; sizes: string[];
    stock: number; tags?: string;
  };
  const productsData: P[] = [
    { name: "Vestido Midi Aurora", sku: "VES-001", category: "Vestidos", collection: "Primavera", description: "Vestido midi em viscose com amarração na cintura.", cost: 62, wholesale: 89, retail: 149.9, minQty: 5, image: "/products/vestido-rosa.svg", colors: ["Rosa", "Nude"], sizes: ["P", "M", "G"], stock: 12, tags: "lançamento,festa" },
    { name: "Vestido Vinho Elegance", sku: "VES-002", category: "Vestidos", collection: "Inverno", description: "Vestido em crepe com fenda discreta.", cost: 74, wholesale: 105, retail: 189.9, minQty: 5, image: "/products/vestido-vinho.svg", colors: ["Vinho", "Preto"], sizes: ["P", "M", "G", "GG"], stock: 8, tags: "festa" },
    { name: "Blusa Tricô Nuvem", sku: "BLU-010", category: "Blusas", collection: "Inverno", description: "Tricô macio de toque acolchoado.", cost: 38, wholesale: 55, retail: 99.9, minQty: 6, image: "/products/blusa-tricot.svg", colors: ["Amarelo", "Off-white"], sizes: ["P", "M", "G"], stock: 15 },
    { name: "Calça Wide Leg Jeans", sku: "CAL-005", category: "Calças", description: "Jeans premium de cintura alta.", cost: 68, wholesale: 92, retail: 169.9, minQty: 4, image: "/products/calca-jeans.svg", colors: ["Azul"], sizes: ["36", "38", "40", "42"], stock: 10, tags: "básico" },
    { name: "Conjunto Fitness Power", sku: "FIT-020", category: "Moda fitness", collection: "Verão", description: "Top + legging com compressão leve.", cost: 45, wholesale: 66, retail: 119.9, minQty: 6, image: "/products/conjunto-fitness.svg", colors: ["Verde", "Preto"], sizes: ["P", "M", "G"], stock: 20, tags: "fitness" },
    { name: "Conjunto Linho Toscana", sku: "CON-008", category: "Conjuntos", collection: "Verão", description: "Blazer + short em linho misto.", cost: 88, wholesale: 125, retail: 219.9, minQty: 4, image: "/products/conjunto-linho.svg", colors: ["Lilás", "Bege"], sizes: ["P", "M", "G"], stock: 6, tags: "lançamento" },
    { name: "Saia Midi Plissada", sku: "SAI-003", category: "Saias", description: "Plissado fluido com cós elástico.", cost: 42, wholesale: 59, retail: 109.9, minQty: 6, image: "/products/saia-midi.svg", colors: ["Laranja", "Preto"], sizes: ["Único"], stock: 14 },
    { name: "Cropped Básico Comfy", sku: "CRO-015", category: "Blusas", description: "Algodão penteado, modelagem justa.", cost: 18, wholesale: 27, retail: 49.9, minQty: 10, image: "/products/cropped-basico.svg", colors: ["Azul", "Branco", "Preto"], sizes: ["P", "M", "G"], stock: 30, tags: "básico" },
  ];

  const productBySku = new Map<string, { id: string; variants: { id: string; color: string; size: string }[] }>();
  for (const p of productsData) {
    const created = await db.product.create({
      data: {
        companyId: company.id,
        name: p.name,
        sku: p.sku,
        category: p.category,
        brand: "Bella Moda",
        collection: p.collection,
        description: p.description,
        costPrice: p.cost,
        wholesalePrice: p.wholesale,
        retailPrice: p.retail,
        minQuantity: p.minQty ?? 1,
        tags: p.tags,
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
        companyId: company.id,
        variantId: v.id,
        type: "ENTRADA" as const,
        quantity: v.stock,
        reason: "Estoque inicial",
      })),
    });
  }

  // produto da segunda empresa (isolamento)
  await db.product.create({
    data: {
      companyId: company2.id, name: "Camiseta Urban", sku: "URB-001",
      category: "Camisetas", retailPrice: 39.9,
      variants: { create: [{ color: "Preto", size: "M", stock: 50 }] },
    },
  });

  // ---- Pedidos ----
  type OItem = { sku: string; color: string; size: string; qty: number; price: number };
  type Ord = {
    customer: string; seller: string; days: number;
    status: "ORCAMENTO" | "AGUARDANDO_PAGAMENTO" | "PAGO" | "EM_PRODUCAO" | "SEPARACAO" | "ENVIADO" | "ENTREGUE" | "CANCELADO";
    items: OItem[]; discount?: number; shippingFee?: number; notes?: string;
    payMethod?: "PIX" | "CARTAO" | "BOLETO"; paid?: boolean;
  };
  const ordersData: Ord[] = [
    { customer: "Mariana Castro", seller: "julia", days: 0, status: "ORCAMENTO", payMethod: "PIX",
      items: [{ sku: "VES-001", color: "Rosa", size: "M", qty: 1, price: 149.9 }, { sku: "SAI-003", color: "Laranja", size: "Único", qty: 1, price: 109.9 }],
      notes: "Cliente pediu para reservar até sexta." },
    { customer: "Loja Estilo Mix", seller: "renata", days: 1, status: "AGUARDANDO_PAGAMENTO", payMethod: "BOLETO",
      items: [{ sku: "VES-001", color: "Nude", size: "P", qty: 6, price: 89 }, { sku: "CRO-015", color: "Branco", size: "M", qty: 10, price: 27 }, { sku: "CAL-005", color: "Azul", size: "40", qty: 4, price: 92 }],
      discount: 50, shippingFee: 45, notes: "Grade mensal — frete negociado." },
    { customer: "Camila Rodrigues", seller: "renata", days: 3, status: "PAGO", payMethod: "PIX", paid: true,
      items: [{ sku: "FIT-020", color: "Verde", size: "M", qty: 6, price: 66 }, { sku: "CRO-015", color: "Preto", size: "P", qty: 6, price: 27 }] },
    { customer: "Juliana Pires", seller: "julia", days: 5, status: "ENVIADO", payMethod: "CARTAO", paid: true,
      items: [{ sku: "VES-002", color: "Vinho", size: "P", qty: 1, price: 189.9 }], shippingFee: 22 },
    { customer: "Atacadão da Moda BH", seller: "renata", days: 8, status: "ENTREGUE", payMethod: "PIX", paid: true,
      items: [{ sku: "CON-008", color: "Lilás", size: "M", qty: 4, price: 125 }, { sku: "BLU-010", color: "Amarelo", size: "G", qty: 6, price: 55 }, { sku: "FIT-020", color: "Preto", size: "G", qty: 8, price: 66 }],
      discount: 80 },
    { customer: "Patrícia Nunes", seller: "julia", days: 12, status: "CANCELADO", payMethod: "PIX",
      items: [{ sku: "BLU-010", color: "Off-white", size: "M", qty: 2, price: 99.9 }], notes: "Cliente desistiu — preço." },
  ];

  let orderSeq = 0;
  for (const o of ordersData) {
    orderSeq += 1;
    const lines = o.items.map((i) => {
      const prod = productBySku.get(i.sku)!;
      const variant = prod.variants.find((v) => v.color === i.color && v.size === i.size)!;
      const pd = productsData.find((p) => p.sku === i.sku)!;
      return { ...i, productId: prod.id, variantId: variant.id, name: pd.name, image: pd.image, total: i.qty * i.price };
    });
    const subtotal = lines.reduce((s, l) => s + l.total, 0);
    const discount = o.discount ?? 0;
    const shippingFee = o.shippingFee ?? 0;
    const total = subtotal - discount + shippingFee;
    const createdAt = daysAgo(o.days, 11);

    const order = await db.order.create({
      data: {
        companyId: company.id,
        number: orderSeq,
        customerId: cust(o.customer).id,
        sellerId: ownerId(o.seller),
        status: o.status,
        subtotal, discount, shippingFee, total,
        notes: o.notes,
        createdAt,
        items: {
          create: lines.map((l) => ({
            productId: l.productId,
            variantId: l.variantId,
            name: l.name,
            sku: l.sku,
            imageUrl: l.image,
            color: l.color,
            size: l.size,
            quantity: l.qty,
            unitPrice: l.price,
            total: l.total,
          })),
        },
        payments: {
          create: {
            method: o.payMethod ?? "PIX",
            amount: total,
            status: o.paid ? "CONFIRMADO" : "PENDENTE",
            paidAt: o.paid ? daysAgo(Math.max(o.days - 1, 0), 15) : null,
            createdAt,
          },
        },
        shipping: {
          create: {
            cost: shippingFee,
            city: cust(o.customer).city,
            state: cust(o.customer).state,
            method: shippingFee > 0 ? "Transportadora" : "Retirada/Combinar",
            shippedAt: ["ENVIADO", "ENTREGUE"].includes(o.status) ? daysAgo(Math.max(o.days - 2, 0)) : null,
            deliveredAt: o.status === "ENTREGUE" ? daysAgo(Math.max(o.days - 4, 0)) : null,
            trackingCode: ["ENVIADO", "ENTREGUE"].includes(o.status) ? `BR${900000 + orderSeq * 137}BM` : null,
          },
        },
        events: {
          create: [
            { type: "CRIADO", description: `Pedido criado por ${o.seller === "julia" ? "Júlia Ferreira" : "Renata Alves"}`, userId: ownerId(o.seller), createdAt },
            ...(o.status !== "ORCAMENTO"
              ? [{ type: "STATUS", description: `Status alterado para "${o.status === "AGUARDANDO_PAGAMENTO" ? "Aguardando pagamento" : o.status.charAt(0) + o.status.slice(1).toLowerCase()}"`, userId: ownerId(o.seller), createdAt: daysAgo(Math.max(o.days - 1, 0), 13) }]
              : []),
          ],
        },
      },
    });

    // baixa de estoque para pedidos não cancelados
    if (o.status !== "CANCELADO") {
      for (const l of lines) {
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
          reason: `Pedido #${String(orderSeq).padStart(4, "0")}`,
        })),
      });
    }
  }

  console.log("Seed concluído!");
  console.log("Logins (senha demo1234): ana@bellamoda.com.br (admin), carla@ (gerente), julia@/renata@ (vendedoras)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
