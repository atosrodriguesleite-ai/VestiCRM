import { describe, it, expect } from "vitest";
import { ondeAbrir, partesDoTexto, temLink } from "../links-do-texto";

/**
 * LINKS NAS MENSAGENS DA CENTRAL (pedido do dono, 15/11/2026: "abrir links
 * enviados e recebidos nas conversas"). O texto vem da CLIENTE — a régua é
 * de segurança (só http/https, nada de usuário embutido) e de bom senso
 * (ponto sem espaço não vira endereço).
 */
const links = (t: string) => partesDoTexto(t).flatMap((p) => (p.tipo === "link" ? [p] : []));
const hrefs = (t: string) => links(t).map((l) => l.href);

describe("o que vira link", () => {
  it("endereço com https e com http", () => {
    expect(hrefs("olha https://catalago.net/toque-leve/julia/a3f9c2b aqui")).toEqual([
      "https://catalago.net/toque-leve/julia/a3f9c2b",
    ]);
    expect(hrefs("http://exemplo.com.br/x?y=1&z=2")).toEqual(["http://exemplo.com.br/x?y=1&z=2"]);
  });

  it("www e domínio solto ganham https", () => {
    expect(hrefs("entra em www.minhaloja.com.br")).toEqual(["https://www.minhaloja.com.br/"]);
    expect(hrefs("meu insta: instagram.com/lojadaana")).toEqual(["https://instagram.com/lojadaana"]);
    expect(hrefs("catalago.net/toque-leve")).toEqual(["https://catalago.net/toque-leve"]);
  });

  it("terminação curta só vale com caminho", () => {
    expect(hrefs("me chama: wa.me/5511999998888")).toEqual(["https://wa.me/5511999998888"]);
    expect(hrefs("bit.ly/abc123")).toEqual(["https://bit.ly/abc123"]);
    expect(hrefs("depois você fala.me avisa")).toEqual([]);
  });

  it("terminação que também é PALAVRA só vale com caminho (ou com https/www)", () => {
    // ponto sem espaço entre duas frases — achado da revisão
    expect(temLink("manda o site.link do catalogo")).toBe(false);
    expect(temLink("fica a vontade.site novo no ar")).toBe(false);
    expect(temLink("comprei.online é mais facil")).toBe(false);
    // com caminho, com www ou com https é endereço
    expect(hrefs("minhaloja.site/promo")).toEqual(["https://minhaloja.site/promo"]);
    expect(hrefs("www.minhaloja.online")).toEqual(["https://www.minhaloja.online/"]);
    expect(hrefs("https://minhaloja.app")).toEqual(["https://minhaloja.app/"]);
  });

  it("o endereço não perde pedaço: o _ do fim é DELE", () => {
    // sem o "_" é OUTRO perfil — achado da revisão
    expect(hrefs("meu insta instagram.com/toqueleve_")).toEqual(["https://instagram.com/toqueleve_"]);
    expect(hrefs("https://www.instagram.com/toque_leve_ segue lá")).toEqual([
      "https://www.instagram.com/toque_leve_",
    ]);
    expect(hrefs("https://youtu.be/abcdefghij_")).toEqual(["https://youtu.be/abcdefghij_"]);
    // apóstrofo no meio do endereço não corta
    expect(links("https://loja.com/a?x=1&y='2'&z=3")[0].texto).toBe("https://loja.com/a?x=1&y='2'&z=3");
  });

  it("vários links na mesma mensagem, na ordem", () => {
    expect(hrefs("a https://a.com b https://b.com/x c")).toEqual(["https://a.com/", "https://b.com/x"]);
  });

  it("o texto mostrado é o que foi escrito, e os pedaços remontam o original", () => {
    for (const t of [
      "Oi! veja (https://loja.com/p?a=1). Depois me fala, tá?",
      "sem link nenhum aqui",
      "*https://loja.com* e _www.outra.com.br_!",
      "linha 1\nhttps://x.com/a\nlinha 3",
      "",
    ]) {
      expect(partesDoTexto(t).map((p) => p.texto).join("")).toBe(t);
    }
    expect(links("veja https://loja.com/p?a=1.")[0].texto).toBe("https://loja.com/p?a=1");
  });
});

