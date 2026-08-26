import { db } from "./db";
import { encryptSecret, decryptSecret } from "./crypto";
import { signState, verifyState } from "./nuvemshop"; // state assinado (HMAC)
import { nomeParaDocumentos } from "./dados-envio";
import { appBaseUrl } from "./comm/evolution";
import { orderNumber, round2, PAID_ORDER_STATUSES } from "./orders";
import { documentoFiscal } from "./documento";
import { telefoneNacional } from "./format";

/**
 * Bling (ERP) — emissão de NF-e a partir do pedido.
 *
 * A nota é da LOJA: ela conecta a conta Bling dela (OAuth v3) e o AtacadoPro
 * monta e envia a NF-e pela API. Tokens criptografados, renovação automática
 * (access token do Bling dura ~6h; o refresh token renova sozinho).
 */

const BLING = "https://www.bling.com.br/Api/v3";

export { signState, verifyState };

export function blingEnv() {
  const clientId = process.env.BLING_CLIENT_ID?.trim() || null;
  const clientSecret = process.env.BLING_CLIENT_SECRET?.trim() || null;
  return { clientId, clientSecret, configured: Boolean(clientId && clientSecret) };
}

export function blingAuthorizeUrl(companyId: string) {
  const { clientId } = blingEnv();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId ?? "",
    state: signState(companyId),
  });
  return `${BLING}/oauth/authorize?${params}`;
}

type BlingTokens = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
};

