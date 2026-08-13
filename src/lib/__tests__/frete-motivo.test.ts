import { describe, it, expect } from "vitest";
import { motivoRecusa } from "../melhorenvio";

/**
 * A cotação sumia com a transportadora que não deu preço — a lojista via só
 * os Correios e achava que o sistema não cotava as outras. Agora cada recusa
 * vira uma frase que ela entende (e resolve).
 */
describe("motivoRecusa", () => {
  it("conta não liberada é a causa nº 1 — manda verificar a conta", () => {
    for (const erro of [
      "Serviço não habilitado para esta conta",
      "É necessário possuir contrato com a transportadora",
      "Sua conta não está autorizada a utilizar este serviço",
      "Transportadora não credenciada para esta conta",
    ]) {
      expect(motivoRecusa(erro)).toContain("Melhor Envio");
      expect(motivoRecusa(erro)).toContain("verificação da conta");
    }
  });

  it("separa peso, tamanho, trecho e valor", () => {
    expect(motivoRecusa("Peso máximo excedido")).toContain("Peso");
    expect(motivoRecusa("Altura acima do permitido")).toContain("Tamanho da caixa");
    expect(motivoRecusa("CEP de destino não atendido")).toContain("trecho");
    expect(motivoRecusa("Valor declarado acima do limite")).toContain("Valor do pedido");
  });

  it("motivo desconhecido é mostrado como veio — nada é escondido", () => {
    expect(motivoRecusa("Instabilidade momentânea")).toBe("Instabilidade momentânea");
  });

  it("problema da transportadora NÃO manda verificar a conta", () => {
    // mandar verificar uma conta já verificada faz a lojista perder o dia
    expect(motivoRecusa("Serviço inativo no momento")).toBe("Serviço inativo no momento");
  });
});
