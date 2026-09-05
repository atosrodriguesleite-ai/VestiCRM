import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AVISO_SEM_CONFIRMACAO,
  confirmacaoVenceu,
  MS_CONFIRMANDO_ENTREGA,
  requisicaoNaoSaiu,
  situacaoDoEnvio,
  tempoEsgotado,
} from "../entrega-incerta";

// Guarda RN-048 (índice em docs/regras.md; texto no CLAUDE.md).

/**
 * ENVIO QUE ESTOUROU O TEMPO NÃO É FALHA.
 *
 * Relato do dono (03/09/2026): quatro alarmes vermelhos em 24h, todos do
 * MESMO áudio. O envio bateu no teto de 50s, a tela mostrou ⚠️ ERRO com o
 * botão "Reenviar", e a vendedora clicou três vezes — duas delas num instante
 * em que o servidor de conexão estava fora do ar.
 */

const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("o que cada desfecho vira", () => {
  it("aceito pelo servidor: entregue", () => {
    expect(situacaoDoEnvio({ ok: true })).toBe("entregue");
  });

  /** O caso do relato: NÃO é vermelho, porque pode ter chegado. */
  it("tempo esgotado: confirmando, nunca falha", () => {
    expect(situacaoDoEnvio({ ok: false, incerto: true })).toBe("confirmando");
  });

  /** Recusa do servidor é resposta de verdade: aí sim é falha. */
  it("o servidor respondeu recusando: falha", () => {
    expect(situacaoDoEnvio({ ok: false, incerto: false })).toBe("falhou");
    expect(situacaoDoEnvio({ ok: false })).toBe("falhou");
  });
});

describe("de que tipo é o erro de rede", () => {
  /**
   * Medido no Node deste projeto contra um servidor que não responde:
   * `AbortSignal.timeout` levanta um DOMException chamado TimeoutError.
   */
  it("tempo esgotado é reconhecido pelo nome do erro", () => {
    const e = Object.assign(new Error("The operation was aborted"), {
      name: "TimeoutError",
    });
    expect(tempoEsgotado(e)).toBe(true);
    expect(requisicaoNaoSaiu(e)).toBe(false);
  });

  /**
   * Medido do mesmo jeito, contra uma porta fechada: `TypeError: fetch failed`
   * com o código real em `cause.code`. Aqui a mensagem com CERTEZA não saiu.
   */
  it("conexão recusada prova que a mensagem não saiu", () => {
    const e = Object.assign(new TypeError("fetch failed"), {
      cause: { code: "ECONNREFUSED" },
    });
    expect(requisicaoNaoSaiu(e)).toBe(true);
    expect(tempoEsgotado(e)).toBe(false);
  });

  it("nome que não resolve também não saiu do lugar", () => {
    expect(
      requisicaoNaoSaiu(Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }))
    ).toBe(true);
  });

  /**
   * ECONNRESET FICA DE FORA: a conexão cair no meio pode ter acontecido DEPOIS
   * de o servidor receber tudo — repetir aí mandaria a mensagem duas vezes,
   * que é o erro que esta regra inteira existe para evitar.
   */
  it("conexão cortada no meio NÃO autoriza tentar de novo sozinho", () => {
    expect(
      requisicaoNaoSaiu(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }))
    ).toBe(false);
  });

  it("erro sem código não vira permissão para repetir", () => {
    expect(requisicaoNaoSaiu(new Error("qualquer coisa"))).toBe(false);
    expect(requisicaoNaoSaiu(null)).toBe(false);
    expect(requisicaoNaoSaiu(undefined)).toBe(false);
  });
});

describe("a janela de confirmação tem fim", () => {
  const t0 = new Date("2026-09-03T08:03:00Z");

  it("dentro da janela, continua esperando o eco", () => {
    expect(confirmacaoVenceu(t0, new Date(t0.getTime() + 60_000))).toBe(false);
  });

  /**
   * Dizer "confirmando" para sempre esconderia a mensagem que REALMENTE não
   * saiu: a cliente ficaria sem resposta com a loja achando que respondeu.
   */
  it("passada a janela, vira falha", () => {
    expect(
      confirmacaoVenceu(t0, new Date(t0.getTime() + MS_CONFIRMANDO_ENTREGA + 1))
    ).toBe(true);
  });

  /** No limite exato ainda vale esperar — o eco pode estar chegando. */
  it("no limite exato ainda espera", () => {
    expect(
      confirmacaoVenceu(t0, new Date(t0.getTime() + MS_CONFIRMANDO_ENTREGA))
    ).toBe(false);
  });

  it("data inválida não fecha o caso sozinha", () => {
    expect(confirmacaoVenceu(t0, new Date(Number.NaN))).toBe(false);
  });

  /** Curta o bastante para a vendedora agir, longa o bastante para o eco. */
  it("a janela é de minutos, não de horas nem de segundos", () => {
    expect(MS_CONFIRMANDO_ENTREGA).toBeGreaterThanOrEqual(60_000);
    expect(MS_CONFIRMANDO_ENTREGA).toBeLessThanOrEqual(15 * 60_000);
  });

  /**
   * O texto do fim da janela NUNCA afirma que não chegou — é justamente o que
   * não se sabe, e a vendedora precisa saber que reenviar pode duplicar.
   */
  it("o aviso final não mente sobre a entrega", () => {
    expect(AVISO_SEM_CONFIRMACAO).toMatch(/PODE ter chegado/);
    expect(AVISO_SEM_CONFIRMACAO).toMatch(/confira a conversa no celular/i);
  });
});

