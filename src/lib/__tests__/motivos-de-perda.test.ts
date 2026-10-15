// Guarda RN-081
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MOTIVOS_DA_TELA,
  MOTIVOS_DE_PERDA,
  MOTIVOS_DO_SISTEMA,
  OUTRO,
  SEM_MOTIVO,
  TETO_DO_DETALHE,
  chipDoMotivo,
  contarPorMotivo,
  detalheDoMotivo,
  lerMotivoDePerda,
  textoDoMotivoDePerda,
  validarMotivoDePerda,
} from "../funil/motivos-de-perda";
import { readdirSync, statSync } from "node:fs";

/**
 * RN-081 — o motivo de perda é uma LISTA FECHADA (fonte única na lib), o
 * texto gravado é "Chip — detalhe", o servidor recusa motivo fora da lista
 * e o relatório conta pelo chip (texto antigo cai em "Outro").
 */

describe("o texto gravado", () => {
  it("é 'Chip — detalhe'; sem detalhe, só o chip; sem chip, 'Outro'", () => {
    expect(textoDoMotivoDePerda("Achou caro")).toBe("Achou caro");
    expect(textoDoMotivoDePerda("Outro", " pediu nota fiscal ")).toBe("Outro — pediu nota fiscal");
    expect(textoDoMotivoDePerda("", "só queria o catálogo")).toBe("Outro — só queria o catálogo");
    expect(textoDoMotivoDePerda("", "")).toBe("Outro");
  });
  it("lê de volta chip e detalhe", () => {
    expect(chipDoMotivo("Outro — pediu nota fiscal")).toBe("Outro");
    expect(detalheDoMotivo("Outro — pediu nota fiscal")).toBe("pediu nota fiscal");
    expect(chipDoMotivo("Frete caro")).toBe("Frete caro");
    expect(detalheDoMotivo("Frete caro")).toBe("");
  });
});

describe("o chip de cada texto", () => {
  it("texto antigo (livre) e detalhe sem chip caem em 'Outro'; nulo é 'sem motivo'", () => {
    expect(chipDoMotivo("preço")).toBe(OUTRO);
    expect(chipDoMotivo("Preço alto demais")).toBe(OUTRO);
    expect(chipDoMotivo(null)).toBe(SEM_MOTIVO);
    expect(chipDoMotivo("   ")).toBe(SEM_MOTIVO);
    // o texto livre antigo É o detalhe — não se perde
    expect(detalheDoMotivo("Preço alto demais")).toBe("Preço alto demais");
  });
  it("texto antigo que só difere em caixa, acento ou espaço cai no chip certo (na leitura)", () => {
    expect(chipDoMotivo("achou caro")).toBe("Achou caro");
    expect(chipDoMotivo("ACHOU CARO")).toBe("Achou caro");
    expect(chipDoMotivo("Sumiu/não respondeu")).toBe("Sumiu / não respondeu");
    expect(chipDoMotivo("Sumiu / nao respondeu")).toBe("Sumiu / não respondeu");
    expect(chipDoMotivo("Achou  caro —  queria desconto")).toBe("Achou caro");
    // mas a porta segue exigindo o chip como está escrito
    expect(validarMotivoDePerda("achou caro")).toMatch(/fora da lista/);
  });
  it("a tela mostra todos menos 'Outro', que é a caixinha do detalhe", () => {
    expect(MOTIVOS_DA_TELA).not.toContain(OUTRO);
    expect(MOTIVOS_DA_TELA.length).toBe(MOTIVOS_DE_PERDA.length - 1);
  });
  it("o motivo do sistema (pedido cancelado) é chip próprio, não 'Outro'", () => {
    expect(MOTIVOS_DO_SISTEMA).toContain("Pedido cancelado");
    expect(chipDoMotivo("Pedido cancelado")).toBe("Pedido cancelado");
  });
});

