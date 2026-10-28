import { describe, it, expect } from "vitest";
import {
  DIAS_PARA_PARADO,
  FOLGA_DIAS,
  PRAZO_MAXIMO_DIAS,
  atrasoDoEnvio,
  carimboDaPostagem,
  normalizarPrazoDias,
  ondeAtrasado,
  previsaoDeEntrega,
} from "../envios/painel";

// Guarda RN-102
/**
 * ATRASADO DE VERDADE: o prazo prometido pela transportadora na cotação aceita
 * (dias úteis) vira a previsão de entrega na postagem, e "atrasado" é passar
 * dela — não um chute fixo de 7 dias. O envio sem prazo (etiqueta antiga)
 * segue na régua dos 7 dias, e a tela diz "parado", não "atrasado".
 */
const DIA = 24 * 60 * 60 * 1000;
const spFim = (iso: string) => new Date(`${iso}T23:59:59.999-03:00`);

describe("previsaoDeEntrega: dias ÚTEIS, no calendário de São Paulo, fim do dia", () => {
  it("postado numa segunda com prazo 3 → quinta, 23:59 de SP", () => {
    // 2026-10-26 é segunda-feira
    const postou = new Date("2026-10-26T10:00:00-03:00");
    expect(previsaoDeEntrega(postou, 3).toISOString()).toBe(spFim("2026-10-29").toISOString());
  });

  it("sexta + 2 úteis pula o fim de semana → terça", () => {
    // 2026-10-30 é sexta-feira
    expect(previsaoDeEntrega(new Date("2026-10-30T15:00:00-03:00"), 2).toISOString()).toBe(
      spFim("2026-11-03").toISOString()
    );
  });

  it("postado no SÁBADO conta a partir da segunda (o dia da postagem não conta)", () => {
    // 2026-10-31 é sábado; 1 dia útil = segunda 02/11
    expect(previsaoDeEntrega(new Date("2026-10-31T09:00:00-03:00"), 1).toISOString()).toBe(
      spFim("2026-11-02").toISOString()
    );
  });

  it("a hora da postagem não muda o dia: 23h de SP ainda é aquele dia (não o seguinte em UTC)", () => {
    // 2026-10-26 23:30 em SP = 27/10 02:30Z — o dia em SP é 26
    const a = previsaoDeEntrega(new Date("2026-10-26T23:30:00-03:00"), 1);
    const b = previsaoDeEntrega(new Date("2026-10-26T08:00:00-03:00"), 1);
    expect(a.toISOString()).toBe(b.toISOString());
    expect(a.toISOString()).toBe(spFim("2026-10-27").toISOString());
  });

  it("prazo torto é preso ao intervalo: nunca menos que 1, nunca mais que o teto", () => {
    const postou = new Date("2026-10-26T10:00:00-03:00");
    expect(previsaoDeEntrega(postou, 0).toISOString()).toBe(previsaoDeEntrega(postou, 1).toISOString());
    expect(previsaoDeEntrega(postou, 999).toISOString()).toBe(
      previsaoDeEntrega(postou, PRAZO_MAXIMO_DIAS).toISOString()
    );
    expect(previsaoDeEntrega("2026-10-26T13:00:00.000Z", 2.4).toISOString()).toBe(
      previsaoDeEntrega(postou, 2).toISOString()
    );
  });
});

describe("atrasoDoEnvio: com previsão, atrasado é passar dela mais a folga", () => {
  const previsto = spFim("2026-10-29");
  const postou = new Date("2026-10-26T10:00:00-03:00");

  it("dentro do prazo não é atrasado, mesmo postado há 7+ dias", () => {
    const r = atrasoDoEnvio(
      { meStatus: "POSTADO", postadoEm: postou, previstoAte: spFim("2026-11-20") },
      new Date("2026-11-10T12:00:00-03:00")
    );
    expect(r.atrasado).toBe(false);
    expect(r.pelaReguaAntiga).toBe(false);
    expect(r.diasAlem).toBe(0);
  });

  it("no dia seguinte à previsão ainda vale a folga; depois dela, atrasado e contando os dias", () => {
    const dentroDaFolga = new Date(previsto.getTime() + FOLGA_DIAS * DIA - 1);
    expect(atrasoDoEnvio({ meStatus: "POSTADO", postadoEm: postou, previstoAte: previsto }, dentroDaFolga).atrasado).toBe(false);
    const depois = new Date(previsto.getTime() + 3.5 * DIA);
    const r = atrasoDoEnvio({ meStatus: "POSTADO", postadoEm: postou, previstoAte: previsto }, depois);
    expect(r.atrasado).toBe(true);
    expect(r.diasAlem).toBe(3);
    expect(r.previstoAte?.toISOString()).toBe(previsto.toISOString());
  });

  it("a previsão vencida de um envio ENTREGUE (ou devolvido, ou cancelado) não é atraso", () => {
    const muitoDepois = new Date(previsto.getTime() + 30 * DIA);
    for (const st of ["ENTREGUE", "DEVOLVIDO", "CANCELADO", "ETIQUETA", null])
      expect(atrasoDoEnvio({ meStatus: st, postadoEm: postou, previstoAte: previsto }, muitoDepois).atrasado).toBe(false);
  });

  it("a entrega marcada À MÃO (POSTADO para a transportadora, entregue na ficha) também não é atraso — e a cláusula do banco concorda", () => {
    const muitoDepois = new Date(previsto.getTime() + 30 * DIA);
    expect(
      atrasoDoEnvio({ meStatus: "POSTADO", postadoEm: postou, previstoAte: previsto, entregueEm: new Date("2026-10-28T12:00:00Z") }, muitoDepois).atrasado
    ).toBe(false);
    expect(ondeAtrasado(muitoDepois).deliveredAt).toBeNull();
  });

  it("sem previsão vale a régua antiga dos 7 dias — e a resposta DIZ que foi ela", () => {
    const agora = new Date("2026-11-10T12:00:00-03:00");
    const r = atrasoDoEnvio({ meStatus: "POSTADO", postadoEm: new Date(agora.getTime() - (DIAS_PARA_PARADO + 1) * DIA) }, agora);
    expect(r).toEqual({ atrasado: true, previstoAte: null, diasAlem: 0, pelaReguaAntiga: true });
    expect(atrasoDoEnvio({ meStatus: "POSTADO", postadoEm: new Date(agora.getTime() - 3 * DIA) }, agora).atrasado).toBe(false);
    expect(atrasoDoEnvio({ meStatus: "POSTADO", postadoEm: null }, agora).atrasado).toBe(false);
  });

  it("aceita as datas como texto (é assim que a lista chega ao navegador)", () => {
    const r = atrasoDoEnvio(
      { meStatus: "POSTADO", postadoEm: postou.toISOString(), previstoAte: previsto.toISOString() },
      new Date(previsto.getTime() + 2 * DIA)
    );
    expect(r.atrasado).toBe(true);
  });

});