/**
 * O que dá para afirmar sem rede e sem banco é a decisão; o caminho foi
 * exercitado ponta a ponta contra o Postgres local na entrega (envio que
 * estoura o tempo → bolha "confirmando" → eco do webhook adota → enviada; e o
 * mesmo sem eco → varredura fecha e a cliente volta para a fila).
 */
describe("quem chama a regra", () => {
  it("o envio guarda o motivo e NÃO marca falha quando é incerto", () => {
    const engine = ler("src/lib/comm/engine.ts");
    const de = engine.indexOf('situacaoDoEnvio(result) === "confirmando"');
    expect(de).toBeGreaterThan(-1);
    // o ramo do incerto escreve só o motivo — status fica ENVIANDO
    const bloco = engine.slice(de, de + 700);
    expect(bloco).toContain("data: { error: result.error }");
    expect(bloco).not.toContain('status: "FALHOU"');
  });

  /**
   * A JANELA CONTA DE QUANDO FICOU INCERTA, não de quando a mensagem nasceu.
   * Pelo `createdAt`, o REENVIO de uma mensagem antiga já nascia vencido: a
   * varredura o marcava como falha em segundos, o vermelho com "Reenviar"
   * voltava e a vendedora clicava de novo — o duplicado que a regra existe
   * para evitar (achado da revisão, 03/09/2026). Reproduzido contra o
   * Postgres local: reenvio de mensagem de 2h fica ENVIANDO, não é fechado.
   */
  it("a varredura mede pela data em que a mensagem foi mexida", () => {
    const engine = ler("src/lib/comm/engine.ts");
    const de = engine.indexOf("export async function fecharConfirmacoesVencidas");
    const bloco = engine.slice(de, engine.indexOf("return fechadas.length", de));
    expect(bloco).toContain("updatedAt: { lt: limite }");
    expect(bloco).toContain("confirmacaoVenceu(m.updatedAt");
    expect(bloco).not.toContain("createdAt: { lt: limite }");
    // e o resgate do eco alcança o reenvio pela mesma régua
    const webhook = ler("src/app/api/whatsapp/evolution/webhook/[token]/route.ts");
    const resgate = webhook.indexOf("RESGATE: o eco pode ser uma mensagem");
    expect(webhook.slice(resgate, resgate + 1200)).toContain("updatedAt: { gt:");
  });

  /**
   * A segunda tentativa CABE no mesmo orçamento: dar um teto novo a ela
   * poderia somar 50s + 50s e matar a função no meio — o problema que o teto
   * de 50s foi criado para evitar (achado da revisão).
   */
  it("a segunda tentativa usa o que sobra do relógio, não um teto novo", () => {
    const evo = ler("src/lib/comm/evolution.ts");
    expect(evo).toContain("const sobra = timeoutMs - (Date.now() - comecou)");
    expect(evo).toContain("if (sobra < MS_MINIMO_PARA_TENTAR_DE_NOVO) return r;");
    expect(evo).toContain("return uma(sobra);");
  });

  it("a varredura fecha a janela de carona no tráfego, sem cron novo", () => {
    expect(ler("src/app/api/conversations/route.ts")).toContain(
      "fecharConfirmacoesSemQuebrar(user.companyId)"
    );
    const crons = JSON.parse(ler("vercel.json")).crons ?? [];
    expect(crons.length).toBeLessThanOrEqual(2);
  });

  /** Só o envio repete sozinho; a leitura do webhook tem orçamento curto. */
  it("a segunda tentativa automática vale para envio, não para leitura", () => {
    const evo = ler("src/lib/comm/evolution.ts");
    for (const envio of ["sendText", "sendMedia", "sendWhatsAppAudio"]) {
      const de = evo.indexOf(envio);
      expect(evo.slice(de, de + 900), envio).toContain("RN-048");
    }
    const leitura = evo.indexOf("getBase64FromMediaMessage");
    expect(evo.slice(leitura, leitura + 400)).not.toContain("RN-048");
  });
});
