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
  company: z.string().min(1),
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
    `🖥️ Solicitação de demonstração — ${d.company}`,
    `Responsável: ${d.name}`,
    d.email ? `E-mail: ${d.email}` : null,
    d.city || d.state ? `Local: ${[d.city, d.state].filter(Boolean).join("/")}` : null,
    d.instagram ? `Instagram: ${d.instagram}` : null,
    d.sellers ? `Vendedores: ${d.sellers}` : null,
    `Loja física: ${d.hasPhysical ? "sim" : "não"} · E-commerce: ${d.hasEcommerce ? "sim" : "não"}`,
    d.currentSystem ? `Sistema atual: ${d.currentSystem}` : null,
    d.message ? `Mensagem: ${d.message}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const result = await intakeLead(companyId, {
    phone: d.phone,
    name: `${d.name} · ${d.company}`,
    origin: "SITE",
    message: resumo,
    city: d.city,
    state: d.state,
    opportunityTitle: `Demonstração — ${d.company}`,
    ownerId: ownerId ?? undefined,
  });

  // enriquece: notas do cliente, timeline e renomeia a tarefa automática
  await db.customer.update({
    where: { id: result.customer.id },
    data: { notes: resumo },
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
    data: { title: `Entrar em contato — ${d.company}` },
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}
