import { describe, it, expect } from "vitest";
import { classifyChannel, maskIp, parseUserAgent } from "../tracking/engine";

describe("classifyChannel (atribuição de canal)", () => {
  it("reconhece redes pelo ref", () => {
    expect(classifyChannel({ ref: "instagram" })).toBe("instagram");
    expect(classifyChannel({ ref: "insta-stories" })).toBe("instagram");
    expect(classifyChannel({ ref: "qr-vitrine" })).toBe("qr");
    expect(classifyChannel({ ref: "gmb" })).toBe("google-meu-negocio");
  });

  it("campanha vem do canal configurado", () => {
    expect(classifyChannel({ ref: "verao", campaignChannel: "facebook" })).toBe("facebook");
  });

  it("ref de vendedor conhecido vira canal 'vendedor'", () => {
    expect(classifyChannel({ ref: "joao", isSeller: true })).toBe("vendedor");
  });

  it("cai no referer quando não há ref", () => {
    expect(classifyChannel({ referer: "https://www.instagram.com/" })).toBe("instagram");
    expect(classifyChannel({ referer: "https://www.google.com/search" })).toBe("google");
  });

  it("sem nada é acesso direto", () => {
    expect(classifyChannel({})).toBe("direto");
  });
});

describe("maskIp (LGPD)", () => {
  it("zera o último octeto IPv4", () => {
    expect(maskIp("187.65.201.42")).toBe("187.65.201.0");
  });

  it("pega apenas o primeiro IP do x-forwarded-for", () => {
    expect(maskIp("187.65.201.42, 10.0.0.1")).toBe("187.65.201.0");
  });

  it("trunca IPv6", () => {
    expect(maskIp("2804:14d:5c3a:8a00:1:2:3:4")).toBe("2804:14d:5c3a::");
  });

  it("nulo permanece nulo", () => {
    expect(maskIp(null)).toBeNull();
    expect(maskIp(undefined)).toBeNull();
  });
});

describe("parseUserAgent", () => {
  it("detecta iPhone/iOS/Safari", () => {
    const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Safari/604";
    const r = parseUserAgent(ua);
    expect(r.device).toBe("mobile");
    expect(r.os).toBe("iOS");
    expect(r.browser).toBe("Safari");
  });

  it("detecta Android/Chrome", () => {
    const ua = "Mozilla/5.0 (Linux; Android 14; SM-G991B) AppleWebKit/537 Chrome/120 Mobile Safari/537";
    const r = parseUserAgent(ua);
    expect(r.device).toBe("mobile");
    expect(r.os).toBe("Android");
    expect(r.browser).toBe("Chrome");
  });

  it("detecta desktop Windows", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537 Chrome/120 Safari/537";
    const r = parseUserAgent(ua);
    expect(r.device).toBe("desktop");
    expect(r.os).toBe("Windows");
  });

  it("user-agent vazio não quebra", () => {
    const r = parseUserAgent(null);
    expect(r.device).toBe("desktop");
    expect(r.os).toBe("Outro");
    expect(r.browser).toBe("Outro");
  });
});
