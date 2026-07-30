import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { podeOperarIntegracoes, isAdmin, isSupport } from "../scope";
import type { SessionUser } from "../auth";

/**
 * O SUPORTE CUIDA DAS INTEGRAÇÕES — E SÓ DELAS.
 *
 * Quando a Nuvemshop desanda ou o estoque desencontra, quem resolve é o
 * suporte. Antes ele era expulso da tela de Configurações inteira e precisava
 * acordar um admin só para clicar em "sincronizar".
 *
 * Abrir isso não pode virar uma porta lateral para o comercial: preço,
 * comissão, pedido mínimo e credenciais continuam fora do papel dele. Este
 * teste trava os dois lados.
 */

const quem = (role: string): SessionUser =>
  ({ id: "u1", companyId: "c1", role, name: "Teste", email: "" }) as unknown as SessionUser;

describe("quem pode operar integrações", () => {
  it("suporte pode — é o trabalho dele", () => {
    expect(podeOperarIntegracoes(quem("SUPPORT"))).toBe(true);
  });

  it("admin e gerente podem, como antes", () => {
    expect(podeOperarIntegracoes(quem("ADMIN"))).toBe(true);
    expect(podeOperarIntegracoes(quem("MANAGER"))).toBe(true);
    expect(podeOperarIntegracoes(quem("SUPERADMIN"))).toBe(true);
  });

  it("vendedora NÃO pode — integração quebrada afeta a loja inteira", () => {
    expect(podeOperarIntegracoes(quem("SELLER"))).toBe(false);
  });

  it("suporte continua não sendo admin", () => {
    // a porta que abrimos é a de integração, não a de administrador
    expect(isAdmin(quem("SUPPORT"))).toBe(false);
    expect(isSupport(quem("SUPPORT"))).toBe(true);
  });
});

describe("o comercial continua fechado para o suporte", () => {
  const ler = (p: string) => readFileSync(join(process.cwd(), "src", p), "utf8");

  it("credenciais das integrações seguem só com o admin", () => {
    // token do Meta, senha de SMTP e afins são criptografados e auditados:
    // operar a integração é uma coisa, ver/trocar segredo é outra
    const fonte = ler("app/api/comm/settings/route.ts");
    expect(
      /isAdmin\(user\)/.test(fonte),
      "As credenciais (tokens, senhas) não podem cair na mão do suporte."
    ).toBe(true);
    expect(/podeOperarIntegracoes/.test(fonte)).toBe(false);
  });

  it("a tela de Configurações esconde o comercial do suporte", () => {
    const fonte = ler("app/(app)/configuracoes/page.tsx");
    // pedido mínimo, base de comissão e identidade do catálogo ficam atrás
    // desta trava; se ela sumir, o suporte passa a mexer em dinheiro
    expect(
      /const comercial = !isSupport\(user\)/.test(fonte),
      "Sem essa trava, o suporte passa a ver pedido mínimo e base de comissão."
    ).toBe(true);
    expect(/\{comercial && /.test(fonte)).toBe(true);
  });
});
