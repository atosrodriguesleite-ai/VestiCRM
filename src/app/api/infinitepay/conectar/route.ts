import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { podeOperarIntegracoes } from "@/lib/scope";
import { encryptSecret } from "@/lib/crypto";

/**
 * Conexão da loja com a InfinitePay: a InfiniteTag (o @usuário da conta)
 * identifica quem recebe. Sem OAuth — conectar é digitar a tag; o token de
 * API é opcional (só contas que exigem autenticação para gerar link).
 * GET devolve o estado; DELETE desconecta.
 */

const schema = z.object({
  // InfiniteTag: letras/números/ponto/underline (o @ é aparado se vier)
  handle: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .transform((v) => v.replace(/^@+/, "").toLowerCase())
    .refine((v) => /^[a-z0-9._-]+$/.test(v), {
      message: "InfiniteTag inválida — use só letras, números, ponto ou traço.",
    }),
  // ausente = mantém o token guardado; "" = limpa; texto = novo token
  apiToken: z.string().max(300).optional(),
});

export async function GET() {
  try {
    const user = await requireUser();
    const conn = await db.infinitePayConnection.findUnique({
      where: { companyId: user.companyId },
      select: { handle: true, connectedAt: true, apiToken: true },
    });
    return NextResponse.json({
      conectado: Boolean(conn),
      handle: conn?.handle ?? null,
      connectedAt: conn?.connectedAt ?? null,
      temToken: Boolean(conn?.apiToken),
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!podeOperarIntegracoes(user)) {
      return NextResponse.json({ error: "Só admin conecta integrações." }, { status: 403 });
    }
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Informe a InfiniteTag da loja." },
        { status: 400 }
      );
    }
    const { handle, apiToken } = parsed.data;

    // o token do webhook nasce UMA vez e sobrevive à troca de handle — o
    // link antigo já entregue à InfinitePay continua apontando certo
    const existente = await db.infinitePayConnection.findUnique({
      where: { companyId: user.companyId },
      select: { webhookToken: true },
    });
    const webhookToken = existente?.webhookToken ?? randomBytes(24).toString("hex");
    // token em repouso SEMPRE criptografado. TRÊS casos, para não apagar o
    // token guardado sem querer (a lojista trocava só a tag e a integração
    // caía com 401 — auditoria 11/08/2026):
    //   • campo ausente  → mantém o que está no banco (não toca em apiToken)
    //   • campo vazio ("")→ limpa o token
    //   • texto          → novo token, criptografado
    const tokenUpdate =
      apiToken === undefined
        ? {}
        : { apiToken: apiToken.trim() ? encryptSecret(apiToken.trim()) : null };

    await db.infinitePayConnection.upsert({
      where: { companyId: user.companyId },
      update: { handle, ...tokenUpdate },
      create: {
        companyId: user.companyId,
        handle,
        apiToken: "apiToken" in tokenUpdate ? tokenUpdate.apiToken : null,
        webhookToken,
      },
    });
    return NextResponse.json({ ok: true, handle });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

export async function DELETE() {
  try {
    const user = await requireUser();
    if (!podeOperarIntegracoes(user)) {
      return NextResponse.json({ error: "Só admin desconecta integrações." }, { status: 403 });
    }
    // cobranças pendentes deste provedor deixam de valer aqui — o link
    // antigo pago depois cai no aviso de "segundo pagamento" do settle
    await db.payment.updateMany({
      where: {
        order: { companyId: user.companyId },
        provider: "INFINITEPAY",
        status: "PENDENTE",
      },
      data: { dueAt: new Date() },
    });
    await db.infinitePayConnection.deleteMany({ where: { companyId: user.companyId } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
