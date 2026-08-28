import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { formFichaSchema, limparResposta } from "@/lib/ficha-funcionario";
import { lerLinkFicha } from "@/lib/ficha-form-link";
import { notifyFichaRecebida } from "@/lib/notify";

export const dynamic = "force-dynamic";

/**
 * O FUNCIONÁRIO ENVIOU O FORMULÁRIO da ficha (RN-025). Rota PÚBLICA: quem
 * prova quem ele é é o código do link (sorteado, 7 dias, USO ÚNICO).
 *
 * O que ele mandou NÃO entra na ficha: fica em `resposta` aguardando a
 * CONFERÊNCIA do admin — ficha de RH guarda CPF e conta bancária, ninguém
 * grava nela sem alguém da empresa olhar. O envio consome o link.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ codigo: string }> }
) {
  const { codigo } = await params;
  const link = await lerLinkFicha(codigo);
  if (!link)
    return NextResponse.json(
      { error: "Este link venceu ou já foi usado. Peça um novo à empresa. 💜" },
      { status: 410 }
    );

  const parsed = formFichaSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    // sem o aceite LGPD marcado o zod recusa — a mensagem explica o porquê
    const semAceite = parsed.error.issues.some((i) => i.path[0] === "aceiteLGPD");
    return NextResponse.json(
      {
        error: semAceite
          ? "Para enviar, marque o aceite do uso dos dados."
          : "Confira os campos e tente de novo.",
      },
      { status: 400 }
    );
  }

  const agora = new Date();
  // uso único com corrida fechada: só grava se NINGUÉM gravou antes
  const consumo = await db.fichaFormLink.updateMany({
    where: { id: link.id, usadoEm: null },
    data: {
      usadoEm: agora,
      aceiteLGPDEm: agora,
      resposta: limparResposta(parsed.data) as object,
    },
  });
  if (consumo.count === 0)
    return NextResponse.json(
      { error: "Este link acabou de ser usado. Peça um novo à empresa. 💜" },
      { status: 410 }
    );

  await db.funcionarioEvento.create({
    data: {
      funcionarioId: link.funcionarioId,
      descricao: "Enviou a ficha pelo link (aguardando conferência).",
      autorNome: link.funcionario.nome,
    },
  });
  await notifyFichaRecebida({
    companyId: link.companyId,
    funcionarioNome: link.funcionario.nome,
  });

  return NextResponse.json({ ok: true });
}
