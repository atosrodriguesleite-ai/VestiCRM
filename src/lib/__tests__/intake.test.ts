import { describe, it, expect } from "vitest";
import { normalizePhone, phoneMatchVariants, pickRoundRobin } from "../intake";

describe("phoneMatchVariants (dedup tolerante ao 9º dígito)", () => {
  it("casa com/sem o 9 (mesma pessoa)", () => {
    // com 9 → também gera a versão sem 9
    expect(phoneMatchVariants("5533988585607")).toContain("553388585607");
    // sem 9 → também gera a versão com 9
    expect(phoneMatchVariants("(33) 8858-5607")).toContain("5533988585607");
  });
  it("as duas formas do mesmo número compartilham variação", () => {
    const a = phoneMatchVariants("5533988585607");
    const b = phoneMatchVariants("553388585607");
    expect(a.some((x) => b.includes(x))).toBe(true);
  });
  it("inclui sempre o próprio número normalizado", () => {
    expect(phoneMatchVariants("11998761001")).toContain("5511998761001");
  });
  it("inclui as formas legadas SEM o DDI 55 (cadastros antigos)", () => {
    // caso real (Larissa): WhatsApp manda 55 73 9134-7878 (sem o 9) e o
    // cadastro antigo pode estar salvo como 73991347878 ou 7391347878
    const v = phoneMatchVariants("557391347878");
    expect(v).toContain("7391347878"); // sem DDI, sem 9
    expect(v).toContain("73991347878"); // sem DDI, com 9
    expect(v).toContain("5573991347878"); // com DDI, com 9
  });
});

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
