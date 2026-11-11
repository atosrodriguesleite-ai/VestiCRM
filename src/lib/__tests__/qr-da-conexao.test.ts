// Guarda RN-110
import { describe, it, expect } from "vitest";
import {
  enderecoDaConsulta,
  FECHADAS_PARA_VENCER,
  fracaoDoAndamento,
  FRASE_DO_QR_VENCIDO,
  MS_ENTRE_CONSULTAS_DO_QR,
  novaTentativa,
  passoDaTentativa,
  passosDoAndamento,
  type TentativaDeConexao,
} from "@/lib/qr-da-conexao";

const inicio: TentativaDeConexao = novaTentativa("A", 1);

describe("RN-110 · a tentativa de conexão pelo QR Code", () => {
  it("esperando a leitura com código novo → troca, com o número que o servidor conta; sem código → fica o da tela", () => {
    expect(passoDaTentativa(inicio, { status: "AGUARDANDO_QR", qr: "B", qrNumero: 2 })).toEqual({
      fim: null,
      tentativa: { qr: "B", fechadas: 0, etapa: "lendo", numero: 2 },
    });
    for (const qr of [null, undefined, ""]) {
      expect(passoDaTentativa(inicio, { status: "AGUARDANDO_QR", qr, qrNumero: 9 })).toEqual({
        fim: null,
        tentativa: { qr: "A", fechadas: 0, etapa: "lendo", numero: 1 },
      });
    }
    // número torto do servidor não apaga o que a tela já sabia
    const torto = passoDaTentativa(inicio, { status: "AGUARDANDO_QR", qr: "B", qrNumero: 0 });
    expect(torto).toMatchObject({ tentativa: { qr: "B", numero: 1 } });
    expect(novaTentativa("A", null).numero).toBeNull();
    expect(novaTentativa("A", 2.5).numero).toBeNull();
  });

  it("o servidor abriu a conexão → passo 'aberta' (o celular leu); só o CONFERIDO acaba a tentativa", () => {
    const aberta = passoDaTentativa(inicio, { status: "AGUARDANDO_QR", aberta: true });
    expect(aberta).toEqual({ fim: null, tentativa: { qr: "A", fechadas: 0, etapa: "aberta", numero: 1 } });
    if (aberta.fim !== null) throw new Error("não devia acabar");
    expect(passoDaTentativa(aberta.tentativa, { status: "CONECTADO" })).toEqual({ fim: "conectou" });
    expect(passoDaTentativa(inicio, { status: "CONECTADO", qr: "B" })).toEqual({ fim: "conectou" });
  });

  it("abriu mas a sonda bateu na conexão fechada → 'caiu' (nunca 'conectou', nunca fica girando)", () => {
    const aberta: TentativaDeConexao = { ...inicio, etapa: "aberta" };
    expect(passoDaTentativa(aberta, { status: "DESCONECTADO", sessaoCaida: true })).toEqual({ fim: "caiu" });
  });

  it("aberta que voltou a fechar retorna ao passo de leitura (o andamento não mente para frente)", () => {
    const aberta: TentativaDeConexao = { ...inicio, etapa: "aberta" };
    expect(passoDaTentativa(aberta, { status: "AGUARDANDO_QR", qr: "C", qrNumero: 4 })).toEqual({
      fim: null,
      tentativa: { qr: "C", fechadas: 0, etapa: "lendo", numero: 4 },
    });
    expect(passoDaTentativa(aberta, { status: "DESCONECTADO" })).toMatchObject({
      tentativa: { etapa: "lendo", fechadas: 1 },
    });
  });

  it("uma consulta fechada NÃO encerra (o pareamento fecha e reabre); só a sequência inteira vence", () => {
    let t = inicio;
    for (let i = 1; i < FECHADAS_PARA_VENCER; i++) {
      const p = passoDaTentativa(t, { status: "DESCONECTADO" });
      expect(p).toEqual({ fim: null, tentativa: { ...inicio, fechadas: i } });
      if (p.fim === null) t = p.tentativa;
    }
    expect(passoDaTentativa(t, { status: "DESCONECTADO" })).toEqual({ fim: "venceu" });
    // fechou e voltou a esperar → a conta zera (o ciclo novo de códigos não é vencimento)
    expect(passoDaTentativa(t, { status: "AGUARDANDO_QR", qr: "C" })).toMatchObject({
      tentativa: { qr: "C", fechadas: 0 },
    });
  });

  it("a consulta: sem tentativa só o estado; lendo pede o código; aberta pede a conferência", () => {
    expect(enderecoDaConsulta(null)).toBe("/api/whatsapp/evolution");
    expect(enderecoDaConsulta(inicio)).toBe("/api/whatsapp/evolution?qr=1");
    expect(enderecoDaConsulta({ ...inicio, etapa: "aberta" })).toBe("/api/whatsapp/evolution?qr=1&conferir=1");
  });

  it("a consulta é mais curta que a vida do código, e a espera até vencer cobre o reinício do pareamento", () => {
    // o código vive ~20 s: a tela nunca mostra um vencido por mais que uma consulta
    expect(MS_ENTRE_CONSULTAS_DO_QR).toBeLessThanOrEqual(5_000);
    // o WhatsApp fecha e reabre em poucos segundos depois da leitura
    expect(MS_ENTRE_CONSULTAS_DO_QR * FECHADAS_PARA_VENCER).toBeGreaterThanOrEqual(10_000);
    expect(FRASE_DO_QR_VENCIDO).toContain("código novo");
  });
});

describe("RN-110 · o andamento é REAL: passo só fica feito com o sinal dele", () => {
  it("lendo: código gerado feito, leitura andando, conferência esperando — a barra em 1/3", () => {
    expect(passosDoAndamento("lendo").map((p) => p.estado)).toEqual(["feito", "andando", "espera"]);
    expect(passosDoAndamento("lendo")[1].rotulo).toBe("Esperando o celular ler o código");
    expect(fracaoDoAndamento("lendo")).toBeCloseTo(1 / 3);
  });
  it("aberta: o celular leu (feito) e a conferência está andando — 2/3, nunca cheia", () => {
    const passos = passosDoAndamento("aberta");
    expect(passos.map((p) => p.estado)).toEqual(["feito", "feito", "andando"]);
    expect(passos[1].rotulo).toBe("Celular leu o código");
    expect(passos[2].rotulo).toBe("Conferindo a conexão");
    expect(fracaoDoAndamento("aberta")).toBeCloseTo(2 / 3);
  });
  it("conectou: os três feitos e a barra cheia — só aqui", () => {
    expect(passosDoAndamento("conectou").map((p) => p.estado)).toEqual(["feito", "feito", "feito"]);
    expect(fracaoDoAndamento("conectou")).toBe(1);
    expect(fracaoDoAndamento("lendo")).toBeLessThan(1);
    expect(fracaoDoAndamento("aberta")).toBeLessThan(1);
  });
});