describe("a pontuação da frase não entra no endereço", () => {
  it("ponto, vírgula, exclamação e aspas no fim ficam de fora", () => {
    expect(hrefs("é esse: https://loja.com/peca.")).toEqual(["https://loja.com/peca"]);
    expect(hrefs("https://loja.com/peca, viu?")).toEqual(["https://loja.com/peca"]);
    expect(hrefs('"https://loja.com/peca"!')).toEqual(["https://loja.com/peca"]);
  });

  it("parêntese que fecha a FRASE sai; o que fecha um do endereço fica", () => {
    expect(hrefs("(veja https://loja.com/a)")).toEqual(["https://loja.com/a"]);
    expect(hrefs("https://pt.wikipedia.org/wiki/Moda_(vestuario)")).toEqual([
      "https://pt.wikipedia.org/wiki/Moda_(vestuario)",
    ]);
  });

  it("negrito e itálico do WhatsApp em volta do link", () => {
    expect(hrefs("*https://loja.com/x*")).toEqual(["https://loja.com/x"]);
    expect(hrefs("_https://loja.com/x_")).toEqual(["https://loja.com/x"]);
    expect(hrefs("veja _www.outra.com.br_!")).toEqual(["https://www.outra.com.br/"]);
    expect(hrefs("~instagram.com/loja~")).toEqual(["https://instagram.com/loja"]);
    // um par só: o "_" do endereço fica, o do itálico sai
    expect(hrefs("_https://instagram.com/toqueleve__")).toEqual(["https://instagram.com/toqueleve_"]);
    // sinal no fim SEM o par no começo é do endereço
    expect(hrefs("https://loja.com/x*")).toEqual(["https://loja.com/x*"]);
  });
});

