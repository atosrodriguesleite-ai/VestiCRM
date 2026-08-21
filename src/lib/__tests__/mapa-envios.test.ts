import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { enderecoDoPedido, montarMapaEnvios } from "../envios/mapa";
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

  it("UF inválida fica fora do mapa, mas é CONTADA como sem endereço", () => {
    const m = montarMapaEnvios([
      { cidade: "Lisboa", uf: "XX", quantidade: 5 },
      { cidade: null, uf: null, quantidade: 2 },
      { cidade: "Sorocaba", uf: "SP", quantidade: 1 },
    ]);
    expect(m.pontos).toHaveLength(1); // só Sorocaba
    expect(m.porUf).toHaveLength(1);
    expect(m.total).toBe(1);
    // o mapa diz em voz alta quem ficou de fora (senão parece que ele mente)
    expect(m.semEndereco).toBe(7);
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

// Guarda RN-022 · Mapa de envios com dois recortes: "todos os pedidos pagos"
// (endereço do envio ou, na falta, da cliente) e "Melhor Envio" (só
// etiquetas, sem canceladas); o que não tem estado é contado e dito na tela
describe("enderecoDoPedido — de onde sai o destino de um pedido pago", () => {
  const emSP = { city: "Sorocaba", state: "SP" };
  const emMG = { city: "Belo Horizonte", state: "MG" };

  it("o endereço do ENVIO manda (foi o usado na etiqueta)", () => {
    expect(enderecoDoPedido({ shipping: emSP, customer: emMG })).toEqual({
      cidade: "Sorocaba",
      uf: "SP",
    });
  });

  it("sem envio, vale o cadastro da cliente (motoboy, retirada, transportadora própria)", () => {
    expect(enderecoDoPedido({ shipping: null, customer: emMG })).toEqual({
      cidade: "Belo Horizonte",
      uf: "MG",
    });
  });

  it("registro de envio SEM endereço (pedido marcado como enviado à mão) cai na cliente", () => {
    // este é o caso comum: virar ENVIADO cria o Shipping só com a data
    expect(
      enderecoDoPedido({ shipping: { city: null, state: null }, customer: emMG })
    ).toEqual({ cidade: "Belo Horizonte", uf: "MG" });
  });

  it("NUNCA mistura as duas fontes (cidade de uma com UF da outra erraria o ponto)", () => {
    const r = enderecoDoPedido({
      shipping: { city: null, state: "SP" },
      customer: emMG,
    });
    expect(r).toEqual({ cidade: null, uf: "SP" }); // centro de SP, não BH
  });

  it("sem endereço em lugar nenhum devolve vazio (vira 'sem endereço')", () => {
    expect(enderecoDoPedido({ shipping: null, customer: null })).toEqual({
      cidade: null,
      uf: null,
    });
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

  it("a rota monta os DOIS recortes: etiquetas e todos os pedidos pagos", () => {
    const rota = ler("src/app/api/envios/route.ts");
    // o recorte "todos" tem que somar por PAID_ORDER_STATUSES (RN-001) e usar
    // a queda envio → cliente; sem isso o mapa geral mostraria quase nada
    expect(rota).toContain("PAID_ORDER_STATUSES");
    expect(rota).toContain("enderecoDoPedido");
    // o agrupamento é no BANCO (uma linha por combinação de endereço, não por
    // pedido), mas os filtros continuam sendo os da regra
    const blocoDosPedidos = rota.slice(rota.indexOf("const filtrosDoEscopo"));
    expect(blocoDosPedidos).toContain("PAID_ORDER_STATUSES");
    // e no MESMO escopo da tela (RN-007: vendedora vê só os pedidos dela)
    expect(blocoDosPedidos).toContain('o."companyId" = ${escopoDoUsuario.companyId}');
    expect(blocoDosPedidos).toContain('o."sellerId" = ${escopoDoUsuario.sellerId}');
  });

  it("a tela oferece os dois recortes e abre no mais completo", () => {
    const tela = ler("src/app/(app)/envios/mapa-envios.tsx");
    expect(tela).toContain("Todos os pedidos pagos");
    expect(tela).toContain("Melhor Envio");
    expect(tela).toContain('useState<Modo>("todos")');
  });
});
