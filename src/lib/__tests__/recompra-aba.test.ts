import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  faixaFixa,
  mensagemAniversario,
  mensagemHoraDeRepor,
  mensagemNovidade,
  mensagemVipLancamento,
} from "../recompra";

/**
 * ABA RECOMPRA — decisões do dono (01/08/2026): ritmo próprio + faixas,
 * Top 20 VIP, estímulos (lançamento VIP / aniversário / novidade do gosto),
 * e NADA sai sozinho — a vendedora dispara.
 */

describe("faixas fixas (para quem ainda não tem ritmo próprio)", () => {
  it.each([
    [0, "ATIVA"],
    [29, "ATIVA"],
    [30, "ESFRIANDO"],
    [59, "ESFRIANDO"],
    [60, "RISCO"],
    [89, "RISCO"],
    [90, "SUMIDA"],
    [400, "SUMIDA"],
  ])("%s dias sem comprar → %s", (dias, faixa) => {
    expect(faixaFixa(dias)).toBe(faixa);
  });
});

describe("mensagens prontas", () => {
  it("hora de repor cita o ritmo DELA e leva o catálogo", () => {
    const m = mensagemHoraDeRepor("Camila Rodrigues", 35, "https://catalago.net/loja");
    expect(m).toContain("Oi Camila!");
    expect(m).toContain("a cada 35 dias");
    expect(m).toContain("https://catalago.net/loja");
  });

  it("sem ritmo conhecido, não inventa número", () => {
    expect(mensagemHoraDeRepor("Ana", null, "x")).not.toContain("a cada");
  });

  it("aniversário, novidade e VIP chamam pelo primeiro nome", () => {
    expect(mensagemAniversario("Juliana Zanfolin", "x")).toContain("Juliana!!");
    expect(mensagemNovidade("Vitoria de Souza", "Vestidos", "x")).toContain(
      "novidades em Vestidos"
    );
    expect(mensagemVipLancamento("Sibelle Freitas", "x")).toContain("Sibelle");
    expect(mensagemVipLancamento("Sibelle Freitas", "x")).toContain("ANTES de todo mundo");
  });
});

describe("a aba usa a MESMA régua do motor da agenda", () => {
  const lib = readFileSync(join(process.cwd(), "src/lib/recompra.ts"), "utf8");

  it("ciclo e 'passou do ponto' vêm de cicloEntreCompras/passouDoRitmo (fonte única)", () => {
    // duas telas discordando de "quem está na hora" seria veneno
    expect(lib).toContain("cicloEntreCompras(datas[0], ultima, datas.length)");
    expect(lib).toContain("passouDoRitmo(diasDesde, ciclo)");
  });

  it("VIP é Top 20 por valor comprado (netTotal — régua do faturamento)", () => {
    expect(lib).toContain("TOP_VIPS = 20");
    expect(lib).toContain("s + o.netTotal");
  });

  it("vendedora vê a carteira DELA (ownedScope)", () => {
    expect(lib).toContain("ownedScope(user)");
  });

  it("a tela existe e está no menu", () => {
    const shell = readFileSync(join(process.cwd(), "src/components/app-shell.tsx"), "utf8");
    expect(shell).toContain('href: "/recompra"');
    const view = readFileSync(
      join(process.cwd(), "src/app/(app)/recompra/recompra-view.tsx"),
      "utf8"
    );
    // nada automático: os botões abrem o WhatsApp da vendedora (wa.me)
    expect(view).toContain("wa.me");
    expect(view).not.toContain("sendMessage");
  });
});
