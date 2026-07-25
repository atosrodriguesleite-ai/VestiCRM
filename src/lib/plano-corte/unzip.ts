import { inflateRawSync } from "zlib";

/**
 * Leitor de ZIP mínimo (só o que o .adsx do Audaces precisa): percorre o
 * diretório central e descompacta entradas STORED (0) e DEFLATE (8).
 * Evita dependência nova só pra abrir um pacotinho de 4 arquivos.
 */

export type ZipEntry = { name: string; data: Buffer };

const EOCD_SIG = 0x06054b50; // fim do diretório central
const CEN_SIG = 0x02014b50; // entrada do diretório central
const LOC_SIG = 0x04034b50; // cabeçalho local

export function unzip(buf: Buffer): ZipEntry[] {
  // O EOCD fica no final (comentário de até 64KB depois dele)
  let eocd = -1;
  const start = Math.max(0, buf.length - 22 - 65536);
  for (let i = buf.length - 22; i >= start; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Arquivo não é um ZIP válido (.adsx)");

  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];

  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== CEN_SIG) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    // nomes podem vir com \ (padrão Windows do Audaces) — normaliza pra /
    const name = buf
      .subarray(off + 46, off + 46 + nameLen)
      .toString("utf8")
      .replace(/\\/g, "/");

    // o cabeçalho local repete nome/extra com tamanhos próprios
    if (buf.readUInt32LE(localOff) !== LOC_SIG)
      throw new Error("ZIP corrompido (cabeçalho local)");
    const locNameLen = buf.readUInt16LE(localOff + 26);
    const locExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + locNameLen + locExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);

    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw);
    else throw new Error(`Compressão não suportada no ZIP (método ${method})`);

    entries.push({ name, data });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}
