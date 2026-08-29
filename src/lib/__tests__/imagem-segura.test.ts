// Guarda RN-026
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  ERRO_DE_FOTO,
  TIPOS_DE_IMAGEM,
  tipoDeImagem,
  urlDeFotoAceita,
  cabecalhosDaFoto,
} from "../imagem-segura";

/**
 * O ATAQUE QUE ESTE TESTE IMPEDE DE VOLTAR (auditoria 29/08/2026).
 *
 * A foto entrava como texto livre e saía com o tipo escrito nela mesma, o
 * que dava a qualquer pessoa logada uma PÁGINA hospedada em
 * www.atacadopro.com. O teste ataca pelos dois lados — pela entrada e pela
 * saída —, porque trancar só a entrada deixaria de fora o que já está
 * gravado no banco e as outras portas por onde foto entra.
 */

const ATAQUES = [
  "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==", // a página do relatório
  "data:text/html,<script>alert(document.domain)</script>",
  "data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+", // SVG executa
  "data:image/svg+xml,<svg onload=alert(1)>",
  "data:application/xhtml+xml,<html/>",
  "javascript:alert(document.cookie)",
  "data:text/javascript,alert(1)",
  "//evil.example.com/foto.jpg", // endereço externo disfarçado de caminho
  "/\\evil.example.com/foto.jpg", // idem, com barra INVERTIDA (o navegador lê como barra)
  "/\\\\evil.example.com/foto.jpg",
  "/api/img/x\\..\\evil.example.com",
];

const FOTOS_DE_VERDADE = [
  "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
  "data:image/png;base64,iVBORw0KGgo=",
  "data:image/webp;base64,UklGRg==",
  "https://cdn.loja.com.br/vestido.jpg",
  "http://site-antigo.com/foto.png",
  "/api/img/abc123",
  "/products/x.jpg",
];

describe("entrada: o que o sistema aceita gravar como foto", () => {
  it("o ataque do relatório é recusado", () => {
    for (const ataque of ATAQUES) {
      expect(urlDeFotoAceita(ataque), ataque).toBe(false);
    }
  });

  it("SVG é recusado mesmo sendo 'imagem'", () => {
    // É o único formato de imagem que carrega programação dentro — e
    // nenhuma foto de peça de roupa é SVG.
    expect(tipoDeImagem("image/svg+xml")).toBe(null);
    expect((TIPOS_DE_IMAGEM as readonly string[])).not.toContain("image/svg+xml");
  });

  it("caminho com barra invertida vira endereço externo — e é recusado", () => {
    // O `new URL` (e o navegador) leem `\` como `/`: um "caminho interno"
    // `/\evil.com/x.jpg` resolve para `https://evil.com/x.jpg`, e a rota
    // pública de foto redirecionaria para lá com o nosso domínio na frente.
    const alvo = new URL("/\\evil.example.com/x.jpg", "https://www.atacadopro.com/api/img/a");
    expect(alvo.host).toBe("evil.example.com"); // é isso que torna o ataque real
    expect(urlDeFotoAceita("/\\evil.example.com/x.jpg")).toBe(false);
  });

  it("a recusa diz à lojista que o problema é a FOTO", () => {
    // "Dados inválidos" faz ela achar que errou o preço ou o nome.
    expect(ERRO_DE_FOTO).toMatch(/foto/i);
    expect(ERRO_DE_FOTO).toMatch(/JPG|PNG/i);
  });

  it("foto de verdade continua entrando, em todos os formatos que a loja usa", () => {
    for (const foto of FOTOS_DE_VERDADE) {
      expect(urlDeFotoAceita(foto), foto).toBe(true);
    }
  });

  it("o tipo é lido sem se confundir com maiúscula, espaço ou charset", () => {
    expect(tipoDeImagem("IMAGE/JPEG")).toBe("image/jpeg");
    expect(tipoDeImagem("image/jpg")).toBe("image/jpeg"); // apelido comum
    expect(tipoDeImagem(" image/png ; charset=utf-8")).toBe("image/png");
    expect(tipoDeImagem("image/png x")).toBe(null);
    expect(tipoDeImagem(null)).toBe(null);
  });
});

