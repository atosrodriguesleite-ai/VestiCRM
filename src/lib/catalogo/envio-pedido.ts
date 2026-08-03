/**
 * ENVIO DO PEDIDO DO CATÁLOGO — o pedido não pode se perder.
 *
 * O que acontecia antes: ao tocar em "Enviar pedido pelo WhatsApp", o
 * catálogo disparava o registro no servidor e abria o WhatsApp na mesma
 * hora, sem esperar resposta e engolindo qualquer erro. Se a internet da
 * cliente oscilasse naquele segundo, a mensagem chegava no WhatsApp da
 * vendedora e o pedido NUNCA era criado — ninguém ficava sabendo. Uma loja
 * real perdeu uma venda assim.
 *
 * Como funciona agora:
 *
 *  1. Antes de mandar, o aparelho sorteia um PROTOCOLO e guarda o pedido
 *     inteiro na memória do navegador.
 *  2. O envio insiste: se falhar, tenta de novo (com intervalo crescente,
 *     para não brigar com uma internet ruim).
 *  3. Se mesmo assim não for, o pedido FICA guardado e é reenviado na
 *     próxima vez que a cliente abrir o catálogo.
 *  4. O protocolo garante que insistir é sempre seguro: o servidor devolve
 *     o pedido que já existe em vez de criar outro. Uma venda, um pedido.
 */

export const CHAVE_PENDENTES = "ap-pedidos-pendentes";

/** Depois disso não adianta mais insistir (a sacola já é história antiga). */
export const VALIDADE_PENDENTE_DIAS = 7;

/** Teto de tentativas por pedido, somando todas as visitas. */
export const MAX_TENTATIVAS = 8;

export type PedidoPendente = {
  clientRef: string;
  payload: Record<string, unknown>;
  at: number;
  tentativas: number;
};

/** Protocolo do envio: único o bastante para nunca colidir entre clientes. */
export function protocolo(): string {
  const rnd =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "")
      : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return `cat-${Date.now().toString(36)}-${rnd.slice(0, 16)}`;
}

/**
 * MESMA SACOLA, MESMO PROTOCOLO — clicar duas vezes não vira dois pedidos.
 *
 * Incidente real (Toque Leve): o registro estava lento, a cliente abriu o
 * WhatsApp e mandou, voltou para o catálogo, viu a tela ainda "enviando" e
 * CLICOU DE NOVO. Cada clique sorteava um protocolo novo, então o servidor
 * não reconhecia o repetido: virou pedido em dobro, mensagem em dobro na
 * vendedora e a MESMA PEÇA reservada duas vezes no estoque.
 *
 * O protocolo aleatório protegia a reinsistência automática (que reusa o
 * mesmo) e não protegia o dedo da cliente. Agora ele é derivado do CONTEÚDO:
 * mesma sacola + mesma cliente + mesmo dia = mesmo protocolo, e o servidor
 * devolve o pedido que já existe em vez de criar outro.
 *
 * O DIA entra de propósito: pedir as mesmas peças amanhã é pedido novo de
 * verdade; pedir as mesmas peças dois minutos depois é o dedo, não a vontade.
 */
