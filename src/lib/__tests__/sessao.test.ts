import { describe, it, expect } from "vitest";
import {
  atributosDoCookieDeSessao,
  avisoDaRecusa,
  deveRenovarSessao,
  inicioDaSessao,
  RENOVA_SESSAO_APOS_S,
  rotaMexeNaSessao,
  SESSAO_VALIDADE_S,
  TETO_SESSAO_S,
} from "../sessao";

// Guarda RN-064
//
// A sessão renova sozinha enquanto a pessoa USA o sistema: o porteiro
// reassina o cookie quando o crachá passa de 1 dia — a sessão vence com 7
// dias parada ou no teto de 30 dias desde o login. Incidente que criou a
// regra: a Entre Linhas cadastrando produtos e o salvar respondendo "Não
// autenticado" no 7º dia do login.

const AGORA = Date.UTC(2026, 8, 23, 12, 0, 0);
const agoraS = Math.floor(AGORA / 1000);
const iatHaSegundos = (s: number) => agoraS - s;

describe("RN-064 — a sessão renova enquanto a pessoa usa", () => {
  it("crachá com mais de 1 dia de idade é renovado", () => {
    expect(
      deveRenovarSessao({ sub: "u1", iat: iatHaSegundos(RENOVA_SESSAO_APOS_S + 60) }, AGORA)
    ).toBe(true);
    // no limite exato também renova (>=): esperar mais um pedido não ajuda
    expect(
      deveRenovarSessao({ sub: "u1", iat: iatHaSegundos(RENOVA_SESSAO_APOS_S) }, AGORA)
    ).toBe(true);
  });

  it("crachá novo (menos de 1 dia) fica como está — nada de Set-Cookie a cada clique", () => {
    expect(deveRenovarSessao({ sub: "u1", iat: iatHaSegundos(60) }, AGORA)).toBe(false);
    expect(
      deveRenovarSessao({ sub: "u1", iat: iatHaSegundos(RENOVA_SESSAO_APOS_S - 60) }, AGORA)
    ).toBe(false);
  });

  it("TETO de 30 dias desde o LOGIN: depois dele a renovação para (cookie roubado e aba esquecida não viram sessão eterna)", () => {
    const login = iatHaSegundos(TETO_SESSAO_S + 60); // logou há 30 dias e 1 min
    // o crachá em uso tem 2 dias de idade (foi renovado várias vezes), mas o
    // carimbo `auth` diz quando o LOGIN foi — e é ele que manda no teto
    expect(
      deveRenovarSessao({ sub: "u1", iat: iatHaSegundos(2 * 24 * 3600), auth: login }, AGORA)
    ).toBe(false);
    // dentro do teto, renova normal
    expect(
      deveRenovarSessao(
        { sub: "u1", iat: iatHaSegundos(2 * 24 * 3600), auth: iatHaSegundos(TETO_SESSAO_S - 24 * 3600) },
        AGORA
      )
    ).toBe(true);
  });

  it("crachá de ANTES do carimbo `auth` usa o próprio iat como início — ninguém ganha teto de graça", () => {
    expect(inicioDaSessao({ iat: 1000 })).toBe(1000);
    expect(inicioDaSessao({ iat: 1000, auth: 500 })).toBe(500);
    expect(inicioDaSessao({})).toBeNull();
    // crachá antigo (sem auth) com 2 dias: renova, e o auth novo nasce do iat
    expect(deveRenovarSessao({ sub: "u1", iat: iatHaSegundos(2 * 24 * 3600) }, AGORA)).toBe(true);
  });

  it("IMPERSONAÇÃO não renova: sessão de suporte do Super Admin vence em 7 dias como sempre", () => {
    expect(
      deveRenovarSessao(
        { sub: "u1", imp: "superadmin1", iat: iatHaSegundos(SESSAO_VALIDADE_S - 60) },
        AGORA
      )
    ).toBe(false);
  });

  it("crachá torto não renova: renovação é conveniência, nunca caminho novo de emissão", () => {
    // sem sub, sub vazio ou de outro tipo
    expect(deveRenovarSessao({ iat: iatHaSegundos(999999) }, AGORA)).toBe(false);
    expect(deveRenovarSessao({ sub: "", iat: iatHaSegundos(999999) }, AGORA)).toBe(false);
    expect(deveRenovarSessao({ sub: 42, iat: iatHaSegundos(999999) }, AGORA)).toBe(false);
    // sem iat, iat não numérico ou no FUTURO (relógio errado)
    expect(deveRenovarSessao({ sub: "u1" }, AGORA)).toBe(false);
    expect(deveRenovarSessao({ sub: "u1", iat: "ontem" }, AGORA)).toBe(false);
    expect(deveRenovarSessao({ sub: "u1", iat: iatHaSegundos(-3600) }, AGORA)).toBe(false);
  });

  it("as rotas que MEXEM no cookie de sessão não recebem renovação por cima (dois Set-Cookie da mesma sessão = 'Sair' que não sai)", () => {
    expect(rotaMexeNaSessao("/api/auth/logout")).toBe(true);
    expect(rotaMexeNaSessao("/api/auth/login/codigo")).toBe(true);
    expect(rotaMexeNaSessao("/api/impersonate")).toBe(true);
    expect(rotaMexeNaSessao("/api/impersonate/exit")).toBe(true);
    expect(rotaMexeNaSessao("/api/products")).toBe(false);
    expect(rotaMexeNaSessao("/pedidos")).toBe(false);
  });

  it("a validade continua 7 dias e os atributos do cookie são os do login", () => {
    expect(SESSAO_VALIDADE_S).toBe(60 * 60 * 24 * 7);
    expect(RENOVA_SESSAO_APOS_S).toBe(60 * 60 * 24);
    expect(TETO_SESSAO_S).toBe(60 * 60 * 24 * 30);
    expect(atributosDoCookieDeSessao()).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      maxAge: SESSAO_VALIDADE_S,
      path: "/",
    });
  });

  it("o 401 do PORTEIRO (sessao: vencida) vira a instrução da OUTRA aba, que salva o digitado", () => {
    const aviso = avisoDaRecusa(
      401,
      { error: "Não autenticado", sessao: "vencida" },
      "Não foi possível salvar."
    );
    expect(aviso).toContain("sessão venceu");
    expect(aviso).toContain("OUTRA aba");
  });

  it("o 401 SEM a marca (usuária desativada, loja suspensa) NÃO manda para o beco da outra aba", () => {
    // entrar de novo não resolveria — a instrução é falar com quem administra
    const aviso = avisoDaRecusa(401, { error: "Não autenticado" }, "x");
    expect(aviso).not.toContain("OUTRA aba");
    expect(aviso).toContain("fale com quem administra");
  });

  it("fora do 401 vale o que o servidor disse — e o fallback quando ele calou", () => {
    expect(avisoDaRecusa(403, { error: "Sem permissão" }, "x")).toBe("Sem permissão");
    expect(avisoDaRecusa(500, null, "Não foi possível salvar.")).toBe("Não foi possível salvar.");
    expect(avisoDaRecusa(400, {}, "Confira os campos.")).toBe("Confira os campos.");
  });
});
