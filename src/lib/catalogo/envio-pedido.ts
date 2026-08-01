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

/**
 * MESMA SACOLA = MESMO PEDIDO.
 *
 * Incidente real (Toque Leve, 31/07/2026): o mesmo pedido apareceu DUAS VEZES
 * na conversa. Não foi falha de recebimento — a cliente apertou "Enviar
 * pedido" duas vezes.
 *
 * E era fácil: a sacola NÃO é limpa depois de enviar, existem três botões de
 * enviar na tela, e o WhatsApp abre numa aba nova. A cliente volta para o
 * catálogo, vê a sacola cheia (parece que não foi) e aperta de novo. Cada
 * toque sorteava um protocolo NOVO — e protocolo novo é pedido novo. A loja
 * ficava com dois pedidos iguais e o estoque reservado em dobro.
 *
 * A trava reaproveita o que já existe: o protocolo é a chave da idempotência
 * no servidor (`companyId + clientRef` é único). Então, enquanto a sacola for
 * a MESMA, o protocolo é o MESMO — e o servidor devolve o pedido que já
 * existe em vez de criar outro. Mudou uma peça? Aí é outro pedido de verdade,
 * e ganha protocolo novo.
 */
export const CHAVE_ULTIMO_ENVIO = "ap-ultimo-envio";

/** Impressão digital da sacola: itens, cliente e campanha. */
export function assinaturaDoPedido(payload: Record<string, unknown>): string {
  const itens = Array.isArray(payload.items) ? payload.items : [];
  const linhas = itens
    .map((i) => {
      const it = (i ?? {}) as Record<string, unknown>;
      return [it.productId, it.color, it.size, it.quantity].join("|");
    })
    .sort();
  const cliente = (payload.customer ?? {}) as Record<string, unknown>;
  return [
    ...linhas,
    `#${cliente.name ?? ""}`,
    `#${cliente.phone ?? ""}`,
    `#${cliente.store ?? ""}`,
    `#${payload.promo ?? ""}`,
    `#${payload.ref ?? ""}`,
  ].join("~");
}

/**
 * Protocolo a usar: o MESMO de antes quando a sacola não mudou, um novo
 * quando mudou. Guardar no aparelho é o que faz a trava sobreviver a fechar
 * a aba e voltar depois.
 */
/**
 * VALIDADE DA TRAVA: 24 horas.
 *
 * Sem validade, a trava virava o incidente ao contrário: no atacado, REPOR
 * exatamente as mesmas peças semanas depois é o fluxo normal — e a sacola
 * idêntica devolvia o protocolo antigo, o servidor respondia "já registrado"
 * com o pedido velho, e a REPOSIÇÃO nunca virava pedido (nem aviso). O
 * duplo-clique que a trava existe para segurar acontece em minutos; um dia
 * inteiro de folga cobre até "aperto de novo à noite" sem engolir reposição.
 */
export const VALIDADE_TRAVA_MS = 24 * 60 * 60 * 1000;

export function protocoloDaSacola(
  storage: Storage,
  payload: Record<string, unknown>,
  agora = Date.now()
): string {
  const assinatura = assinaturaDoPedido(payload);
  try {
    const bruto = JSON.parse(storage.getItem(CHAVE_ULTIMO_ENVIO) ?? "null") as {
      assinatura?: string;
      clientRef?: string;
      at?: number;
    } | null;
    const valida =
      typeof bruto?.at === "number" && agora - bruto.at < VALIDADE_TRAVA_MS;
    if (valida && bruto?.assinatura === assinatura && bruto.clientRef) {
      return bruto.clientRef;
    }
  } catch {
    /* registro ilegível não pode impedir o pedido de sair */
  }
  const novo = protocolo();
  try {
    storage.setItem(
      CHAVE_ULTIMO_ENVIO,
      JSON.stringify({ assinatura, clientRef: novo, at: agora })
    );
  } catch {
    /* sem espaço para guardar: segue com protocolo novo (o normal de antes) */
  }
  return novo;
}
