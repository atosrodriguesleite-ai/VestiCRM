// Guarda RN-034, RN-035
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { montarMensagemDeCobranca } from "../financeiro/cobranca";
import { DFC_LABEL, grupoDFCdoCodigo } from "../financeiro/visao";
import { CATEGORIAS_PADRAO } from "../financeiro/cadastros";
import { dataDoDia } from "../financeiro/lancamentos";

/**
 * RN-034 · Cobrança pelo WhatsApp: a mensagem é montada pelo sistema, enviada
 * por uma pessoa, e a mesma conta não é cobrada duas vezes no mesmo dia.
 * RN-035 · A visão de dono: saldo previsto (só o que está em aberto) e DFC
 * (só o que movimentou), com a conta fechando.
 */

const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("a mensagem de cobrança (RN-034)", () => {
  const base = {
    clienteNome: "Ana Paula Souza",
    descricao: "Venda #0042",
    valor: 530,
    vencimento: dataDoDia("2026-09-05")!,
    diasDeAtraso: 12,
    lojaNome: "Toque Leve",
  };

  it("chama a cliente pelo primeiro nome e traz valor e vencimento", () => {
    const m = montarMensagemDeCobranca(base);
    expect(m).toContain("Ana");
    expect(m).not.toContain("Ana Paula Souza"); // primeiro nome, não a ficha inteira
    expect(m).toContain("530");
    expect(m).toContain("05/09/2026");
    expect(m).toContain("Venda #0042");
  });

  it("muda o tom conforme o atraso — e nunca acusa", () => {
    const hoje = montarMensagemDeCobranca({ ...base, diasDeAtraso: 0 });
    const pouco = montarMensagemDeCobranca({ ...base, diasDeAtraso: 2 });
    const muito = montarMensagemDeCobranca({ ...base, diasDeAtraso: 40 });
    expect(hoje).toContain("vencimento de hoje");
    expect(pouco).toContain("venceu há pouquinho");
    expect(muito).toContain("valor em aberto");
    for (const m of [hoje, pouco, muito]) {
      expect(m.toLowerCase()).not.toMatch(/inadimpl|dívida|devedor|negativ|cobrança judicial/);
      // e sempre abre a porta para a cliente responder
      expect(m).toContain("me avisa");
    }
  });

  it("não mostra dias quando a conta vence hoje", () => {
    expect(montarMensagemDeCobranca({ ...base, diasDeAtraso: 0 })).not.toMatch(/\(\d+ dia/);
    expect(montarMensagemDeCobranca({ ...base, diasDeAtraso: 1 })).toContain("(1 dia)");
    expect(montarMensagemDeCobranca({ ...base, diasDeAtraso: 3 })).toContain("(3 dias)");
  });

  it("cliente sem nome não quebra a mensagem", () => {
    const m = montarMensagemDeCobranca({ ...base, clienteNome: "" });
    expect(m.startsWith("Oi")).toBe(true);
  });
});

describe("as travas da cobrança (RN-034)", () => {
  const motor = ler("src/lib/financeiro/cobranca.ts");

  it("recusa quando falta o essencial, com frase em português", () => {
    for (const trava of [
      "Só dá para cobrar conta a receber",
      "Este lançamento está cancelado",
      "A cliente não tem WhatsApp no cadastro",
      "Esta cliente está bloqueada no WhatsApp",
      "Esta parcela já está quitada",
      "Esta conta já foi cobrada hoje",
    ]) {
      expect(motor, `falta a trava: ${trava}`).toContain(trava);
    }
  });

  it("sai pela Central de sempre (com o ritmo anti-ban da RN-017)", () => {
    expect(motor).toContain('from "../comm/engine"');
    expect(motor).toContain("sendMessage(");
  });

  it("envio que falha NÃO diz que foi enviado", () => {
    expect(motor).toContain("Não consegui enviar pelo WhatsApp");
    // a marca de cobrada é tomada ANTES do envio (é ela que impede o clique
    // duplo na janela anti-ban), então todo caminho de erro DESMARCA: o que
    // não saiu não pode ficar registrado como cobrado
    const saidas = motor.split("status: 502").length - 1;
    expect(saidas).toBe(2); // a exceção e o FALHOU
    expect(motor.split("await desmarcar();").length - 1).toBe(saidas);
  });

  it("a cobrança é um clique de PESSOA, nunca um disparo automático", () => {
    const rota = ler("src/app/api/financeiro/parcelas/[id]/cobranca/route.ts");
    expect(rota).toContain("porteiraFinanceiro");
    // não existe cron nem carona chamando a cobrança sozinha
    const vercel = JSON.parse(ler("vercel.json")) as { crons?: { path: string }[] };
    expect((vercel.crons ?? []).some((c) => /cobranca/i.test(c.path))).toBe(false);
  });
});

describe("em que bloco do DFC cada categoria entra (RN-035)", () => {
  it("máquina e reforma são investimento", () => {
    expect(grupoDFCdoCodigo("07")).toBe("INVESTIMENTO");
    expect(grupoDFCdoCodigo("07.01")).toBe("INVESTIMENTO");
    expect(grupoDFCdoCodigo("07.03")).toBe("INVESTIMENTO");
  });

  it("empréstimo e retirada dos sócios são financiamento", () => {
    expect(grupoDFCdoCodigo("06.03")).toBe("FINANCIAMENTO");
    expect(grupoDFCdoCodigo("05.04")).toBe("FINANCIAMENTO");
  });

  it("o dia a dia da loja é operacional", () => {
    for (const c of ["01.01", "01.03", "03.02", "04.02", "05.01", "06.01"]) {
      expect(grupoDFCdoCodigo(c), `${c} deveria ser operacional`).toBe("OPERACIONAL");
    }
  });

  it("categoria criada pela loja (ou sem categoria) cai em operacional", () => {
    expect(grupoDFCdoCodigo("08.01")).toBe("OPERACIONAL");
    expect(grupoDFCdoCodigo(null)).toBe("OPERACIONAL");
    expect(grupoDFCdoCodigo(undefined)).toBe("OPERACIONAL");
  });

  it("os três blocos têm nome em português para a lojista", () => {
    expect(Object.keys(DFC_LABEL).sort()).toEqual([
      "FINANCIAMENTO",
      "INVESTIMENTO",
      "OPERACIONAL",
    ]);
    for (const t of Object.values(DFC_LABEL)) expect(t.length).toBeGreaterThan(10);
  });

  it("a árvore padrão TEM as categorias que o DFC usa para separar", () => {
    const codigos = CATEGORIAS_PADRAO.map((c) => c.codigo);
    for (const c of ["07", "07.01", "06.03", "05.04"]) {
      expect(codigos, `a árvore precisa de ${c}`).toContain(c);
    }
  });
});

describe("saldo previsto e DFC contam a verdade (RN-035)", () => {
  const visao = ler("src/lib/financeiro/visao.ts");

  it("a previsão soma o que está EM ABERTO (o já pago não conta duas vezes)", () => {
    // valor das parcelas − o que já foi abatido nelas: a quitada entra
    // valendo zero dos dois lados. Somado no BANCO — carregar as parcelas
    // traria a história inteira da loja a cada abertura da tela
    expect(visao).toContain("db.finParcela.aggregate");
    expect(visao).toContain("(parcelas._sum.valor ?? 0) - (abatido._sum.valor ?? 0)");
    expect(visao).toContain("estornadaEm: null"); // baixa estornada não abate
    // e o cancelado nunca entra
    expect(visao).toContain("canceladoEm: null");
  });

  it("o DFC soma o que MOVIMENTOU, não o previsto", () => {
    expect(visao).toContain("db.finBaixa.findMany");
    expect(visao).toContain("estornadaEm: null");
    expect(visao).toContain("valorMovimentado");
  });

  it("a diferença que sobra é DITA, nunca escondida — e com o nome CERTO", () => {
    // conta cadastrada com saldo inicial DENTRO do período traz dinheiro que
    // a loja não gerou nem transferiu. Antes ele caía na sobra e a tela o
    // chamava de "transferência" — dizer o nome errado do dinheiro é pior
    // que não mostrar (achado do ponta a ponta da Fase 5).
    expect(visao).toContain("saldoInicialEm: { gte: de, lte: ate }");
    expect(visao).toContain("saldosDeclarados");
    expect(visao).toContain(
      "saldoFinal - saldoInicial - geradoNoPeriodo - saldosDeclarados"
    );
    // e a tela mostra o valor com o nome dele
    const tela = ler("src/app/(app)/financeiro/dfc/dfc-view.tsx");
    expect(tela).toContain("Contas cadastradas");
  });

  it("os cards do painel somam o PERÍODO INTEIRO, não as linhas exibidas", () => {
    // mesma régua da RN-030: card que soma só as 500 linhas carregadas mostra
    // menos dívida do que existe, e a lojista se planeja com o número errado
    expect(visao).toContain("db.finParcela.aggregate");
    expect(visao).toContain("db.finBaixa.aggregate");
    expect(visao).toContain("truncado: idsEmAberto.length >= TETO_INADIMPLENCIA");
    // e a vaga não se gasta com parcela já quitada: o filtro do "em aberto"
    // é feito NO BANCO, senão a lista vinha vazia ao lado de um total grande
    expect(visao).toContain('SELECT SUM(b."valor") FROM "FinBaixa" b');
    // e a tela DIZ que está mostrando parte
    const tela = ler("src/app/(app)/financeiro/inadimplencia/inadimplencia-view.tsx");
    expect(tela).toContain("mostrando as mais antigas");
  });

  it("as linhas de saldo por conta fecham com o card do painel", () => {
    // conta arquivada continua com o dinheiro dela: escondê-la da lista
    // enquanto o total a soma faz as linhas não baterem com o card
    const painel = ler("src/app/(app)/financeiro/_visao/painel.tsx");
    expect(painel).toContain("contas.reduce((s, c) => s + c.saldo, 0)");
    expect(painel).toContain("!c.arquivada || c.saldo !== 0");
  });

  it("a vaga do dia é tomada ANTES do envio (dois cliques não cobram 2×)", () => {
    // o envio proativo espera de 4 a 9s (RN-017): nessa janela dois cliques
    // passariam os dois pela conferência e a cliente receberia em dobro
    const cobranca = ler("src/lib/financeiro/cobranca.ts");
    expect(cobranca).toContain("db.finLancamento.updateMany");
    expect(cobranca).toContain("if (vaga.count === 0)");
    expect(cobranca.indexOf("vaga.count === 0")).toBeLessThan(
      cobranca.indexOf("await sendMessage(")
    );
    // e o que não saiu é desmarcado
    expect(cobranca).toContain("await desmarcar();");
  });

  it("a semeadura não pendura categoria do sistema debaixo de categoria da loja", () => {
    // `proximoCodigo` numera na ordem: a loja pode ter criado a dela com o
    // código "07", e enxertar "07.01 Máquinas" ali faria o DFC ler a
    // categoria inteira da lojista como investimento
    const cadastros = ler("src/lib/financeiro/cadastros.ts");
    expect(cadastros).toContain("nossoPai");
    expect(cadastros).toContain("Boolean(dono?.sistema) && dono?.tipo === tipo");
  });

  it("a cobrança só marca 'cobrada' se o WhatsApp ACEITOU a mensagem", () => {
    // a Central não LANÇA erro quando o provedor recusa: devolve a mensagem
    // com status FALHOU. Sem olhar o status, a cobrança se dava por enviada
    // com o WhatsApp desligado — a lojista riscava da lista e a cliente
    // nunca soube (achado do ponta a ponta da Fase 5).
    const cobranca = ler("src/lib/financeiro/cobranca.ts");
    expect(cobranca).toContain('enviada.status === "FALHOU"');
    // e o histórico do lançamento só ganha "Cobrança enviada" no caminho
    // que passou pela conferência do envio
    expect(cobranca.indexOf('enviada.status === "FALHOU"')).toBeLessThan(
      cobranca.indexOf("Cobrança enviada pelo WhatsApp")
    );
  });

  it("a semeadura das categorias COMPLETA o que falta (loja antiga ganha o bloco novo)", () => {
    const cadastros = ler("src/lib/financeiro/cadastros.ts");
    expect(cadastros).toContain("const faltando = CATEGORIAS_PADRAO.filter");
    expect(cadastros).toContain("if (faltando.length === 0) return;");
  });
});
