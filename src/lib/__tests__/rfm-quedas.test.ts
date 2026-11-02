import { describe, it, expect } from "vitest";
import {
  GRUPOS_DE_ALERTA,
  caiuParaAlerta,
  chaveDaQueda,
  decidirQuedas,
  grupoDaChave,
  prioridadeDaQueda,
  textoDaQueda,
  type ClienteDaRodada,
  type Lembranca,
} from "../bi/rfm-quedas-regra";
import { IDS_DOS_GRUPOS, type GrupoRfm } from "../bi/rfm-regra";
import { linkDaClienteDoRfm } from "../bi/rfm-link";

// Guarda RN-100
/**
 * AS QUEDAS DO RFM (Etapa 3, decidido com o dono): quando a cliente CAI para
 * um grupo de alerta, a vendedora dona dela recebe UMA tarefa — sem enxurrada
 * no primeiro dia, sem tarefa para a cliente da loja, com teto por vendedora
 * e sem esquecer quem ficou para depois.
 */
/** a memória da rodada anterior, a partir de cliente → grupo (e quem já esperava a vez) */
const mem = (pares: [string, GrupoRfm][], seguradas: Record<string, Date> = {}) =>
  new Map<string, Lembranca>(pares.map(([id, grupo]) => [id, { grupo, seguradaDesde: seguradas[id] ?? null }]));
const c = (id: string, grupo: GrupoRfm, o: Partial<ClienteDaRodada> = {}): ClienteDaRodada => ({
  id,
  grupo,
  ltv: o.ltv ?? 100,
  donaId: o.donaId === undefined ? "ana" : o.donaId,
});

describe("caiuParaAlerta: só a queda que ENTRA num grupo de alerta", () => {
  it("toda combinação, pela ordem da tela", () => {
    const ordem = IDS_DOS_GRUPOS;
    for (const de of ordem)
      for (const para of ordem) {
        const esperado = GRUPOS_DE_ALERTA.has(para) && ordem.indexOf(para) > ordem.indexOf(de);
        expect(caiuParaAlerta(de, para), `${de} → ${para}`).toBe(esperado);
      }
  });

  it("Campeã que vira Fiel não é alarme; Fiel que vira Não posso perder é", () => {
    expect(caiuParaAlerta("CAMPEAS", "FIEIS")).toBe(false);
    expect(caiuParaAlerta("FIEIS", "NAO_PERDER")).toBe(true);
    expect(caiuParaAlerta("NOVATAS", "ATENCAO")).toBe(true);
    // subir nunca é queda, nem entre os de alerta
    expect(caiuParaAlerta("PERDIDAS", "HIBERNANDO")).toBe(false);
  });
});

