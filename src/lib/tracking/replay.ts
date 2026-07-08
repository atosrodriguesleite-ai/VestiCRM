/**
 * Replay de sessão — estrutura preparada (sugestão do produto).
 *
 * O modelo TrackSession já tem o campo `replayId`. Quando uma ferramenta de
 * replay for contratada (rrweb auto-hospedado, PostHog, OpenReplay...),
 * implemente este contrato: o catálogo chama `startRecording` no início da
 * sessão e a Inteligência Comercial usa `getReplayUrl` para exibir o botão
 * "Assistir sessão" na jornada do cliente. Nenhuma outra parte do CRM muda.
 */

export interface SessionReplayProvider {
  readonly name: string;
  readonly configured: boolean;
  /** inicia a gravação e devolve o replayId a salvar na TrackSession */
  startRecording(sessionId: string): Promise<string | null>;
  /** URL para assistir o replay de uma sessão gravada */
  getReplayUrl(replayId: string): string | null;
}

class NotConfiguredReplay implements SessionReplayProvider {
  readonly name = "Replay (não configurado)";
  readonly configured = false;
  async startRecording(): Promise<string | null> {
    return null;
  }
  getReplayUrl(): string | null {
    return null;
  }
}

export const replayProvider: SessionReplayProvider = new NotConfiguredReplay();
