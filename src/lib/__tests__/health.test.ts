import { describe, it, expect } from "vitest";
import { cooldownPassed } from "../health";

describe("cooldownPassed (anti-spam dos alertas)", () => {
  const now = new Date("2026-07-25T12:00:00Z");
  it("sem aviso anterior → pode avisar", () => {
    expect(cooldownPassed(null, now, 60_000)).toBe(true);
    expect(cooldownPassed(undefined, now, 60_000)).toBe(true);
  });
  it("aviso recente → segura (não spamma)", () => {
    const há30s = new Date(now.getTime() - 30_000);
    expect(cooldownPassed(há30s, now, 60_000)).toBe(false);
  });
  it("cooldown vencido → pode avisar de novo", () => {
    const há2min = new Date(now.getTime() - 120_000);
    expect(cooldownPassed(há2min, now, 60_000)).toBe(true);
  });
});
