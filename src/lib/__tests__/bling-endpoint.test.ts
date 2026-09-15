import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * O ENDEREÇO DA API DO BLING (incidente 14/09/2026).
 *
 * A emissão voltava "Acesso não permitido" porque as chamadas de API iam para
 * `www.bling.com.br`, e o Bling respondeu: *"A URL 'www.bling.com.br' está
 * bloqueada para requisições de API. Por favor, utilize o endpoint oficial:
 * 'api.bling.com.br'"*.
 *
 * O que tornou isso caro de achar: a CONEXÃO continuou funcionando (a tela de
 * autorização e a troca de token são no site), então o cartão dizia
 * "Conectado" e só a emissão falhava — e a investigação foi parar em escopo do
 * aplicativo, que não tinha nada a ver.
 *
 * Por isso o teste olha para ONDE A CHAMADA SAI, não para o texto do código:
 * um guarda que exige a constante escrita de um jeito protegeria o erro em vez
 * de impedi-lo.
 */

vi.mock("../db", () => ({
  db: {
    blingConnection: {
      findUnique: vi.fn().mockResolvedValue({
        companyId: "loja1",
        accessToken: "cripto",
        refreshToken: "cripto",
        // longe de vencer: a renovação não pode entrar no meio do teste
        expiresAt: new Date(Date.now() + 5 * 60 * 60 * 1000),
      }),
    },
  },
}));
vi.mock("../crypto", () => ({
  encryptSecret: (v: string) => v,
  decryptSecret: () => "token-de-mentira",
}));

import { blingAuthorizeUrl, consultarNfe } from "../bling";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ data: { situacao: 5, numero: "12" } }),
  });
  vi.stubGlobal("fetch", fetchMock);
  process.env.BLING_CLIENT_ID = "id-de-mentira";
  process.env.BLING_CLIENT_SECRET = "segredo-de-mentira";
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("para onde cada chamada do Bling sai", () => {
  it("chamada de API vai para api.bling.com.br — www é BLOQUEADO lá", async () => {
    await consultarNfe("loja1", "999");
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("https://api.bling.com.br/Api/v3/nfe/999");
    expect(url).not.toContain("www.bling.com.br");
  });

  it("o token vai no cabeçalho, então o endereço é a única coisa que muda", async () => {
    await consultarNfe("loja1", "999");
    const init = fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> };
    expect(init.headers.Authorization).toBe("Bearer token-de-mentira");
  });

  it("a tela de autorização continua no SITE — é o navegador da lojista que abre", () => {
    // aqui www é o certo: api.bling.com.br não serve página para gente ver,
    // e foi por este caminho que a loja conectou de verdade
    const url = blingAuthorizeUrl("loja1");
    expect(url).toContain("https://www.bling.com.br/Api/v3/oauth/authorize");
    expect(url).toContain("response_type=code");
  });
});

describe("autorização que não vale mais (incidente 14/09/2026)", () => {
  it("renovação que FALHA não manda o token velho — diz que precisa reconectar", async () => {
    const { db } = await import("../db");
    // conexão vencida: força o caminho da renovação
    (db.blingConnection.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      companyId: "loja1",
      accessToken: "cripto",
      refreshToken: "cripto",
      expiresAt: new Date(Date.now() - 60_000),
    });
    // o Bling RECUSA a renovação (foi o que aconteceu: mexer no escopo do
    // aplicativo revoga a autorização já concedida)
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: "invalid_grant" }),
      text: async () => "{}",
    });

    const r = await consultarNfe("loja1", "999");
    expect(r.ok).toBe(false);
    // o que NÃO pode acontecer: tentar a chamada com o token morto
    const chamadas = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(chamadas.some((u) => u.includes("/nfe/999"))).toBe(false);
    expect(chamadas.some((u) => u.includes("/oauth/token"))).toBe(true);
  });
});
