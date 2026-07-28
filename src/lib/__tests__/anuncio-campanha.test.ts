import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { juntarRef, refsDaCampanha, rotuloDoAnuncio, normalizaRefDigitada } from "../ad-match";

/**
 * VINCULAR O ANÚNCIO À CAMPANHA DIRETO DO CHAT.
 *
 * A vendedora vê "Cliente veio de um ANÚNCIO" na conversa e resolve ali mesmo
 * de qual campanha aquilo é. Duas garantias sustentam essa porta:
 *
 *  • o código entra na campanha SEM repetir e SEM apagar o que já estava lá
 *    (a loja pode ter colado vários posts na mesma campanha);
 *  • o vínculo é retroativo só para quem está SEM campanha — quem já tem dona
 *    não é reescrita (vale o primeiro contato).
 */

describe("juntar o anúncio na lista da campanha", () => {
  it("campanha sem nenhum anúncio recebe o primeiro", () => {
    expect(juntarRef(null, "dbn-u8qsqk4")).toBe("dbn-u8qsqk4");
    expect(juntarRef("", "dbn-u8qsqk4")).toBe("dbn-u8qsqk4");
  });

  it("não perde os posts que já estavam na campanha", () => {
    const antes = "https://www.instagram.com/p/AAA111bbb/\nabc123";
    const depois = juntarRef(antes, "dbn-u8qsqk4");
    expect(refsDaCampanha(depois)).toEqual(["aaa111bbb", "abc123", "dbn-u8qsqk4"]);
  });

  it("não repete anúncio que já está lá (nem se veio como link)", () => {
    const antes = "https://www.instagram.com/p/DbN-U8QsQK4/";
    // o mesmo post, agora pelo código que o WhatsApp mandou
    expect(juntarRef(antes, "dbn-u8qsqk4")).toBe(antes);
    expect(refsDaCampanha(juntarRef(antes, "dbn-u8qsqk4"))).toHaveLength(1);
  });

  it("vincular duas vezes seguidas não duplica", () => {
    const uma = juntarRef(null, "abc123");
    expect(juntarRef(uma, "abc123")).toBe(uma);
  });

  it("o código entra sempre no mesmo formato do que veio do WhatsApp", () => {
    // maiúsculas do link colado x minúsculas do código: um formato só
    const lista = refsDaCampanha(juntarRef(null, normalizaRefDigitada("DbN-U8QsQK4")!));
    expect(lista).toEqual(["dbn-u8qsqk4"]);
  });
});

describe("como a equipe lê o anúncio na tela", () => {
  it("diz a origem, não só o código solto", () => {
    expect(rotuloDoAnuncio("dbn-u8qsqk4", "https://www.instagram.com/p/DbN-U8QsQK4/")).toBe(
      "Post do Instagram · dbn-u8qsqk4"
    );
    expect(rotuloDoAnuncio("1234567890123", "https://www.facebook.com/loja/posts/1234567890123")).toBe(
      "Post do Facebook · 1234567890123"
    );
  });

  it("sem link conhecido, ainda assim é legível", () => {
    expect(rotuloDoAnuncio("120210000000012345")).toBe("Anúncio · 120210000000012345");
  });
});

describe("a porta de vincular (rota)", () => {
  const rota = readFileSync(
    join(process.cwd(), "src/app/api/marketing/anuncios/vincular/route.ts"),
    "utf8"
  );

  it("é da loja e só de gerente para cima", () => {
    expect(rota).toContain("isManagerUp");
    expect(rota).toContain("companyId: user.companyId");
  });

  it("o vínculo retroativo NÃO mexe em quem já tem campanha", () => {
    // sem esse filtro, vincular um anúncio roubaria clientes de outra campanha
    expect(rota).toMatch(/campaignId:\s*null/);
  });

  it("busca campanha existente sempre dentro da própria loja", () => {
    // uma loja não pode vincular anúncio na campanha de outra
    const buscas = rota.match(/marketingCampaign\.findFirst\(\{[\s\S]*?\}\)/g) ?? [];
    expect(buscas.length).toBeGreaterThan(0);
    for (const b of buscas) expect(b).toContain("companyId: user.companyId");
  });

  it("um anúncio, uma campanha só (não deixa duas donas do mesmo anúncio)", () => {
    // duas campanhas com o mesmo anúncio = atribuição no chute
    expect(rota).toMatch(/const dona =/);
    expect(rota).toContain("já está na campanha");
  });

  it("mesmo nome não vira campanha repetida", () => {
    expect(rota).toMatch(/name\.trim\(\)\.toLowerCase\(\) === nome\.toLowerCase\(\)/);
  });

  it("campanha criada na hora nasce da loja e ativa", () => {
    const criar = rota.slice(rota.indexOf("marketingCampaign.create"));
    expect(criar).toContain("companyId: user.companyId");
    expect(criar).toMatch(/active:\s*true/);
  });
});
