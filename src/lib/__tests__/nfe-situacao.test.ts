// Guarda RN-058
import { describe, it, expect } from "vitest";
import { acaoDaNota, seloDaNota } from "../nfe-situacao";

/**
 * "Uma nota foi rejeitada, aí atualizei os dados com a inscrição estadual —
 * como faço para reemitir?" (relato do dono, 16/09/2026). Não havia como: a
 * ficha mostrava o selo OU o botão, nunca os dois.
 */

describe("quando o pedido pode ganhar uma nota nova", () => {
  it("sem nota nenhuma: o caminho normal", () => {
    const a = acaoDaNota(null);
    expect(a.pode).toBe(true);
    if (a.pode) expect(a.rotulo).toContain("Emitir NF-e");
  });

  it("REJEITADA pode — é o caso do relato, e a nota não existe no fisco", () => {
    const a = acaoDaNota("REJEITADA");
    expect(a.pode).toBe(true);
    if (a.pode) {
      expect(a.rotulo).toBe("Emitir nova NF-e");
      expect(a.aviso).toContain("não existe perante o fisco");
      // a confirmação precisa TIRAR o medo de nota em dobro, que é o que
      // faz a lojista não clicar
      expect(a.confirmacao).toContain("não vale");
    }
  });

  it("CANCELADA pode — o pedido ficou sem nota", () => {
    const a = acaoDaNota("CANCELADA");
    expect(a.pode).toBe(true);
    if (a.pode) expect(a.rotulo).toBe("Emitir nova NF-e");
  });

  it("ERRO pode, e o texto diz que a anterior é CONFERIDA antes", () => {
    // é a proteção contra o caso traiçoeiro: o tempo esgotar depois de a
    // SEFAZ ter aceitado
    const a = acaoDaNota("ERRO");
    expect(a.pode).toBe(true);
    if (a.pode) {
      expect(a.rotulo).toBe("Tentar de novo");
      expect(a.aviso).toContain("consulta o Bling");
    }
  });

  it("AUTORIZADA NUNCA — seria nota em dobro", () => {
    const a = acaoDaNota("AUTORIZADA");
    expect(a.pode).toBe(false);
    if (!a.pode) {
      expect(a.motivo).toContain("nota em dobro");
      // e diz o caminho de verdade, que é cancelar
      expect(a.motivo).toContain("cancele");
    }
  });

  it("EMITINDO não: está em andamento, e o botão volta se for recusada", () => {
    const a = acaoDaNota("EMITINDO");
    expect(a.pode).toBe(false);
    if (!a.pode) expect(a.motivo).toContain("andamento");
  });

  it("situação DESCONHECIDA cai no lado seguro", () => {
    // o Bling pode ganhar uma situação nova; oferecer o botão por padrão
    // arriscaria nota em dobro
    expect(acaoDaNota("SITUACAO_NOVA_DO_BLING").pode).toBe(false);
  });
});

describe("o que a ficha pode PROMETER sobre a nota que vai sair", () => {
  it("nota NOVA é montada do zero: pode prometer natureza e NCM atuais", () => {
    for (const st of [null, "REJEITADA", "CANCELADA"] as const) {
      const a = acaoDaNota(st);
      expect(a.pode).toBe(true);
      if (a.pode) expect(a.remontaNota).toBe(true);
    }
  });

  it("ERRO NÃO remonta — a retomada reenvia o rascunho que já existe", () => {
    // prometer a natureza nova aqui seria mentira sobre documento fiscal: a
    // lojista cadastra a inscrição estadual, lê "vai sair como contribuinte"
    // e a SEFAZ autoriza com os dados antigos
    const a = acaoDaNota("ERRO");
    expect(a.pode).toBe(true);
    if (a.pode) {
      expect(a.remontaNota).toBe(false);
      // e o texto tem que DIZER isso, com a saída
      expect(a.aviso).toContain("REENVIA");
      expect(a.aviso).toContain("NOVA");
    }
  });
});

describe("o selo da nota na lista de pedidos", () => {
  it("nota autorizada mostra o NÚMERO, que é o que a lojista confere", () => {
    expect(seloDaNota("AUTORIZADA", "000008")?.texto).toBe("NF 000008");
  });

  it("autorizada sem número ainda diz que saiu (o número chega na consulta)", () => {
    expect(seloDaNota("AUTORIZADA", null)?.texto).toBe("NF emitida");
  });

  it("pedido SEM nota não ganha selo — marcar ausência poluiria a lista toda", () => {
    expect(seloDaNota(null, null)).toBeNull();
    expect(seloDaNota("", null)).toBeNull();
  });

  it("a que DEU ERRADO aparece, e é onde o selo vale mais", () => {
    // pedido pago sem nota é pendência fiscal, e só aparecia abrindo um por um
    for (const st of ["REJEITADA", "CANCELADA", "ERRO"]) {
      const selo = seloDaNota(st, null)!;
      expect(selo.texto).toContain("NF");
      expect(selo.cor).toBe("#E11D48"); // vermelho: é problema, não informação
      expect(selo.titulo.length).toBeGreaterThan(20); // diz o que fazer
    }
  });

  it("em andamento vira relógio, e some sozinha quando resolver", () => {
    expect(seloDaNota("EMITINDO", null)?.cor).toBe("#D97706");
  });

  it("a nota RECUSADA nunca mostra número de nota que não vale", () => {
    // o número existe no banco (a SEFAZ devolve), mas anunciá-lo faria a
    // lojista achar que tem nota
    expect(seloDaNota("REJEITADA", "000008")?.texto).not.toContain("000008");
  });
});
