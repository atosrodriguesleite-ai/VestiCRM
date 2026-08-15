import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lerMensagemWA } from "../comm/wa-message";

/**
 * REGRA: NENHUMA MENSAGEM DE CLIENTE PODE SUMIR.
 *
 * Incidente real (loja Toque Leve): chegou mensagem no celular e ela não
 * apareceu no sistema. O pior não foi o sumiço — foi não haver o que
 * investigar: o descarte era um `continue` mudo, sem bolha, sem log, sem
 * rastro nenhum.
 *
 * Este teste vigia as duas metades da regra:
 *  1. o LEITOR nunca devolve vazio para uma mensagem que tem conteúdo;
 *  2. o WEBHOOK nunca descarta sem registrar.
 */

describe("o leitor de mensagem nunca engole conteúdo", () => {
  it("texto simples", () => {
    expect(lerMensagemWA({ message: { conversation: "Oi, tudo bem?" } }).text).toBe(
      "Oi, tudo bem?"
    );
  });

  it("mensagem que veio de anúncio (Click-to-WhatsApp)", () => {
    // é exatamente o formato do incidente: texto + prévia do anúncio junto
    const m = {
      message: {
        extendedTextMessage: {
          text: "Olá! Posso ter mais informações sobre isso?",
          contextInfo: {
            externalAdReply: {
              title: "Regata poliamida premium",
              sourceUrl: "https://fb.me/99dbnnVXr",
            },
          },
        },
      },
    };
    expect(lerMensagemWA(m).text).toBe("Olá! Posso ter mais informações sobre isso?");
  });

  it("formato que o sistema não conhece vira AVISO, não silêncio", () => {
    const lida = lerMensagemWA({ message: { algumFormatoNovoDoWhatsApp: { x: 1 } } });
    // pode não saber ler, mas tem que devolver ALGO para virar bolha
    expect(lida.desconhecida).toBe(true);
    expect(lida.text.length).toBeGreaterThan(0);
  });
});

describe("o webhook nunca descarta mensagem sem deixar rastro", () => {
  const fonte = readFileSync(
    join(process.cwd(), "src/app/api/whatsapp/evolution/webhook/[token]/route.ts"),
    "utf8"
  );

  it("mensagem ilegível é registrada antes de qualquer coisa", () => {
    expect(
      /registrarDescarte\(/.test(fonte),
      `O webhook precisa registrar toda mensagem que não conseguiu interpretar. ` +
        `Sem isso, a loja vê a mensagem no celular, não vê no sistema, e não ` +
        `sobra NADA para investigar depois — foi exatamente o que aconteceu.`
    ).toBe(true);
  });

  it("não existe mais o descarte mudo por texto vazio", () => {
    expect(
      /if\s*\(!text\)\s*continue\s*;/.test(fonte),
      `"if (!text) continue" joga a mensagem fora sem bolha e sem log. ` +
        `Mensagem sem texto reconhecido tem que virar bolha de aviso E ir ` +
        `para o painel de Saúde com o conteúdo bruto.`
    ).toBe(false);
  });
});
