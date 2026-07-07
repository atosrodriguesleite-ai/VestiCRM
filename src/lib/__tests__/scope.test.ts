import { describe, it, expect } from "vitest";
import { ownedScope, canSeeAll, isAdmin, isManagerUp, tenant } from "../scope";
import type { SessionUser } from "../auth";

const makeUser = (role: SessionUser["role"]): SessionUser => ({
  id: "user-1",
  companyId: "company-1",
  name: "Teste",
  email: "t@t.com",
  role,
  color: "#000",
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

describe("papéis", () => {
  it("hierarquia de permissões", () => {
    expect(isAdmin(makeUser("ADMIN"))).toBe(true);
    expect(isAdmin(makeUser("MANAGER"))).toBe(false);
    expect(isManagerUp(makeUser("MANAGER"))).toBe(true);
    expect(isManagerUp(makeUser("SELLER"))).toBe(false);
  });
});
