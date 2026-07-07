import { describe, it, expect } from "vitest";
import { normalizePhone, pickRoundRobin } from "../intake";

describe("normalizePhone (deduplicação de leads)", () => {
  it("adiciona DDI 55 a números brasileiros com DDD", () => {
    expect(normalizePhone("(11) 99876-1001")).toBe("5511998761001");
    expect(normalizePhone("11998761001")).toBe("5511998761001");
  });

  it("mantém números que já têm DDI", () => {
    expect(normalizePhone("5511998761001")).toBe("5511998761001");
    expect(normalizePhone("+55 11 99876-1001")).toBe("5511998761001");
  });

  it("normaliza fixo de 10 dígitos", () => {
    expect(normalizePhone("(11) 3456-7890")).toBe("551134567890");
  });

  it("o mesmo cliente digitado de formas diferentes vira o mesmo telefone", () => {
    const formats = ["+55 (11) 99876-1001", "11 99876 1001", "5511998761001"];
    const normalized = formats.map(normalizePhone);
    expect(new Set(normalized).size).toBe(1);
  });
});

describe("pickRoundRobin (distribuição de leads)", () => {
  const sellers = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("começa pelo primeiro quando não há histórico", () => {
    expect(pickRoundRobin(sellers, null)?.id).toBe("a");
  });

  it("avança em rodízio e volta ao início", () => {
    expect(pickRoundRobin(sellers, "a")?.id).toBe("b");
    expect(pickRoundRobin(sellers, "b")?.id).toBe("c");
    expect(pickRoundRobin(sellers, "c")?.id).toBe("a");
  });

  it("se o último vendedor saiu da equipe, recomeça do primeiro", () => {
    expect(pickRoundRobin(sellers, "desligado")?.id).toBe("a");
  });

  it("sem vendedores retorna null", () => {
    expect(pickRoundRobin([], "a")).toBeNull();
  });
});
