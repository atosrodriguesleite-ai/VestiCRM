import { describe, it, expect } from "vitest";
import {
  MOVIMENTOS,
  NOVA,
  rotuloDaOrigem,
  compararRetratos,
  inicioDoMes,
  lerMesDoRetrato,
  mesSeguinte,
  mesesDoRetrato,
  movimentoDe,
  nomeDoMes,
} from "../bi/rfm-movimento-regra";
import { GRUPOS_RFM, IDS_DOS_GRUPOS, type GrupoRfm } from "../bi/rfm-regra";
import { lerFiltro, hrefDaLista } from "../bi/listas";
import { mesSP } from "../dia";

// Guarda RN-101
/**
 * O RETRATO DO MÊS NO RFM (Etapa 4, pedido do dono): quem caiu, quem subiu e
 * quem chegou, do dia 1º ao fim do mês (ou a hoje) — recalculado, nunca
 * gravado, pela mesma ordem de grupos da tela e das quedas (RN-100).
 */
describe("movimentoDe: a mesma ordem da tela (do melhor ao mais distante)", () => {
  it("toda combinação", () => {
    for (const a of IDS_DOS_GRUPOS)
      for (const d of IDS_DOS_GRUPOS) {
        const ia = IDS_DOS_GRUPOS.indexOf(a);
        const id = IDS_DOS_GRUPOS.indexOf(d);
        expect(movimentoDe(a, d), `${a} → ${d}`).toBe(id < ia ? "subiu" : id > ia ? "caiu" : "ficou");
      }
    for (const d of IDS_DOS_GRUPOS) expect(movimentoDe(NOVA, d)).toBe("chegou");
  });

  it("Perdida que volta a comprar SOBE (e a régua é a mesma das quedas: Campeã → Não posso perder cai)", () => {
    expect(movimentoDe("PERDIDAS", "NOVATAS")).toBe("subiu");
    expect(movimentoDe("CAMPEAS", "NAO_PERDER")).toBe("caiu");
  });
});

describe("compararRetratos", () => {
  const antes = new Map<string, GrupoRfm>([
    ["a", "CAMPEAS"],
    ["b", "CAMPEAS"],
    ["c", "FIEIS"],
    ["d", "PERDIDAS"],
    ["e", "ATENCAO"],
    ["cancelada", "NOVATAS"],
  ]);
  const depois: { id: string; grupo: GrupoRfm }[] = [
    { id: "a", grupo: "NAO_PERDER" },
    { id: "b", grupo: "NAO_PERDER" },
    { id: "c", grupo: "CAMPEAS" },
    { id: "d", grupo: "NOVATAS" },
    { id: "e", grupo: "ATENCAO" },
    { id: "nova", grupo: "NOVATAS" },
  ];
  const r = compararRetratos("2026-10", antes, depois, true);

  it("conta quem caiu, subiu, chegou e ficou, e quem saiu do RFM", () => {
    expect(r.contagem).toEqual({ caiu: 2, subiu: 2, chegou: 1, ficou: 1 });
    expect(r.semVendaAgora).toBe(1);
    expect(r.emCurso).toBe(true);
  });

  it("os caminhos: as quedas primeiro, depois subidas e chegadas, pelo tamanho; quem ficou não é caminho", () => {
    expect(r.caminhos.map((c) => `${c.antes}>${c.depois}:${c.clientes}`)).toEqual([
      "CAMPEAS>NAO_PERDER:2",
      "FIEIS>CAMPEAS:1",
      "PERDIDAS>NOVATAS:1",
      "NOVA>NOVATAS:1",
    ]);
  });

  it("cada grupo fecha a conta: fim = começo + entraram − saíram", () => {
    const g = r.porGrupo;
    for (const id of IDS_DOS_GRUPOS) expect(g[id].fim, id).toBe(g[id].comeco + g[id].entraram - g[id].sairam);
    expect(IDS_DOS_GRUPOS.reduce((s, id) => s + g[id].comeco, 0)).toBe(antes.size);
    expect(IDS_DOS_GRUPOS.reduce((s, id) => s + g[id].fim, 0)).toBe(depois.length);
    expect(g.NAO_PERDER).toEqual({ comeco: 0, fim: 2, entraram: 2, sairam: 0 });
    expect(g.CAMPEAS).toEqual({ comeco: 2, fim: 1, entraram: 1, sairam: 2 });
    // a cancelada sai do grupo dela
    expect(g.NOVATAS).toEqual({ comeco: 1, fim: 2, entraram: 2, sairam: 1 });
  });

  it("loja sem nada não quebra", () => {
    const vazio = compararRetratos("2026-10", new Map(), [], false);
    expect(vazio.contagem).toEqual({ caiu: 0, subiu: 0, chegou: 0, ficou: 0 });
    expect(vazio.caminhos).toEqual([]);
    expect(Object.keys(vazio.porGrupo)).toHaveLength(GRUPOS_RFM.length);
  });
});

