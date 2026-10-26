import { describe, it, expect } from "vitest";
import {
  normalizePhone,
  phoneMatchVariants,
  pareceNumeroBrasileiroSemDdi,
  ehNumeroBrasileiro,
  formatarInternacional,
  guardadoComCinquentaECincoPorEngano,
} from "../telefone";
import { celularSemONove, formatPhone } from "../format";
import { normalizePhone as doIntake } from "../intake";

// Guarda RN-096 (índice em docs/regras.md; texto no CLAUDE.md).

/**
 * O CASO REAL (Toque Leve, 26/10/2026): a cliente escreve do WhatsApp
 * +1 781 408-6755 (EUA). O número chega como `17814086755`, onze dígitos — e
 * o sistema colava um 55 na frente, criando "(17) 81408-6755", um DDD de
 * verdade com um celular que não existe. A resposta da loja ia para o nada.
 */
const EUA = "17814086755";

describe("número do WhatsApp (sempre com DDI) nunca ganha 55", () => {
  it("o webhook marca o número com '+', e aí os dígitos ficam como vieram", () => {
    expect(normalizePhone(`+${EUA}`)).toBe(EUA);
    expect(normalizePhone("+5519988394961")).toBe("5519988394961");
    // o caso ambíguo (um +1 de área 29x tem a cara de um celular do DDD 12)
    // é exatamente o que o "+" resolve: vindo do WhatsApp não há dúvida
    expect(normalizePhone("+12939876543")).toBe("12939876543");
  });

  it("o intake reexporta a MESMA função (quem importa de lá vê a mesma régua)", () => {
    expect(doIntake).toBe(normalizePhone);
  });
});

describe("número digitado: só ganha 55 quando tem cara de brasileiro", () => {
  it("brasileiro com DDD continua ganhando 55 (celular e fixo)", () => {
    expect(normalizePhone("(11) 99876-1001")).toBe("5511998761001");
    expect(normalizePhone("(11) 3456-7890")).toBe("551134567890");
    // celular antigo sem o 9: o cadastro tolera, e o phoneMatchVariants põe o 9
    expect(normalizePhone("(35) 9971-3320")).toBe("553599713320");
  });

  it("onze dígitos que não são um celular brasileiro ficam como vieram", () => {
    // EUA sem o "+": DDD 17 existe, mas o terceiro dígito não é 9
    expect(normalizePhone(EUA)).toBe(EUA);
    // Espanha (+34 6…), França (+33 6…), Austrália (+61 4…), Holanda (+31 6…)
    expect(normalizePhone("34612345678")).toBe("34612345678");
    expect(normalizePhone("33612345678")).toBe("33612345678");
    expect(normalizePhone("61412345678")).toBe("61412345678");
    expect(normalizePhone("31612345678")).toBe("31612345678");
    // Chile (+56 9…): DDD 56 não existe no Brasil
    expect(normalizePhone("56912345678")).toBe("56912345678");
  });

  it("DDD que não existe não vira brasileiro, nem com dez dígitos", () => {
    expect(normalizePhone("0912345678")).toBe("0912345678"); // DDD 09 não existe
    expect(normalizePhone("2012345678")).toBe("2012345678"); // DDD 20 não existe
  });

  it("a cara do número brasileiro, dita em um lugar só", () => {
    expect(pareceNumeroBrasileiroSemDdi("11998761001")).toBe(true);
    expect(pareceNumeroBrasileiroSemDdi("1134567890")).toBe(true);
    expect(pareceNumeroBrasileiroSemDdi(EUA)).toBe(false);
    expect(pareceNumeroBrasileiroSemDdi("5511998761001")).toBe(false); // com DDI não é "sem DDI"
    expect(ehNumeroBrasileiro("5511998761001")).toBe(true);
    expect(ehNumeroBrasileiro("551134567890")).toBe(true);
    expect(ehNumeroBrasileiro("11998761001")).toBe(true); // legado sem DDI
    expect(ehNumeroBrasileiro(`55${EUA}`)).toBe(false); // o 55 colado por engano
    expect(ehNumeroBrasileiro(EUA)).toBe(false);
    expect(ehNumeroBrasileiro("ns-123")).toBe(false);
  });
});