export function assinaturaDoPedido(
  payload: Record<string, unknown>,
  agora = Date.now()
): string {
  const itens = Array.isArray(payload.items) ? payload.items : [];
  const cliente = (payload.customer ?? {}) as Record<string, unknown>;
  // ordena para que a mesma sacola montada em ordem diferente case igual
  const corpo = itens
    .map((i) => {
      const it = i as Record<string, unknown>;
      return `${it.productId}|${it.color}|${it.size}|${it.quantity}`;
    })
    .sort()
    .join(";");
  const dia = new Date(agora - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const quem = `${payload.company ?? ""}|${cliente.phone ?? ""}|${cliente.name ?? ""}`;
  return hashCurto(`${dia}::${quem}::${corpo}::${payload.promo ?? ""}`);
}

/** Hash curto e estável (não precisa ser criptográfico — só repetível). */
function hashCurto(texto: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return (h1.toString(36) + h2.toString(36)).slice(0, 18);
}

/** Protocolo estável para esta sacola: `cat-<assinatura>`. */
export function protocoloDaSacola(
  payload: Record<string, unknown>,
  agora = Date.now()
): string {
  return `cat-${assinaturaDoPedido(payload, agora)}`;
}

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

/** Lê a fila de pendentes tolerando lixo (memória de navegador é bagunçada). */
export function lerPendentes(storage: Storage): PedidoPendente[] {
  let bruto: unknown;
  try {
    bruto = JSON.parse(storage.getItem(CHAVE_PENDENTES) ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(bruto)) return [];
  return bruto.filter(
    (p): p is PedidoPendente =>
      !!p &&
      typeof p === "object" &&
      typeof (p as PedidoPendente).clientRef === "string" &&
      typeof (p as PedidoPendente).at === "number" &&
      !!(p as PedidoPendente).payload
  );
}

/** Só o que ainda vale a pena reenviar. */
export function pendentesValidos(
  lista: PedidoPendente[],
  agora = Date.now()
): PedidoPendente[] {
  return lista.filter(
    (p) =>
      agora - p.at < VALIDADE_PENDENTE_DIAS * 86_400_000 &&
      (p.tentativas ?? 0) < MAX_TENTATIVAS
  );
}

function gravar(storage: Storage, lista: PedidoPendente[]) {
  try {
    storage.setItem(CHAVE_PENDENTES, JSON.stringify(lista));
  } catch {
    // memória cheia: paciência, o envio direto ainda vai acontecer
  }
}

/** Guarda o pedido ANTES de mandar — é o que garante a segunda chance. */
export function guardarPendente(storage: Storage, p: PedidoPendente) {
  const lista = lerPendentes(storage).filter((x) => x.clientRef !== p.clientRef);
  gravar(storage, [...lista, p]);
}

/** Registrado com sucesso: sai da fila. */
export function removerPendente(storage: Storage, clientRef: string) {
  gravar(
    storage,
    lerPendentes(storage).filter((p) => p.clientRef !== clientRef)
  );
}

/** Marca mais uma tentativa (o teto evita insistir para sempre). */
export function contarTentativa(storage: Storage, clientRef: string) {
  gravar(
    storage,
    lerPendentes(storage).map((p) =>
      p.clientRef === clientRef ? { ...p, tentativas: (p.tentativas ?? 0) + 1 } : p
    )
  );
}

export type ResultadoEnvio = { ok: boolean; number?: number; permanente?: boolean };

/**
 * Uma tentativa de registro. `permanente` marca a falha que não adianta
 * repetir (pedido recusado pelo servidor: loja inexistente, dados inválidos)
 * — insistir nesses casos só gastaria a bateria da cliente.
 */
export async function tentarRegistrar(
  payload: Record<string, unknown>,
  f: typeof fetch = fetch
): Promise<ResultadoEnvio> {
  try {
    const res = await f("/api/catalog/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    });
    if (res.ok) {
      const d = await res.json().catch(() => ({}));
      return { ok: true, number: d?.number };
    }
    // 4xx é recusa do servidor: repetir daria o mesmo resultado
    return { ok: false, permanente: res.status >= 400 && res.status < 500 };
  } catch {
    // sem internet / servidor fora: vale insistir
    return { ok: false };
  }
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Registra o pedido insistindo. Devolve true quando o servidor confirmou.
 * Nunca lança: o envio do pedido pelo WhatsApp não pode depender disto.
 */
export async function registrarComInsistencia(
  pendente: PedidoPendente,
  opts: {
    storage: Storage;
    fetchImpl?: typeof fetch;
    tentativas?: number;
    intervalos?: number[];
    dormir?: (ms: number) => Promise<unknown>;
  }
): Promise<boolean> {
  const { storage, fetchImpl = fetch, dormir = espera } = opts;
  const intervalos = opts.intervalos ?? [1500, 4000, 10000];
  const max = opts.tentativas ?? intervalos.length + 1;

  for (let i = 0; i < max; i++) {
    contarTentativa(storage, pendente.clientRef);
    const r = await tentarRegistrar(pendente.payload, fetchImpl);
    if (r.ok) {
      removerPendente(storage, pendente.clientRef);
      return true;
    }
    if (r.permanente) {
      // recusado de vez: tirar da fila para não insistir a cada visita
      removerPendente(storage, pendente.clientRef);
      return false;
    }
    if (i < max - 1) await dormir(intervalos[Math.min(i, intervalos.length - 1)]);
  }
  return false;
}

/**
 * Reenvia o que ficou para trás — chamado quando o catálogo abre. É a rede
 * de segurança para o pedido que falhou com o celular já no WhatsApp.
 */
export async function reenviarPendentes(opts: {
  storage: Storage;
  fetchImpl?: typeof fetch;
  agora?: number;
}): Promise<number> {
  const validos = pendentesValidos(lerPendentes(opts.storage), opts.agora);
  // o que venceu sai da fila de uma vez
  gravar(opts.storage, validos);
  let recuperados = 0;
  for (const p of validos) {
    contarTentativa(opts.storage, p.clientRef);
    const r = await tentarRegistrar(p.payload, opts.fetchImpl ?? fetch);
    if (r.ok) {
      removerPendente(opts.storage, p.clientRef);
      recuperados++;
    } else if (r.permanente) {
      removerPendente(opts.storage, p.clientRef);
    }
  }
  return recuperados;
}
