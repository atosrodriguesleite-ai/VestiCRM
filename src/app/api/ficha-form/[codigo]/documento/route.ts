import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { TETO_DOCS_POR_LINK } from "@/lib/ficha-funcionario";
import { lerLinkFicha } from "@/lib/ficha-form-link";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * O FUNCIONÁRIO ANEXOU UM DOCUMENTO pelo link (RN-025). Rota PÚBLICA, um
 * arquivo por chamada (o teto de corpo da Vercel é ~4,5 MB — mandar a pasta
 * inteira num POST só não passa).
 *
 * O documento ENTRA NA PASTA na hora — diferente dos campos, que aguardam
 * conferência: anexo é arquivo dele mesmo, o admin vê tudo na conferência e
 * pode remover. O que segura abuso: link vence, morre no envio final e tem
 * TETO de anexos.
 */
const schema = z.object({
  // TIPO e VALIDADE não vêm do formulário (decisão do dono, 28/08/2026): o
  // funcionário manda SÓ o CPF, e quem decide o rótulo é o servidor — a
  // lista inteira de documentos assustava e ninguém preenchia. O admin
  // continua anexando qualquer tipo, com validade, pela tela Equipe.
  fileName: z.string().min(1).max(160),
  arquivo: z.string().startsWith("data:").max(5_500_000),
  // o RG entra na pasta ANTES do envio final, então o consentimento tem que
  // ser exigido e REGISTRADO aqui também: quem anexa e desiste do formulário
  // deixava documento guardado sem nenhuma prova de que autorizou (LGPD)
  aceiteLGPD: z.literal(true),
});

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

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const semAceite = parsed.error.issues.some((i) => i.path[0] === "aceiteLGPD");
    return NextResponse.json(
      {
        error: semAceite
          ? "Para anexar, marque o aceite do uso dos dados."
          : "Arquivo grande demais (máximo ~4 MB) ou campos inválidos.",
      },
      { status: 400 }
    );
  }

  // teto por link, com a contagem no PRÓPRIO update (corrida fechada); o
  // primeiro anexo já carimba o consentimento
  const conta = await db.fichaFormLink.updateMany({
    where: { id: link.id, docsEnviados: { lt: TETO_DOCS_POR_LINK }, usadoEm: null },
    data: {
      docsEnviados: { increment: 1 },
      ...(link.aceiteLGPDEm ? {} : { aceiteLGPDEm: new Date() }),
    },
  });
  if (conta.count === 0)
    return NextResponse.json(
      { error: `Este link já recebeu ${TETO_DOCS_POR_LINK} arquivos.` },
      { status: 429 }
    );

  const doc = await db.funcionarioDocumento.create({
    data: {
      funcionarioId: link.funcionarioId,
      tipo: "CPF_DOC",
      fileName: parsed.data.fileName,
      arquivo: parsed.data.arquivo,
    },
    select: { id: true, tipo: true, fileName: true, validade: true },
  });
  await db.funcionarioEvento.create({
    data: {
      funcionarioId: link.funcionarioId,
      descricao: `Anexou documento pelo link: ${parsed.data.fileName}.`,
      autorNome: link.funcionario.nome,
    },
  });
  return NextResponse.json(doc, { status: 201 });
}
