import { describe, it, expect } from "vitest";
import { janelaDeDias, montarRelatorioDeTrocas, motivoDoChip, porcentagensQueFecham, type TrocaParaRelatorio } from "../troca/relatorio";
import { textoDoMotivo } from "../troca/regra";

/**
 * Relatório de trocas (RN-073, parte 3): qual peça volta, por quê e o
 * dinheiro — tudo dos registros da troca.
 */

const pedido = { id: "o1", number: 12, status: "ENTREGUE", customer: { name: "Ana" } };
const t = (over: Partial<TrocaParaRelatorio>): TrocaParaRelatorio => ({
  id: Math.random().toString(36).slice(2),
  numero: 1,
  createdAt: new Date("2026-10-08T12:00:00Z"),
  motivo: "Tamanho",
  diferenca: 0,
  resolucao: "SEM_DIFERENCA",
  resolvidaEm: new Date("2026-10-08T12:00:00Z"),
  registradaPorNome: "Lara",
  order: pedido,
  itens: [],
  ...over,
});
const volta = (q: number, destino = "ESTOQUE", over = {}) => ({ sentido: "VOLTA", productId: "p1", name: "Regata", color: "Preto", size: "P", quantity: q, destino, ...over });
const sai = (q: number) => ({ sentido: "SAI", productId: "p1", name: "Regata", color: "Preto", size: "M", quantity: q, destino: null });

describe("relatório de trocas", () => {
  it("o motivo conta pelo CHIP do cardápio, não pela frase digitada; o resto é Outro; vazio é dito", () => {
    expect(motivoDoChip("Tamanho — ficou pequena")).toBe("Tamanho");
    expect(motivoDoChip("defeito")).toBe("Defeito");
    expect(motivoDoChip("Outro — presente")).toBe("Outro");
    // a frase solta (troca antiga, ou o "Outro" que gravava só o texto) é Outro
    expect(motivoDoChip("cliente desistiu")).toBe("Outro");
    expect(motivoDoChip("  ")).toBe("Sem motivo");
    expect(motivoDoChip(null)).toBe("Sem motivo");
  });
  it("o texto gravado é 'Chip — detalhe'; sem chip, o detalhe vira Outro", () => {
    expect(textoDoMotivo("Tamanho", "ficou pequena")).toBe("Tamanho — ficou pequena");
    expect(textoDoMotivo("Outro", "")).toBe("Outro");
    expect(textoDoMotivo("", "presente")).toBe("Outro — presente");
    expect(textoDoMotivo("", "  ")).toBe("");
  });
  it("as porcentagens fecham 100 (a sobra vai ao maior resto)", () => {
    expect(porcentagensQueFecham([1, 1, 1])).toEqual([34, 33, 33]);
    expect(porcentagensQueFecham([2, 1])).toEqual([67, 33]);
    expect(porcentagensQueFecham([])).toEqual([]);
    expect(porcentagensQueFecham([0, 0])).toEqual([0, 0]);
  });
  it("troca de pedido depois CANCELADO: as peças contam, o dinheiro fica fora (foi desfeito)", () => {
    const r = montarRelatorioDeTrocas([
      t({ order: { ...pedido, status: "CANCELADO" }, itens: [volta(1), sai(1)], diferenca: -12, resolucao: "CREDITO" }),
      t({ order: { ...pedido, status: "CANCELADO" }, itens: [volta(1), sai(1)], diferenca: 16, resolucao: "COBRAR" }),
    ]);
    expect(r.totais).toMatchObject({ trocas: 2, deCancelados: 2, pecasVoltaram: 2, creditoDado: 0, recebido: 0 });
    expect(r.ultimas.every((u) => u.pedidoCancelado)).toBe(true);
  });
  it("totais: peças que voltaram (com defeito), que saíram, e o dinheiro separado pelo que andou", () => {
    const r = montarRelatorioDeTrocas([
      t({ itens: [volta(2), sai(2)] }),
      t({ motivo: "Defeito — costura", itens: [volta(1, "DEFEITO"), sai(1)], diferenca: 16, resolucao: "COBRAR" }),
      t({ motivo: "Cor", itens: [volta(1), sai(1)], diferenca: 18, resolucao: "COBRAR", resolvidaEm: null }),
      t({ motivo: "Modelo", itens: [volta(1), sai(1)], diferenca: -10, resolucao: "DEVOLUCAO" }),
      t({ motivo: "Modelo", itens: [volta(1), sai(1)], diferenca: -4, resolucao: "DEVOLUCAO", resolvidaEm: null }),
      t({ motivo: null, itens: [volta(1), sai(1)], diferenca: -12.1, resolucao: "CREDITO" }),
    ]);
    expect(r.totais).toEqual({
      trocas: 6,
      deCancelados: 0,
      pecasVoltaram: 7,
      pecasDefeito: 1,
      pecasSairam: 7,
      recebido: 16,
      aReceber: 18,
      devolvido: 10,
      aDevolver: 4,
      creditoDado: 12.1,
    });
    expect(r.motivos).toEqual([
      // 33,3 / 16,7 ×4: a sobra (3 pontos) vai aos maiores restos (os 16,7)
      { motivo: "Modelo", trocas: 2, pct: 33 },
      { motivo: "Cor", trocas: 1, pct: 17 },
      { motivo: "Defeito", trocas: 1, pct: 17 },
      { motivo: "Sem motivo", trocas: 1, pct: 17 },
      { motivo: "Tamanho", trocas: 1, pct: 16 },
    ]);
    expect(r.motivos.reduce((s, m) => s + m.pct, 0)).toBe(100);
  });

  it("peças que mais voltam: produto × cor × tamanho, com defeito e em quantas trocas; produto apagado pelo nome do retrato", () => {
    const r = montarRelatorioDeTrocas([
      t({ itens: [volta(2), volta(1, "DEFEITO")] }),
      t({ itens: [volta(1, "ESTOQUE", { color: "preto" })] }), // caixa diferente é a mesma peça
      t({ itens: [volta(5, "ESTOQUE", { productId: null, name: "Blusa Antiga", color: null, size: "G" })] }),
    ]);
    expect(r.pecas[0]).toMatchObject({ nome: "Blusa Antiga", tamanho: "G", voltaram: 5, defeito: 0, trocas: 1 });
    expect(r.pecas[1]).toMatchObject({ nome: "Regata", cor: "Preto", tamanho: "P", voltaram: 4, defeito: 1, trocas: 2 });
    expect(r.pecas).toHaveLength(2);
    expect(r.pecasDistintas).toBe(2);
  });

  it("últimas: mais recente primeiro, com o pedido, o que voltou e o que levou", () => {
    const r = montarRelatorioDeTrocas([
      t({ numero: 1, createdAt: new Date("2026-10-01T12:00:00Z"), itens: [volta(1), sai(1)] }),
      t({ numero: 2, createdAt: new Date("2026-10-05T12:00:00Z"), itens: [volta(1, "DEFEITO"), sai(1)] }),
    ]);
    expect(r.ultimas.map((u) => u.numero)).toEqual([2, 1]);
    expect(r.ultimas[0]).toMatchObject({ pedido: 12, cliente: "Ana", voltou: "1× Regata (Preto P) · defeito", levou: "1× Regata (Preto M)" });
  });

  it("vazio é vazio, e a janela conta os dias até agora", () => {
    expect(montarRelatorioDeTrocas([]).totais.trocas).toBe(0);
    const agora = new Date("2026-10-08T12:00:00Z");
    expect(janelaDeDias(30, agora).toISOString()).toBe("2026-09-08T12:00:00.000Z");
  });
});
