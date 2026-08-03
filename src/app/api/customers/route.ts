import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { intakeLead } from "@/lib/intake";
import { conferirDocumentos, guardarDocumento, soDigitos } from "@/lib/documento";
import type { Origin } from "@prisma/client";

const schema = z.object({
  name: z.string().min(1),
  phone: z.string().min(8),
  // CPF e CNPJ SEPARADOS: a cliente lojista tem os dois e cada transportadora
  // pede um deles (ver src/lib/documento.ts)
  cpf: z.string().max(20).optional(),
  cnpj: z.string().max(25).optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  type: z
    .enum(["VAREJO", "ATACADO", "REVENDEDORA", "LOJISTA", "BOUTIQUE", "SACOLEIRA"])
    .default("VAREJO"),
  origin: z.string().default("MANUAL"),
  notes: z.string().optional(),
  preferredSize: z.string().optional(),
  preferredColors: z.string().optional(),
  // aniversário: chega como "AAAA-MM-DD" do input de data
  birthDate: z.string().optional(),
  interestIds: z.array(z.string()).optional(),
  campaignId: z.string().optional(), // campanha de aquisição (módulo Marketing)
  skipOpportunity: z.boolean().optional(), // fluxos que criam a oportunidade/pedido na sequência
});

/** Cadastro manual — passa pelo Lead Intake Engine como todos os canais. */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const { interestIds, type, notes, preferredSize, preferredColors, birthDate, origin, cpf, cnpj, campaignId, skipOpportunity, ...core } =
      parsed.data;

    // CPF/CNPJ digitado errado só dá as caras lá na frente — a transportadora
    // recusa a etiqueta ou a Receita rejeita a nota, com a venda já fechada.
    // Melhor avisar aqui, enquanto a vendedora está com a cliente.
    const docErro = conferirDocumentos({ cpf, cnpj });
    if (docErro) return NextResponse.json({ error: docErro }, { status: 400 });

    const validOrigins = Object.keys(
      (await import("@/lib/format")).originLabel
    );
    const resolvedOrigin = (
      validOrigins.includes(origin) ? origin : "MANUAL"
    ) as Origin;

    // campanha precisa ser da própria loja (segurança multi-tenant)
    const validCampaignId = campaignId
      ? (
          await db.marketingCampaign.findFirst({
            where: { id: campaignId, companyId: user.companyId },
            select: { id: true },
          })
        )?.id
      : undefined;

    const result = await intakeLead(user.companyId, {
      phone: core.phone,
      name: core.name,
      city: core.city,
      state: core.state,
      origin: resolvedOrigin,
      campaignId: validCampaignId,
      ownerId: user.id, // quem cadastrou fica responsável
      skipOpportunity,
    });

    // campos complementares do formulário (perfil de moda)
    const customer = await db.customer.update({
      where: { id: result.customer.id },
      data: {
        type,
        cpf: guardarDocumento(cpf) ?? undefined,
        cnpj: guardarDocumento(cnpj) ?? undefined,
        notes: notes ?? undefined,
        preferredSize: preferredSize ?? undefined,
        preferredColors: preferredColors ?? undefined,
        birthDate: birthDate ? new Date(`${birthDate}T12:00:00Z`) : undefined,
        interests: interestIds?.length
          ? {
              deleteMany: {},
              create: interestIds.map((id) => ({ interestId: id })),
            }
          : undefined,
      },
    });

    return NextResponse.json(customer, {
      status: result.isNewLead ? 201 : 200,
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

/** Busca de clientes da loja (para vincular a pedidos etc.). */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
    const customers = await db.customer.findMany({
      where: {
        companyId: user.companyId,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { phone: { contains: q.replace(/\D/g, "") || q } },
                // busca por documento: a vendedora digita com ponto e traço,
                // o banco guarda só os números
                ...(soDigitos(q)
                  ? [{ cpf: { contains: soDigitos(q) } }, { cnpj: { contains: soDigitos(q) } }]
                  : []),
              ],
            }
          : {}),
      },
      select: { id: true, name: true, phone: true, city: true, state: true },
      orderBy: { lastContactAt: { sort: "desc", nulls: "last" } },
      take: 15,
    });
    return NextResponse.json(customers);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
