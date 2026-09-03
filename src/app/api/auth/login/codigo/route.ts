import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth";
import {
  COOKIE_APARELHO,
  DIAS_APARELHO_CONFIAVEL,
  assinarAparelho,
  conferirCodigo,
} from "@/lib/auth-codigo";
import {
  chavesDeChuteDeCodigo,
  ipDaRequisicao,
  registrarTentativa,
  segundosDeBloqueio,
} from "@/lib/rate-limit";

/**
 * Segunda etapa do login (RN-045): a pessoa acertou a senha, o código foi
 * pelo WhatsApp e chega aqui para conferência. Acertou → sessão criada e o
 * APARELHO fica confiável por 90 dias (não pede código de novo). O desafio
 * expira em 10 minutos e morre com 5 erros — quem errar demais volta para a
 * tela de senha e recomeça (código novo, contagem nova).
 */

const schema = z.object({
  desafio: z.string().min(10).max(60),
  codigo: z.string().min(4).max(12),
});

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  }
  // porta pública de escrita: ritmo por IP (padrão da RN-044) — o teto de 5
  // erros por desafio já existe; este aqui barra a varredura de desafios
  const chavesIp = chavesDeChuteDeCodigo(ipDaRequisicao(req.headers));
  if (chavesIp.length > 0) {
    const recusa = NextResponse.json(
      { error: "Muitas tentativas — aguarde alguns minutos e entre de novo." },
      { status: 429 }
    );
    if ((await segundosDeBloqueio(chavesIp)) !== null) return recusa;
    if ((await registrarTentativa(chavesIp)) !== null) return recusa;
  }
  const userId = await conferirCodigo(
    parsed.data.desafio,
    parsed.data.codigo.replace(/\D/g, "")
  );
  if (!userId) {
    // mensagem única: não diz se foi código errado, vencido ou desafio morto
    return NextResponse.json(
      { error: "Código inválido ou vencido — tente entrar de novo." },
      { status: 401 }
    );
  }
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, active: true },
  });
  // conta desativada entre a senha e o código: não entra
  if (!user?.active) {
    return NextResponse.json({ error: "Conta desativada" }, { status: 403 });
  }
  await createSession(user.id);
  // o aparelho vira conhecido: o código só aparece de novo em aparelho novo
  const store = await cookies();
  store.set(COOKIE_APARELHO, assinarAparelho(user.id), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: DIAS_APARELHO_CONFIAVEL * 86_400,
    path: "/",
  });
  return NextResponse.json({ ok: true, role: user.role });
}