async function tokenRequest(body: URLSearchParams): Promise<BlingTokens | null> {
  const { clientId, clientSecret } = blingEnv();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(`${BLING}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body,
  });
  const data = (await res.json().catch(() => null)) as BlingTokens | null;
  return res.ok && data?.access_token ? data : null;
}

export async function blingExchangeCode(code: string) {
  return tokenRequest(
    new URLSearchParams({ grant_type: "authorization_code", code })
  );
}

export async function blingSaveConnection(companyId: string, t: BlingTokens) {
  const expiresAt = new Date(Date.now() + (t.expires_in ?? 21600) * 1000);
  if (!t.access_token) return null;
  // na PRIMEIRA conexão o refresh é OBRIGATÓRIO: sem ele a conexão morre em
  // ~6h sem aviso e toda emissão passa a falhar com 401 opaco. Melhor
  // recusar já — a tela mostra "bling=erro" e a lojista conecta de novo.
  const existente = await db.blingConnection.findUnique({ where: { companyId } });
  const refresh = t.refresh_token;
  if (!existente && !refresh) return null;
  // a RENOVAÇÃO pode vir sem refresh_token novo — o antigo segue valendo
  return db.blingConnection.upsert({
    where: { companyId },
    update: {
      accessToken: encryptSecret(t.access_token),
      ...(refresh ? { refreshToken: encryptSecret(refresh) } : {}),
      expiresAt,
    },
    create: {
      companyId,
      accessToken: encryptSecret(t.access_token),
      // o create só roda sem `existente` — e aí o guard acima garantiu refresh
      refreshToken: encryptSecret(refresh ?? ""),
      expiresAt,
    },
  });
}

/** Token válido — renova sozinho quando falta menos de 10 min. */
async function blingAccessToken(companyId: string): Promise<string | null> {
  const conn = await db.blingConnection.findUnique({ where: { companyId } });
  if (!conn) return null;
  if (conn.expiresAt.getTime() - Date.now() < 10 * 60 * 1000) {
    const novo = await tokenRequest(
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: decryptSecret(conn.refreshToken),
      })
    );
    if (novo?.access_token) {
      await blingSaveConnection(companyId, novo);
      return novo.access_token;
    }
  }
  return decryptSecret(conn.accessToken);
}

async function blingApi<T = unknown>(
  companyId: string,
  method: "GET" | "POST",
  path: string,
  body?: unknown
): Promise<{ ok: boolean; status: number; data: T | null; raw: string }> {
  const token = await blingAccessToken(companyId);
  if (!token) return { ok: false, status: 0, data: null, raw: "sem conexão" };
  const res = await fetch(`${BLING}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const raw = await res.text().catch(() => "");
  let data: T | null = null;
  try {
    data = JSON.parse(raw) as T;
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data, raw: raw.slice(0, 500) };
}

/** Erro legível a partir da resposta do Bling (validações vêm detalhadas). */
function blingErro(raw: string, status: number): string {
  try {
    const j = JSON.parse(raw) as {
      error?: { message?: string; fields?: { msg?: string }[] };
    };
    const campos = j.error?.fields?.map((f) => f.msg).filter(Boolean).join("; ");
    return (
      [j.error?.message, campos].filter(Boolean).join(" — ").slice(0, 300) ||
      `Bling recusou (HTTP ${status})`
    );
  } catch {
    return `Bling recusou (HTTP ${status})`;
  }
}

export type NfeResult =
  | { ok: true; blingId: string; situacao: string; numero?: string; url?: string }
  | { ok: false; error: string };

/**
 * OS ITENS DA NOTA — com a conta fechando NO CENTAVO.
 *
 * A nota precisa bater com o cobrado: Σ itens = valor vendido (netTotal).
 * O desconto/acréscimo do pedido é distribuído proporcionalmente no preço
 * unitário. O problema do centavo: com 2 casas decimais, um item de 3 peças
 * não tem como representar R$ 20,00 (3 × 6,67 = 20,01). A NF-e aceita preço
 * unitário com até 10 casas — usamos 4: 3 × 6,6667 = 20,0001 → R$ 20,00. ✔
 *
 * Se mesmo assim sobrar diferença, ela é corrigida no item de MENOR
 * quantidade (passos de 0,0001 no unitário). `fecha: false` = não deu para
 * fechar (caso extremo) — aí a emissão RECUSA, porque nota divergente do
 * cobrado é exatamente o que este código existe para impedir.
 */
export function itensDaNotaFiscal(
  items: {
    name: string;
    color: string | null;
    size: string | null;
    sku: string | null;
    quantity: number;
    unitPrice: number;
  }[],
  subtotal: number,
  netTotal: number
): {
  itens: { codigo?: string; descricao: string; unidade: string; quantidade: number; valor: number }[];
  fecha: boolean;
} {
  const round4 = (n: number) => Math.round(n * 10000) / 10000;
  const ajuste = subtotal > 0 ? netTotal / subtotal : 1;
  const itens = items.map((i) => ({
    codigo: i.sku ?? undefined,
    // sem "null null" quando cor/tamanho são vazios
    descricao: [i.name, i.color, i.size].filter(Boolean).join(" ").slice(0, 120),
    unidade: "UN",
    quantidade: i.quantity,
    valor: round4(i.unitPrice * ajuste),
  }));

  const alvo = round2(netTotal);
  const soma = () =>
    round2(itens.reduce((s, it) => s + round2(it.valor * it.quantidade), 0));

  // corrige a sobra no item de MENOR quantidade (correção mais precisa);
  // poucas voltas bastam — cada uma reduz a diferença ou nada muda (para)
  for (let volta = 0; volta < 4; volta++) {
    const diff = round2(alvo - soma());
    if (diff === 0) break;
    const candidatos = [...itens]
      .filter((it) => it.valor + diff / it.quantidade > 0)
      .sort((a, b) => a.quantidade - b.quantidade);
    const it = candidatos[0];
    if (!it) break;
    const delta = round4(diff / it.quantidade);
    if (delta === 0) break; // sem granularidade para corrigir
    it.valor = round4(it.valor + delta);
  }

  return { itens, fecha: soma() === alvo };
}

/**
 * Emite a NF-e do pedido: cria a nota no Bling e manda transmitir à SEFAZ.
 * Pré-requisitos (da LOJA, no cadastro do cliente): CPF/CNPJ e endereço.
 */
export async function emitirNfeDoPedido(
  companyId: string,
  orderId: string
): Promise<NfeResult> {
  const order = await db.order.findFirst({
    where: { id: orderId, companyId },
    include: { items: true, customer: true },
  });
  if (!order) return { ok: false, error: "Pedido não encontrado." };

  const c = order.customer;
  // a nota aceita UM documento e ele decide se é pessoa jurídica ou física:
  // tendo CNPJ, quem compra é a loja (o caso normal do atacado)
  const fiscal = documentoFiscal(c);
  if (!fiscal) {
    return {
      ok: false,
      error:
        "O cliente precisa ter CPF ou CNPJ preenchido na ficha para emitir a nota.",
    };
  }
  if (order.items.length === 0)
    return { ok: false, error: "Pedido sem itens." };

  if (!(PAID_ORDER_STATUSES as readonly string[]).includes(order.status)) {
    return {
      ok: false,
      error: "Emita a nota só depois que o pedido estiver pago.",
    };
  }

  // NOTA EXISTENTE COM ERRO: primeiro descobre o que aconteceu com ELA em
  // vez de criar outra. O caso traiçoeiro é a transmissão que "falhou" por
  // timeout DEPOIS de a SEFAZ aceitar — reemitir criava a segunda nota.
  if (order.nfeBlingId && order.nfeStatus === "ERRO") {
    return retomarNfeComErro(companyId, order.id, order.nfeBlingId);
  }

  // A NOTA SÓ SAI UMA VEZ — TRAVA ATÔMICA (revisão 09/08/2026: a checagem
  // "já tem nota?" era leitura + gravação separadas; dois cliques ao MESMO
  // tempo passavam os dois e transmitiam DUAS NF-e à SEFAZ). Só quem vira o
  // status para EMITINDO ganha o direito de emitir; o concorrente é barrado.
  const trava = await db.order.updateMany({
    where: {
      id: order.id,
      companyId,
      nfeBlingId: order.nfeBlingId, // ninguém emitiu no meio do caminho
      // REJEITADA e CANCELADA são notas MORTAS: o pedido pode (e precisa)
      // ganhar uma nota nova — sem CANCELADA aqui, cancelar a nota no
      // painel do Bling prendia o pedido sem nota para sempre
      OR: [{ nfeStatus: null }, { nfeStatus: "REJEITADA" }, { nfeStatus: "CANCELADA" }],
    },
    data: { nfeStatus: "EMITINDO" },
  });
  if (trava.count === 0) {
    return {
      ok: false,
      error:
        "Este pedido já tem NF-e (ou uma emissão em andamento). Consulte a nota existente em vez de emitir outra.",
    };
  }
  // qualquer saída de erro daqui em diante DEVOLVE a trava — senão o pedido
  // fica preso em "EMITINDO" para sempre e ninguém consegue tentar de novo
  const soltarTrava = () =>
    db.order
      .updateMany({
        where: { id: order.id, nfeStatus: "EMITINDO" },
        data: { nfeStatus: order.nfeStatus },
      })
      .catch(() => {});

  // A NOTA TEM QUE BATER COM O QUE A CLIENTE PAGA (auditoria 07/08/2026).
  // Σ itens = netTotal e Σ itens + frete = total. A conta do centavo vive em
  // `itensDaNotaFiscal` (pura, testada); se não fechar, a emissão RECUSA.
  const conta = itensDaNotaFiscal(order.items, order.subtotal, order.netTotal);
  if (!conta.fecha) {
    await soltarTrava();
    return {
      ok: false,
      error:
        "Não consegui fechar o valor da nota no centavo com esta combinação de quantidades e desconto. Ajuste o desconto do pedido em alguns centavos e tente de novo.",
    };
  }
  const itens = conta.itens;

  // monta a NF-e (modelo 55, saída) no formato da API v3 do Bling
  const payload = {
    tipo: 1, // saída
    dataOperacao: new Date().toISOString().slice(0, 19).replace("T", " "),
    contato: {
      // razão social no CNPJ (RN-024): a nota sai no nome que o fisco conhece
      nome: nomeParaDocumentos(c).slice(0, 120),
      tipoPessoa: fiscal.tipoPessoa,
      numeroDocumento: fiscal.numero,
      ...(c.email ? { email: c.email } : {}),
      // SEM O DDI 55 (mesmo motivo da etiqueta): o sistema guarda o telefone
      // com o 55 na frente para casar com o WhatsApp, e quem lê a nota como
      // telefone brasileiro toma o "55" por DDD — "(55) 11910-8800" no lugar
      // de "(11) 91088-0083". A nota viaja com a caixa (RN-016).
      ...(c.phone ? { telefone: telefoneNacional(c.phone) } : {}),
      endereco: {
        endereco: c.street ?? "",
        numero: c.streetNumber ?? "S/N",
        complemento: c.complement ?? "",
        bairro: c.district ?? "",
        cep: (c.zip ?? "").replace(/\D/g, ""),
        municipio: c.city ?? "",
        uf: c.state ?? "",
      },
    },
    itens,
    // frete destacado (o que a cliente paga além da mercadoria)
    ...(order.shippingFee > 0
      ? { transporte: { frete: round2(order.shippingFee) } }
      : {}),
    observacoes: `Pedido ${orderNumber(order.number)} — AtacadoPro`,
  };

  // fetch pode LANÇAR (queda de rede, DNS) em vez de responder erro — sem
  // este try a trava ficava presa em EMITINDO para sempre, sem nota e sem
  // como tentar de novo (revisão 09/08/2026)
  try {
    const criada = await blingApi<{ data?: { id?: number | string } }>(
      companyId,
      "POST",
      "/nfe",
      payload
    );
    const blingId = criada.data?.data?.id ? String(criada.data.data.id) : null;
    if (!criada.ok || !blingId) {
      await soltarTrava();
      return { ok: false, error: blingErro(criada.raw, criada.status) };
    }
    return await transmitirEGravar(companyId, order.id, blingId);
  } catch {
    await soltarTrava();
    return {
      ok: false,
      error: "Falha de comunicação com o Bling. Nada foi emitido — tente de novo.",
    };
  }
}

/**
 * Nota que ficou com ERRO: consulta a situação REAL antes de qualquer coisa.
 * Se a SEFAZ já autorizou (o "erro" foi só o timeout da resposta), grava e
 * pronto; se o rascunho nunca foi transmitido, REENVIA o mesmo rascunho —
 * nunca cria uma segunda nota por cima.
 */
async function retomarNfeComErro(
  companyId: string,
  orderId: string,
  blingId: string
): Promise<NfeResult> {
  // trava atômica também aqui: duas retomadas juntas transmitiriam duas vezes
  const trava = await db.order.updateMany({
    where: { id: orderId, companyId, nfeBlingId: blingId, nfeStatus: "ERRO" },
    data: { nfeStatus: "EMITINDO" },
  });
  if (trava.count === 0) {
    return { ok: false, error: "A nota deste pedido já está sendo retomada." };
  }
  const voltarParaErro = () =>
    db.order
      .updateMany({
        where: { id: orderId, nfeStatus: "EMITINDO" },
        data: { nfeStatus: "ERRO" },
      })
      .catch(() => {});

  let consulta: Awaited<ReturnType<typeof consultarNfe>>;
  try {
    consulta = await consultarNfe(companyId, blingId);
  } catch {
    await voltarParaErro();
    return {
      ok: false,
      error: "Não consegui consultar a nota no Bling agora. Tente de novo em instantes.",
    };
  }
  if (!consulta.ok) {
    await voltarParaErro();
    return {
      ok: false,
      error: "Não consegui consultar a nota no Bling agora. Tente de novo em instantes.",
    };
  }
  if (consulta.situacao === "CANCELADA" || consulta.situacao === "REJEITADA") {
    // essa nota morreu; libera o pedido para uma emissão NOVA (o botão de
    // emitir passa a criar outra nota, agora sem o id antigo no caminho)
    await db.order.update({
      where: { id: orderId },
      // chave junto: nota morta não pode virar etiqueta com nota fiscal
      data: { nfeBlingId: null, nfeStatus: "REJEITADA", nfeKey: null },
    });
    return {
      ok: false,
      error: `A nota anterior está ${consulta.situacao === "CANCELADA" ? "cancelada" : "rejeitada"} no Bling. Clique em emitir de novo para gerar uma nota nova.`,
    };
  }
  if (consulta.situacao === "AUTORIZADA") {
    // o "erro" era mentira: a SEFAZ tinha aceitado — só grava a verdade
    await gravarSituacao(orderId, blingId, consulta);
    return {
      ok: true,
      blingId,
      situacao: consulta.situacao,
      numero: consulta.numero,
      url: consulta.url,
    };
  }
  // rascunho pendente de verdade: transmite O MESMO rascunho
  return transmitirEGravar(companyId, orderId, blingId);
}

/** Transmite a nota à SEFAZ e grava o resultado no pedido. */
async function transmitirEGravar(
  companyId: string,
  orderId: string,
  blingId: string
): Promise<NfeResult> {
  let envio: Awaited<ReturnType<typeof blingApi>>;
  try {
    envio = await blingApi(companyId, "POST", `/nfe/${blingId}/enviar`, {});
  } catch {
    // rede caiu COM a nota já criada: grava ERRO (recuperável) com o id —
    // a retomada consulta a situação real antes de qualquer reenvio
    await db.order
      .update({
        where: { id: orderId },
        data: { nfeBlingId: blingId, nfeStatus: "ERRO" },
      })
      .catch(() => {});
    return {
      ok: false,
      error:
        "A nota foi criada mas a transmissão caiu no meio. Clique em emitir de novo — o sistema retoma esta mesma nota, sem duplicar.",
    };
  }
  if (!envio.ok) {
    // nota criada mas não transmitida: guarda o id para retomar depois
    await db.order.update({
      where: { id: orderId },
      data: { nfeBlingId: blingId, nfeStatus: "ERRO" },
    });
    return { ok: false, error: blingErro(envio.raw, envio.status) };
  }

  // a partir daqui a nota JÁ FOI transmitida: qualquer falha na consulta
  // (resposta de erro OU exceção de rede) fecha em EMITINDO — nunca ERRO,
  // senão a retomada tentaria transmitir de novo uma nota já enviada
  const consulta = await consultarNfe(companyId, blingId).catch(
    () => ({ ok: false as const, situacao: "EMITINDO" })
  );
  if (!consulta.ok) {
    await db.order
      .update({
        where: { id: orderId },
        data: { nfeBlingId: blingId, nfeStatus: "EMITINDO" },
      })
      .catch(() => {});
    return { ok: true, blingId, situacao: "EMITINDO" };
  }
  await gravarSituacao(orderId, blingId, consulta);
  await db.orderEvent.create({
    data: {
      orderId,
      type: "NOTA",
      description: `NF-e enviada ao Bling (situação: ${consulta.situacao})`,
    },
  });
  return {
    ok: true,
    blingId,
    situacao: consulta.situacao,
    numero: consulta.numero,
    url: consulta.url,
  };
}

async function gravarSituacao(
  orderId: string,
  blingId: string,
  c: { situacao: string; numero?: string; url?: string; chave?: string }
) {
  await db.order.update({
    where: { id: orderId },
    data: {
      nfeBlingId: blingId,
      nfeStatus: c.situacao,
      nfeNumber: c.numero ?? null,
      nfeUrl: c.url ?? null,
      // a chave só existe depois de a SEFAZ autorizar; nota morta não guarda
      // chave nenhuma (senão uma etiqueta sairia apontando para nota cancelada)
      nfeKey: c.situacao === "AUTORIZADA" ? (c.chave ?? null) : null,
    },
  });
}

/**
 * Consulta a situação da NF-e no Bling (número e link quando autorizada).
 * `ok: false` = a CONSULTA falhou (token, Bling fora do ar) — quem chama não
 * pode confundir isso com "a nota está pendente": sobrescrever uma nota
 * AUTORIZADA por causa de uma consulta falhada apagava número e DANFE.
 */
export async function consultarNfe(
  companyId: string,
  blingId: string
): Promise<{
  ok: boolean;
  situacao: string;
  numero?: string;
  url?: string;
  chave?: string;
}> {
  const res = await blingApi<{
    data?: {
      situacao?: number;
      numero?: number | string;
      linkDanfe?: string;
      linkPDF?: string;
      chaveAcesso?: string;
    };
  }>(companyId, "GET", `/nfe/${blingId}`);
  const d = res.data?.data;
  if (!res.ok || !d) {
    return { ok: false, situacao: "EMITINDO" };
  }
  // situações do Bling: 1 pendente · 2 cancelada · 3 aguardando recibo ·
  // 4 rejeitada · 5 autorizada · 6 emitida DANFE · 7 registrada · ...
  const mapa: Record<number, string> = {
    1: "EMITINDO",
    2: "CANCELADA",
    3: "EMITINDO",
    4: "REJEITADA",
    5: "AUTORIZADA",
    6: "AUTORIZADA",
    7: "AUTORIZADA",
  };
  return {
    ok: true,
    situacao: mapa[d.situacao ?? 1] ?? "EMITINDO",
    numero: d.numero ? String(d.numero) : undefined,
    url: d.linkDanfe ?? d.linkPDF ?? undefined,
    chave: limparChaveNfe(d.chaveAcesso),
  };
}

/**
 * Chave de acesso da NF-e: 44 dígitos, e só. O Melhor Envio recusa a compra
 * inteira se a chave vier torta (com espaço, pontuação ou incompleta) — e a
 * loja perderia a etiqueta por causa de um caractere. Melhor não mandar do
 * que mandar errado: chave inválida vira `undefined` e o envio sai com
 * declaração de conteúdo, como sempre saiu.
 */
export function limparChaveNfe(valor: unknown): string | undefined {
  if (typeof valor !== "string") return undefined;
  const so = valor.replace(/\D/g, "");
  return so.length === 44 ? so : undefined;
}