describe("o que NÃO vira link", () => {
  it("ponto sem espaço entre frases (a maiúscula do corretor)", () => {
    expect(temLink("tudo certo.Com certeza eu vou")).toBe(false);
    expect(temLink("obrigada.Me avisa quando chegar")).toBe(false);
    expect(temLink("vi a peça.Net de pesca não tenho")).toBe(false);
  });

  it("e-mail não vira link nem pela metade", () => {
    expect(temLink("meu email é ana.silva@gmail.com")).toBe(false);
    expect(temLink("contato@loja.com.br")).toBe(false);
    // o NOME do e-mail com cara de domínio — achado da revisão
    expect(temLink("meu email é minhaloja.com@gmail.com")).toBe(false);
    expect(temLink("banco.com@golpe.com")).toBe(false);
  });

  it("terminação que só ENCOSTOU numa palavra com acento", () => {
    expect(temLink("loja.comércio do centro")).toBe(false);
    expect(temLink("fui na feira.netão me ligou")).toBe(false);
  });

  it("valor, medida e nome de arquivo", () => {
    expect(temLink("R$ 39.90 cada, tamanho 1.60")).toBe(false);
    expect(temLink("mandei o arquivo foto.png e o pedido.pdf")).toBe(false);
    expect(temLink("loja.comercial do centro")).toBe(false);
    // letra com acento antes do ponto: o pedaço "a.net" não é endereço
    expect(temLink("vi a peça.net de pesca não tenho")).toBe(false);
    expect(temLink("amanhã.com certeza")).toBe(false);
  });

  it("esquema que não é http(s) nunca é link", () => {
    expect(temLink("javascript:alert(1)")).toBe(false);
    expect(temLink("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(temLink("file:///etc/passwd")).toBe(false);
    for (const l of links("x javascript://loja.com/%0aalert(1) y")) {
      expect(l.href.startsWith("https://")).toBe(true);
    }
  });

  it("endereço com usuário embutido (um domínio fingindo ser outro)", () => {
    expect(temLink("https://bancodobrasil.com.br@golpe.com/entrar")).toBe(false);
    expect(temLink("https://usuario:senha@site.com")).toBe(false);
  });

  it("todo link que sai é http ou https", () => {
    const textos = [
      "https://a.com",
      "www.a.com",
      "a.com/b",
      "HTTPS://A.COM/B",
      "wa.me/55",
      "x https://[::1]/ y",
      "https://",
      "www.",
    ];
    for (const t of textos) {
      for (const l of links(t)) expect(/^https?:\/\//.test(l.href)).toBe(true);
    }
    expect(temLink("https://")).toBe(false);
    expect(temLink("www.")).toBe(false);
  });
});

describe("mensagem gigante não trava a tela", () => {
  // a mensagem do WhatsApp chega a 65 mil letras; a busca de links roda a
  // cada bolha desenhada. Medido na revisão com a busca sem teto: 3 segundos.
  const rapido = (texto: string) => {
    const t0 = performance.now();
    partesDoTexto(texto);
    return performance.now() - t0;
  };
  it("65 mil letras coladas", () => {
    expect(rapido("a".repeat(65_000))).toBeLessThan(250);
  });
  it("milhares de pontos seguidos", () => {
    expect(rapido("a.".repeat(30_000))).toBeLessThan(250);
    expect(rapido("ab-".repeat(20_000) + ".com")).toBeLessThan(250);
  });
  it("endereço enorme com esquema", () => {
    expect(rapido("https://" + "a".repeat(65_000))).toBeLessThan(250);
    expect(rapido(("www." + "x".repeat(60) + " ").repeat(1000))).toBeLessThan(250);
  });
});

describe("onde o link abre", () => {
  const app = "https://www.atacadopro.com";
  it("no navegador comum, tudo abre fora (aba nova)", () => {
    expect(ondeAbrir("https://catalago.net/loja", app, false)).toBe("fora");
    expect(ondeAbrir("https://www.atacadopro.com/rastreio/abc", app, false)).toBe("fora");
  });
  it("no aplicativo instalado, endereço de fora abre fora", () => {
    expect(ondeAbrir("https://catalago.net/loja", app, true)).toBe("fora");
    expect(ondeAbrir("https://atacadopro.com.golpe.net/x", app, true)).toBe("fora");
  });
  it("no aplicativo instalado, página PÚBLICA do próprio sistema abre na janela com X", () => {
    expect(ondeAbrir("https://www.atacadopro.com/rastreio/abc", app, true)).toBe("janela");
    expect(ondeAbrir("https://www.atacadopro.com/dados/tok", app, true)).toBe("janela");
    expect(ondeAbrir("https://www.atacadopro.com/catalogo/loja?ref=ana", app, true)).toBe("janela");
  });
  it("o que REDIRECIONA para fora (/api/) e as telas do app não entram na janela", () => {
    // o encurtador da bio leva para o endereço que qualquer loja cadastrou —
    // achado da revisão: site de fora numa janela que diz "sistema"
    expect(ondeAbrir("https://www.atacadopro.com/api/bio/go/abc", app, true)).toBe("fora");
    expect(ondeAbrir("https://www.atacadopro.com/api/messages/x/media", app, true)).toBe("fora");
    expect(ondeAbrir("https://www.atacadopro.com/pedidos/123", app, true)).toBe("fora");
    expect(ondeAbrir("https://www.atacadopro.com/", app, true)).toBe("fora");
    // parecido não é igual
    expect(ondeAbrir("https://www.atacadopro.com/rastreios-falsos", app, true)).toBe("fora");
  });
  it("endereço torto nunca vai para a janela", () => {
    expect(ondeAbrir("nada", app, true)).toBe("fora");
  });
});
