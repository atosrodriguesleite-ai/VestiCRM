import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isAdmin } from "@/lib/scope";

const COLORS = ["#6d28ff", "#0ea5e9", "#f59e0b", "#10b981", "#ec4899", "#f43f5e"];

const schema = z.object({
  name: z.string().min(1),
  // login de acesso: um e-mail OU um nome de usuário simples (ex.: "maria")
  login: z.string().min(3).max(60),
  password: z.string().min(6),
  role: z.enum(["ADMIN", "MANAGER", "SELLER", "SUPPORT"]),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!isAdmin(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }

    const rawLogin = parsed.data.login.trim().toLowerCase();
    let email: string;
    let username: string | null = null;

    if (rawLogin.includes("@")) {
      // login por e-mail
      if (!z.string().email().safeParse(rawLogin).success) {
        return NextResponse.json({ error: "E-mail inválido" }, { status: 400 });
      }
      email = rawLogin;
    } else {
      // login por nome de usuário (sem e-mail): letras, números, ponto e hífen
      username = rawLogin.replace(/\s+/g, ".");
      if (!/^[a-z0-9._-]{3,30}$/.test(username)) {
        return NextResponse.json(
          { error: "Usuário inválido: use letras minúsculas, números, ponto ou hífen (mín. 3)" },
          { status: 400 }
        );
      }
      // e-mail interno só para satisfazer o cadastro — nunca é exibido
      email = `${username}.${user.companyId.slice(-6)}@login.interno`;
    }

    const exists = await db.user.findFirst({
      where: { OR: [{ email }, ...(username ? [{ username }] : [])] },
    });
    if (exists) {
      return NextResponse.json(
        { error: username ? "Este nome de usuário já está em uso — tente outro (ex.: maria.silva)" : "Já existe um usuário com este e-mail" },
        { status: 409 }
      );
    }

    const created = await db.user.create({
      data: {
        companyId: user.companyId,
        name: parsed.data.name,
        email,
        username,
        passwordHash: await bcrypt.hash(parsed.data.password, 10),
        role: parsed.data.role,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
      },
    });
    return NextResponse.json(
      { id: created.id, name: created.name, login: created.username ?? created.email },
      { status: 201 }
    );
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
