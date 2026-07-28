import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { casaCliente, casaTelefone, casaTexto, normalizarBusca, soDigitos } from "../busca";

/**
 * "A lupa de buscar nome não funciona." Não funcionava mesmo — por dois
 * motivos diferentes, um em cada tela. Estes testes são a trava dos dois.
 */

describe("maiúscula e acento não podem atrapalhar", () => {
  it("acha independente de caixa", () => {
    expect(casaTexto("Maria Silva", "maria")).toBe(true);
    expect(casaTexto("maria silva", "MARIA")).toBe(true);
  });

  it("acha sem digitar o acento", () => {
    expect(casaTexto("Mônica Araújo", "monica")).toBe(true);
    expect(casaTexto("José", "jose")).toBe(true);
    expect(casaTexto("Calça Wide Leg", "calca")).toBe(true);
  });

  it("acha pelo pedaço do meio do nome", () => {
    expect(casaTexto("Ana Paula Rodrigues", "paula")).toBe(true);
  });

  it("não acha o que não existe", () => {
    expect(casaTexto("Maria Silva", "joana")).toBe(false);
  });

  it("normaliza do jeito esperado", () => {
    expect(normalizarBusca("  ÁÉÍÕÇ  ")).toBe("aeioc");
    expect(soDigitos("(11) 99876-1001")).toBe("11998761001");
  });
});

describe("telefone só entra quando foi digitado número", () => {
  it("acha pelo pedaço do telefone, com ou sem formatação", () => {
    expect(casaTelefone("5511998761001", "99876")).toBe(true);
    expect(casaTelefone("5511998761001", "(11) 99876")).toBe(true);
  });

  it("BUSCA POR NOME NÃO CASA COM TODO MUNDO (o defeito da lupa)", () => {
    // o código antigo tirava as letras, sobrava "", e "telefone contém vazio"
    // era verdade para todos: procurar um nome devolvia a lista inteira
    expect(casaTelefone("5511998761001", "maria")).toBe(false);
    expect(casaTelefone("5511998761001", "")).toBe(false);
  });

  it("um ou dois dígitos não valem (casaria meia agenda)", () => {
    expect(casaTelefone("5511998761001", "11")).toBe(false);
    expect(casaTelefone("5511998761001", "119")).toBe(true);
  });
});

describe("busca de cliente: nome, telefone ou cidade", () => {
  const ana = { name: "Ana Paula", phone: "5562988880010", city: "Goiânia" };

  it("acha pelo nome", () => expect(casaCliente(ana, "ana")).toBe(true));
  it("acha pelo telefone", () => expect(casaCliente(ana, "98888")).toBe(true));
  it("acha pela cidade sem acento", () => expect(casaCliente(ana, "goiania")).toBe(true));
  it("não acha quem não é", () => expect(casaCliente(ana, "carla")).toBe(false));

  it("busca vazia mostra todo mundo", () => {
    expect(casaCliente(ana, "")).toBe(true);
    expect(casaCliente(ana, "   ")).toBe(true);
  });

  it("cliente sem cidade/telefone cadastrados não quebra", () => {
    expect(casaCliente({ name: "Sem Dados" }, "sem")).toBe(true);
    expect(casaCliente({ name: "Sem Dados" }, "9999")).toBe(false);
  });
});

describe("as telas usam a busca única", () => {
  const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("o chat busca em TODAS as abas (a pessoa, não a gaveta)", () => {
    const inbox = ler("src/app/(app)/whatsapp/inbox.tsx");
    expect(inbox).toContain("casaCliente");
    expect(inbox).toContain("if (!q && bucketOf(c) !== tab) return false;");
  });

  it("a tela de clientes usa o mesmo motor (acento e caixa não contam)", () => {
    const clientes = ler("src/app/(app)/clientes/page.tsx");
    expect(clientes).toContain("casaCliente");
    // e não voltou o filtro antigo, no banco, só por nome e exato
    expect(clientes).not.toContain("where.name = { contains: q }");
  });
});
