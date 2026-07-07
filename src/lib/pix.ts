/**
 * Gerador de payload PIX "copia e cola" (BR Code / EMV-MPM).
 * Estrutura preparada para o QR Code do orçamento em PDF: quando a loja
 * configurar sua chave PIX, o payload gerado aqui é o conteúdo do QR.
 * Referência: Manual de Padrões para Iniciação do PIX (Bacen).
 */

function emv(id: string, value: string): string {
  const len = String(value.length).padStart(2, "0");
  return `${id}${len}${value}`;
}

/** CRC16-CCITT (0xFFFF), exigido pelo campo 63 do BR Code. */
export function crc16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** Remove acentos e limita tamanho — exigência dos campos 59/60. */
function ascii(value: string, max: number): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "")
    .slice(0, max)
    .trim();
}

export type PixChargeInput = {
  pixKey: string;
  merchantName: string; // nome da loja
  merchantCity: string;
  amount: number; // em reais
  txid?: string; // identificador (ex.: número do pedido)
};

export function buildPixPayload(input: PixChargeInput): string {
  const gui = emv("00", "br.gov.bcb.pix");
  const key = emv("01", input.pixKey);
  const account = emv("26", gui + key);

  const body =
    emv("00", "01") + // payload format
    account +
    emv("52", "0000") + // merchant category
    emv("53", "986") + // BRL
    emv("54", input.amount.toFixed(2)) +
    emv("58", "BR") +
    emv("59", ascii(input.merchantName, 25) || "LOJA") +
    emv("60", ascii(input.merchantCity, 15) || "BRASIL") +
    emv("62", emv("05", ascii(input.txid ?? "***", 25) || "***")) +
    "6304"; // CRC placeholder

  return body + crc16(body);
}
