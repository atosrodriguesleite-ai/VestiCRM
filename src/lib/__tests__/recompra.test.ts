import { describe, it, expect } from "vitest";
import { cicloEntreCompras, passouDoRitmo } from "../recompra";

/**
 * CICLO DE RECOMPRA — quando chamar a cliente de volta.
 *
 * O motor antigo usava prazo fixo ("comprou há 30+ dias") para todo mundo, e
 * errava dos dois lados: a lojista que repõe a cada 3 semanas era chamada
 * tarde (a concorrente já vendeu) e a que compra de 3 em 3 meses era
 * incomodada cedo — jeito mais rápido de a vendedora queimar a relação.
 *
 * Agora o ritmo sai do histórico de cada uma. Como essa conta decide quem é
 * incomodada e quando, ela fica travada aqui.
 */

const DIA = 24 * 60 * 60 * 1000;
const dias = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * DIA);

describe("ritmo de compra de cada cliente", () => {
  it("duas compras com 30 dias de intervalo = ciclo de 30 dias", () => {
    expect(cicloEntreCompras(dias(0), dias(30), 2)).toBe(30);
  });

  it("três compras em 60 dias = ciclo de 30 (média dos intervalos)", () => {
    expect(cicloEntreCompras(dias(0), dias(60), 3)).toBe(30);
  });

  it("uma compra só não revela ritmo nenhum", () => {
    expect(cicloEntreCompras(dias(0), dias(0), 1)).toBeNull();
    expect(cicloEntreCompras(null, null, 5)).toBeNull();
  });

  it("ciclo absurdamente curto respeita o piso de 7 dias", () => {
    // 5 compras em 4 dias (importação, devolução, pedido dividido) daria ~1 dia
    expect(cicloEntreCompras(dias(0), dias(4), 5)).toBe(7);
  });

  it("ciclo absurdamente longo respeita o teto de 180 dias", () => {
    // duas compras separadas por 3 anos não fazem dela uma cliente de 3 em 3 anos
    expect(cicloEntreCompras(dias(0), dias(1095), 2)).toBe(180);
  });

  it("datas invertidas não viram ciclo negativo", () => {
    expect(cicloEntreCompras(dias(30), dias(0), 2)).toBeNull();
  });
});

describe("a hora de chamar", () => {
  it("não incomoda quem está dentro do próprio ritmo", () => {
    // compra a cada 30 dias, faz 20 — ainda não é hora
    expect(passouDoRitmo(20, 30)).toBe(false);
  });

  it("não chama no dia exato do ciclo (existe uma folga)", () => {
    // sem folga, a cliente receberia mensagem no dia em que 'venceu'
    expect(passouDoRitmo(30, 30)).toBe(false);
  });

  it("chama quando passou do ritmo com folga", () => {
    // 15% de folga sobre 30 dias = 34,5 → 35 dias já entra
    expect(passouDoRitmo(35, 30)).toBe(true);
  });

  it("cliente de ciclo curto é chamada antes da de ciclo longo", () => {
    // 25 dias sem comprar: quem gira a cada 20 já está atrasada; quem gira a
    // cada 90 nem perto. É exatamente o que o prazo fixo errava.
    expect(passouDoRitmo(25, 20)).toBe(true);
    expect(passouDoRitmo(25, 90)).toBe(false);
  });
});
