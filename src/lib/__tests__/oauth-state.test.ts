import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { signState, verifyState, VALIDADE_DO_ESTADO_MS } from "../oauth-state";

/**
 * CRACHÁ DO OAUTH das integrações.
 *
 * O de antes era `companyId.HMAC(companyId)`: o MESMO texto para sempre. Quem
 * o visse uma vez podia montar o link de autorização e mandar para outra
 * pessoa — ela autorizava a conta dela e os tokens caíam na loja de quem
 * mandou o link (com a carteira do Melhor Envio junto).
 */

const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

afterEach(() => vi.useRealTimers());

describe("signState / verifyState", () => {
  it("o crachá volta com a loja certa", () => {
    expect(verifyState(signState("loja-1"))).toBe("loja-1");
  });

  it("NÃO é o mesmo texto duas vezes (era o que permitia reaproveitar)", () => {
    expect(signState("loja-1")).not.toBe(signState("loja-1"));
  });

  it("adulterado é recusado", () => {
    const bom = signState("loja-1");
    const [corpo, sig] = bom.split(".");
    expect(verifyState(`${corpo}.${"a".repeat(sig.length)}`)).toBeNull();
    expect(verifyState(`${corpo}x.${sig}`)).toBeNull();
    expect(verifyState("loja-1.qualquercoisa")).toBeNull();
    expect(verifyState("")).toBeNull();
    // o crachá de OUTRA loja não vira o desta trocando o texto
    const deOutra = signState("loja-2");
    expect(verifyState(`${bom.split(".")[0]}.${deOutra.split(".")[1]}`)).toBeNull();
  });

  it("VENCE (não vale para sempre, como o antigo)", () => {
    vi.useFakeTimers();
    const estado = signState("loja-1");
    vi.advanceTimersByTime(VALIDADE_DO_ESTADO_MS - 1000);
    expect(verifyState(estado), "ainda dentro do prazo").toBe("loja-1");
    vi.advanceTimersByTime(2000);
    expect(verifyState(estado), "passou do prazo").toBeNull();
  });
});

// Guarda RN-023 · Conectar integração exige crachá de OAuth sorteado com
// validade E sessão da própria loja com permissão de integrações; o resultado
// da volta é dito na tela
describe("a volta do provedor confere a sessão", () => {
  const CALLBACKS = [
    "src/app/api/melhorenvio/callback/route.ts",
    "src/app/api/bling/callback/route.ts",
    "src/app/api/mercadopago/callback/route.ts",
    "src/app/api/nuvemshop/callback/route.ts",
  ];

  it("TODOS os quatro callbacks exigem sessão da própria loja", () => {
    for (const rota of CALLBACKS) {
      const texto = ler(rota);
      expect(texto, `${rota} sem a trava de sessão`).toContain("sessaoAutorizadaPara");
      expect(texto, `${rota} não barra quem não é da loja`).toContain('sessao !== "ok"');
      // e a trava vem ANTES de trocar o code por token
      const posTrava = texto.indexOf("sessaoAutorizadaPara(companyId)");
      const posTroca = texto.search(/(meExchangeCode|blingExchangeCode|mpExchangeCode|exchangeCode)\(/);
      expect(posTrava, `${rota}: a trava tem que vir antes da troca`).toBeLessThan(posTroca);
    }
  });

  it("o crachá fixo antigo não existe mais", () => {
    // era `${companyId}.${sig}`: determinístico e eterno. Agora nuvemshop.ts
    // só REEXPORTA o crachá sorteado (o createHmac que sobrou ali é a
    // conferência de webhook da Nuvemshop, outra coisa)
    const nuvem = ler("src/lib/nuvemshop.ts");
    expect(nuvem).toContain('export { signState, verifyState } from "./oauth-state"');
    expect(nuvem).not.toContain("export function signState");
    expect(ler("src/lib/oauth-state.ts")).toContain("randomBytes");
  });

  it("a tela explica CADA desfecho da volta (senão a trava vira 'não funciona')", () => {
    const tela = ler("src/app/(app)/configuracoes/resultado-conexao.tsx");
    for (const caso of ["ok", "outra_loja", "sem_sessao"]) {
      expect(tela, `sem mensagem para "${caso}"`).toContain(`"${caso}"`);
    }
    expect(ler("src/app/(app)/configuracoes/page.tsx")).toContain("<ResultadoDaConexao");
    // a Nuvemshop tem aviso próprio — e ele cobre os mesmos desfechos
    const nuvem = ler("src/app/(app)/configuracoes/nuvemshop-connect.tsx");
    expect(nuvem).toContain('q === "outra_loja"');
    expect(nuvem).toContain('q === "sem_sessao"');
  });

  it("o motivo da recusa é distinguido (login perdido não é link de outra loja)", () => {
    const lib = ler("src/lib/oauth-state.ts");
    expect(lib).toContain('"ok" | "sem_sessao" | "outra_loja"');
  });
});
