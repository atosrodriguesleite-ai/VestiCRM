import { db } from "./db";

/**
 * Empresa-plataforma do AtacadoPro — o "tenant" comercial do Super Admin,
 * onde caem os leads da Landing Page (Site Oficial). Reaproveita todo o
 * CRM (funil, clientes, tarefas, timeline) como pipeline "Leads do Site".
 *
 * Pipeline de vendas do AtacadoPro (diferente do funil de moda das lojas):
 * Novo Lead → Contato realizado → Demonstração agendada → Demonstração
 * realizada → Negociação → Implantação → Cliente (ganho) / Perdido.
 */

export const PLATFORM_SLUG = "vesticrm";

const SALES_STAGES: [string, string, boolean, boolean][] = [
  ["Novo Lead", "#8148f9", false, false],
  ["Contato realizado", "#9d74ff", false, false],
  ["Demonstração agendada", "#818cf8", false, false],
  ["Demonstração realizada", "#a78bfa", false, false],
  ["Negociação", "#f59e0b", false, false],
  ["Implantação", "#14b8a6", false, false],
  ["Cliente", "#10b981", true, false],
  ["Perdido", "#ef4444", false, true],
];

/** Garante a empresa-plataforma + pipeline de vendas. Idempotente. */
export async function ensurePlatformCompany(): Promise<string> {
  let company = await db.company.findUnique({
    where: { slug: PLATFORM_SLUG },
  });
  if (!company) {
    company = await db.company.create({
      data: {
        name: "AtacadoPro",
        slug: PLATFORM_SLUG,
        tagline: "O jeito profissional de vender no atacado.",
      },
    });
  }

  const pipeline = await db.pipeline.findFirst({
    where: { companyId: company.id },
    include: { stages: true },
  });
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
  }

  return company.id;
}

/** Superadmin dono da operação comercial (recebe os leads da LP). */
export async function platformOwnerId(companyId: string): Promise<string | null> {
  const superadmin = await db.user.findFirst({
    where: { companyId, role: "SUPERADMIN", active: true },
  });
  if (superadmin) return superadmin.id;
  const anyUser = await db.user.findFirst({
    where: { companyId, active: true },
  });
  return anyUser?.id ?? null;
}
