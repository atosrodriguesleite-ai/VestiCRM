import { describe, it, expect } from "vitest";
import {
  diagnosticoLoja,
  vereditoGeral,
  taxaDeEntrega,
  silencioLabel,
  HORAS_SILENCIO_ATENCAO,
  HORAS_SILENCIO_CRITICO,
} from "../health-wa";

const agora = new Date("2026-07-28T15:00:00Z");
const hAtras = (h: number) => new Date(agora.getTime() - h * 3_600_000);
const base = {
  conectado: true,
  ultimaRecebida: hAtras(1),
  presas: 0,
  falhas24: 0,
  jaTeveTrafego: true,
};

describe("diagnóstico de uma loja", () => {
  it("conectada e recebendo: tudo certo", () => {
    expect(diagnosticoLoja(base, agora).nivel).toBe("OK");
  });

  it("desconectada é grave, e o silêncio não vira problema separado", () => {
    const d = diagnosticoLoja({ ...base, conectado: false, ultimaRecebida: hAtras(50) }, agora);
    expect(d.nivel).toBe("CRITICO");
    expect(d.problemas).toHaveLength(1); // só a desconexão; o resto é consequência
    expect(d.problemas[0]).toContain("desconectado");
  });

  it("SILÊNCIO SUSPEITO: conectada, mas nada chega — a falha invisível", () => {
    const atencao = diagnosticoLoja(
      { ...base, ultimaRecebida: hAtras(HORAS_SILENCIO_ATENCAO + 1) },
      agora
    );
    expect(atencao.nivel).toBe("ATENCAO");

    const critico = diagnosticoLoja(
      { ...base, ultimaRecebida: hAtras(HORAS_SILENCIO_CRITICO + 1) },
      agora
    );
    expect(critico.nivel).toBe("CRITICO");
    expect(critico.problemas[0]).toContain("webhook");
  });

  it("movimento fraco (5h sem mensagem) não é alarme", () => {
    expect(diagnosticoLoja({ ...base, ultimaRecebida: hAtras(5) }, agora).nivel).toBe("OK");
  });

  it("loja NOVA sem tráfego nenhum não acende alarme", () => {
    const d = diagnosticoLoja(
      { ...base, ultimaRecebida: null, jaTeveTrafego: false },
      agora
    );
    expect(d.nivel).toBe("OK");
    expect(d.problemas[0]).toContain("loja nova");
  });

  it("mas loja que JÁ teve tráfego e zerou é grave", () => {
    const d = diagnosticoLoja({ ...base, ultimaRecebida: null, jaTeveTrafego: true }, agora);
    expect(d.nivel).toBe("CRITICO");
  });

  it("mensagem presa no envio pede atenção", () => {
    const d = diagnosticoLoja({ ...base, presas: 3 }, agora);
    expect(d.nivel).toBe("ATENCAO");
    expect(d.problemas[0]).toContain("3 mensagem");
  });

  it("envio que falhou pede atenção", () => {
    expect(diagnosticoLoja({ ...base, falhas24: 2 }, agora).nivel).toBe("ATENCAO");
  });

  it("vários problemas juntos: fica o mais grave, e todos são listados", () => {
    const d = diagnosticoLoja(
      { ...base, ultimaRecebida: hAtras(30), presas: 1, falhas24: 4 },
      agora
    );
    expect(d.nivel).toBe("CRITICO");
    expect(d.problemas).toHaveLength(3);
  });
});

describe("veredito da plataforma", () => {
  const ok = { nivel: "OK" as const, problemas: [] };

  it("tudo verde", () => {
    expect(
      vereditoGeral({ servidorOk: true, lojas: [ok, ok], errosWebhook24: 0 }).nivel
    ).toBe("OK");
  });

  it("servidor fora do ar derruba tudo", () => {
    const v = vereditoGeral({ servidorOk: false, lojas: [ok], errosWebhook24: 0 });
    expect(v.nivel).toBe("CRITICO");
    expect(v.problemas[0]).toContain("Servidor");
  });

  it("mensagem que não conseguiu ser gravada é sempre grave", () => {
    // é conversa de cliente que a loja nunca vai ver
    const v = vereditoGeral({ servidorOk: true, lojas: [ok], errosWebhook24: 1 });
    expect(v.nivel).toBe("CRITICO");
  });

  it("conta as lojas por gravidade", () => {
    const v = vereditoGeral({
      servidorOk: true,
      lojas: [ok, { nivel: "ATENCAO", problemas: ["x"] }, { nivel: "CRITICO", problemas: ["y"] }],
      errosWebhook24: 0,
    });
    expect(v.nivel).toBe("CRITICO");
    expect(v.problemas.join(" ")).toContain("1 loja(s) com problema grave");
    expect(v.problemas.join(" ")).toContain("1 loja(s) pedindo atenção");
  });
});

describe("taxa de entrega", () => {
  it("sem envio no período não inventa número", () => {
    expect(taxaDeEntrega(0, 0)).toBeNull();
  });
  it("calcula o percentual", () => {
    expect(taxaDeEntrega(10, 9)).toBe(90);
    expect(taxaDeEntrega(3, 3)).toBe(100);
  });
  it("nunca passa de 100% (recibo duplicado não estoura a conta)", () => {
    expect(taxaDeEntrega(5, 8)).toBe(100);
  });
});

describe("rótulo do silêncio", () => {
  it("horas e dias em português", () => {
    expect(silencioLabel(0.5)).toBe("menos de 1 hora");
    expect(silencioLabel(7.9)).toBe("7 h");
    expect(silencioLabel(24)).toBe("1 dia");
    expect(silencioLabel(72)).toBe("3 dias");
  });
});
