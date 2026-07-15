import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/scope";

/**
 * Super Admin: troca o LOGIN de acesso (e opcionalmente a senha) do
 * administrador de uma loja cliente. Aceita e-mail ou nome de usuário
 * simples — mesma regra do cadastro de equipe.
 */

const schema = z.object({
  companyId: z.string().min(1),
  login: z.string().min(3).max(60),
  password: z.string().min(6).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!isSuperAdmin(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const { companyId, password } = parsed.data;

    const admin = await db.user.findFirst({
      where: { companyId, role: "ADMIN" },
      orderBy: { createdAt: "asc" },
    });
    if (!admin) {
      return NextResponse.json(
        { error: "Esta loja não tem um administrador." },
        { status: 404 }
      );
    }

    const rawLogin = parsed.data.login.trim().toLowerCase();
    let email: string;
    let username: string | null = null;
    if (rawLogin.includes("@")) {
      if (!z.string().email().safeParse(rawLogin).success) {
        return NextResponse.json({ error: "E-mail inválido" }, { status: 400 });
      }
      email = rawLogin;
    } else {
      username = rawLogin.replace(/\s+/g, ".");
      if (!/^[a-z0-9._-]{3,30}$/.test(username)) {
        return NextResponse.json(
          { error: "Login inválido: use letras minúsculas, números, ponto ou hífen (mín. 3)." },
          { status: 400 }
        );
      }
      email = `${username}.${companyId.slice(-6)}@login.interno`;
    }

    const clash = await db.user.findFirst({
      where: {
        id: { not: admin.id },
        OR: [{ email }, ...(username ? [{ username }] : [])],
      },
      select: { id: true },
    });
    if (clash) {
      return NextResponse.json(
        { error: "Este login já está em uso por outro usuário." },
        { status: 409 }
      );
    }

    const updated = await db.user.update({
      where: { id: admin.id },
      data: {
        email,
        username,
        ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}),
      },
    });
    return NextResponse.json({
      ok: true,
      login: updated.username ?? updated.email,
      passwordChanged: Boolean(password),
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
