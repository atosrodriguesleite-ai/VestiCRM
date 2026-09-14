/**
 * QUAL MICROFONE GRAVA O ÁUDIO.
 *
 * Reclamação real (26/08/2026): "estou usando o headset, mas o som não sai do
 * microfone do headset e sim do computador". O sistema pedia o microfone sem
 * dizer QUAL — então quem escolhia era o Windows, pelo "dispositivo padrão".
 * Plugar o headset não muda esse padrão sozinho, e a vendedora não tem como
 * saber: a barra de gravação nunca disse de onde estava vindo o som.
 *
 * Agora dá para escolher aqui dentro, e a escolha fica guardada no aparelho.
 * As regras que decidem isso ficam neste arquivo (sem navegador no meio) para
 * poderem ser conferidas por teste.
 */

/** Onde a escolha fica guardada (por aparelho, não por loja). */
export const CHAVE_MICROFONE = "vesti:microfone";

/**
 * QUANTO ESPERAR ANTES DE COMEÇAR A GRAVAR DE VERDADE (ms).
 *
 * "No primeiro segundo tá estourado, depois fica bom" (26/08/2026). O ganho
 * automático do navegador começa alto e leva um instante para achar o volume
 * da voz — esse instante ia inteiro para dentro do arquivo. Meio segundo de
 * espera joga a subida do ganho FORA da gravação, e é exatamente por isso que
 * o resto do áudio sempre soou bem.
 */
export const MS_ASSENTAR_MICROFONE = 500;

/**
 * Qualidade de GRAVAÇÃO, não de chamada: o cancelamento de eco é feito para
 * conversa ao vivo e come parte da voz. A supressão de ruído fica — loja de
 * confecção é barulhenta.
 *
 * O GANHO AUTOMÁTICO DO NAVEGADOR SAI (relato do dono, 14/09/2026: "uso
 * microfone com anti-ruído, mas o áudio captura sons do fundo, e sons que
 * nem são altos chegam estourando"). Era ele: nas pausas da fala o ganho
 * automático sobe para "achar" som — e o que ele acha é o fundo da sala, que
 * o anti-ruído do microfone tinha abaixado. E um som médio que chega com o
 * ganho lá em cima satura ANTES de qualquer freio nosso: o corte acontece
 * dentro do navegador, num estágio que não dá para desfazer depois. O
 * volume da voz é acertado por nós, depois, medindo a energia da FALA
 * (`normalizarVoz`), com portão de ruído e freio de verdade — trabalho que
 * o ganho automático fazia pior.
 */
export function restricoesDeAudio(microfoneId?: string | null): MediaTrackConstraints {
  return {
    echoCancellation: false,
    noiseSuppression: true,
    autoGainControl: false,
    channelCount: 1,
    // `exact` de propósito: sem ele o navegador aceita o pedido e entrega
    // OUTRO microfone em silêncio — que é exatamente o problema que esta
    // entrega veio resolver. Falhando, o código de cima cai no padrão e AVISA.
    ...(microfoneId ? { deviceId: { exact: microfoneId } } : {}),
  };
}

/**
 * O microfone escolhido ainda existe na lista de agora?
 *
 * Headset desconectado, porta trocada, outro computador: o id guardado deixa
 * de valer. Sem esta conferência a gravação simplesmente falharia — melhor
 * voltar para o padrão do aparelho e dizer o que aconteceu.
 */
export function microfoneAindaExiste(
  microfoneId: string | null | undefined,
  disponiveis: { deviceId: string }[]
): boolean {
  if (!microfoneId) return false;
  return disponiveis.some((d) => d.deviceId === microfoneId);
}

