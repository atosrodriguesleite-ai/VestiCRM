/**
 * PONTE COM A ZEBRA PELO NAVEGADOR (RN-059). Só cliente, sem banco.
 *
 * O navegador não fala com impressora. A Zebra resolve isso com o **Zebra
 * Browser Print**: um programinha gratuito instalado no computador da loja
 * que escuta em `localhost:9100` e repassa o ZPL para a impressora USB. Aqui
 * o sistema pergunta se ele está rodando e, se estiver, manda o ZPL direto —
 * sem baixar arquivo, sem abrir PDF. Sem ele, o caminho é o PDF (qualquer
 * impressora pelo driver) ou o arquivo ZPL.
 *
 * `localhost` é tratado como origem segura pelo Chrome: a página em https
 * pode chamar http://localhost sem bloqueio de conteúdo misto.
 */

const BASE = "http://localhost:9100";
const TETO_MS = 2500;

export type ImpressoraZebra = { name: string; uid: string; connection: string; deviceType: string };

/** A impressora padrão do Browser Print, ou null se ele não está rodando. */
export async function zebraDisponivel(): Promise<ImpressoraZebra | null> {
  try {
    const r = await fetch(`${BASE}/default?type=printer`, {
      signal: AbortSignal.timeout(TETO_MS),
    });
    if (!r.ok) return null;
    const d = (await r.json()) as Partial<ImpressoraZebra>;
    return d?.uid && d?.name ? (d as ImpressoraZebra) : null;
  } catch {
    return null;
  }
}

/** Manda o ZPL para a impressora. Lança com frase em português se falhar. */
export async function imprimirNaZebra(impressora: ImpressoraZebra, zpl: string): Promise<void> {
  let r: Response;
  try {
    r = await fetch(`${BASE}/write`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ device: impressora, data: zpl }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("Não deu para falar com o Zebra Browser Print. Ele está aberto no computador?");
  }
  if (!r.ok) throw new Error("A impressora recusou o envio. Confira se ela está ligada e com etiqueta.");
}