describe("decidirQuedas", () => {
  it("a primeira vez é o ponto de partida: grava a memória, NENHUMA tarefa", () => {
    const d = decidirQuedas(new Map(), [c("a", "NAO_PERDER"), c("b", "PERDIDAS")]);
    expect(d.tarefas).toEqual([]);
    expect(d.gravar.map((g) => g.customerId).sort()).toEqual(["a", "b"]);
  });

  it("memória velha (o BI desligado e religado) também é ponto de partida: nenhuma tarefa de meses atrás", () => {
    const d = decidirQuedas(mem([["a", "CAMPEAS"], ["b", "FIEIS"]]), [c("a", "PERDIDAS"), c("b", "FIEIS")], { partida: true });
    expect(d.tarefas).toEqual([]);
    expect(d.gravar).toEqual([{ customerId: "a", grupo: "PERDIDAS" }]);
  });

  it("caiu para alerta, com dona: vira tarefa NOVA para a DONA e a memória anda", () => {
    const d = decidirQuedas(mem([["a", "CAMPEAS"]]), [c("a", "NAO_PERDER", { donaId: "bia" })]);
    expect(d.tarefas).toEqual([{ customerId: "a", de: "CAMPEAS", para: "NAO_PERDER", donaId: "bia", atualizar: false }]);
    expect(d.gravar).toEqual([{ customerId: "a", grupo: "NAO_PERDER" }]);
  });

  it("sem dona: nenhuma tarefa e a queda ESPERA — dada a uma vendedora, a tarefa nasce", () => {
    const anteriores = mem([["a", "CAMPEAS"]]);
    const hoje = decidirQuedas(anteriores, [c("a", "NAO_PERDER", { donaId: null })]);
    expect(hoje.tarefas).toEqual([]);
    expect(hoje.gravar).toEqual([]);
    expect(hoje.seguradas).toEqual([{ customerId: "a", para: "NAO_PERDER", donaId: null }]);
    // a memória não andou: amanhã, com a Ana de dona, é queda
    const amanha = decidirQuedas(anteriores, [c("a", "NAO_PERDER", { donaId: "ana" })]);
    expect(amanha.tarefas.map((t) => t.donaId)).toEqual(["ana"]);
  });

  it("subiu ou caiu sem alerta: a memória anda e nada mais; ficou: nada", () => {
    const d = decidirQuedas(
      mem([
        ["a", "PERDIDAS"],
        ["b", "CAMPEAS"],
        ["c", "ATENCAO"],
      ]),
      [c("a", "CAMPEAS"), c("b", "FIEIS"), c("c", "ATENCAO")]
    );
    expect(d.tarefas).toEqual([]);
    expect(d.gravar.map((g) => g.customerId).sort()).toEqual(["a", "b"]);
  });

  it("o teto por vendedora conta só tarefa NOVA: atualizar a tarefa aberta não gasta vaga", () => {
    const pares: [string, GrupoRfm][] = [];
    const atuais: ClienteDaRodada[] = [];
    for (let i = 0; i < 12; i++) {
      pares.push([`a${i}`, "ATENCAO"]);
      atuais.push(c(`a${i}`, "HIBERNANDO", { ltv: 100 + i }));
    }
    const abertas = new Set(["a0", "a1", "a2", "a3", "a4", "a5", "a6", "a7"]);
    const d = decidirQuedas(mem(pares), atuais, { teto: 10, comTarefaAberta: abertas });
    expect(d.tarefas.filter((t) => t.atualizar).map((t) => t.customerId).sort()).toEqual([...abertas].sort());
    // as quatro sem tarefa aberta cabem no teto inteiro
    expect(d.tarefas.filter((t) => !t.atualizar)).toHaveLength(4);
    expect(d.seguradas).toEqual([]);
  });

  it("o teto: as de maior LTV primeiro; as outras ficam SEGURADAS e, na rodada seguinte, vão NA FRENTE", () => {
    const pares: [string, GrupoRfm][] = [];
    const atuais: ClienteDaRodada[] = [];
    for (let i = 0; i < 13; i++) {
      pares.push([`a${i}`, "FIEIS"]);
      atuais.push(c(`a${i}`, "NAO_PERDER", { ltv: i * 10, donaId: "ana" }));
    }
    pares.push(["b0", "FIEIS"]);
    atuais.push(c("b0", "NAO_PERDER", { ltv: 1, donaId: "bia" }));
    const d = decidirQuedas(mem(pares), atuais, { teto: 10 });
    const daAna = d.tarefas.filter((t) => t.donaId === "ana");
    expect(daAna.map((t) => t.customerId)).toEqual(["a12", "a11", "a10", "a9", "a8", "a7", "a6", "a5", "a4", "a3"]);
    // o teto é por vendedora: a Bia não perde a dela por causa da Ana
    expect(d.tarefas.some((t) => t.customerId === "b0")).toBe(true);
    expect(d.seguradas.map((t) => t.customerId).sort()).toEqual(["a0", "a1", "a2"]);
    for (const s of d.seguradas) expect(d.gravar.some((g) => g.customerId === s.customerId)).toBe(false);

    // amanhã caem dez clientes NOVAS da Ana, todas valendo mais — e as três
    // que esperavam vão na frente mesmo assim (a fila anda)
    const ontem = new Date("2026-10-26T12:00:00Z");
    const memoria = new Map<string, Lembranca>();
    for (const [id, g] of pares) memoria.set(id, { grupo: g, seguradaDesde: null });
    for (const g of d.gravar) memoria.set(g.customerId, { grupo: g.grupo, seguradaDesde: null });
    for (const s of d.seguradas) memoria.set(s.customerId, { grupo: "FIEIS", seguradaDesde: ontem });
    const novas: ClienteDaRodada[] = [];
    for (let i = 0; i < 10; i++) {
      memoria.set(`n${i}`, { grupo: "FIEIS", seguradaDesde: null });
      novas.push(c(`n${i}`, "NAO_PERDER", { ltv: 10_000 + i }));
    }
    const amanha = decidirQuedas(memoria, [...atuais, ...novas], { teto: 10 });
    const ordem = amanha.tarefas.filter((t) => t.donaId === "ana").map((t) => t.customerId);
    expect(ordem.slice(0, 3).sort()).toEqual(["a0", "a1", "a2"]);
  });

  it("quem saiu do RFM (a venda foi cancelada) tem a memória apagada", () => {
    const d = decidirQuedas(
      mem([
        ["a", "CAMPEAS"],
        ["sumiu", "NOVATAS"],
      ]),
      [c("a", "CAMPEAS")]
    );
    expect(d.apagar).toEqual(["sumiu"]);
  });

  it("a ordem de leitura não muda o resultado", () => {
    const anteriores = mem([
      ["x", "FIEIS"],
      ["y", "FIEIS"],
      ["z", "FIEIS"],
    ]);
    const atuais = [c("x", "ATENCAO", { ltv: 5 }), c("y", "ATENCAO", { ltv: 5 }), c("z", "ATENCAO", { ltv: 9 })];
    const a = decidirQuedas(anteriores, atuais, { teto: 2 }).tarefas.map((t) => t.customerId);
    const b = decidirQuedas(anteriores, [...atuais].reverse(), { teto: 2 }).tarefas.map((t) => t.customerId);
    expect(a).toEqual(b);
    expect(a).toEqual(["z", "x"]);
  });
});

