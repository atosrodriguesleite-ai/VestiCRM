import { describe, it, expect } from "vitest";
import { canonicalPhone } from "../merge-contacts";

describe("canonicalPhone (agrupa a mesma pessoa)", () => {
  it("com e sem o 9º dígito dão a mesma chave", () => {
    expect(canonicalPhone("5533988585607")).toBe(canonicalPhone("(33) 8858-5607"));
  });
  it("números diferentes dão chaves diferentes", () => {
    expect(canonicalPhone("11998761001")).not.toBe(canonicalPhone("11998761002"));
  });
  it("normaliza para DDI 55", () => {
    expect(canonicalPhone("(11) 3456-7890")).toBe("551134567890");
  });
});
