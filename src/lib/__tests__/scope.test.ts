import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ownedScope,
  canSeeAll,
  conversationScope,
  isAdmin,
  isManagerUp,
  tenant,
} from "../scope";
import type { SessionUser } from "../auth";

const makeUser = (
  role: SessionUser["role"],
  extra?: Partial<SessionUser>
): SessionUser => ({
  id: "user-1",
  companyId: "company-1",
  name: "Teste",
  email: "t@t.com",
  role,
  color: "#000",
  chatVisaoTotal: false,
  ...extra,
});

describe("isolamento multi-tenant", () => {
  it("todo escopo carrega o companyId do usuário", () => {
    for (const role of ["ADMIN", "MANAGER", "SELLER", "SUPPORT"] as const) {
      expect(tenant(makeUser(role))).toEqual({ companyId: "company-1" });
      expect(ownedScope(makeUser(role)).companyId).toBe("company-1");
    }
  });

  it("vendedor enxerga apenas os próprios registros", () => {
    expect(ownedScope(makeUser("SELLER"))).toEqual({
      companyId: "company-1",
      ownerId: "user-1",
    });
    expect(canSeeAll(makeUser("SELLER"))).toBe(false);
  });

  it("admin e gerente enxergam a empresa toda (mas só a própria)", () => {
    expect(ownedScope(makeUser("ADMIN"))).toEqual({ companyId: "company-1" });
    expect(ownedScope(makeUser("MANAGER"))).toEqual({ companyId: "company-1" });
    expect(canSeeAll(makeUser("ADMIN"))).toBe(true);
  });
});

describe("visão total do chat (pedido da Toque Leve, 17/08/2026)", () => {
  it("vendedora comum vê os atendimentos dela + a fila", () => {
    expect(conversationScope(makeUser("SELLER"))).toEqual({
      companyId: "company-1",
      OR: [{ assigneeId: "user-1" }, { assigneeId: null }],
    });
  });

  it("vendedora com o interruptor ligado vê TODAS as conversas da loja", () => {
    expect(conversationScope(makeUser("SELLER", { chatVisaoTotal: true }))).toEqual({
      companyId: "company-1",
    });
  });

  it("o interruptor vale SÓ no chat: carteira e pedidos seguem de vendedora", () => {
    const leticia = makeUser("SELLER", { chatVisaoTotal: true });
    expect(ownedScope(leticia)).toEqual({
      companyId: "company-1",
      ownerId: "user-1",
    });
    expect(canSeeAll(leticia)).toBe(false);
  });

  it("mesmo com visão total, o isolamento da LOJA continua (multi-tenant)", () => {
    expect(
      conversationScope(makeUser("SELLER", { chatVisaoTotal: true })).companyId
    ).toBe("company-1");
  });
});

describe("as duas portas que a visão total NÃO abre (revisão 17/08/2026)", () => {
  const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("backup CSV segue o escopo normal da vendedora (histórico da loja não desce)", () => {
    // ver a Central na tela é uma coisa; baixar TODAS as conversas da loja
    // para o computador é outro tamanho de porta (LGPD, saída de funcionária)
    expect(ler("src/app/api/export/conversas/route.ts")).toContain(
      "chatVisaoTotal: false"
    );
  });

  it("na conversa da colega, o link do catálogo leva o ref de QUEM ATENDE", () => {
    // RN-005: quem manda o link leva a venda E a carteira — a visão total
    // não pode virar atalho para tomar a cliente da colega com dois cliques
    const f = ler("src/lib/inbox-data.ts");
    expect(f).toContain("refDaConversa");
    expect(f).toContain("c.assigneeId !== user.id");
  });
});

describe("papéis", () => {
  it("hierarquia de permissões", () => {
    expect(isAdmin(makeUser("ADMIN"))).toBe(true);
    expect(isAdmin(makeUser("MANAGER"))).toBe(false);
    expect(isManagerUp(makeUser("MANAGER"))).toBe(true);
    expect(isManagerUp(makeUser("SELLER"))).toBe(false);
  });
});
