/**
 * RN-110 · O QR CODE DA CONEXÃO SE RENOVA NA TELA (11/11/2026).
 *
 * O WhatsApp troca o QR Code sozinho: o primeiro vale ~60 s e os seguintes
 * ~20 s (conferido no código do Baileys: `qrMs = 60_000`, depois `20_000`).
 * A tela buscava o código UMA vez, no clique, e ficava mostrando a mesma
 * imagem com "a tela atualiza sozinha" — só o status atualizava. Quem
 * demorasse mais que isso lia um código morto, e depois de ~10 min (o teto
 * de códigos do servidor) a tela seguia girando para sempre.
 *
 * Esta é a decisão PURA de cada consulta da tela enquanto a pessoa tenta
 * conectar: troca o código pelo de agora, diz que conectou, ou diz que a
 * tentativa venceu. O navegador a importa (sem banco, sem servidor).
 */

/** De quanto em quanto a tela consulta enquanto o QR está nela (o código vive ~20 s). */
export const MS_ENTRE_CONSULTAS_DO_QR = 3_000;

/**
 * Quantas consultas SEGUIDAS com a conexão fechada encerram a tentativa. Uma
 * só não basta: logo depois da leitura o WhatsApp fecha e reabre a conexão
 * (o "reinício" do pareamento), e entre um ciclo de códigos e outro o
 * servidor também passa um instante fechado.
 */
export const FECHADAS_PARA_VENCER = 4;

export type ConsultaDaConexao = {
  status: "DESCONECTADO" | "AGUARDANDO_QR" | "CONECTADO";
  /** o QR Code de AGORA, quando o servidor está esperando a leitura */
  qr?: string | null;
};

export type TentativaDeConexao = { qr: string; fechadas: number };

export type PassoDaTentativa =
  | { fim: "conectou" }
  | { fim: "venceu" }
  | { fim: null; tentativa: TentativaDeConexao; trocou: boolean };

/** O que a tela faz com a resposta de uma consulta, tendo um QR na tela. */
export function passoDaTentativa(atual: TentativaDeConexao, d: ConsultaDaConexao): PassoDaTentativa {
  if (d.status === "CONECTADO") return { fim: "conectou" };
  if (d.status === "DESCONECTADO") {
    const fechadas = atual.fechadas + 1;
    if (fechadas >= FECHADAS_PARA_VENCER) return { fim: "venceu" };
    return { fim: null, tentativa: { qr: atual.qr, fechadas }, trocou: false };
  }
  // esperando a leitura: vale o código de agora (sem código na resposta, fica o da tela)
  const novo = typeof d.qr === "string" && d.qr.length > 0 ? d.qr : atual.qr;
  return { fim: null, tentativa: { qr: novo, fechadas: 0 }, trocou: novo !== atual.qr };
}

/** A frase de quando a tentativa venceu — diz o que fazer, nunca fica girando. */
export const FRASE_DO_QR_VENCIDO =
  "O código venceu sem a conexão completar. Deixe o celular da loja já aberto em Dispositivos conectados → Conectar dispositivo e gere um código novo.";
