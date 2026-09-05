import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { centralDisponivel, type SinalDaCentral } from "../central-disponivel";

// Guarda RN-049 (índice em docs/regras.md; texto no CLAUDE.md).

/**
 * A CENTRAL SÓ APARECE PARA QUEM JÁ TEM WHATSAPP.
 *
 * Relato do dono (05/09/2026): loja que nunca conectou o WhatsApp via a fila
 * e o chat cheios de pedidos do catálogo. Por trás nada muda (o pedido
 * continua nascendo com conversa, funil e tarefa); a TELA é que vira o
 * convite para conectar. E a loja que já conversou de verdade nunca perde o
 * histórico atrás dessa tela, mesmo com a conexão caída.
 */

const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const nunca: SinalDaCentral = {
  activeProvider: "MOCK",
  evolutionStatus: "DESCONECTADO",
  jaConectou: false,
  lojaDemo: false,
};

describe("loja que nunca conectou", () => {
  it("vê o convite para conectar, não a Central", () => {
    expect(centralDisponivel(nunca)).toBe(false);
  });

  /** Clicou em conectar e o QR está na tela: ainda não é Central. */
  it("esperando o QR ainda não é Central", () => {
    expect(centralDisponivel({ ...nunca, evolutionStatus: "AGUARDANDO_QR" })).toBe(false);
  });

  /** Configuração vazia (loja recém-criada, sem CommSettings). */
  it("sem configuração nenhuma é o mesmo que nunca conectou", () => {
    expect(
      centralDisponivel({ ...nunca, activeProvider: undefined, evolutionStatus: null })
    ).toBe(false);
  });
});

describe("loja com WhatsApp", () => {
  it("conectada agora: Central", () => {
    expect(centralDisponivel({ ...nunca, evolutionStatus: "CONECTADO" })).toBe(true);
  });

  it("API oficial configurada: Central", () => {
    expect(centralDisponivel({ ...nunca, activeProvider: "CLOUD_API" })).toBe(true);
  });

  /**
   * O SEGUNDO PEDIDO DO DONO: a conexão caiu, ou a loja clicou em
   * Desconectar (que ZERA instância, telefone e provedor — as configurações
   * ficam iguais às de quem nunca conectou). O histórico tem que continuar
   * lá. A prova é o carimbo da primeira conexão, que nunca é apagado.
   */
  it("desconectou, mas já conectou um dia: o histórico FICA", () => {
    expect(centralDisponivel({ ...nunca, jaConectou: true })).toBe(true);
  });
});

describe("a loja de demonstração", () => {
  /** É vitrine: mostra a Central com as conversas semeadas, sem conectar nada. */
  it("sempre vê a Central", () => {
    expect(centralDisponivel({ ...nunca, lojaDemo: true })).toBe(true);
  });
});

/**
 * O carimbo é o que sustenta a regra — e onde ele NÃO pode ser apagado.
 * O restante (a página lendo o carimbo, o backfill das lojas antigas) foi
 * exercitado contra o Postgres local na entrega.
 */
describe("o carimbo da primeira conexão", () => {
  it("é gravado onde a conexão vira real, e o Desconectar não o toca", () => {
    for (const rota of [
      "src/app/api/whatsapp/evolution/route.ts",
      "src/app/api/whatsapp/evolution/webhook/[token]/route.ts",
      "src/app/api/comm/settings/route.ts",
    ]) {
      expect(ler(rota), rota).toContain("registrarPrimeiraConexao(");
    }
    expect(ler("src/app/api/whatsapp/evolution/disconnect/route.ts")).not.toContain(
      "whatsappConectadoEm"
    );
  });

  /**
   * Id FALSO não prova WhatsApp: o provedor simulado grava "mock.…", a tela de
   * simulação "wamid.sim.…" e o seed da demo "wamid.seed.…". O id da API
   * oficial de verdade começa por "wamid." + base64 — por isso o backfill
   * exclui só os dois sufixos falsos, nunca "wamid.%" inteiro.
   */
  it("o backfill ignora os ids falsos e preserva o id real da API oficial", () => {
    const sql = ler("prisma/migrations/20260905090000_comm_whatsapp_conectado_em/migration.sql");
    expect(sql).toContain(`NOT LIKE 'mock.%'`);
    expect(sql).toContain(`NOT LIKE 'wamid.sim.%'`);
    expect(sql).toContain(`NOT LIKE 'wamid.seed.%'`);
    expect(sql).not.toContain(`NOT LIKE 'wamid.%'`);
    // e o texto da regra mora no schema, do lado da coluna
    expect(ler("prisma/schema.prisma")).toContain("whatsappConectadoEm   DateTime?");
  });
});
