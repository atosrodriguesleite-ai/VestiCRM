import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { db } from "./db";
import type { Role } from "@prisma/client";

const COOKIE = "vesticrm_session";
const secret = new TextEncoder().encode(
  process.env.AUTH_SECRET ?? "vesticrm-dev-secret"
);

export type SessionUser = {
  id: string;
  companyId: string;
  name: string;
  email: string;
  role: Role;
  color: string;
};

export async function createSession(userId: string) {
  const token = await new SignJWT({ sub: userId })
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
