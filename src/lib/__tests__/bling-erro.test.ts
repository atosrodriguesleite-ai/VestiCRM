import { describe, it, expect } from "vitest";
import { blingErro } from "../bling";

/**
 * A RECUSA DO BLING TEM QUE DIZER O QUE FAZER (incidente 14/09/2026).
 *
 * O dono tentou emitir e recebeu só *"Acesso não permitido"*. Com essa frase
 * não dá para saber se o crachá venceu (401) ou se o aplicativo não tem o
 * escopo (403) — e são consertos diferentes. Duas tentativas de conserto
 * foram no escuro por causa disso.
 */

const bling = (corpo: object) => JSON.stringify({ error: corpo });

describe("a recusa do Bling vira frase acionável", () => {
  it("403 diz que é PERMISSÃO DO APLICATIVO e manda marcar o escopo e RECONECTAR", () => {
    const f = blingErro(bling({ type: "FORBIDDEN", message: "Acesso não permitido" }), 403);
    expect(f).toContain("Acesso não permitido");
    expect(f).toContain("não tem permissão");
    expect(f).toContain("Emissão de Nota Fiscal Eletrônica");
    // reconectar é o passo que quase todo mundo pula: o crachá guarda as
    // permissões do momento em que foi feito
    expect(f).toContain("reconecte");
    expect(f).toContain("403");
  });

  it("401 diz que é a AUTORIZAÇÃO, e o conserto é desconectar e conectar", () => {
    const f = blingErro(bling({ type: "UNAUTHORIZED", message: "Acesso não permitido" }), 401);
    expect(f).toContain("Desconectar");
    // não pode mandar mexer em escopo: aqui o escopo não é o problema
    expect(f).not.toContain("escopo");
    expect(f).toContain("401");
  });

  it("erro de validação traz o CAMPO que a SEFAZ vai recusar", () => {
    const f = blingErro(
      bling({
        message: "Dados inválidos",
        description: "Verifique os campos",
        fields: [{ element: "contato.endereco.cep", msg: "CEP é obrigatório" }],
      }),
      422
    );
    expect(f).toContain("contato.endereco.cep");
    expect(f).toContain("CEP é obrigatório");
    expect(f).toContain("Verifique os campos");
  });

  it("corpo ilegível não vira frase vazia, e o status não aparece duas vezes", () => {
    const f = blingErro("<html>erro</html>", 500);
    expect(f).toContain("500");
    expect(f.match(/500/g)).toHaveLength(1);
  });

  it("a frase tem teto — recusa gigante do Bling não estoura a tela", () => {
    const f = blingErro(bling({ message: "x".repeat(2000) }), 422);
    expect(f.length).toBeLessThanOrEqual(500);
  });
});
