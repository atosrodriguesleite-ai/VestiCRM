import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { nomeProvisorio } from "../intake";

/**
 * NOME DA CLIENTE NO PEDIDO DO CATÁLOGO — incidente Entre Linhas, pedido
 * #0146 (30/07/2026).
 *
 * A cliente mandou o pedido pelo catálogo e ele apareceu no painel com o
 * TELEFONE no lugar do nome: "Contato (77) 8101-4696".
 *
 * O que acontecia: a mensagem do WhatsApp chega primeiro e o sistema batiza o
 * contato com o telefone (ainda não sabe quem é). Depois o pedido do catálogo
 * chega com o nome DIGITADO pela cliente — e era jogado fora, porque a regra
 * de atualização só gravava o nome "se o cliente não tivesse nome". Só que
 * nome é campo obrigatório no banco: NUNCA está vazio. Ou seja, a condição
 * jamais era verdadeira e o nome digitado se perdia toda vez.
 *
 * A regra certa: crachá provisório dá lugar ao nome de verdade; nome escrito
 * por gente nunca é sobrescrito.
 */

describe("crachá provisório (o sistema inventou)", () => {
  it.each([
    "Contato (77) 8101-4696",
    "Contato 4696",
    "contato (11) 99999-8888",
    "Lead 4696",
    "Cliente do catálogo (não identificado)",
    "Cliente do catalogo",
    "(77) 8101-4696",
    "5577810146 96",
    "   ",
    "",
  ])("%s é provisório", (nome) => {
    expect(nomeProvisorio(nome)).toBe(true);
  });

  it("nulo também conta como provisório", () => {
    expect(nomeProvisorio(null)).toBe(true);
    expect(nomeProvisorio(undefined)).toBe(true);
  });
});

describe("nome de gente NUNCA é sobrescrito", () => {
  it.each([
    "Samira Duarte",
    "LOJA DA GABI",
    "Boutique Charme",
    "Ana",
    "Maria José da Silva",
    "Contatos Modas", // começa com "Contato" mas é nome de loja de verdade
    "Leadership Store",
  ])("%s é nome de verdade", (nome) => {
    expect(nomeProvisorio(nome)).toBe(false);
  });
});

describe("a regra está ligada na entrada de leads", () => {
  const intake = readFileSync(join(process.cwd(), "src/lib/intake.ts"), "utf8");

  it("a condição velha (que nunca era verdade) saiu", () => {
    expect(intake).not.toContain("payload.name && !existing.name");
  });

  it("agora o nome de verdade substitui o provisório", () => {
    expect(intake).toContain("nomeProvisorio(existing.name)");
    expect(intake).toContain("{ name: payload.name.trim() }");
  });
});
