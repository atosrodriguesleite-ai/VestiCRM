/**
 * Captura GLOBAL de erros de produção (Next.js chama onRequestError para
 * qualquer erro não tratado em rotas/páginas do servidor). Cada erro vira um
 * registro no painel Saúde (/saude) e um push pro Super Admin — com anti-spam.
 *
 * IMPORTANTE: o import do coletor fica DENTRO do `if (NEXT_RUNTIME ===
 * "nodejs")` — o empacotador remove o bloco morto no build edge. Com early
 * return, o bundle edge tentaria resolver web-push (usa módulos do Node,
 * ex.: "https") e o deploy QUEBRA na Vercel.
 */

export function register() {
  // nada a inicializar — o gancho importante é o onRequestError abaixo
}

export async function onRequestError(
  err: unknown,
  request: { path: string; method: string },
) {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { logServerError } = await import("./lib/health");
      const e = err as Error & { digest?: string };
      await logServerError({
        source: "server",
        path: `${request.method} ${request.path}`,
        message: e?.message ?? String(err),
        detail: e?.stack ?? (e?.digest ? `digest: ${e.digest}` : null),
      });
    } catch {
      // o coletor de erros nunca pode gerar erro
    }
  }
}
