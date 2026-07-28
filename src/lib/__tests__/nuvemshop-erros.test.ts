import { describe, it, expect } from "vitest";
import {
  explicarNuvemshop,
  motivoPeloErro,
  motivoPeloStatus,
} from "../nuvemshop-erros";

/**
 * "Não foi possível sincronizar." não é resposta: não diz por quê nem o que
 * fazer. Cada falha aqui vira uma frase que a lojista consegue agir em cima.
 */

describe("motivo pelo código que a Nuvemshop devolveu", () => {
  it("401/403 é autorização vencida", () => {
    expect(motivoPeloStatus(401)).toBe("AUTORIZACAO");
    expect(motivoPeloStatus(403)).toBe("AUTORIZACAO");
  });
  it("429 é limite de chamadas", () => {
    expect(motivoPeloStatus(429)).toBe("LIMITE");
  });
  it("5xx é problema do lado deles", () => {
    expect(motivoPeloStatus(500)).toBe("FORA_DO_AR");
    expect(motivoPeloStatus(503)).toBe("FORA_DO_AR");
  });
  it("sem status é falta de resposta", () => {
    expect(motivoPeloStatus(0)).toBe("SEM_RESPOSTA");
  });
});

describe("motivo por exceção", () => {
  it("token que não abre = credencial ilegível (chave do servidor mudou)", () => {
    const e = new Error("Unsupported state or unable to authenticate data");
    expect(motivoPeloErro(e)).toBe("CREDENCIAL_ILEGIVEL");
  });
  it("rede caindo vira falta de resposta", () => {
    expect(motivoPeloErro(new Error("fetch failed"))).toBe("SEM_RESPOSTA");
    expect(motivoPeloErro(new Error("The operation was aborted due to timeout"))).toBe(
      "SEM_RESPOSTA"
    );
  });
  it("o que não se reconhece não é chutado", () => {
    expect(motivoPeloErro(new Error("kaboom"))).toBe("DESCONHECIDO");
    expect(motivoPeloErro(null)).toBe("DESCONHECIDO");
  });
});

describe("toda mensagem diz o que fazer", () => {
  const motivos = [
    "SEM_CONEXAO",
    "CREDENCIAL_ILEGIVEL",
    "AUTORIZACAO",
    "LIMITE",
    "FORA_DO_AR",
    "SEM_RESPOSTA",
    "DESCONHECIDO",
  ] as const;

  it("nenhuma mensagem é um beco sem saída", () => {
    for (const m of motivos) {
      const { mensagem } = explicarNuvemshop(m);
      expect(mensagem.length).toBeGreaterThan(30);
      // toda frase termina em uma AÇÃO: reconectar, tentar de novo ou avisar
      expect(mensagem).toMatch(/Conectar|conecte|Tente|tente|avise/);
    }
  });

  it("credencial ilegível manda reconectar e tranquiliza sobre os dados", () => {
    const { mensagem } = explicarNuvemshop("CREDENCIAL_ILEGIVEL");
    expect(mensagem).toContain("Desconectar");
    expect(mensagem).toContain("nada do que já foi importado é perdido");
  });
});
