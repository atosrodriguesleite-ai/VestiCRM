import { describe, it, expect, vi, afterEach } from "vitest";

// Banco de MENTIRA que AVALIA as condições do where — teste que só confere
// "chamou o banco" protege o erro em vez de impedi-lo (lição do compositor,
// 28/08/2026): se alguém tirar o teto de erros do updateMany, este fake
// deixa os chutes passarem e o teste QUEBRA.
const linhas = new Map<string, { id: string; userId: string; codeHash: string; expiresAt: Date; tries: number }>();
let seq = 0;
vi.mock("../db", () => ({
  db: {
    loginCode: {
      deleteMany: async ({ where }: { where: { expiresAt?: { lt: Date } } }) => {
        let count = 0;
        for (const [id, l] of linhas) {
          if (where.expiresAt?.lt && l.expiresAt < where.expiresAt.lt) {
            linhas.delete(id);
            count++;
          }
        }
        return { count };
      },
      create: async ({ data }: { data: { userId: string; codeHash: string; expiresAt: Date } }) => {
        const linha = { id: `desafio-${++seq}`, tries: 0, ...data };
        linhas.set(linha.id, linha);
        return linha;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; expiresAt: { gt: Date }; tries: { lt: number } };
        data: { tries: { increment: number } };
      }) => {
        const l = linhas.get(where.id);
        if (!l || l.expiresAt <= where.expiresAt.gt || l.tries >= where.tries.lt) {
          return { count: 0 };
        }
        l.tries += data.tries.increment;
        return { count: 1 };
      },
      findUnique: async ({ where }: { where: { id: string } }) => linhas.get(where.id) ?? null,
      delete: async ({ where }: { where: { id: string } }) => {
        if (!linhas.has(where.id)) throw new Error("P2025");
        linhas.delete(where.id);
      },
    },
  },
}));

import {
  aparelhoConfiavel,
  assinarAparelho,
  conferirCodigo,
  criarDesafio,
  gerarCodigo,
  hashDoCodigo,
  DIAS_APARELHO_CONFIAVEL,
  MAX_ERROS_DO_CODIGO,
  MINUTOS_DO_CODIGO,
} from "../auth-codigo";

afterEach(() => {
  linhas.clear();
  vi.useRealTimers();
});

// Guarda RN-045
//
// Código de login pelo WhatsApp em aparelho novo: opt-in por loja e por
// pessoa, aparelho conhecido por 90 dias, e NUNCA tranca a lojista fora —
// sem como entregar o código, o login segue como sempre, com rastro.

describe("RN-045 — código de login em aparelho novo", () => {
  it("o código tem 6 dígitos, com zero à esquerda valendo", () => {
    for (let i = 0; i < 200; i++) {
      expect(gerarCodigo()).toMatch(/^\d{6}$/);
    }
    // não é sempre o mesmo (gerador de verdade)
    const varios = new Set(Array.from({ length: 50 }, () => gerarCodigo()));
    expect(varios.size).toBeGreaterThan(1);
  });

  it("o que vai ao banco é o HMAC do código, nunca o código", () => {
    const h = hashDoCodigo("123456");
    expect(h).not.toContain("123456");
    expect(h).toBe(hashDoCodigo("123456")); // determinístico para conferir
    expect(h).not.toBe(hashDoCodigo("123457"));
  });

  it("aparelho confiável: o cookie assinado dispensa o código por 90 dias", () => {
    const agora = Date.now();
    const cookie = assinarAparelho("user-1", agora);
    expect(aparelhoConfiavel(cookie, "user-1", agora)).toBe(true);
    // ainda vale um dia antes de vencer…
    expect(
      aparelhoConfiavel(cookie, "user-1", agora + (DIAS_APARELHO_CONFIAVEL - 1) * 86_400_000)
    ).toBe(true);
    // …e MORRE depois do prazo
    expect(
      aparelhoConfiavel(cookie, "user-1", agora + (DIAS_APARELHO_CONFIAVEL + 1) * 86_400_000)
    ).toBe(false);
  });

  it("código certo entra UMA vez; o desafio morre no acerto", async () => {
    const { desafioId, codigo } = await criarDesafio("user-1");
    expect(await conferirCodigo(desafioId, "999999")).toBeNull(); // chute erra
    expect(await conferirCodigo(desafioId, codigo)).toBe("user-1"); // certo entra
    expect(await conferirCodigo(desafioId, codigo)).toBeNull(); // e só uma vez
  });

  it(`o desafio MORRE com ${MAX_ERROS_DO_CODIGO} erros — nem o código certo entra depois`, async () => {
    const { desafioId, codigo } = await criarDesafio("user-1");
    for (let i = 0; i < MAX_ERROS_DO_CODIGO; i++) {
      expect(await conferirCodigo(desafioId, "000000")).toBeNull();
    }
    expect(await conferirCodigo(desafioId, codigo)).toBeNull();
  });

  it(`o código vence em ${MINUTOS_DO_CODIGO} minutos`, async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-02T12:00:00Z"));
    const { desafioId, codigo } = await criarDesafio("user-1");
    vi.setSystemTime(new Date("2026-09-02T12:11:00Z")); // 11 min depois
    expect(await conferirCodigo(desafioId, codigo)).toBeNull();
  });

  it("o cookie é de UMA pessoa: outra conta no mesmo aparelho pede código", () => {
    const cookie = assinarAparelho("user-1");
    expect(aparelhoConfiavel(cookie, "user-2")).toBe(false);
  });

  it("cookie mexido não vale: validade esticada ou assinatura trocada caem", () => {
    const agora = Date.now();
    const cookie = assinarAparelho("user-1", agora);
    const [id, validade, assinatura] = cookie.split(".");
    // esticar a validade sem reassinar
    expect(
      aparelhoConfiavel(`${id}.${Number(validade) + 86_400_000}.${assinatura}`, "user-1", agora)
    ).toBe(false);
    // assinatura de mentira
    expect(aparelhoConfiavel(`${id}.${validade}.${"0".repeat(64)}`, "user-1", agora)).toBe(false);
    // lixo
    expect(aparelhoConfiavel("qualquer-coisa", "user-1", agora)).toBe(false);
    expect(aparelhoConfiavel(undefined, "user-1", agora)).toBe(false);
  });
});