/**
 * A GRAVAÇÃO FALHOU PORQUE O APARELHO ESCOLHIDO SUMIU?
 *
 * Só nesse caso vale voltar para o padrão do computador. A primeira versão
 * tratava QUALQUER falha como "sumiu" — inclusive a permissão negada, que é
 * outra coisa completamente diferente: nela o navegador nem deixa ver a lista
 * de aparelhos (devolve tudo com id vazio, de propósito). Resultado: a
 * escolha da vendedora era APAGADA por engano e, depois de reautorizar, ela
 * voltava a gravar pelo padrão do Windows sem saber — o defeito original de
 * volta (achado da revisão).
 *
 * `nome` é o `name` do erro do navegador; `disponiveis` é a lista de agora.
 */
export function microfoneSumiu(
  nome: string | null | undefined,
  microfoneId: string | null | undefined,
  disponiveis: { deviceId: string }[]
): boolean {
  if (!microfoneId) return false;
  // estes dois são os erros de "esse aparelho não existe/não serve"
  if (nome !== "OverconstrainedError" && nome !== "NotFoundError") return false;
  // lista sem NENHUM id legível = não deu para conferir (permissão negada):
  // na dúvida, a escolha da vendedora fica de pé
  if (!disponiveis.some((d) => d.deviceId)) return false;
  return !microfoneAindaExiste(microfoneId, disponiveis);
}

/**
 * Nome legível do microfone, do jeito que cabe na barra de gravação.
 *
 * Tira só o prefixo em inglês que o Chrome põe ("Default - ") e encurta o
 * que for comprido demais.
 *
 * O QUE VEM ENTRE PARÊNTESES FICA. A primeira versão cortava ali, para
 * enxugar — mas no Windows em português os dois aparelhos se chamam
 * "Microfone", e a diferença mora justamente no parêntese: "Microfone
 * (Realtek(R) Audio)" é o do computador e "Microfone (2- USB Audio Device)" é
 * o headset. Cortando, os dois viravam "Microfone" e a barra ficava ambígua
 * exatamente no caso que esta entrega veio resolver (achado da revisão).
 */
export function nomeCurtoDoMicrofone(rotulo: string | null | undefined): string {
  const t = (rotulo ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "Microfone padrão";
  const semPrefixo = t.replace(/^(default|communications)\s*-\s*/i, "").trim();
  const nome = semPrefixo || t;
  return nome.length > 34 ? `${nome.slice(0, 33)}…` : nome;
}

/**
 * O NAVEGADOR ENTREGOU O MICROFONE QUE FOI PEDIDO?
 *
 * `deviceId: { exact }` já obriga — mas "garantia" é conferir o que veio, não
 * confiar no que foi pedido (pedido do dono, 14/09/2026). O que veio está em
 * `track.getSettings().deviceId`. Sem escolha, qualquer um serve; sem id nas
 * configurações (navegador que não informa), não dá para dizer que divergiu.
 */
export function microfoneEntregueConfere(
  escolhidoId: string | null | undefined,
  entregue: { deviceId?: string } | null | undefined
): boolean {
  if (!escolhidoId) return true;
  if (!entregue?.deviceId) return true;
  return entregue.deviceId === escolhidoId;
}

/**
 * O que o navegador DE FATO aplicou na captura, em português, para a barra
 * de gravação mostrar ao passar o mouse — é a prova de que a configuração
 * pedida foi a usada, e não só desejada.
 */
export function descricaoDaCaptura(
  entregue: {
    noiseSuppression?: boolean;
    autoGainControl?: boolean;
    echoCancellation?: boolean;
    sampleRate?: number;
  } | null | undefined
): string {
  if (!entregue) return "";
  const liga = (v: boolean | undefined) => (v === undefined ? "?" : v ? "ligado" : "desligado");
  const partes = [
    `supressão de ruído ${liga(entregue.noiseSuppression)}`,
    `ganho automático ${liga(entregue.autoGainControl)}`,
    `cancelamento de eco ${liga(entregue.echoCancellation)}`,
  ];
  if (entregue.sampleRate) partes.push(`${Math.round(entregue.sampleRate / 1000)} kHz`);
  return partes.join(" · ");
}
