import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { intakeLead } from "@/lib/intake";
import { ensurePlatformCompany, platformOwnerId } from "@/lib/platform";

/**
 * Solicitação de demonstração (Landing Page → Super Admin).
 * Passa SEMPRE pelo Lead Intake Engine (origem SITE). Nenhum lead é criado
 * diretamente. Gera cliente + conversa + oportunidade em "Novo Lead" +
 * tarefa "Entrar em contato" + evento na timeline.
 */

const schema = z.object({
  name: z.string().min(1),
  company: z.string().optional(),
  phone: z.string().min(8),
  email: z.string().email().optional().or(z.literal("")),
  city: z.string().optional(),
  state: z.string().optional(),
  instagram: z.string().optional(),
  sellers: z.string().optional(),
  hasPhysical: z.boolean().optional(),
  hasEcommerce: z.boolean().optional(),
  currentSystem: z.string().optional(),
  message: z.string().optional(),
  ref: z.string().max(300).optional(), // origem/utm (ex.: catálogo de uma loja)
  consent: z.literal(true),
});

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Confira os campos obrigatórios e o aceite de dados." },
      { status: 400 }
    );
  }
  const d = parsed.data;

  const companyId = await ensurePlatformCompany();
  const ownerId = await platformOwnerId(companyId);

  // resumo estruturado da solicitação → vira 1ª mensagem da conversa + notas
  const resumo = [
    `🖥️ Solicitação de demonstração`,
    `Responsável: ${d.name}`,
    d.company ? `Loja: ${d.company}` : null,
    d.email ? `E-mail: ${d.email}` : null,
    d.instagram ? `Instagram: ${d.instagram}` : null,
    d.currentSystem ? `Sistema atual: ${d.currentSystem}` : null,
    d.ref ? `Veio de: ${d.ref}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const rotulo = d.company || d.instagram || d.name;

  const result = await intakeLead(companyId, {
    phone: d.phone,
    name: d.company ? `${d.name} · ${d.company}` : d.name,
    origin: "SITE",
    message: resumo,
    city: d.city,
    state: d.state,
    opportunityTitle: `Demonstração — ${rotulo}`,
    ownerId: ownerId ?? undefined,
  });

  // Canal de aquisição "Bio": o rodapé "feito por atacadopro.com" das bios das
  // lojas leva o visitante até aqui com ?utm_source=bio&utm_campaign=<slug>.
  // Marca o lead para o Super Admin acompanhar esse canal separadamente.
  let landingSource: string | null = null;
  if (d.ref) {
    const parts = d.ref.split(/[/·,]/).map((p) => p.trim().toLowerCase()).filter(Boolean);
    if (parts.includes("bio")) {
      const slug = parts[parts.indexOf("bio") + 1] ?? "";
      landingSource = slug ? `bio:${slug}` : "bio";
    }
  }

  // enriquece: notas do cliente, timeline e renomeia a tarefa automática
  await db.customer.update({
    where: { id: result.customer.id },
    data: { notes: resumo, ...(landingSource ? { landingSource } : {}) },
  });
  await db.customerEvent.create({
    data: {
      companyId,
      customerId: result.customer.id,
      type: "LEAD_CRIADO",
      channel: "SITE",
      description: "Lead solicitou demonstração pela Landing Page.",
    },
  });
  await db.task.updateMany({
    where: { companyId, autoRule: `intake:${result.customer.id}` },
    data: { title: `Entrar em contato — ${rotulo}` },
  });

  // Atribuição de afiliado: o link de divulgação leva ?utm_campaign=<código>
  // (o formulário junta os utm em d.ref). Se alguma parte do ref bater com o
  // código de um afiliado ativo, o lead fica atribuído a ele — é assim que
  // o Super Admin sabe a quem pagar comissão.
  if (d.ref) {
    const parts = d.ref
      .split(/[/·,]/)
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean);
    if (parts.length) {
      const affiliate = await db.affiliate.findFirst({
        where: { active: true, slug: { in: parts } },
      });
      if (affiliate) {
        await db.customer.update({
          where: { id: result.customer.id },
          data: { affiliateId: affiliate.id },
        });
        await db.customerEvent.create({
          data: {
            companyId,
            customerId: result.customer.id,
            type: "OUTRO",
            channel: "SITE",
            description: `Lead trazido pelo afiliado ${affiliate.name} (link "${affiliate.slug}").`,
          },
        });
      }
    }
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
