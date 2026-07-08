import type { TrackEventInput } from "./engine";

/**
 * Destinos externos de tracking — estrutura preparada (item 31).
 *
 * Quando Meta Pixel, GA4, Google Ads, TikTok Ads ou GTM forem contratados,
 * implemente o destino aqui e registre em DESTINATIONS. A engine já faz o
 * fan-out de todos os eventos por este ponto único — nenhuma tela muda.
 */

export interface TrackingDestination {
  readonly name: string;
  readonly configured: boolean;
  forward(companyId: string, events: TrackEventInput[]): Promise<void>;
}

class StubDestination implements TrackingDestination {
  readonly configured = false;
  constructor(readonly name: string) {}
  async forward(): Promise<void> {
    /* aguardando credenciais */
  }
}

export const DESTINATIONS: TrackingDestination[] = [
  new StubDestination("Meta Pixel"),
  new StubDestination("Google Analytics 4"),
  new StubDestination("Google Ads"),
  new StubDestination("TikTok Ads"),
  new StubDestination("Google Tag Manager"),
];

export async function forwardToDestinations(
  companyId: string,
  events: TrackEventInput[]
): Promise<void> {
  await Promise.all(
    DESTINATIONS.filter((d) => d.configured).map((d) =>
      d.forward(companyId, events)
    )
  );
}
