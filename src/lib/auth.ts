import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { db } from "./db";
import { AUTH_SECRET } from "./env";
import type { Role } from "@prisma/client";

const COOKIE = "vesticrm_session";
const secret = new TextEncoder().encode(AUTH_SECRET);

export type SessionUser = {
  id: string;
  companyId: string;
  name: string;
  email: string;
  role: Role;
  color: string;
  /** Quando o Super Admin está acessando uma loja, guarda o id dele. */
  impersonatedBy?: string;
};

/**
 * Cria a sessão do usuário. Quando `impersonatorId` é informado, a sessão
 * representa o usuário `userId` (ex.: admin da loja), mas registra de forma
 * assinada quem é o Super Admin por trás — permitindo voltar depois.
 */
export async function createSession(userId: string, impersonatorId?: string) {
  const token = await new SignJWT(
    impersonatorId ? { sub: userId, imp: impersonatorId } : { sub: userId }
  )
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });
}

export async function destroySession() {
  const store = await cookies();
  store.delete(COOKIE);
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    const user = await db.user.findUnique({
      where: { id: payload.sub as string },
    });
    if (!user || !user.active) return null;
    return {
      id: user.id,
      companyId: user.companyId,
      name: user.name,
      email: user.email,
      role: user.role,
      color: user.color,
      impersonatedBy:
        typeof payload.imp === "string" ? payload.imp : undefined,
    };
  } catch {
    return null;
  }
}

/** Lança se não autenticado — usar em páginas e rotas de API. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AuthError();
  return user;
}

export class AuthError extends Error {
  constructor() {
    super("Não autenticado");
  }
}