describe("como o número aparece na tela", () => {
  it("brasileiro como sempre; de fora com o DDI na frente", () => {
    expect(formatPhone("5511998761001")).toBe("(11) 99876-1001");
    expect(formatPhone("11998761001")).toBe("(11) 99876-1001");
    expect(formatPhone("551134567890")).toBe("(11) 3456-7890");
    // o caso real: nunca mais "(17) 81408-6755"
    expect(formatPhone(EUA)).toBe("+1 781 408-6755");
    expect(formatPhone(`+${EUA}`)).toBe("+1 781 408-6755");
    expect(formatPhone("34612345678")).toBe("+34 61 234-5678");
    expect(formatPhone("351912345678")).toBe("+351 91 234-5678");
  });

  it("o que não é número volta como veio (marcador da loja online, lixo)", () => {
    expect(formatPhone("ns-123")).toBe("ns-123");
    expect(formatPhone("")).toBe("");
  });

  it("o DDI de um, dois e três dígitos é separado certo", () => {
    expect(formatarInternacional("17814086755")).toBe("+1 781 408-6755");
    expect(formatarInternacional("447911123456")).toBe("+44 791 112-3456");
    expect(formatarInternacional("5215512345678")).toBe("+52 1 551 234-5678");
    expect(formatarInternacional("123")).toBeNull();
  });
});

describe("a cliente de fora guardada com o 55 colado antes da regra", () => {
  it("é achada pelas variantes (a forma antiga entra na busca)", () => {
    expect(phoneMatchVariants(EUA)).toContain(`55${EUA}`);
    expect(phoneMatchVariants(`+${EUA}`)).toContain(EUA);
  });

  it("e só ela é curada: brasileiro nunca cai nessa régua", () => {
    expect(guardadoComCinquentaECincoPorEngano(`55${EUA}`, EUA)).toBe(true);
    expect(guardadoComCinquentaECincoPorEngano("5511998761001", "11998761001")).toBe(false);
    expect(guardadoComCinquentaECincoPorEngano(EUA, EUA)).toBe(false);
  });

  it("o número de fora com cara de brasileiro (+51 9… do Peru) só se cura VERIFICADO pelo WhatsApp", () => {
    const peru = "51912345678";
    // vindo do webhook (o "+" é certeza): as variantes trazem a forma antiga e a cura vale
    expect(phoneMatchVariants(`+${peru}`)).toContain(`55${peru}`);
    expect(guardadoComCinquentaECincoPorEngano(`55${peru}`, peru, true)).toBe(true);
    // digitado sem o "+": pela cara é um celular do DDD 51 — não se cura
    expect(guardadoComCinquentaECincoPorEngano(`55${peru}`, peru, false)).toBe(false);
    // e o "+" digitado num formulário NÃO é certeza: "+11 99876-1001" é um
    // brasileiro com o DDI esquecido — o cadastro certo (55…) não perde o 55
    expect(guardadoComCinquentaECincoPorEngano("5511998761001", "11998761001", false)).toBe(false);
    expect(phoneMatchVariants("+11998761001")).toContain("5511998761001");
  });

  it("'00' na frente também declara o DDI (é como se disca para fora)", () => {
    expect(normalizePhone("00 1 781 408-6755")).toBe(EUA);
    expect(formatPhone("+5511998761001")).toBe("(11) 99876-1001");
  });

  it("menos de onze dígitos sem DDI continua desenhado como sempre (cadastro para corrigir, não número de fora)", () => {
    expect(formatPhone("998761001")).toBe("998761001");
    expect(formatPhone("1098765432")).toBe("(10) 9876-5432");
  });

  it("o 9º dígito continua tolerado para o brasileiro (nada mudou ali)", () => {
    expect(phoneMatchVariants("5533988585607")).toContain("553388585607");
    expect(phoneMatchVariants("(33) 8858-5607")).toContain("5533988585607");
    expect(phoneMatchVariants(EUA)).not.toContain(`9${EUA}`);
  });
});

describe("a sugestão 'faltou o 9' só vale para número brasileiro", () => {
  it("sugere o 9 no celular antigo brasileiro", () => {
    expect(celularSemONove("(35) 9971-3320")).toBe("35999713320");
  });
  it("não sugere num DDD que não existe (é número de fora)", () => {
    expect(celularSemONove("4071234567")).toBeNull(); // Romênia: DDD 40 não existe
  });
});
