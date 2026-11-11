// Guarda RN-110
import { describe, it, expect } from "vitest";
import {
  FECHADAS_PARA_VENCER,
  FRASE_DO_QR_VENCIDO,
  MS_ENTRE_CONSULTAS_DO_QR,
  passoDaTentativa,
  type TentativaDeConexao,
} from "@/lib/qr-da-conexao";

const inicio: TentativaDeConexao = { qr: "A", fechadas: 0 };

describe("RN-110 · a tentativa de conexão pelo QR Code", () => {
  it("esperando a leitura com código novo → troca; com o mesmo ou sem código → fica o da tela", () => {
    expect(passoDaTentativa(inicio, { status: "AGUARDANDO_QR", qr: "B" })).toEqual({
      fim: null,
      tentativa: { qr: "B", fechadas: 0 },
      trocou: true,
    });
    for (const qr of ["A", null, undefined, ""]) {
      expect(passoDaTentativa(inicio, { status: "AGUARDANDO_QR", qr })).toEqual({
        fim: null,
        tentativa: { qr: "A", fechadas: 0 },
        trocou: false,
      });
    }
  });

  it("conectou → acaba a tentativa", () => {
    expect(passoDaTentativa(inicio, { status: "CONECTADO" })).toEqual({ fim: "conectou" });
    expect(passoDaTentativa({ qr: "A", fechadas: 3 }, { status: "CONECTADO", qr: "B" })).toEqual({ fim: "conectou" });
  });

  it("uma consulta fechada NÃO encerra (o pareamento fecha e reabre); só a sequência inteira vence", () => {
    let t = inicio;
    for (let i = 1; i < FECHADAS_PARA_VENCER; i++) {
      const p = passoDaTentativa(t, { status: "DESCONECTADO" });
      expect(p).toEqual({ fim: null, tentativa: { qr: "A", fechadas: i }, trocou: false });
      if (p.fim === null) t = p.tentativa;
    }
    expect(passoDaTentativa(t, { status: "DESCONECTADO" })).toEqual({ fim: "venceu" });
  });

  it("fechou e voltou a esperar → a conta zera (o ciclo novo de códigos não é vencimento)", () => {
    const meio = { qr: "A", fechadas: FECHADAS_PARA_VENCER - 1 };
    const p = passoDaTentativa(meio, { status: "AGUARDANDO_QR", qr: "C" });
    expect(p).toEqual({ fim: null, tentativa: { qr: "C", fechadas: 0 }, trocou: true });
  });

  it("a consulta é mais curta que a vida do código, e a espera até vencer cobre o reinício do pareamento", () => {
    // o código vive ~20 s: a tela nunca mostra um vencido por mais que uma consulta
    expect(MS_ENTRE_CONSULTAS_DO_QR).toBeLessThanOrEqual(5_000);
    // o WhatsApp fecha e reabre em poucos segundos depois da leitura
    expect(MS_ENTRE_CONSULTAS_DO_QR * FECHADAS_PARA_VENCER).toBeGreaterThanOrEqual(10_000);
    expect(FRASE_DO_QR_VENCIDO).toContain("código novo");
  });
});
