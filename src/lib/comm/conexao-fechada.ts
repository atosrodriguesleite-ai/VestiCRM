/**
 * A CONEXÃO COM O CELULAR CAIU, MAS O SERVIDOR DIZ "CONECTADO" (RN-105,
 * 02/11/2026). Só regras puras — o navegador e os testes podem importar.
 *
 * O incidente: depois do "Reiniciar conexão", o servidor Evolution respondeu
 * "open" na leitura do estado, a tela disse "Conexão reiniciada" — e o envio,
 * dois minutos depois, voltou com `Error: Connection Closed`. A leitura do
 * estado é o que o servidor GUARDA na memória; ela pode seguir "open" com a
 * conexão com o WhatsApp morta por trás. Quem diz a verdade é uma chamada que
 * PRECISA da conexão viva — e o erro que ela devolve quando não há conexão é
 * o mesmo do envio ("Connection Closed", ou "Connection Terminated" quando o
 * servidor a encerrou).
 */

/** A resposta de erro do servidor diz que a conexão com o WhatsApp está fechada? */
export function respostaDizConexaoFechada(data: unknown): boolean {
  if (data == null) return false;
  let texto: string;
  try {
    texto = typeof data === "string" ? data : JSON.stringify(data);
  } catch {
    return false;
  }
  return /connection (closed|terminated)/i.test(texto ?? "");
}

/**
 * O que a bolha da mensagem diz. Era o JSON cru em inglês. A frase não
 * afirma a queda: um "Connection Closed" sozinho pode ser o soluço de quando
 * o servidor se reconecta (quem decide é a sonda, depois) — então ela manda
 * tentar de novo em 1 minuto e só então chamar quem reconecta (achado da
 * revisão: a primeira versão dizia "reenviar não adianta" e a vendedora
 * deixava de reenviar o que já passaria).
 */
export const FRASE_CONEXAO_FECHADA =
  "O WhatsApp da loja não estava conectado ao celular na hora do envio. Tente reenviar em 1 minuto; se falhar de novo, quem administra a loja precisa reconectar em Comunicação (ler o QR Code).";

/** O resultado de uma sonda de sessão: só "morta" é certeza de queda. */
export type ResultadoDaSonda = "viva" | "morta" | "sem-resposta";

/**
 * Lê a resposta da sonda. "morta" exige o servidor RESPONDER dizendo que a
 * conexão está fechada; tempo esgotado, rota que não existe nesta versão ou
 * qualquer outro erro é "sem-resposta" — não decide nada (achar queda onde
 * não há mandaria a loja ler o QR Code à toa).
 */
export function lerSonda(r: { ok: boolean; status: number; data: unknown } | null): ResultadoDaSonda {
  if (!r) return "sem-resposta";
  if (r.ok) return "viva";
  if (r.status > 0 && respostaDizConexaoFechada(r.data)) return "morta";
  return "sem-resposta";
}

/**
 * Uma sonda só pode pegar o soluço de segundos em que o servidor se reconecta
 * sozinho — e marcar queda ali mandaria a loja ler o QR Code à toa (achado da
 * revisão). Então o veredito junta tentativas espaçadas: qualquer "viva"
 * decide viva; "sem-resposta" não decide nada e para de insistir; só é
 * "morta" quando TODAS bateram na conexão fechada.
 */
export function veredictoDasSondas(resultados: ResultadoDaSonda[]): ResultadoDaSonda {
  if (resultados.length === 0) return "sem-resposta";
  if (resultados.includes("viva")) return "viva";
  if (resultados.includes("sem-resposta")) return "sem-resposta";
  return "morta";
}

/**
 * O "fechou" dos minutos seguintes a um reinício pedido pela loja é do
 * reinício, não queda (RN-105). Puro: lê o carimbo `CommSettings.
 * reinicioPedidoEm`, que o webhook e o vigia já têm na mão.
 */
export const MS_JANELA_DO_REINICIO = 3 * 60_000;
export function reinicioEmCurso(pedidoEm: Date | null | undefined, agora = new Date()): boolean {
  return !!pedidoEm && agora.getTime() - pedidoEm.getTime() < MS_JANELA_DO_REINICIO;
}
