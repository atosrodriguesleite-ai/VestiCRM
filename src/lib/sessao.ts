/**
 * RN-064 · A SESSÃO RENOVA SOZINHA ENQUANTO A PESSOA USA O SISTEMA.
 *
 * Relato da Entre Linhas (23/09/2026): cadastrando produtos novos, tudo
 * preenchido, e o salvar respondia "Não autenticado". O login valia 7 dias
 * CRAVADOS a partir da entrada (JWT + cookie) e vencia no meio do trabalho —
 * e a tela de Produtos vive no navegador, então o salvar é a PRIMEIRA ida ao
 * servidor: a pessoa só descobre que caiu na hora em que mais custa, com a
 * ficha inteira digitada.
 *
 * A regra: o porteiro global (middleware) REASSINA o cookie quando o crachá
 * passa de 1 dia de idade — quem usa o sistema todo dia não é derrubada; a
 * sessão vence com 7 dias PARADA ou ao bater o TETO de 30 dias desde o
 * login. As travas (cada uma tem teste):
 *
 * - **Teto absoluto de 30 dias** (`auth`, o carimbo do LOGIN, que a
 *   renovação PRESERVA): sem ele, um cookie roubado — ou a aba esquecida
 *   aberta na loja, que o sync de 3s da Central mantém "em uso" — viraria
 *   sessão eterna. Passou do teto, não renova mais e a sessão morre em até
 *   7 dias, pedindo o login de novo.
 * - **Impersonação NÃO renova**: o "acessar como loja" do Super Admin segue
 *   vencendo em 7 dias — sessão de suporte não vira permanente.
 * - **Renovar não reabre porta nenhuma**: o cookie novo só prova QUEM É; a
 *   usuária desativada e a loja suspensa continuam barradas na consulta de
 *   sempre (`getSessionUser` confere o banco a cada requisição).
 * - **Crachá torto não renova**: sem `sub`, sem `iat` ou com `iat` no futuro
 *   (relógio errado), fica como está — renovação é conveniência, nunca um
 *   caminho novo de emissão.
 * - **As rotas que MEXEM no próprio cookie não renovam** (logout e
 *   impersonação, decidido em `rotaMexeNaSessao`): o middleware e a rota
 *   escreveriam DOIS Set-Cookie da mesma sessão na mesma resposta, e quem
 *   vence depende da plataforma — o "Sair" podia sair sem sair.
 *
 * Assinatura e atributos do cookie moram AQUI, numa função só, usados pelo
 * login (`createSession`) e pela renovação do porteiro: cookie renovado
 * diferente do original é a classe de bug que só aparece para sessão de um
 * dia de idade. As funções são puras (jose roda no edge) e testadas.
 */

import { SignJWT } from "jose";

/** Nome do cookie de sessão — o mesmo do login, do porteiro e do logout. */
export const COOKIE_SESSAO = "vesticrm_session";

/** Validade de cada crachá: 7 dias (o login e a renovação usam daqui). */
export const SESSAO_VALIDADE_S = 60 * 60 * 24 * 7;

/**
 * Idade a partir da qual o crachá é reassinado (1 dia). Renovar em toda
 * requisição seria um Set-Cookie por resposta à toa; uma vez por dia basta
 * para a sessão de quem USA não vencer no meio do trabalho.
 */
export const RENOVA_SESSAO_APOS_S = 60 * 60 * 24;

/**
 * Teto ABSOLUTO da sessão: 30 dias desde o login. Depois dele a renovação
 * para e o último crachá vence em até 7 dias — a pessoa entra de novo.
 */
export const TETO_SESSAO_S = 60 * 60 * 24 * 30;

/** O payload do JWT como chega do `jwtVerify` (campos sem garantia de tipo). */
type PayloadDaSessao = { sub?: unknown; iat?: unknown; imp?: unknown; auth?: unknown };

/**
 * Quando o crachá NASCEU DE VERDADE (o login): o carimbo `auth`, preservado
 * pelas renovações. Crachá de antes do carimbo usa o próprio `iat` — ele tem
 * no máximo 7 dias, então ninguém ganha teto de graça.
 */
export function inicioDaSessao(payload: PayloadDaSessao): number | null {
  if (typeof payload.auth === "number") return payload.auth;
  if (typeof payload.iat === "number") return payload.iat;
  return null;
}

export function deveRenovarSessao(payload: PayloadDaSessao, agoraMs: number): boolean {
  // impersonação (Super Admin como loja) não renova — vence como sempre
  if (payload.imp !== undefined) return false;
  if (typeof payload.sub !== "string" || !payload.sub) return false;
  if (typeof payload.iat !== "number") return false;
  const agoraS = agoraMs / 1000;
  // iat no futuro dá idade negativa e cai aqui: não renova
  if (agoraS - payload.iat < RENOVA_SESSAO_APOS_S) return false;
  // teto absoluto: depois de 30 dias do LOGIN, a renovação para
  const inicio = inicioDaSessao(payload);
  if (inicio === null || agoraS - inicio >= TETO_SESSAO_S) return false;
  return true;
}

/**
 * Rotas que ESCREVEM o cookie de sessão (login por código, logout, entrar e
 * sair da impersonação): o porteiro não renova nelas — seriam dois
 * Set-Cookie da mesma sessão na mesma resposta, com vencedor dependente da
 * plataforma.
 */
export function rotaMexeNaSessao(pathname: string): boolean {
  return pathname.startsWith("/api/auth") || pathname.startsWith("/api/impersonate");
}

/**
 * O ÚNICO lugar que assina crachá de sessão: login e renovação passam aqui.
 * `authTime` é o carimbo do login (segundos); a renovação repassa o que leu.
 * Claim novo de sessão entra AQUI, nunca só no login — senão a primeira
 * renovação o apagaria em silêncio.
 */
export async function assinarCrachaDeSessao(
  secret: Uint8Array,
  claims: { sub: string; authTime: number; imp?: string }
): Promise<string> {
  return await new SignJWT({
    sub: claims.sub,
    auth: claims.authTime,
    ...(claims.imp ? { imp: claims.imp } : {}),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSAO_VALIDADE_S}s`)
    .sign(secret);
}

/** Atributos do cookie — os MESMOS no login e na renovação. */
export function atributosDoCookieDeSessao() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSAO_VALIDADE_S,
    path: "/",
  };
}

/**
 * O aviso que a tela mostra quando a API recusa: 401 vira instrução de
 * gente, não jargão — e instrução CERTA para cada caso. O porteiro marca o
 * 401 dele com `sessao: "vencida"` (cookie ausente, vencido ou inválido —
 * entrar de novo RESOLVE, e a dica da OUTRA aba é o que salva o digitado: o
 * login em outra aba renova o cookie do navegador inteiro). O 401 SEM a
 * marca veio de dentro (usuária desativada, loja suspensa): ali "entre em
 * outra aba" seria um beco — a instrução é falar com quem administra.
 */
export function avisoDaRecusa(
  status: number,
  corpo: { error?: unknown; sessao?: unknown } | null | undefined,
  fallback: string
): string {
  if (status === 401) {
    if (corpo?.sessao === "vencida") {
      return (
        "Sua sessão venceu. Abra o AtacadoPro em OUTRA aba do navegador, " +
        "faça o login e volte NESTA tela para salvar de novo — o que você " +
        "preencheu continua aqui."
      );
    }
    return (
      "O sistema não reconheceu seu acesso. Saia e entre de novo; se não " +
      "resolver, fale com quem administra a loja."
    );
  }
  return (typeof corpo?.error === "string" && corpo.error) || fallback;
}
