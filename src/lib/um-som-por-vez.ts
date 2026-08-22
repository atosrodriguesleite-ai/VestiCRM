/**
 * UM SOM DE CADA VEZ na Central de Atendimento (pedido do dono, 21/08/2026).
 *
 * O player de áudio do navegador não conversa com os vizinhos: cada um toca
 * por conta própria. Na prática, a vendedora ouvia o áudio da cliente, abria
 * o seguinte para conferir e os DOIS saíam ao mesmo tempo — não dá para
 * entender nenhum dos dois, e ela precisava caçar o player anterior no meio
 * da conversa para pausar na mão.
 *
 * A regra é a do WhatsApp: começou um som, o que estava tocando para. Vale
 * entre áudios E vídeos (som é som; dois juntos atrapalham igual).
 *
 * Recebe a lista para poder ser testada sem navegador — quem chama passa os
 * players que existem na tela.
 */
export type MidiaTocavel = { paused: boolean; pause: () => void };

export function pausarOsOutros(
  atual: MidiaTocavel,
  todas: Iterable<MidiaTocavel>
): void {
  for (const midia of todas) {
    // `paused` evita pausar quem já estava parado (mexer à toa no player
    // faz o navegador disparar evento e piscar o controle)
    if (midia !== atual && !midia.paused) midia.pause();
  }
}
