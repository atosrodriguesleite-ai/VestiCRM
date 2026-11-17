// Guarda RN-113
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MS_DO_DEPOIS,
  MS_ENTRE_CONFERENCIAS,
  haVersaoNova,
  horaDeConferir,
  lerVersaoDaResposta,
  situacaoDoAviso,
  valeAvisar,
} from "@/lib/versao-do-app";

/**
 * RN-113 · A TELA QUE FICOU ABERTA SABE QUE SAIU VERSÃO NOVA — a régua pura,
 * a versão gravada no build e a rota que diz a versão do ar. O comportamento
 * do aviso na tela (nunca recarrega sozinho) está em
 * `components/__tests__/aviso-de-versao-nova.test.tsx`.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("tem versão nova?", () => {
  it("só com as duas versões conhecidas E diferentes", () => {
    expect(haVersaoNova("aaa", "bbb")).toBe(true);
    expect(haVersaoNova("aaa", "aaa")).toBe(false);
    expect(haVersaoNova(" aaa ", "aaa")).toBe(false);
  });
  it("sem uma delas é 'não sei', e 'não sei' nunca vira aviso", () => {
    expect(haVersaoNova("", "bbb")).toBe(false);
    expect(haVersaoNova("aaa", "")).toBe(false);
    expect(haVersaoNova("aaa", null)).toBe(false);
    expect(haVersaoNova(undefined, "bbb")).toBe(false);
    expect(haVersaoNova("aaa", 42)).toBe(false);
  });
  it("a resposta da rota é lida pelo campo; qualquer outra coisa é vazio", () => {
    expect(lerVersaoDaResposta({ versao: "abc123" })).toBe("abc123");
    expect(lerVersaoDaResposta({ versao: 7 })).toBe("");
    expect(lerVersaoDaResposta({ error: "Não autenticado" })).toBe("");
    expect(lerVersaoDaResposta(null)).toBe("");
    expect(lerVersaoDaResposta("abc")).toBe("");
  });
  it("a aba que JÁ recarregou por causa desta versão não é avisada de novo", () => {
    expect(valeAvisar("aaa", "bbb", null)).toBe(true);
    expect(valeAvisar("aaa", "bbb", "bbb")).toBe(false);
    // versão mais nova ainda: aí vale de novo
    expect(valeAvisar("aaa", "ccc", "bbb")).toBe(true);
    expect(valeAvisar("aaa", "aaa", null)).toBe(false);
  });
});

describe("o ritmo da pergunta", () => {
  it("só depois do intervalo — e o relógio que andou para trás não trava", () => {
    const t = 1_800_000_000_000;
    expect(horaDeConferir(t + MS_ENTRE_CONFERENCIAS - 1, t)).toBe(false);
    expect(horaDeConferir(t + MS_ENTRE_CONFERENCIAS, t)).toBe(true);
    expect(horaDeConferir(t - 60_000, t)).toBe(true);
  });
  it("pergunta de minutos em minutos, e o 'Depois' vale uma hora", () => {
    expect(MS_ENTRE_CONFERENCIAS).toBeGreaterThanOrEqual(60_000);
    expect(MS_ENTRE_CONFERENCIAS).toBeLessThanOrEqual(15 * 60_000);
    expect(MS_DO_DEPOIS).toBe(60 * 60_000);
  });
});

describe("a versão gravada no build", () => {
  it("é o commit que a Vercel informa — a MESMA nas várias leituras do arquivo", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "fa1eade47b73733d6312d5abfad33ce9e4068081");
    const um = (await import("../../../next.config")).default;
    vi.resetModules();
    // o Next lê este arquivo mais de uma vez no mesmo build: relógio ou
    // sorteio aqui dariam navegador e servidor com versões diferentes
    await new Promise((r) => setTimeout(r, 5));
    const dois = (await import("../../../next.config")).default;
    expect(um.env?.NEXT_PUBLIC_VERSAO_DO_APP).toBe("fa1eade47b73733d6312d5abfad33ce9e4068081");
    expect(dois.env?.NEXT_PUBLIC_VERSAO_DO_APP).toBe(um.env?.NEXT_PUBLIC_VERSAO_DO_APP);
  });
  it("fora da Vercel fica vazia (o aviso não existe), nunca inventada", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    const config = (await import("../../../next.config")).default;
    expect(config.env?.NEXT_PUBLIC_VERSAO_DO_APP).toBe("");
  });
});

describe("a rota que diz a versão do ar", () => {
  it("responde a versão deste código, sem cache em lugar nenhum", async () => {
    vi.stubEnv("NEXT_PUBLIC_VERSAO_DO_APP", "abc123");
    const { GET } = await import("@/app/api/versao/route");
    const res = GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ versao: "abc123" });
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });
  it("sem versão conhecida responde vazio — e a tela não avisa", async () => {
    vi.stubEnv("NEXT_PUBLIC_VERSAO_DO_APP", "");
    const { GET } = await import("@/app/api/versao/route");
    const corpo = await GET().json();
    expect(corpo).toEqual({ versao: "" });
    expect(haVersaoNova("aaa", lerVersaoDaResposta(corpo))).toBe(false);
  });
});

describe("onde o aviso mora", () => {
  it("no esqueleto da área logada, para TODA tela e todo papel", () => {
    const shell = readFileSync(join(process.cwd(), "src/components/app-shell.tsx"), "utf8");
    expect(shell).toContain("<AvisoDeVersaoNova ");
  });
});

describe("o aviso nunca fica desligado em silêncio", () => {
  it("a Saúde diz se está ligado (com a versão) ou desligado (com o caminho)", () => {
    const ligado = situacaoDoAviso("fa1eade47b73733d6312d5abfad33ce9e4068081");
    expect(ligado.ligado).toBe(true);
    expect(ligado.frase).toContain("fa1eade");
    for (const vazio of ["", "   ", null, undefined]) {
      const desligado = situacaoDoAviso(vazio);
      expect(desligado.ligado).toBe(false);
      expect(desligado.frase).toContain("DESLIGADO");
      expect(desligado.frase).toContain("Automatically expose System Environment Variables");
    }
  });
  it("o painel de Saúde mostra essa frase", () => {
    const saude = readFileSync(join(process.cwd(), "src/app/(app)/saude/page.tsx"), "utf8");
    expect(saude).toContain("situacaoDoAviso(VERSAO_DO_APP)");
    expect(saude).toContain("{avisoDeVersao.frase}");
  });
});

describe("a rota da versão é só para quem está logado", () => {
  it("nenhuma entrada da lista pública do porteiro alcança /api/versao", () => {
    const porteiro = readFileSync(join(process.cwd(), "src/middleware.ts"), "utf8");
    const inicio = porteiro.indexOf("const PUBLIC_PATHS = [");
    expect(inicio).toBeGreaterThan(-1);
    const lista = porteiro.slice(inicio, porteiro.indexOf("];", inicio));
    const publicas = [...lista.matchAll(/^\s*"([^"]+)"/gm)].map((m) => m[1]);
    // a lista foi lida de verdade (senão o teste passaria vazio)
    expect(publicas).toContain("/api/img");
    expect(publicas.filter((p) => "/api/versao".startsWith(p))).toEqual([]);
  });
});