describe("o que a porta aceita", () => {
  it("aceita todo chip da lista e do sistema, com ou sem detalhe", () => {
    for (const m of [...MOTIVOS_DE_PERDA, ...MOTIVOS_DO_SISTEMA]) {
      expect(validarMotivoDePerda(m)).toBeNull();
      expect(validarMotivoDePerda(`${m} — um detalhe`)).toBeNull();
    }
  });
  it("recusa vazio, texto fora da lista e detalhe comprido — com frase", () => {
    expect(validarMotivoDePerda("")).toMatch(/Informe o motivo/);
    expect(validarMotivoDePerda("preço")).toMatch(/fora da lista/);
    expect(validarMotivoDePerda(`Outro — ${"x".repeat(TETO_DO_DETALHE + 1)}`)).toMatch(/no máximo 120/);
    expect(validarMotivoDePerda(`Outro — ${"x".repeat(TETO_DO_DETALHE)}`)).toBeNull();
  });
  it("grava a forma CANÔNICA: espaços tortos e travessão solto não viram texto sujo nem recusa", () => {
    expect(lerMotivoDePerda("Achou caro  —  queria 10%\n")).toEqual({
      ok: true,
      chip: "Achou caro",
      detalhe: "queria 10%",
      texto: "Achou caro — queria 10%",
    });
    expect(lerMotivoDePerda("Outro — ")).toEqual({ ok: true, chip: OUTRO, detalhe: "", texto: OUTRO });
    expect(lerMotivoDePerda("Outro —")).toMatchObject({ ok: true, texto: OUTRO });
  });
});

describe("a contagem do relatório", () => {
  it("uma barra por chip, da maior para a menor; texto antigo em 'Outro'; sem motivo por último", () => {
    const barras = contarPorMotivo([
      { lostReason: "Achou caro" },
      { lostReason: "Achou caro — queria 10% off" },
      { lostReason: "Sumiu / não respondeu" },
      { lostReason: "preço" }, // antigo
      { lostReason: "Outro — pediu boleto" },
      { lostReason: null },
      { lostReason: null },
    ]);
    expect(barras).toEqual([
      { label: "Achou caro", value: 2 },
      // a barra "Outro" diz o que foi escrito, sem virar uma barra por frase
      { label: OUTRO, value: 2, sub: "pediu boleto · preço" },
      { label: "Sumiu / não respondeu", value: 1 },
      { label: SEM_MOTIVO, value: 2 },
    ]);
  });
  it("os detalhes do 'Outro' somam repetições e mostram só os 3 mais comuns", () => {
    const perdidas = [
      ...Array(3).fill({ lostReason: "Outro — pediu boleto" }),
      { lostReason: "Outro — Pediu Boleto" },
      { lostReason: "Outro — só catálogo" },
      { lostReason: "Outro — só catálogo" },
      { lostReason: "Outro — nota fiscal" },
      { lostReason: "Outro — loja fechou" },
    ];
    expect(contarPorMotivo(perdidas)[0]).toEqual({
      label: OUTRO,
      value: 8,
      sub: "pediu boleto ×4 · só catálogo ×2 · loja fechou",
    });
  });
  it("lista vazia, nenhuma barra", () => {
    expect(contarPorMotivo([])).toEqual([]);
  });
});

describe("o sistema está amarrado", () => {
  const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  it("a tela do funil, a porta e o relatório usam a lista da lib (não uma cópia)", () => {
    const board = ler("src/app/(app)/funil/funnel-board.tsx");
    expect(board).toContain('from "@/lib/funil/motivos-de-perda"');
    expect(board).not.toMatch(/const MOTIVOS_DE_PERDA = \[/);
    expect(ler("src/app/api/opportunities/[id]/route.ts")).toContain("lerMotivoDePerda(");
    expect(ler("src/app/(app)/relatorios/page.tsx")).toContain("contarPorMotivo(");
  });
  it("TODO motivo que o servidor grava sozinho está na lista do sistema (varre lib e api)", () => {
    const arquivos: string[] = [];
    const andar = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const c = join(dir, f);
        if (statSync(c).isDirectory()) andar(c);
        else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)) arquivos.push(c);
      }
    };
    andar(join(process.cwd(), "src/lib"));
    andar(join(process.cwd(), "src/app/api"));
    const literais = new Map<string, string>();
    for (const a of arquivos) {
      for (const m of readFileSync(a, "utf8").matchAll(/lostReason:\s*"([^"]+)"/g)) literais.set(m[1], a);
    }
    expect(literais.size).toBeGreaterThan(0); // a sincronização do pedido cancelado
    for (const [texto, arquivo] of literais) {
      expect(MOTIVOS_DO_SISTEMA as readonly string[], `${arquivo} grava "${texto}"`).toContain(texto);
    }
  });
});
