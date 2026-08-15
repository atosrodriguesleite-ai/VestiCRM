import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";

/**
 * A documentação só vale se não puder envelhecer em silêncio.
 *
 * O índice de regras (`docs/regras.md`) e o texto das regras (`CLAUDE.md`) são
 * dois arquivos que falam da mesma coisa — e dois arquivos sempre discordam um
 * dia. Este teste é o que impede: se um lado ganhar ou perder uma RN, o build
 * quebra. Vale o mesmo para os ADRs e a lista deles.
 *
 * É o mesmo princípio do guarda de faturamento: guarda que não pega nada é
 * pior que nenhum.
 */

const ler = (p: string) => readFileSync(p, "utf8");
const ids = (texto: string, prefixo: "RN" | "ADR") => [
  ...new Set(texto.match(new RegExp(`\\b${prefixo}-\\d{3}\\b`, "g")) ?? []),
];

describe("índice de regras × CLAUDE.md", () => {
  const claude = ler("CLAUDE.md");
  const indice = ler("docs/regras.md");

  it("toda RN do índice tem texto no CLAUDE.md, e vice-versa", () => {
    const noIndice = ids(indice, "RN").sort();
    const noClaude = ids(claude, "RN").sort();
    expect(noIndice.length).toBeGreaterThan(0);
    // as duas listas idênticas: nada só num lado
    expect(noIndice).toEqual(noClaude);
  });

  it("nenhum número de regra é reaproveitado, nem no índice nem no CLAUDE.md", () => {
    // `\b` no fim (e não ` |`) para o formato de revogação que a própria
    // documentação manda usar — `| RN-003 (revogada em…) |` — não quebrar o
    // teste e empurrar quem for consertar a apagar a linha, perdendo o histórico
    const linhas = indice.match(/^\| RN-\d{3}\b/gm) ?? [];
    expect(new Set(linhas).size).toBe(linhas.length);
    expect(linhas.length).toBe(ids(indice, "RN").length);
    // no CLAUDE.md o marcador é `RN-0XX ·` ou `**RN-0XX**` — uma vez por regra
    const marcadores = claude.match(/RN-\d{3}(?= ·|\*\*)/g) ?? [];
    expect(new Set(marcadores).size).toBe(marcadores.length);
  });

  it("o teste citado como guardião DECLARA a regra, e só ele", () => {
    // Só conferir que o arquivo existe deixa passar mapeamento errado: um
    // teste que nunca falaria da regra ficava listado como guardião dela.
    // Aqui o vínculo é fechado nos DOIS sentidos, e pelo marcador exato
    // (`// Guarda RN-0XX`) — menção solta em prosa não vale, senão apagar o
    // marcador continuaria passando verde.
    const pastas = ["src/lib/__tests__", "src/lib/comm/__tests__"];
    const caminhoDe = new Map<string, string>();
    for (const pasta of pastas)
      for (const f of readdirSync(pasta)) caminhoDe.set(f, `${pasta}/${f}`);

    const declara = (texto: string, rn: string) =>
      (texto.match(/^\/\/ Guarda (RN-\d{3}(?:, RN-\d{3})*)/m)?.[1] ?? "")
        .split(", ")
        .includes(rn);

    // ida: cada linha do índice → o teste citado declara aquela RN
    const linhas = indice.match(/^\| RN-\d{3}\b.*$/gm) ?? [];
    expect(linhas.length).toBeGreaterThan(0);
    const esperado = new Map<string, string>(); // RN → arquivo
    const revogadas = new Set<string>();
    for (const linha of linhas) {
      const rn = linha.match(/RN-\d{3}/)![0];
      // regra revogada não precisa de teste vivo — é histórico, não contrato
      if (/revogada/i.test(linha)) {
        revogadas.add(rn);
        continue;
      }
      const arquivo = linha.match(/`([a-z0-9-]+\.test\.ts)`/)?.[1];
      expect(arquivo, `${rn} não cita nenhum teste`).toBeTruthy();
      const caminho = caminhoDe.get(arquivo!);
      expect(caminho, `${rn} cita ${arquivo}, que não existe`).toBeTruthy();
      expect(
        declara(ler(caminho!), rn),
        `${arquivo} é o guardião de ${rn} no índice, mas não tem "// Guarda ${rn}"`
      ).toBe(true);
      esperado.set(rn, arquivo!);
    }

    // volta: cada marcador no repositório → o índice aponta para esse arquivo
    for (const [arquivo, caminho] of caminhoDe) {
      const m = ler(caminho).match(/^\/\/ Guarda (RN-\d{3}(?:, RN-\d{3})*)/m);
      if (!m) continue;
      for (const rn of m[1].split(", ")) {
        if (revogadas.has(rn)) continue; // o teste pode sobreviver à regra
        expect(
          esperado.get(rn),
          `${arquivo} se declara guardião de ${rn}, mas o índice aponta para outro teste`
        ).toBe(arquivo);
      }
    }
  });
});

describe("ADRs", () => {
  const pasta = "docs/decisoes";
  const lista = ler(`${pasta}/README.md`);
  const arquivos = readdirSync(pasta).filter((f) => f.startsWith("ADR-"));

  it("todo ADR na pasta está na lista, e todo item da lista tem arquivo", () => {
    const naPasta = arquivos.map((f) => f.slice(0, 7)).sort();
    const naLista = ids(lista, "ADR").sort();
    expect(naPasta).toEqual(naLista);
  });

  it("nenhum número de ADR é reaproveitado", () => {
    const numeros = arquivos.map((f) => f.slice(0, 7));
    expect(new Set(numeros).size).toBe(numeros.length);
  });

  it("todo ADR citado em qualquer documento existe como arquivo", () => {
    const docs = [
      "CLAUDE.md",
      "docs/README.md",
      "docs/runbook.md",
      "docs/integracoes.md",
      "docs/regras.md",
      "docs/juridico/situacao-atual.md",
      ...arquivos.map((f) => `${pasta}/${f}`),
    ];
    const naPasta = new Set(arquivos.map((f) => f.slice(0, 7)));
    for (const doc of docs) {
      for (const id of ids(ler(doc), "ADR")) {
        expect(naPasta, `${doc} cita ${id}, que não existe`).toContain(id);
      }
    }
  });

  it("todo ADR declara a situação (aceita/revogada) — decisão sem situação não serve", () => {
    for (const f of arquivos) {
      expect(ler(`${pasta}/${f}`)).toMatch(/\*\*Situação:\*\*/);
    }
  });
});

describe("a pasta /docs continua enxuta", () => {
  it("os quatro espaços combinados existem", () => {
    for (const caminho of [
      "docs/README.md",
      "docs/regras.md",
      "docs/runbook.md",
      "docs/integracoes.md",
      "docs/decisoes/README.md",
      "docs/juridico/situacao-atual.md",
    ]) {
      expect(existsSync(caminho), `faltando: ${caminho}`).toBe(true);
    }
  });

  it("não existe um segundo arquivo de contexto concorrendo com o CLAUDE.md", () => {
    // Dois arquivos de instrução para IA = duas versões que um dia discordam,
    // e foi exatamente o que aconteceu: o `docs/ESTADO-DO-PROJETO.md` mandava
    // "leia este arquivo ao iniciar uma sessão" e falava em 52 testes.
    for (const proibido of [
      "AGENTS.md",
      "docs/AGENTS.md",
      "docs/ESTADO-DO-PROJETO.md",
      "docs/PRODUCAO.md",
      "DESIGN_NOTES.md",
    ]) {
      expect(existsSync(proibido), `${proibido} voltou a existir`).toBe(false);
    }
  });
});
