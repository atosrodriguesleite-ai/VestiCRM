import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { montarMapaEnvios } from "../envios/mapa";
import { NOME_DO_ESTADO } from "../envios/estados";
import mapaBrasil from "../envios/mapa-brasil.json";
import municipiosXy from "../envios/municipios-xy.json";

/**
 * MAPA DE ENVIOS da tela Envios (o BI "para onde a loja vende").
 *
 * O que não pode quebrar:
 *  - a lista lateral SÓ tem estado com 1+ envio (pedido do dono);
 *  - envio nunca some do mapa: cidade digitada errada vira ponto no centro
 *    do estado, não buraco;
 *  - a cidade casa do jeito que foi digitada (acento/maiúscula não importam);
 *  - etiqueta CANCELADA não conta (guarda na rota).
 */

const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const UFS = (mapaBrasil as { ufs: Record<string, unknown> }).ufs;
const XY = municipiosXy as Record<string, number[]>;

describe("bases geográficas commitadas (geradas por scripts/gerar-mapa-envios.mjs)", () => {
  it("os 27 estados têm contorno e centro", () => {
    expect(Object.keys(UFS)).toHaveLength(27);
    expect(Object.keys(UFS).sort()).toEqual(Object.keys(NOME_DO_ESTADO).sort());
  });

  it("a base de municípios está inteira e na chave normalizada", () => {
    expect(Object.keys(XY).length).toBeGreaterThan(5000);
    expect(XY["sao paulo|SP"]).toBeDefined();
    expect(XY["feira de santana|BA"]).toBeDefined();
  });
});

describe("montarMapaEnvios", () => {
  it("cidade cadastrada vira bolinha na cidade, não no centro do estado", () => {
    const m = montarMapaEnvios([{ cidade: "Sorocaba", uf: "SP", quantidade: 2 }]);
    expect(m.pontos).toHaveLength(1);
    expect(m.pontos[0]).toMatchObject({ cidade: "Sorocaba", uf: "SP", quantidade: 2 });
    expect([m.pontos[0].x, m.pontos[0].y]).toEqual(XY["sorocaba|SP"]);
  });

  it("acento e maiúscula não atrapalham (a cidade vem digitada do cadastro)", () => {
    const m = montarMapaEnvios([
      { cidade: "SÃO PAULO", uf: "sp", quantidade: 1 },
      { cidade: "sao paulo", uf: "SP", quantidade: 1 },
    ]);
    expect(m.pontos).toHaveLength(1); // é a MESMA cidade
    expect(m.pontos[0].quantidade).toBe(2);
  });

  it("cidade que não casa NÃO some: vira ponto no centro do estado", () => {
    const m = montarMapaEnvios([
      { cidade: "Cidade Que Nao Existe", uf: "MG", quantidade: 1 },
      { cidade: null, uf: "MG", quantidade: 2 },
    ]);
    expect(m.pontos).toHaveLength(1); // agregadas no centro de MG
    expect(m.pontos[0]).toMatchObject({ cidade: null, uf: "MG", quantidade: 3 });
    expect(m.porUf).toEqual([{ uf: "MG", nome: "Minas Gerais", quantidade: 3 }]);
  });

  it("UF inválida fica fora do mapa e da lista (não há onde desenhar)", () => {
    const m = montarMapaEnvios([{ cidade: "Lisboa", uf: "XX", quantidade: 5 }]);
    expect(m.pontos).toHaveLength(0);
    expect(m.porUf).toHaveLength(0);
    expect(m.total).toBe(0);
  });

  it("a lista sai do maior para o menor e SÓ com estado de 1+ envio", () => {
    const m = montarMapaEnvios([
      { cidade: "Cuiabá", uf: "MT", quantidade: 1 },
      { cidade: "Feira de Santana", uf: "BA", quantidade: 4 },
      { cidade: "Salvador", uf: "BA", quantidade: 2 },
      { cidade: "Sorocaba", uf: "SP", quantidade: 0 }, // sem envio, sem linha
    ]);
    expect(m.porUf.map((e) => e.uf)).toEqual(["BA", "MT"]);
    expect(m.porUf[0].quantidade).toBe(6);
    expect(m.total).toBe(7);
  });
});

describe("as portas do mapa", () => {
  it("a rota /api/envios monta o mapa sem etiqueta cancelada (e SEM perder status nulo)", () => {
    const rota = ler("src/app/api/envios/route.ts");
    expect(rota).toContain("montarMapaEnvios");
    // a âncora é o bloco do PRÓPRIO mapa (groupBy por cidade/UF) — conferir
    // a rota inteira deixava o guarda vazio: o filtro de cancelada já
    // existia no gasto do mês e o teste passava mesmo sem ele no mapa
    const blocoDoMapa = rota.slice(rota.indexOf('by: ["city", "state"]'));
    expect(blocoDoMapa).toContain(
      'OR: [{ meStatus: null }, { meStatus: { not: "CANCELADO" } }]'
    );
  });

  it("a tela Envios desenha o mapa", () => {
    expect(ler("src/app/(app)/envios/envios-view.tsx")).toContain("<MapaEnvios");
  });
});
