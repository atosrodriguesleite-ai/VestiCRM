/**
 * Segredos da aplicação. Em produção são OBRIGATÓRIOS: se faltarem, a
 * aplicação falha de propósito (fail-fast) em vez de rodar com um segredo
 * público — o que tornaria as sessões e as credenciais das integrações
 * forjáveis. Em desenvolvimento, cai num valor padrão para facilitar.
 *
 * Edge-safe: só lê process.env (usado inclusive no middleware).
 */

const DEV_FALLBACK = "vesticrm-dev-secret";

// Durante o `next build` os segredos não são necessários; a exigência vale
// em tempo de execução (next start / serverless).
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

function resolveSecret(name: "AUTH_SECRET" | "CRED_SECRET", fallbackEnv?: string): string {
  const value =
    process.env[name] || (fallbackEnv ? process.env[fallbackEnv] : undefined);
  if (value && value.length >= 16) return value;
  if (process.env.NODE_ENV === "production" && !isBuildPhase) {
    throw new Error(
      `[VestiCRM] ${name} não definido (ou muito curto) em produção. ` +
        `Configure um segredo forte de pelo menos 16 caracteres na variável de ambiente ${name}.`
    );
  }
  return DEV_FALLBACK;
}

/** Assina/verifica a sessão (JWT). */
export const AUTH_SECRET = resolveSecret("AUTH_SECRET");

/** Criptografa credenciais de integrações. Cai em AUTH_SECRET se não definido. */
export const CRED_SECRET = resolveSecret("CRED_SECRET", "AUTH_SECRET");