describe("os meses", () => {
  it("os seis da tela, do mais novo ao mais velho, atravessando o ano", () => {
    expect(mesesDoRetrato("2026-02")).toEqual(["2026-02", "2026-01", "2025-12", "2025-11", "2025-10", "2025-09"]);
  });

  it("o mês escolhido mais velho que os seis ganha o seu botão (senão nenhum ficaria marcado)", () => {
    expect(mesesDoRetrato("2026-10", 6, "2025-12")).toEqual(["2026-10", "2026-09", "2026-08", "2026-07", "2026-06", "2026-05", "2025-12"]);
    expect(mesesDoRetrato("2026-10", 6, "2026-09")).toHaveLength(6);
  });

  it("só vale um dos últimos 12 meses — nunca o futuro, nunca texto torto", () => {
    expect(lerMesDoRetrato("2026-10", "2026-10")).toBe("2026-10");
    expect(lerMesDoRetrato("2025-11", "2026-10")).toBe("2025-11");
    expect(lerMesDoRetrato("2025-10", "2026-10")).toBeNull();
    expect(lerMesDoRetrato("2026-11", "2026-10")).toBeNull();
    for (const torto of ["2026-13", "2026-1", "x", "", null, ["2026-10"]]) expect(lerMesDoRetrato(torto, "2026-10")).toBeNull();
  });

  it("o dia 1º à 0h de São Paulo, e o mês seguinte virando o ano", () => {
    expect(inicioDoMes("2026-10").toISOString()).toBe("2026-10-01T03:00:00.000Z");
    expect(mesSeguinte("2026-12")).toBe("2027-01");
    expect(mesSeguinte("2026-09")).toBe("2026-10");
    expect(nomeDoMes("2026-10")).toBe("outubro de 2026");
  });
});

describe("o nome da origem é um só (cartão e lista dizem o mesmo)", () => {
  it("primeira compra e os grupos", () => {
    expect(rotuloDaOrigem(NOVA)).toBe("🆕 primeira compra");
    expect(rotuloDaOrigem("NAO_PERDER")).toBe("🚨 Não posso perder");
  });
});

describe("a lista do retrato (o número abre quem é)", () => {
  const mes = mesSP();
  it("lê o mês, o movimento e o caminho — e recusa o que vier torto", () => {
    expect(lerFiltro({ tipo: "rfm-mov", mes, mov: "caiu" })).toMatchObject({ tipo: "rfm-mov", mes, mov: "caiu" });
    expect(lerFiltro({ tipo: "rfm-mov", mes, antes: NOVA, depois: "NOVATAS" })).toMatchObject({ antes: NOVA, depois: "NOVATAS" });
    expect(lerFiltro({ tipo: "rfm-mov", mov: "caiu" })).toBeNull(); // sem mês
    expect(lerFiltro({ tipo: "rfm-mov", mes, mov: "sumiu" })).toBeNull();
    expect(lerFiltro({ tipo: "rfm-mov", mes, antes: "VIP" })).toBeNull();
    expect(lerFiltro({ tipo: "rfm-mov", mes, depois: "NOVA" })).toBeNull();
    expect(lerFiltro({ tipo: "rfm-mov", mes: "2020-01" })).toBeNull();
  });

  it("o endereço que o cartão monta é o que a lista lê", () => {
    for (const mov of MOVIMENTOS) {
      const href = hrefDaLista({ tipo: "rfm-mov", mes, mov, antes: "CAMPEAS", depois: "FIEIS", aba: "clientes" });
      const params = Object.fromEntries(new URL(href, "http://x").searchParams);
      expect(lerFiltro(params)).toMatchObject({ tipo: "rfm-mov", mes, mov, antes: "CAMPEAS", depois: "FIEIS", aba: "clientes" });
    }
  });
});
