import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  cnpjValido,
  conferirDocumentos,
  cpfValido,
  documentoFiscal,
  documentoParaMostrar,
  formatarCnpj,
  formatarCpf,
  guardarDocumento,
  separarDocumento,
  soDigitos,
} from "../documento";

/**
 * CPF E CNPJ SEPARADOS — pedido da lojista (31/07/2026):
 * "alguma transportadora usa CNPJ e outra usa CPF, então eu preciso dos dois".
 */

// documentos com dígitos verificadores corretos (gerados para o teste)
const CPF_OK = "52998224725";
const CNPJ_OK = "11222333000181";

describe("conferência dos dígitos", () => {
  it("aceita CPF e CNPJ de verdade, com ou sem máscara", () => {
    expect(cpfValido(CPF_OK)).toBe(true);
    expect(cpfValido("529.982.247-25")).toBe(true);
    expect(cnpjValido(CNPJ_OK)).toBe(true);
    expect(cnpjValido("11.222.333/0001-81")).toBe(true);
  });

  it("recusa número digitado errado (é o que a transportadora recusaria)", () => {
    expect(cpfValido("52998224726")).toBe(false);
    expect(cnpjValido("11222333000182")).toBe(false);
  });

  it("recusa os repetidos (111.111.111-11 e afins)", () => {
    expect(cpfValido("11111111111")).toBe(false);
    expect(cnpjValido("11111111111111")).toBe(false);
  });

  it("recusa tamanho errado, vazio e lixo", () => {
    for (const v of ["", "   ", "123", null, undefined, "abc"]) {
      expect(cpfValido(v)).toBe(false);
      expect(cnpjValido(v)).toBe(false);
    }
    // CNPJ no campo do CPF (e vice-versa) não passa
    expect(cpfValido(CNPJ_OK)).toBe(false);
    expect(cnpjValido(CPF_OK)).toBe(false);
  });
});

describe("o que o sistema responde para a vendedora", () => {
  it("campo vazio é permitido — o documento é opcional", () => {
    expect(conferirDocumentos({})).toBeNull();
    expect(conferirDocumentos({ cpf: "", cnpj: null })).toBeNull();
  });

  it("os dois preenchidos e certos: pode salvar", () => {
    expect(conferirDocumentos({ cpf: CPF_OK, cnpj: CNPJ_OK })).toBeNull();
  });

  it("errado avisa em português, dizendo QUAL campo", () => {
    expect(conferirDocumentos({ cpf: "12345678900" })).toContain("CPF");
    expect(conferirDocumentos({ cnpj: "12345678000100" })).toContain("CNPJ");
  });
});

describe("como fica guardado e como aparece na tela", () => {
  it("guarda só os números (o Melhor Envio e o Bling não aceitam máscara)", () => {
    expect(guardarDocumento("529.982.247-25")).toBe(CPF_OK);
    expect(guardarDocumento("  ")).toBeNull();
    expect(guardarDocumento(null)).toBeNull();
  });

  it("mostra com máscara e com o nome certo de cada um", () => {
    expect(formatarCpf(CPF_OK)).toBe("529.982.247-25");
    expect(formatarCnpj(CNPJ_OK)).toBe("11.222.333/0001-81");
    expect(documentoParaMostrar({ cpf: CPF_OK, cnpj: CNPJ_OK })).toBe(
      "CNPJ: 11.222.333/0001-81 · CPF: 529.982.247-25"
    );
    expect(documentoParaMostrar({ cpf: CPF_OK })).toBe("CPF: 529.982.247-25");
    expect(documentoParaMostrar({ cnpj: CNPJ_OK })).toBe("CNPJ: 11.222.333/0001-81");
    expect(documentoParaMostrar({})).toBe("");
  });

  it("documento incompleto aparece como foi digitado (não some da tela)", () => {
    expect(formatarCpf("5299822")).toBe("5299822");
  });

  it("soDigitos limpa qualquer máscara", () => {
    expect(soDigitos("11.222.333/0001-81")).toBe(CNPJ_OK);
  });
});

describe("nota fiscal: qual documento manda", () => {
  it("tendo CNPJ, é pessoa JURÍDICA (o caso normal do atacado)", () => {
    expect(documentoFiscal({ cpf: CPF_OK, cnpj: CNPJ_OK })).toEqual({
      numero: CNPJ_OK,
      tipoPessoa: "J",
    });
  });

  it("só com CPF, é pessoa FÍSICA", () => {
    expect(documentoFiscal({ cpf: CPF_OK })).toEqual({
      numero: CPF_OK,
      tipoPessoa: "F",
    });
  });

  it("sem documento nenhum não emite nota", () => {
    expect(documentoFiscal({})).toBeNull();
    expect(documentoFiscal({ cpf: "123" })).toBeNull();
  });
});

describe("importação: um campo só, dois destinos", () => {
  it("14 dígitos vira CNPJ, 11 vira CPF", () => {
    expect(separarDocumento("11.222.333/0001-81")).toEqual({ cpf: null, cnpj: CNPJ_OK });
    expect(separarDocumento("529.982.247-25")).toEqual({ cpf: CPF_OK, cnpj: null });
  });

  it("qualquer outra coisa não vira documento", () => {
    for (const v of ["", "123", null, undefined, "abc"]) {
      expect(separarDocumento(v)).toEqual({ cpf: null, cnpj: null });
    }
  });
});

describe("o sistema inteiro usa os dois campos", () => {
  const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("Melhor Envio manda CPF e CNPJ em campos diferentes", () => {
    const me = ler("src/lib/melhorenvio.ts");
    expect(me).toContain("{ document: cpf }");
    expect(me).toContain("{ company_document: cnpj }");
    // a decisão por tamanho do documento único saiu de cena
    expect(me).not.toContain("doc.length === 14 ? { company_document: doc }");
  });

  it("a nota fiscal decide pessoa física/jurídica pela fonte única", () => {
    expect(ler("src/lib/bling.ts")).toContain("documentoFiscal(c)");
  });

  it("as telas de cadastro têm os DOIS campos", () => {
    for (const tela of [
      "src/app/(app)/clientes/new-customer.tsx",
      "src/app/(app)/pedidos/[id]/customer-editor.tsx",
      "src/app/(app)/configuracoes/envios-connect.tsx",
    ]) {
      const t = ler(tela);
      expect(t.toLowerCase()).toContain("cpf");
      expect(t.toLowerCase()).toContain("cnpj");
    }
  });

  it("as APIs conferem o documento antes de gravar", () => {
    expect(ler("src/app/api/customers/route.ts")).toContain("conferirDocumentos(");
    expect(ler("src/app/api/customers/[id]/route.ts")).toContain("conferirDocumentos(");
  });

  it("a exportação traz uma coluna para cada documento", () => {
    expect(ler("src/app/api/export/clientes/route.ts")).toContain('"CPF", "CNPJ"');
  });
});