describe("normalizarPrazoDias: informação, nunca trava", () => {
  it("número bom passa inteiro e preso ao intervalo; o resto vira 'sem prazo'", () => {
    expect(normalizarPrazoDias(3)).toBe(3);
    expect(normalizarPrazoDias(2.6)).toBe(3);
    expect(normalizarPrazoDias("5")).toBe(5);
    expect(normalizarPrazoDias(65)).toBe(PRAZO_MAXIMO_DIAS);
    expect(normalizarPrazoDias(0.4)).toBe(1);
    for (const torto of [0, -2, NaN, Infinity, null, undefined, "", "x", {}]) expect(normalizarPrazoDias(torto)).toBeNull();
  });
});

describe("carimboDaPostagem: a previsão nasce UMA vez, pelos dois caminhos", () => {
  const postou = new Date("2026-10-26T10:00:00-03:00");

  it("com prazo e sem previsão, carimba a partir da postagem", () => {
    expect(carimboDaPostagem({ prazoDias: 3, previstoAte: null, shippedAt: null }, postou)).toEqual({
      previstoAte: previsaoDeEntrega(postou, 3),
    });
  });

  it("a saída já marcada à mão é a base (a vendedora deixou a caixa no correio antes de a transportadora dizer 'postado')", () => {
    const aMao = new Date("2026-10-23T17:00:00-03:00");
    expect(carimboDaPostagem({ prazoDias: 2, previstoAte: null, shippedAt: aMao }, postou)).toEqual({
      previstoAte: previsaoDeEntrega(aMao, 2),
    });
  });

  it("sem prazo não carimba; com previsão já gravada não refaz", () => {
    expect(carimboDaPostagem({ prazoDias: null, previstoAte: null }, postou)).toEqual({});
    const antiga = spFim("2026-10-28");
    expect(carimboDaPostagem({ prazoDias: 2, previstoAte: antiga }, postou)).toEqual({});
  });
});

describe("ondeAtrasado: a MESMA régua escrita para o banco", () => {
  it("postado E (previsão vencida com folga OU sem previsão e 7+ dias)", () => {
    const agora = new Date("2026-11-10T12:00:00.000Z");
    const w = ondeAtrasado(agora);
    expect(w.meStatus).toBe("POSTADO");
    // a postagem é exigida nos dois ramos: voltar o pedido limpa a postagem e
    // a linha só com previsão não pode contar no cartão sem aparecer na aba
    expect(w.shippedAt).toEqual({ not: null });
    expect(w.OR).toHaveLength(2);
    expect(w.OR[0]).toEqual({ previstoAte: { lt: new Date(agora.getTime() - FOLGA_DIAS * DIA) } });
    expect(w.OR[1]).toEqual({
      previstoAte: null,
      shippedAt: { lt: new Date(agora.getTime() - DIAS_PARA_PARADO * DIA) },
    });
  });

  it("concorda com a função pura nos pontos de virada", () => {
    const agora = new Date("2026-11-10T12:00:00.000Z");
    const w = ondeAtrasado(agora);
    const limitePrevisao = (w.OR[0] as { previstoAte: { lt: Date } }).previstoAte.lt;
    const umMsAntes = new Date(limitePrevisao.getTime() - 1);
    const postou = new Date(agora.getTime() - 2 * DIA);
    // previsão 1 ms antes do limite: o banco acha (lt) e a pura também
    expect(atrasoDoEnvio({ meStatus: "POSTADO", postadoEm: postou, previstoAte: umMsAntes }, agora).atrasado).toBe(true);
    // previsão exatamente no limite: o banco não acha (lt estrito) e a pura também não (>)
    expect(atrasoDoEnvio({ meStatus: "POSTADO", postadoEm: postou, previstoAte: limitePrevisao }, agora).atrasado).toBe(false);
  });
});
