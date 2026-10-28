import { describe, it, expect } from "vitest";
import { montarNaEstrada } from "../envios/mapa";
import { avisoDeAtraso, DIAS_PARA_PARADO, type AtrasoDoEnvio } from "../envios/painel";

// Guarda RN-103
/**
 * NA ESTRADA: o mapa mostra só o que está a caminho, com arco da loja até
 * cada cidade e vermelho onde há pacote atrasado (RN-102 decide o atraso);
 * e o atraso vira UM aviso por pacote no sino de quem é dono do pedido. A
 * parte com banco (o carimbo atômico, a rodada de carona) está no e2e
 * `scripts/e2e-envios-prazo.ts`.
 */
describe("montarNaEstrada: a camada do mapa", () => {
  const pacotes = [
    { cidade: "São Paulo", uf: "SP", situacao: "no-prazo" as const },
    { cidade: "Sao Paulo", uf: "São Paulo", situacao: "atrasado" as const }, // mesma cidade, escrita diferente
    { cidade: "Recife", uf: "PE", situacao: "no-prazo" as const },
    { cidade: "Cidade Que Nao Existe", uf: "PE", situacao: "parado" as const }, // vai para o centro de PE
    { cidade: "Manaus", uf: null, situacao: "atrasado" as const }, // sem UF: contado, nunca desenhado
  ];
  const m = montarNaEstrada(pacotes, { cidade: "Divinópolis", uf: "MG" });

  it("agrega por cidade, separando no prazo, atrasado e parado", () => {
    const sp = m.pontos.find((p) => p.cidade === "São Paulo" && p.uf === "SP")!;
    expect(sp).toMatchObject({ noPrazo: 1, atrasados: 1, parados: 0 });
    expect(m.pontos.find((p) => p.cidade === "Recife")).toMatchObject({ noPrazo: 1, atrasados: 0, parados: 0 });
    const centroPe = m.pontos.find((p) => p.uf === "PE" && p.cidade === null)!;
    expect(centroPe).toMatchObject({ noPrazo: 0, atrasados: 0, parados: 1 });
  });

  it("os totais: sem UF conta em semEndereco e fica fora do total e dos atrasados; parado NÃO é atrasado", () => {
    expect(m.total).toBe(4);
    expect(m.atrasados).toBe(1);
    expect(m.parados).toBe(1);
    expect(m.semEndereco).toBe(1);
    expect(m.cortado).toBe(false);
    expect(montarNaEstrada([], null, { cortado: true }).cortado).toBe(true);
  });

  it("a lista por estado traz atrasados e parados, e põe quem tem atraso primeiro, depois quem tem parado", () => {
    expect(m.porUf.map((e) => [e.uf, e.quantidade, e.atrasados, e.parados])).toEqual([
      ["SP", 2, 1, 0],
      ["PE", 2, 0, 1],
    ]);
    const soParados = montarNaEstrada(
      [
        { cidade: "Recife", uf: "PE", situacao: "no-prazo" },
        { cidade: "Recife", uf: "PE", situacao: "no-prazo" },
        { cidade: "Curitiba", uf: "PR", situacao: "parado" },
      ],
      null
    );
    expect(soParados.porUf.map((e) => e.uf)).toEqual(["PR", "PE"]);
  });

  it("os pontos: no prazo embaixo, parado no meio, atrasado por cima (desenho)", () => {
    const peso = m.pontos.map((p) => (p.atrasados > 0 ? 2 : p.parados > 0 ? 1 : 0));
    expect([...peso].sort((a, b) => a - b)).toEqual(peso);
  });

  it("a origem é a loja: cidade casada na base, ou o centro do estado, ou nada sem UF", () => {
    expect(m.origem).toMatchObject({ cidade: "Divinópolis", uf: "MG" });
    expect(montarNaEstrada([], { cidade: "Lugar Inventado", uf: "MG" }).origem).toMatchObject({ cidade: null, uf: "MG" });
    expect(montarNaEstrada([], { cidade: "Divinópolis", uf: null }).origem).toBeNull();
    expect(montarNaEstrada([], null).origem).toBeNull();
  });

  it("sem pacote nenhum, tudo zero e nada quebra", () => {
    expect(montarNaEstrada([], null)).toEqual({
      origem: null, pontos: [], porUf: [], total: 0, atrasados: 0, parados: 0, semEndereco: 0, cortado: false,
    });
  });
});

describe("avisoDeAtraso: o texto do sino, uma régua", () => {
  const previsto = new Date("2026-10-29T23:59:59.999-03:00");
  const base = { pedido: "#482", cliente: "Maria Silva", transportadora: "Correios" };

  it("sem atraso não há aviso", () => {
    const a: AtrasoDoEnvio = { atrasado: false, previstoAte: previsto, diasAlem: 0, pelaReguaAntiga: false };
    expect(avisoDeAtraso(base, a)).toBeNull();
  });

  it("com previsão: diz a data prometida, quantos dias passaram e o que fazer", () => {
    const a: AtrasoDoEnvio = { atrasado: true, previstoAte: previsto, diasAlem: 3, pelaReguaAntiga: false };
    const aviso = avisoDeAtraso(base, a)!;
    expect(aviso.titulo).toBe("⏰ Pacote atrasado");
    expect(aviso.corpo).toContain("#482 · Maria Silva");
    expect(aviso.corpo).toContain("(Correios)");
    expect(aviso.corpo).toContain("até 29/10");
    expect(aviso.corpo).toContain("3 dias");
    expect(aviso.corpo).toMatch(/cobrar a transportadora/);
    expect(aviso.evento).toContain("29/10");
    expect(aviso.evento).toMatch(/uma vez por pacote/);
  });

  it("um dia é singular", () => {
    const a: AtrasoDoEnvio = { atrasado: true, previstoAte: previsto, diasAlem: 1, pelaReguaAntiga: false };
    expect(avisoDeAtraso(base, a)!.corpo).toContain("1 dia.");
  });

  it("sem prazo (régua antiga) diz PARADO, nunca 'atrasado' — não promete prazo que ninguém deu", () => {
    const a: AtrasoDoEnvio = { atrasado: true, previstoAte: null, diasAlem: 0, pelaReguaAntiga: true };
    const aviso = avisoDeAtraso({ pedido: "#9", cliente: "Ana", transportadora: null }, a)!;
    expect(aviso.titulo).toBe("📦 Pacote parado no caminho");
    expect(aviso.titulo.toLowerCase()).not.toContain("atrasado");
    expect(aviso.corpo).toContain(`mais de ${DIAS_PARA_PARADO} dias`);
    expect(aviso.corpo).not.toContain("(");
  });
});
