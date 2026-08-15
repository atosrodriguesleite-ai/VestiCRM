import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "crypto";
import { AUTH_SECRET, CRED_SECRET } from "./env";

/**
 * Criptografia de credenciais em repouso (AES-256-GCM).
 * Formato armazenado: enc:v1:<base64(iv | authTag | ciphertext)>
 * A chave deriva de CRED_SECRET (ou AUTH_SECRET) — obrigatório em produção.
 *
 * TROCA DE CHAVE SEM DOR: gravar usa SEMPRE a chave principal (CRED_SECRET);
 * ler tenta a principal e, se falhar, a antiga (AUTH_SECRET). Assim dá pra
 * definir uma CRED_SECRET NOVA na Vercel sem copiar a AUTH_SECRET (que é
 * "Sensitive" e não pode ser revelada): os tokens antigos continuam legíveis
 * pela chave antiga e vão sendo regravados com a nova conforme os OAuth
 * renovam sozinhos.
 */

const PREFIX = "enc:v1:";

function key(): Buffer {
  return createHash("sha256").update(CRED_SECRET).digest();
}

function chaveAntiga(): Buffer | null {
  if (CRED_SECRET === AUTH_SECRET) return null; // sem CRED_SECRET própria ainda
  return createHash("sha256").update(AUTH_SECRET).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, data]).toString("base64");
}

export function decryptSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored; // legado/plano
  const raw = Buffer.from(stored.slice(PREFIX.length), "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const abrir = (k: Buffer) => {
    const decipher = createDecipheriv("aes-256-gcm", k, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString(
      "utf8"
    );
  };
  try {
    return abrir(key());
  } catch (e) {
    // token gravado antes da CRED_SECRET própria existir: abre com a antiga
    const antiga = chaveAntiga();
    if (!antiga) throw e;
    return abrir(antiga);
  }
}

export function isEncrypted(value: string | null | undefined): boolean {
  return !!value?.startsWith(PREFIX);
}

/** Máscara para exibição — tokens nunca voltam inteiros para o navegador. */
export function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  const plain = isEncrypted(value) ? "•".repeat(12) : value;
  if (plain.length <= 4) return "••••";
  return `••••••••${plain.slice(-4)}`;
}