describe("a tarefa", () => {
  it("diz de onde caiu, para onde, o porquê e a ação do grupo", () => {
    const t = textoDaQueda(
      { de: "CAMPEAS", para: "NAO_PERDER" },
      { nome: "Maria Souza", diasDesde: 75, compras12: 6, valor12: 5400 },
      (v) => `R$ ${v}`
    );
    expect(t.titulo).toBe("🚨 Maria Souza caiu para Não posso perder");
    expect(t.descricao).toContain("era 🏆 Campeãs");
    expect(t.descricao).toContain("há 75 dias");
    expect(t.descricao).toContain("6 compras e R$ 5400");
    expect(t.descricao).toContain("Chamar hoje, com cuidado");
    const sumida = textoDaQueda({ de: "HIBERNANDO", para: "PERDIDAS" }, { nome: "X", diasDesde: 1, compras12: 0, valor12: 0 }, String);
    expect(sumida.descricao).toContain("nenhuma compra nos últimos 12 meses");
    expect(sumida.descricao).toContain("há 1 dia,");
  });

  it("Não posso perder é prioridade ALTA; todo tipo é de CONTATO (falar com ela ou ela comprar fecha a tarefa sozinha)", () => {
    expect(prioridadeDaQueda("NAO_PERDER").priority).toBe("ALTA");
    for (const g of GRUPOS_DE_ALERTA) expect(["FOLLOW_UP", "REATIVAR"]).toContain(prioridadeDaQueda(g).type);
  });

  it("a chave leva o grupo (a Agenda monta a mensagem por ele) e volta inteira", () => {
    for (const g of IDS_DOS_GRUPOS) expect(grupoDaChave(chaveDaQueda(g, "cli1"))).toBe(g);
    expect(grupoDaChave("recompra:cli1")).toBeNull();
    expect(grupoDaChave("rfm-queda:VIP:cli1")).toBeNull();
    expect(grupoDaChave(null)).toBeNull();
  });
});

describe("o vencimento da tarefa", () => {
  it("é 23:59 de HOJE em SP — dentro do dia, então cai em Hoje e fecha sozinha no mesmo dia", async () => {
    const { vencimentoDaQueda } = await import("../bi/rfm-quedas");
    const { fimDeHojeSP } = await import("../contato-feito");
    for (const agora of [new Date("2026-10-27T13:00:00Z"), new Date("2026-10-28T02:30:00Z"), new Date("2026-10-27T03:00:00Z")]) {
      const v = vencimentoDaQueda(agora);
      expect(v.getTime()).toBeLessThan(fimDeHojeSP(agora).getTime());
      expect(fimDeHojeSP(agora).getTime() - v.getTime()).toBe(60_000);
    }
  });
});

describe("o link da mensagem (o mesmo da lista do BI)", () => {
  it("leva o código da cliente e a ref da dona; sem dona, sem ref", () => {
    const com = linkDaClienteDoRfm("loja", { nome: "Ana Souza", role: "SELLER" }, "abc123");
    expect(com).toContain("abc123");
    expect(com).toMatch(/ref=ana|\/ana\//);
    const sem = linkDaClienteDoRfm("loja", null, "abc123");
    expect(sem).toContain("abc123");
    expect(sem).not.toMatch(/ref=/);
  });
});
