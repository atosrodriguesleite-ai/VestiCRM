import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "crypto";

/**
 * Criptografia de credenciais em repouso (AES-256-GCM).
 * Formato armazenado: enc:v1:<base64(iv | authTag | ciphertext)>
 * A chave deriva de CRED_SECRET (ou AUTH_SECRET) — defina em produção.
 */

const PREFIX = "enc:v1:";

function key(): Buffer {
  const secret =
    process.env.CRED_SECRET ?? process.env.AUTH_SECRET ?? "vesticrm-dev-secret";
  return createHash("sha256").update(secret).digest();
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
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8"
  );
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
