import bcrypt from "bcryptjs";
import { db } from "./db";

/**
 * Provisionamento de uma NOVA loja (tenant) no AtacadoPro.
 *
 * Cria, de forma atômica e NÃO destrutiva, tudo que uma loja precisa para já
 * começar a operar:
 *   • a empresa (Company) com os padrões de intake;
 *   • o usuário administrador da loja (login inicial);
 *   • o funil de vendas padrão de moda (etapas prontas);
 *   • a biblioteca inicial de cores e tamanhos do catálogo.
 *
 * Reutilizável por qualquer origem (tela do Super Admin hoje; futura
 * auto-contratação amanhã). Diferente do seed, este helper JAMAIS apaga dados.
 */

/** Etapas padrão do funil de moda (nome, cor, ganho, perdido). */
const DEFAULT_STAGES: [string, string, boolean, boolean][] = [
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

/** Paleta inicial do catálogo (o lojista personaliza depois). */
const DEFAULT_COLORS: [string, string][] = [
  ["Preto", "#211E1D"], ["Branco", "#FAF6EF"], ["Off-white", "#F5F0E4"],
  ["Vinho", "#6E2536"], ["Rosa", "#E8A0BF"], ["Nude", "#D9B99B"],
  ["Terracota", "#BC5836"], ["Verde", "#3E7A5E"], ["Amarelo", "#E5B93C"],
  ["Azul", "#3B5F8A"], ["Lilás", "#B49BD6"], ["Bege", "#D8C9A8"],
];

const DEFAULT_SIZES = ["PP", "P", "M", "G", "GG", "36", "38", "40", "42", "44", "Único"];

/** Gera um slug URL-safe a partir do nome da loja. */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "loja";
}

/** Garante um slug único acrescentando sufixo numérico se necessário. */
async function uniqueSlug(base: string): Promise<string> {
  const root = slugify(base);
  let slug = root;
  let n = 1;
  while (await db.company.findUnique({ where: { slug } })) {
    n += 1;
    slug = `${root}-${n}`;
  }
  return slug;
}

export type ProvisionInput = {
  companyName: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
  whatsapp?: string;
  tagline?: string;
};

export type ProvisionResult = {
  companyId: string;
  slug: string;
  adminId: string;
  adminEmail: string;
};

export class ProvisionError extends Error {
  constructor(
    message: string,
    public code: "EMAIL_TAKEN" | "INVALID" = "INVALID"
  ) {
    super(message);
  }
}

/**
 * Cria a loja + admin + funil + cores/tamanhos. Lança ProvisionError em caso
 * de e-mail já cadastrado.
 */
export async function provisionCompany(
  input: ProvisionInput
): Promise<ProvisionResult> {
  const email = input.adminEmail.trim().toLowerCase();

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    throw new ProvisionError(
      "Já existe um usuário com este e-mail.",
      "EMAIL_TAKEN"
    );
  }

  const slug = await uniqueSlug(input.companyName);
  const passwordHash = await bcrypt.hash(input.adminPassword, 10);

  return db.$transaction(async (tx) => {
    const company = await tx.company.create({
      data: {
        name: input.companyName.trim(),
        slug,
        whatsapp: input.whatsapp?.replace(/\D/g, "") || null,
        tagline: input.tagline?.trim() || null,
      },
    });

    const admin = await tx.user.create({
      data: {
        companyId: company.id,
        name: input.adminName.trim(),
        email,
        passwordHash,
        role: "ADMIN",
        color: "#6d28ff",
      },
    });

    await tx.pipeline.create({
      data: {
        companyId: company.id,
        name: "Funil de vendas",
        stages: {
          create: DEFAULT_STAGES.map(([name, color, isWon, isLost], i) => ({
            name,
            order: i,
            color,
            isWon,
            isLost,
          })),
        },
      },
    });

    await tx.companyColor.createMany({
      data: DEFAULT_COLORS.map(([name, hex]) => ({
        companyId: company.id,
        name,
        hex,
      })),
    });
    await tx.companySize.createMany({
      data: DEFAULT_SIZES.map((name, order) => ({
        companyId: company.id,
        name,
        order,
      })),
    });

    return {
      companyId: company.id,
      slug: company.slug,
      adminId: admin.id,
      adminEmail: admin.email,
    };
  });
}
