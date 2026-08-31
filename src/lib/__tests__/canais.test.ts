import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  CANAL_WHATSAPP_CATALOGO,
  canalDaOrigem,
  canalValido,
  labelDoCanal,
  origensDoCanal,
} from "../canais";
import { originLabel } from "../format";

// Guarda RN-026
//
// WhatsApp e catálogo público são O MESMO canal nas métricas: a cliente que
// chama no WhatsApp recebe o link do catálogo e pede por ele — separar os
// dois fazia o canal das vendedoras parecer dois canais pequenos ao lado da
// Nuvemshop, e a loja tirava conclusão errada de onde investir.

describe("RN-026 — WhatsApp e catálogo público são um canal só nas métricas", () => {
  it("as duas origens caem no MESMO canal, com um nome que diz os dois", () => {
    expect(canalDaOrigem("WHATSAPP")).toBe(CANAL_WHATSAPP_CATALOGO);
    expect(canalDaOrigem("CATALOGO_PUBLICO")).toBe(CANAL_WHATSAPP_CATALOGO);
    // o nome precisa citar os dois lados: "WhatsApp" sozinho esconderia o
    // catálogo, e vice-versa — a loja precisa entender o que está somado
    expect(labelDoCanal(CANAL_WHATSAPP_CATALOGO).toLowerCase()).toContain("whatsapp");
    expect(labelDoCanal(CANAL_WHATSAPP_CATALOGO).toLowerCase()).toContain("catálogo");
  });

  it("os DEMAIS canais seguem separados, com o rótulo de sempre", () => {
    for (const origem of Object.keys(originLabel)) {
      if (origem === "WHATSAPP" || origem === "CATALOGO_PUBLICO") continue;
      expect(canalDaOrigem(origem)).toBe(origem);
      expect(labelDoCanal(origem)).toBe(originLabel[origem as keyof typeof originLabel]);
    }
    // Nuvemshop é o exemplo que motivou a regra: loja online é OUTRO canal
    expect(canalDaOrigem("NUVEMSHOP")).toBe("NUVEMSHOP");
  });

  it("o filtro do canal unido cobre as duas origens — e o dos demais, só a própria", () => {
    // é o que o `where` do filtro por canal usa: se o canal unido devolvesse
    // uma origem só, o filtro mostraria METADE das vendas do canal
    expect([...origensDoCanal(CANAL_WHATSAPP_CATALOGO)].sort()).toEqual([
      "CATALOGO_PUBLICO",
      "WHATSAPP",
    ]);
    expect(origensDoCanal("NUVEMSHOP")).toEqual(["NUVEMSHOP"]);
  });

  it("link antigo com a origem separada continua valendo (vira o canal unido)", () => {
    // favorito salvo com ?canal=WHATSAPP não pode virar tela vazia
    expect(canalValido("WHATSAPP")).toBe(true);
    expect(canalValido("CATALOGO_PUBLICO")).toBe(true);
    expect(canalValido(CANAL_WHATSAPP_CATALOGO)).toBe(true);
    expect(canalValido("QUALQUER_COISA")).toBe(false);
    // a URL é da visita: chave herdada de objeto (?canal=constructor) não é
    // canal — passar aqui derrubava a tela lá na frente, no Prisma
    for (const lixo of ["constructor", "toString", "hasOwnProperty", "__proto__"]) {
      expect(canalValido(lixo), `"${lixo}" não pode valer como canal`).toBe(false);
    }
  });

  it("labelDoCanal canoniza sozinho: origem crua já sai com o nome do canal unido", () => {
    // esquecer o canalDaOrigem no meio não pode ressuscitar o canal separado
    expect(labelDoCanal("WHATSAPP")).toBe(labelDoCanal(CANAL_WHATSAPP_CATALOGO));
    expect(labelDoCanal("CATALOGO_PUBLICO")).toBe(labelDoCanal(CANAL_WHATSAPP_CATALOGO));
    // e chave herdada de objeto volta como veio, nunca como função do protótipo
    expect(labelDoCanal("constructor")).toBe("constructor");
  });

  it("toda tela que agrega métrica por canal passa pela soma (varredura)", () => {
    // mesma lógica do guarda de faturamento: a regra só vale se as telas a
    // usarem. Uma agregação nova por `originLabel[...origin]` cru recriaria
    // o canal separado em silêncio.
    const telas = [
      "src/app/(app)/marketing/page.tsx",
      "src/app/(app)/relatorios/page.tsx",
      "src/app/api/export/relatorio/route.ts",
    ];
    for (const tela of telas) {
      const codigo = readFileSync(tela, "utf8");
      expect(codigo, `${tela} não usa canalDaOrigem — a soma da RN-026 sumiu daí`).toMatch(
        /canalDaOrigem\(/
      );
      // agregação direto pelo rótulo da origem crua é o jeito antigo voltando
      expect(
        codigo.match(/originLabel\[/g) ?? [],
        `${tela} volta a rotular origem crua em métrica — usar labelDoCanal(canalDaOrigem(...))`
      ).toEqual([]);
    }
  });
});
