"use client";

/**
 * Cliente da Tracking Engine para o catálogo público.
 *
 * Performance: eventos entram numa fila em memória e são enviados em lote
 * a cada 4s (fetch keepalive) e no fechamento da aba (sendBeacon) — o
 * rastreamento NUNCA bloqueia o carregamento ou a navegação.
 *
 * LGPD: nada é gravado sem consentimento; o visitorId (localStorage) só
 * existe após o aceite. Recusou? A navegação segue 100% funcional.
 */

export type ClientEvent = {
  type: string;
  productId?: string;
  productName?: string;
  category?: string;
  color?: string;
  size?: string;
  qty?: number;
  value?: number;
  /** carga extra (ex.: a foto da sacola para a Recuperação) */
  meta?: Record<string, unknown>;
};

const CONSENT_KEY = "vesticrm_consent";
const VISITOR_KEY = "vesticrm_visitor";

export function getConsent(): "granted" | "denied" | null {
  if (typeof window === "undefined") return null;
  return (localStorage.getItem(CONSENT_KEY) as "granted" | "denied") ?? null;
}

export function setConsent(value: "granted" | "denied") {
  localStorage.setItem(CONSENT_KEY, value);
  if (value === "denied") localStorage.removeItem(VISITOR_KEY);
}

export class CatalogTracker {
  private queue: ClientEvent[] = [];
  private sessionId: string | null = null;
  private visitorId: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private starting = false;

  constructor(private companySlug: string) {}

  get active(): boolean {
    return this.sessionId !== null;
  }

  /** id da sessão aberta — o pedido do catálogo manda junto (faturamento por canal) */
  get session(): string | null {
    return this.sessionId;
  }

  /** Abre a sessão (só após consentimento). Não bloqueia nada. */
  async start(ref: string | null, utm: Record<string, string | null>) {
    if (this.sessionId || this.starting || getConsent() !== "granted") return;
    this.starting = true;
    try {
      const res = await fetch("/api/track/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          company: this.companySlug,
          visitorId: localStorage.getItem(VISITOR_KEY),
          ref,
          c: utm.c ?? null,
          utm: {
            source: utm.utm_source,
            medium: utm.utm_medium,
            campaign: utm.utm_campaign,
            term: utm.utm_term,
            content: utm.utm_content,
          },
          referer: document.referrer || null,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        this.sessionId = data.sessionId;
        this.visitorId = data.visitorId;
        localStorage.setItem(VISITOR_KEY, data.visitorId);
        this.track({ type: "page_view" });
        this.timer = setInterval(() => this.flush(), 4000);
        window.addEventListener("pagehide", () => {
          this.track({ type: "session_end" });
          this.flush(true);
        });
      }
    } catch {
      /* tracking nunca quebra o catálogo */
    } finally {
      this.starting = false;
    }
  }

  /** Enfileira um evento (memória; envio em background). */
  track(event: ClientEvent) {
    if (!this.sessionId) return;
    this.queue.push(event);
    if (this.queue.length >= 20) this.flush();
  }

  flush(useBeacon = false) {
    if (!this.sessionId || this.queue.length === 0) return;
    const batch = this.queue.splice(0, 100);
    const body = JSON.stringify({
      company: this.companySlug,
      sessionId: this.sessionId,
      events: batch,
    });
    try {
      if (useBeacon && navigator.sendBeacon) {
        navigator.sendBeacon(
          "/api/track",
          new Blob([body], { type: "application/json" })
        );
      } else {
        fetch("/api/track", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: true,
        }).catch(() => {});
      }
    } catch {
      /* silencioso */
    }
  }

  /** Cliente informou o telefone → unifica a navegação anônima. */
  identify(phone: string) {
    if (!this.visitorId) return;
    fetch("/api/track/identify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        company: this.companySlug,
        visitorId: this.visitorId,
        phone,
      }),
    }).catch(() => {});
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }
}
