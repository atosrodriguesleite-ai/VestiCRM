import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CHAVE_PENDENTES,
  MAX_TENTATIVAS,
  guardarPendente,
  lerPendentes,
  pendentesValidos,
  protocolo,
  reenviarPendentes,
  registrarComInsistencia,
  removerPendente,
  tentarRegistrar,
} from "../catalogo/envio-pedido";

/**
 * O PEDIDO NÃO PODE SE PERDER.
 *
 * Caso real: a cliente montou o pedido, a mensagem chegou no WhatsApp da
 * vendedora, e o pedido nunca foi criado no sistema — o registro falhou em
 * silêncio e ninguém ficou sabendo. Estes testes cobrem exatamente isso.
 */

/** localStorage de mentira, igual ao do navegador no que interessa. */
function memoria() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    _dump: () => m,
  };
}

const pedido = (ref: string, at = Date.now()) => ({
  clientRef: ref,
  at,
  tentativas: 0,
  payload: { company: "loja", items: [{ productId: "p1" }], clientRef: ref },
});

const resposta = (status: number, body: unknown = {}) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

describe("protocolo do envio", () => {
  it("cada pedido ganha um código diferente", () => {
    const vistos = new Set(Array.from({ length: 200 }, () => protocolo()));
    expect(vistos.size).toBe(200);
  });
});

describe("guardar antes de mandar (a segunda chance)", () => {
  it("o pedido fica na memória do aparelho", () => {
    const s = memoria();
    guardarPendente(s, pedido("a1"));
    expect(lerPendentes(s)).toHaveLength(1);
    expect(s.getItem(CHAVE_PENDENTES)).toContain("a1");
  });

  it("registrado com sucesso, sai da fila", () => {
    const s = memoria();
    guardarPendente(s, pedido("a1"));
    removerPendente(s, "a1");
    expect(lerPendentes(s)).toHaveLength(0);
  });

  it("guardar o mesmo pedido duas vezes não duplica a fila", () => {
    const s = memoria();
    guardarPendente(s, pedido("a1"));
    guardarPendente(s, pedido("a1"));
    expect(lerPendentes(s)).toHaveLength(1);
  });

  it("lixo na memória do navegador não quebra nada", () => {
    const s = memoria();
    s.setItem(CHAVE_PENDENTES, "isso não é json");
    expect(lerPendentes(s)).toEqual([]);
    s.setItem(CHAVE_PENDENTES, JSON.stringify([null, 42, { nada: true }, pedido("ok")]));
    expect(lerPendentes(s).map((p) => p.clientRef)).toEqual(["ok"]);
  });

  it("pedido velho demais ou insistido demais para de ser tentado", () => {
    const antigo = pedido("velho", Date.now() - 30 * 86_400_000);
    const cansado = { ...pedido("cansado"), tentativas: MAX_TENTATIVAS };
    const bom = pedido("bom");
    expect(pendentesValidos([antigo, cansado, bom]).map((p) => p.clientRef)).toEqual(["bom"]);
  });
});

describe("insistir quando a internet oscila", () => {
  it("falhou na primeira, deu certo na segunda — venda salva", async () => {
    const s = memoria();
    const p = pedido("a1");
    guardarPendente(s, p);
    const f = vi
      .fn()
      .mockRejectedValueOnce(new Error("rede caiu"))
      .mockResolvedValueOnce(resposta(201, { number: 42 }));
    const ok = await registrarComInsistencia(p, {
      storage: s,
      fetchImpl: f as unknown as typeof fetch,
      dormir: async () => {},
    });
    expect(ok).toBe(true);
    expect(f).toHaveBeenCalledTimes(2);
    expect(lerPendentes(s)).toHaveLength(0); // saiu da fila
  });

  it("servidor fora o tempo todo: o pedido FICA guardado para a próxima visita", async () => {
    const s = memoria();
    const p = pedido("a1");
    guardarPendente(s, p);
    const f = vi.fn().mockResolvedValue(resposta(500));
    const ok = await registrarComInsistencia(p, {
      storage: s,
      fetchImpl: f as unknown as typeof fetch,
      dormir: async () => {},
    });
    expect(ok).toBe(false);
    // NÃO pode sumir: é a última chance dessa venda
    expect(lerPendentes(s)).toHaveLength(1);
  });

  it("recusa do servidor (dados inválidos) não fica insistindo para sempre", async () => {
    const s = memoria();
    const p = pedido("a1");
    guardarPendente(s, p);
    const f = vi.fn().mockResolvedValue(resposta(400));
    const ok = await registrarComInsistencia(p, {
      storage: s,
      fetchImpl: f as unknown as typeof fetch,
      dormir: async () => {},
    });
    expect(ok).toBe(false);
    expect(f).toHaveBeenCalledTimes(1); // não repetiu
    expect(lerPendentes(s)).toHaveLength(0);
  });

  it("cada tentativa é contada (o teto existe de verdade)", async () => {
    const s = memoria();
    const p = pedido("a1");
    guardarPendente(s, p);
    await registrarComInsistencia(p, {
      storage: s,
      fetchImpl: vi.fn().mockResolvedValue(resposta(503)) as unknown as typeof fetch,
      dormir: async () => {},
    });
    expect(lerPendentes(s)[0].tentativas).toBeGreaterThan(1);
  });
});

