import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isAdmin } from "@/lib/scope";

const COLORS = ["#2563eb", "#0ea5e9", "#f59e0b", "#10b981", "#ec4899", "#f43f5e"];

const schema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
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

    const exists = await db.user.findUnique({
      where: { email: parsed.data.email.toLowerCase() },
    });
    if (exists) {
      return NextResponse.json(
        { error: "Já existe um usuário com este e-mail" },
        { status: 409 }
      );
    }

    const created = await db.user.create({
      data: {
        companyId: user.companyId,
        name: parsed.data.name,
        email: parsed.data.email.toLowerCase(),
        passwordHash: await bcrypt.hash(parsed.data.password, 10),
        role: parsed.data.role,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
      },
    });
    return NextResponse.json(
      { id: created.id, name: created.name, email: created.email },
      { status: 201 }
    );
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