describe("saída: como o arquivo chega ao navegador", () => {
  it("o que não é imagem NUNCA sai como página", () => {
    for (const tipo of ["text/html", "image/svg+xml", "application/pdf", ""]) {
      const h = cabecalhosDaFoto(tipo, { cache: "no-store", nome: "x.bin" });
      expect(h["Content-Type"], tipo).toBe("application/octet-stream");
      expect(h["Content-Disposition"], tipo).toContain("attachment");
    }
  });

  it("foto de verdade sai como imagem, com o tipo NORMALIZADO", () => {
    // Sai o tipo da nossa lista, não o texto que veio do banco: é isso que
    // impede `image/png, text/html` e afins de chegarem ao navegador.
    const h = cabecalhosDaFoto("image/jpg", { cache: "public, max-age=60" });
    expect(h["Content-Type"]).toBe("image/jpeg");
    expect(h["Content-Disposition"]).toBeUndefined();
    expect(h["Cache-Control"]).toBe("public, max-age=60");
  });

  it("toda resposta leva nosniff, imagem ou não", () => {
    // Sem ele o navegador ignora o tipo declarado e adivinha pelo conteúdo
    // — declarar o tipo não bastaria.
    for (const tipo of ["image/png", "text/html", null]) {
      const h = cabecalhosDaFoto(tipo, { cache: "no-store" });
      expect(h["X-Content-Type-Options"]).toBe("nosniff");
    }
  });

  it("o `sandbox` das portas de arquivo está onde ele de fato vale", () => {
    // Medido no servidor de verdade (29/08/2026): o cabeçalho do
    // `next.config.ts` VENCE o que a rota põe na resposta — a rota mandava
    // `sandbox` e chegava ao navegador só o `frame-ancestors`. Por isso o
    // `sandbox` mora no config, e é lá que este teste vai conferir.
    const config = readFileSync("next.config.ts", "utf8");
    const regra = config.match(
      /source:\s*"\/api\/:porta\(([^)]+)\)[^"]*"[\s\S]{0,600}?value:\s*"([^"]*sandbox[^"]*)"/
    );
    expect(regra, "o next.config.ts perdeu a regra de sandbox das portas de arquivo").toBeTruthy();
    for (const porta of ["img", "media", "messages", "funcionarios"]) {
      expect(regra![1].split("|"), porta).toContain(porta);
    }
    // e a regra específica precisa vir DEPOIS da geral: a última vence
    expect(config.indexOf('source: "/:path*"')).toBeLessThan(
      config.indexOf("/api/:porta(")
    );
  });

  it("o nome do arquivo não escapa das aspas do cabeçalho", () => {
    const h = cabecalhosDaFoto("text/html", {
      cache: "no-store",
      nome: 'a" ; filename="virus.exe',
    });
    expect(h["Content-Disposition"]).toBe('attachment; filename="a-filename-virus.exe"');
  });
});

describe("as portas que servem arquivo usam esta régua", () => {
  // Teste de fiação: a régua só vale se estiver LIGADA onde o arquivo sai.
  // Não dá para provar isso pelo comportamento sem subir banco e servidor,
  // então aqui se confere o vínculo — e o vínculo é o que alguém desfaz sem
  // perceber ao mexer na rota.
  const rotas = [
    "src/app/api/img/[id]/route.ts",
    "src/app/api/media/[id]/raw/route.ts",
  ];

  it("nenhuma delas monta o Content-Type na mão", () => {
    for (const rota of rotas) {
      const texto = readFileSync(rota, "utf8");
      expect(texto, rota).toContain("cabecalhosDaFoto");
      // o padrão antigo — `"Content-Type": mime` — é exatamente a falha
      expect(texto, rota).not.toMatch(/"Content-Type":\s*(decoded\.)?mime/);
    }
  });

  it("a busca de foto externa também passa pela lista", () => {
    // `mime.startsWith("image/")` deixava SVG entrar pela porta dos fundos
    const texto = readFileSync("src/app/api/img/[id]/route.ts", "utf8");
    expect(texto).not.toContain('mime.startsWith("image/")');
    expect(texto).toContain("tipoDeImagem(res.headers.get");
  });

  it("as portas de cadastro conferem a foto na entrada", () => {
    for (const rota of [
      "src/app/api/products/route.ts",
      "src/app/api/products/[id]/route.ts",
      "src/lib/catalog-import.ts",
    ]) {
      expect(readFileSync(rota, "utf8"), rota).toContain("urlDeFotoAceita");
    }
    expect(readFileSync("src/app/api/media/route.ts", "utf8")).toContain(
      "tipoDeImagem"
    );
  });
});