describe("resgate na próxima visita ao catálogo", () => {
  it("o pedido perdido é reenviado quando a cliente abre o catálogo de novo", async () => {
    const s = memoria();
    guardarPendente(s, pedido("perdido"));
    const f = vi.fn().mockResolvedValue(resposta(201, { number: 7 }));
    const recuperados = await reenviarPendentes({
      storage: s,
      fetchImpl: f as unknown as typeof fetch,
    });
    expect(recuperados).toBe(1);
    expect(lerPendentes(s)).toHaveLength(0);
  });

  it("continua falhando: segue guardado, sem sumir", async () => {
    const s = memoria();
    guardarPendente(s, pedido("perdido"));
    const recuperados = await reenviarPendentes({
      storage: s,
      fetchImpl: vi.fn().mockRejectedValue(new Error("sem rede")) as unknown as typeof fetch,
    });
    expect(recuperados).toBe(0);
    expect(lerPendentes(s)).toHaveLength(1);
  });

  it("sem nada guardado, não fala com o servidor à toa", async () => {
    const f = vi.fn();
    await reenviarPendentes({ storage: memoria(), fetchImpl: f as unknown as typeof fetch });
    expect(f).not.toHaveBeenCalled();
  });
});

describe("uma venda, um pedido", () => {
  it("o protocolo vai junto no envio (é ele que impede pedido duplicado)", async () => {
    const f = vi.fn().mockResolvedValue(resposta(201, {}));
    await tentarRegistrar(pedido("a1").payload, f as unknown as typeof fetch);
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    expect(body.clientRef).toBe("a1");
  });

  it("a rota devolve o pedido que já existe em vez de criar outro", () => {
    const rota = readFileSync(
      join(process.cwd(), "src/app/api/catalog/order/route.ts"),
      "utf8"
    );
    expect(rota).toContain("companyId_clientRef");
    expect(rota).toContain("jaRegistrado");
    // e a corrida (dois envios juntos) cai no índice único, sem estourar erro
    expect(rota).toContain("P2002");
  });
});

describe("o catálogo não manda mais no escuro", () => {
  const tela = readFileSync(
    join(process.cwd(), "src/app/catalogo/[slug]/public-catalog.tsx"),
    "utf8"
  );

  it("o erro do registro não é mais engolido", () => {
    expect(tela).not.toContain('fetch("/api/catalog/order"');
    expect(tela).toContain("registrarComInsistencia");
  });

  it("o pedido é guardado antes de sair e resgatado ao abrir o catálogo", () => {
    expect(tela).toContain("guardarPendente");
    expect(tela).toContain("reenviarPendentes");
  });

  it("a cliente vê o que aconteceu com o pedido dela", () => {
    expect(tela).toContain("Pedido registrado");
    expect(tela).toContain("não conseguimos registrar");
  });
});

describe("aviso de pedido novo (ninguém mais descobre por acaso)", () => {
  const notify = readFileSync(join(process.cwd(), "src/lib/notify.ts"), "utf8");
  const rota = readFileSync(
    join(process.cwd(), "src/app/api/catalog/order/route.ts"),
    "utf8"
  );

  it("pedido do catálogo avisa na hora", () => {
    expect(rota).toContain("notifyNovoPedido");
  });

  it("com vendedora no link, o aviso é SÓ dela", () => {
    const f = notify.slice(notify.indexOf("export async function notifyNovoPedido"));
    expect(f).toMatch(/input\.sellerId\s*\n?\s*\?\s*\[input\.sellerId\]/);
  });

  it("sem vendedora, o aviso vai para a gerência — nunca para uma vendedora qualquer", () => {
    const f = notify.slice(notify.indexOf("export async function notifyNovoPedido"));
    expect(f).toMatch(/role:\s*\{\s*in:\s*\["ADMIN",\s*"MANAGER"\]/);
    expect(f).not.toContain("SELLER");
  });
});
