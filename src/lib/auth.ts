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
  /** Vendedora com visão TOTAL do chat (só a Central; carteira/pedidos não). */
  chatVisaoTotal: boolean;
  /** Vendedora com visão TOTAL dos pedidos (exceção por pessoa à RN-007). */
  pedidosVisaoTotal: boolean;
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
      include: { company: { select: { suspended: true } } },
    });
    if (!user || !user.active) return null;

    const impersonatedBy =
      typeof payload.imp === "string" ? payload.imp : undefined;

    // Loja suspensa (ex.: inadimplência): bloqueia o acesso dos usuários dela.
    // O Super Admin nunca é bloqueado e continua podendo acessar a loja para
    // dar suporte (impersonação), inclusive para reativar depois.
    if (
      user.company.suspended &&
      user.role !== "SUPERADMIN" &&
      !impersonatedBy
    ) {
      return null;
    }

    // Registra o último acesso REAL (a cada ~10 min, para não escrever à toa).
    // Não conta quando o Super Admin está acessando a loja (impersonação),
    // senão o painel mostraria a loja como "ativa" sem o cliente ter entrado.
    if (!impersonatedBy) {
      const stale =
        !user.lastActiveAt ||
        Date.now() - user.lastActiveAt.getTime() > 10 * 60 * 1000;
      if (stale) {
        await db.user
          .update({ where: { id: user.id }, data: { lastActiveAt: new Date() } })
          .catch(() => {});
      }
    }

    return {
      id: user.id,
      companyId: user.companyId,
      name: user.name,
      email: user.email,
      role: user.role,
      color: user.color,
      // lidos do banco a CADA requisição: ligar/desligar na tela Equipe vale
      // na hora, sem a vendedora precisar sair e entrar
      chatVisaoTotal: user.chatVisaoTotal,
      pedidosVisaoTotal: user.pedidosVisaoTotal,
      impersonatedBy,
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
