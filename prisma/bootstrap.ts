/**
 * Bootstrap de produção — NÃO destrutivo e idempotente.
 *
 * Diferente do seed (que é de demonstração e apaga tudo), este script apenas
 * GARANTE o mínimo para operar:
 *   • a empresa-plataforma (onde o Super Admin trabalha);
 *   • o pipeline "Leads do Site";
 *   • um usuário SUPERADMIN, criado a partir das variáveis de ambiente
 *     SUPERADMIN_EMAIL e SUPERADMIN_PASSWORD.
 *
 * Pode rodar em todo deploy: se o Super Admin já existir, não faz nada.
 * Se as variáveis não estiverem definidas, apenas pula (não quebra o build).
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

const PLATFORM_SLUG = "vesticrm";
const SALES_STAGES: [string, string, boolean, boolean][] = [
  ["Novo Lead", "#3b82f6", false, false],
  ["Contato realizado", "#60a5fa", false, false],
  ["Demonstração agendada", "#818cf8", false, false],
  ["Demonstração realizada", "#a78bfa", false, false],
  ["Negociação", "#f59e0b", false, false],
  ["Implantação", "#14b8a6", false, false],
  ["Cliente", "#10b981", true, false],
  ["Perdido", "#ef4444", false, true],
];

async function main() {
  const email = process.env.SUPERADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SUPERADMIN_PASSWORD;

  if (!email || !password) {
    console.log(
      "[bootstrap] SUPERADMIN_EMAIL/SUPERADMIN_PASSWORD não definidos — pulando criação do Super Admin."
    );
    return;
  }
  if (password.length < 6) {
    console.log("[bootstrap] SUPERADMIN_PASSWORD muito curta (mín. 6) — pulando.");
    return;
  }

  // Empresa-plataforma
  let company = await db.company.findUnique({ where: { slug: PLATFORM_SLUG } });
  if (!company) {
    company = await db.company.create({
      data: {
        name: "AtacadoPro",
        slug: PLATFORM_SLUG,
        tagline: "A plataforma comercial para lojas de moda.",
      },
    });
    console.log("[bootstrap] Empresa-plataforma criada.");
  }

  // Pipeline de vendas "Leads do Site"
  const pipeline = await db.pipeline.findFirst({ where: { companyId: company.id } });
  if (!pipeline) {
    await db.pipeline.create({
      data: {
        companyId: company.id,
        name: "Leads do Site",
        stages: {
          create: SALES_STAGES.map(([name, color, isWon, isLost], i) => ({
            name,
            order: i,
            color,
            isWon,
            isLost,
          })),
        },
      },
    });
    console.log("[bootstrap] Pipeline 'Leads do Site' criado.");
  }

  // Super Admin
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`[bootstrap] Usuário ${email} já existe — nada a fazer.`);
    return;
  }
  await db.user.create({
    data: {
      companyId: company.id,
      name: "Super Admin",
      email,
      passwordHash: await bcrypt.hash(password, 10),
      role: "SUPERADMIN",
      color: "#2563eb",
    },
  });
  console.log(`[bootstrap] Super Admin criado: ${email}`);
}

main()
  .catch((e) => {
    // Não derruba o deploy por causa do bootstrap: apenas registra.
    console.error("[bootstrap] erro (ignorado para não quebrar o build):", e);
  })
  .finally(() => db.$disconnect());
