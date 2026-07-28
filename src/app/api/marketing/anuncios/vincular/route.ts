import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import { isManagerUp } from "@/lib/scope";
import { juntarRef, normalizaRefDigitada, refsDaCampanha } from "@/lib/ad-match";

const schema = z.object({
  /** código do anúncio (o mesmo que o sistema carimbou na cliente) */
  adRef: z.string().min(2).max(120),
  /** campanha existente… */
  campaignId: z.string().min(1).optional(),
  /** …ou o nome de uma campanha nova, criada na hora */
  novaCampanha: z.string().min(2).max(80).optional(),
  canal: z.enum(["INSTAGRAM", "FACEBOOK", "GOOGLE", "WHATSAPP", "TIKTOK", "OUTRO"]).optional(),
});

/**
 * VINCULAR UM ANÚNCIO A UMA CAMPANHA — direto da conversa.
 *
 * A vendedora está no chat, vê "Cliente veio de um ANÚNCIO" e resolve ali
 * mesmo de qual campanha aquilo é. Sem essa porta, o caminho era sair do
 * atendimento, ir em Marketing, achar o anúncio na lista e vincular — o que
 * na prática ninguém fazia, e o lead ficava sem campanha para sempre.
 *
 * O vínculo é RETROATIVO: todas as clientes que chegaram por esse mesmo
 * anúncio e ainda estão sem campanha entram junto. É o que faz a conta de
 * "quanto essa campanha trouxe" ficar verdadeira desde o primeiro clique.
 *
 * Quem já tem campanha NÃO é mexida: vale o primeiro contato — a atribuição
 * de quem trouxe a cliente não se reescreve.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!isManagerUp(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const code = normalizaRefDigitada(parsed.data.adRef);
    if (!code) {
      return NextResponse.json({ error: "Anúncio não reconhecido" }, { status: 400 });
    }

    // ---- a campanha: existente ou criada na hora ----
    const daLoja = await db.marketingCampaign.findMany({
      where: { companyId: user.companyId },
      select: { id: true, name: true, adRefs: true },
    });

    // UM ANÚNCIO, UMA CAMPANHA. Se esse anúncio já pertence a alguém, é ela —
    // duas campanhas com o mesmo anúncio deixariam a atribuição no chute (a
    // conta de "quanto essa campanha trouxe" viraria loteria).
    const dona = daLoja.find((c) => refsDaCampanha(c.adRefs).includes(code)) ?? null;
    if (dona && parsed.data.campaignId && parsed.data.campaignId !== dona.id) {
      return NextResponse.json(
        { error: `Este anúncio já está na campanha “${dona.name}”.` },
        { status: 409 }
      );
    }

    let campanha = parsed.data.campaignId
      ? await db.marketingCampaign.findFirst({
          where: { id: parsed.data.campaignId, companyId: user.companyId },
        })
      : dona
        ? await db.marketingCampaign.findFirst({
            where: { id: dona.id, companyId: user.companyId },
          })
        : null;

    if (!campanha && parsed.data.novaCampanha) {
      const nome = parsed.data.novaCampanha.trim();
      // mesmo nome = mesma campanha: duas pessoas vinculando anúncios
      // diferentes no mesmo dia não podem virar duas "Promoção de Julho"
      const mesmoNome = daLoja.find(
        (c) => c.name.trim().toLowerCase() === nome.toLowerCase()
      );
      if (mesmoNome) {
        campanha = await db.marketingCampaign.findFirst({
          where: { id: mesmoNome.id, companyId: user.companyId },
        });
      }
    }

    if (!campanha && parsed.data.novaCampanha) {
      const nome = parsed.data.novaCampanha.trim();
      // slug curto e único por loja (é a chave que casa com ?utm_campaign=)
      const base =
        nome
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 30) || "campanha";
      let utmKey = base;
      for (let i = 2; i <= 30; i++) {
        const existe = await db.marketingCampaign.findFirst({
          where: { companyId: user.companyId, utmKey },
          select: { id: true },
        });
        if (!existe) break;
        utmKey = `${base}-${i}`;
      }
      campanha = await db.marketingCampaign.create({
        data: {
          companyId: user.companyId,
          name: nome,
          channel: parsed.data.canal ?? "INSTAGRAM",
          utmKey,
          adRefs: code,
          active: true,
        },
      });
    }

    if (!campanha) {
      return NextResponse.json({ error: "Campanha não encontrada" }, { status: 404 });
    }

    // o anúncio passa a pertencer à campanha (sem repetir o que já estava lá)
    const adRefs = juntarRef(campanha.adRefs, code);
    if (adRefs !== (campanha.adRefs ?? "").trim()) {
      await db.marketingCampaign.update({
        where: { id: campanha.id },
        data: { adRefs },
      });
    }

    // RETROATIVO: quem veio por este anúncio e está sem campanha entra junto
    const { count } = await db.customer.updateMany({
      where: { companyId: user.companyId, adRef: code, campaignId: null },
      data: { campaignId: campanha.id },
    });

    return NextResponse.json({
      campanha: { id: campanha.id, name: campanha.name },
      clientesVinculadas: count,
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
