// Guarda RN-092
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  DATAS_COMERCIAIS,
  DATA_DO_SISTEMA_POR_CHAVE,
  SEGMENTOS,
  diaDaData,
  diasEntre,
  enesimoDiaDaSemana,
  foraDaJanela,
  inicioDe,
  intervaloDaTela,
  janelaDoLembrete,
  montarOcorrencias,
  paraAvisar,
  pascoa,
  segmentosValidos,
  situacaoDe,
  somarDias,
  textoDoLembrete,
  type EventoGravado,
} from "../calendario/datas";
import { MODULOS } from "../modulos";
import { itemVisivel, type ItemDoMenu } from "../menu-grupos";
import { ondeTomarATrava } from "../calendario/lembrete";

/**
 * RN-092 — CALENDÁRIO COMERCIAL: datas do sistema CALCULADAS (nunca gravadas
 * ano a ano), segmentos em lista fechada, antecedência da loja e de cada
 * data, lembrete uma vez por data. Módulo com chave, só gerência.
 */

const raiz = process.cwd();
const ler = (rel: string) => readFileSync(join(raiz, rel), "utf8");
const data = (chave: string) => DATA_DO_SISTEMA_POR_CHAVE.get(chave)!.data;

describe("RN-092 · as datas que mudam todo ano são calculadas", () => {
  it("Páscoa bate com o calendário de verdade", () => {
    expect(pascoa(2024)).toBe("2024-03-31");
    expect(pascoa(2025)).toBe("2025-04-20");
    expect(pascoa(2026)).toBe("2026-04-05");
    expect(pascoa(2027)).toBe("2027-03-28");
    expect(pascoa(2028)).toBe("2028-04-16");
  });

  it("Carnaval é a terça 47 dias antes da Páscoa", () => {
    expect(diaDaData(data("carnaval"), 2026)).toBe("2026-02-17");
    expect(diaDaData(data("carnaval"), 2027)).toBe("2027-02-09");
  });

  it("Mães e Pais são o 2º domingo de maio e de agosto", () => {
    expect(diaDaData(data("dia-das-maes"), 2026)).toBe("2026-05-10");
    expect(diaDaData(data("dia-das-maes"), 2027)).toBe("2027-05-09");
    expect(diaDaData(data("dia-dos-pais"), 2026)).toBe("2026-08-09");
    expect(diaDaData(data("dia-dos-pais"), 2027)).toBe("2027-08-08");
  });

  it("Black Friday é a sexta depois da 4ª quinta de novembro", () => {
    expect(diaDaData(data("black-friday"), 2025)).toBe("2025-11-28");
    expect(diaDaData(data("black-friday"), 2026)).toBe("2026-11-27");
    expect(diaDaData(data("black-friday"), 2027)).toBe("2027-11-26");
  });

  it("dia da semana: 1ª segunda de fevereiro e o 1º do mês que já cai no dia", () => {
    expect(enesimoDiaDaSemana(2026, 2, 1, 1)).toBe("2026-02-02");
    // 1º de junho de 2026 é segunda
    expect(enesimoDiaDaSemana(2026, 6, 1, 1)).toBe("2026-06-01");
  });

  it("somar dias e contar dias atravessam mês e ano", () => {
    expect(somarDias("2026-03-01", -1)).toBe("2026-02-28");
    expect(somarDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(diasEntre("2026-10-23", "2026-11-27")).toBe(35);
    expect(diasEntre("2026-11-27", "2026-10-23")).toBe(-35);
  });

  it("toda data do sistema tem chave única e cai num dia que existe", () => {
    const chaves = [...DATAS_COMERCIAIS, ...SEGMENTOS.flatMap((s) => s.datas)].map((d) => d.chave);
    // a mesma data em dois segmentos é o MESMO objeto (uma chave, um dia)
    expect(new Set(chaves).size).toBe(DATA_DO_SISTEMA_POR_CHAVE.size);
    for (const { data: d } of DATA_DO_SISTEMA_POR_CHAVE.values()) {
      for (const ano of [2026, 2027, 2028]) {
        const dia = diaDaData(d, ano);
        expect(dia, d.chave).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(new Date(`${dia}T12:00:00Z`).toISOString().slice(0, 10), d.chave).toBe(dia);
      }
    }
  });
});

describe("RN-092 · o calendário da loja", () => {
  const base = { de: "2026-10-01", ate: "2027-09-30", eventos: [] as EventoGravado[] };

  it("loja sem segmento vê só as comerciais — nenhuma oportunidade inventada", () => {
    const lista = montarOcorrencias({ ...base, segmentos: [], ocultas: [] });
    expect(lista.every((o) => o.tipo === "COMERCIAL")).toBe(true);
    expect(lista.map((o) => o.titulo)).toContain("Black Friday");
    expect(lista.find((o) => o.chaveSistema === "dia-das-maes")?.dia).toBe("2027-05-09");
  });

  it("o segmento traz as datas dele; a mesma data em dois segmentos aparece UMA vez com os dois nomes", () => {
    const lista = montarOcorrencias({ ...base, segmentos: ["feminina", "plus-size"], ocultas: [] });
    const outono = lista.filter((o) => o.chaveSistema === "estacao-outono");
    expect(outono).toHaveLength(1);
    expect(outono[0].tipo).toBe("OPORTUNIDADE");
    expect(outono[0].segmentos).toEqual(["Moda feminina", "Plus size"]);
  });

  it("segmento que não existe é ignorado (o que vem do banco ou da tela é conferido)", () => {
    expect(segmentosValidos(["praia", "inventado", "praia"])).toEqual(["praia"]);
    const lista = montarOcorrencias({ ...base, segmentos: ["inventado"], ocultas: [] });
    expect(lista.some((o) => o.tipo === "OPORTUNIDADE")).toBe(false);
  });

  it("data escondida some de todos os anos", () => {
    const lista = montarOcorrencias({ ...base, ate: "2028-12-31", segmentos: [], ocultas: ["natal"] });
    expect(lista.some((o) => o.chaveSistema === "natal")).toBe(false);
  });

  it("a anotação pendura na data do sistema DAQUELE ano, e a data da loja entra pelo dia", () => {
    const eventos: EventoGravado[] = [
      {
        id: "an1", tipo: "COMERCIAL", titulo: "Black Friday", dia: "2026-11-27",
        antecedenciaDias: 60, notas: "kits", chaveSistema: "black-friday", ano: 2026, avisadoEm: null,
        tarefas: [{ id: "t1", texto: "fotos", feita: true, feitaPorNome: "Ana" }],
      },
      {
        id: "l1", tipo: "LANCAMENTO", titulo: "Coleção Verão", dia: "2026-11-10",
        antecedenciaDias: null, notas: "", chaveSistema: null, ano: null, avisadoEm: null, tarefas: [],
      },
      {
        id: "fora", tipo: "LANCAMENTO", titulo: "Muito longe", dia: "2028-01-10",
        antecedenciaDias: null, notas: "", chaveSistema: null, ano: null, avisadoEm: null, tarefas: [],
      },
    ];
    const lista = montarOcorrencias({ ...base, segmentos: [], ocultas: [], eventos });
    const bf = lista.find((o) => o.id === "sis:black-friday:2026")!;
    expect(bf.eventoId).toBe("an1");
    expect(bf.antecedenciaPropria).toBe(60);
    expect(bf.tarefas).toHaveLength(1);
    expect(lista.find((o) => o.id === "loja:l1")?.tipo).toBe("LANCAMENTO");
    expect(lista.some((o) => o.id === "loja:fora")).toBe(false);
    // em ordem de dia
    const dias = lista.map((o) => o.dia);
    expect([...dias].sort()).toEqual(dias);
  });
});

describe("RN-092 · antecedência: quando começar", () => {
  const bf = { dia: "2026-11-27", antecedenciaPropria: null };

  it("vale a da loja, e a da data quando ela tem a sua", () => {
    expect(inicioDe(bf, 45)).toBe("2026-10-13");
    expect(inicioDe({ ...bf, antecedenciaPropria: 60 }, 45)).toBe("2026-09-28");
    expect(inicioDe({ ...bf, antecedenciaPropria: 0 }, 45)).toBe("2026-11-27");
  });

  it("em breve → hora de começar → é hoje → passou", () => {
    expect(situacaoDe(bf, 45, "2026-10-01")).toBe("em-breve");
    expect(situacaoDe(bf, 45, "2026-10-13")).toBe("agora");
    expect(situacaoDe(bf, 45, "2026-11-27")).toBe("hoje");
    expect(situacaoDe(bf, 45, "2026-11-28")).toBe("passou");
  });

  it("o lembrete sai UMA vez: só quem está na janela e ainda não foi avisado", () => {
    const lista = montarOcorrencias({ de: "2026-10-23", ate: "2027-10-24", segmentos: [], ocultas: [], eventos: [] });
    const avisar = paraAvisar(lista, 45, "2026-10-23").map((o) => o.chaveSistema);
    // Black Friday (27/11) entrou nos 45 dias; Natal (25/12) ainda não
    expect(avisar).toContain("black-friday");
    expect(avisar).not.toContain("natal");
    const jaAvisada = lista.map((o) => (o.chaveSistema === "black-friday" ? { ...o, avisadoEm: "2026-10-13T12:00:00Z" } : o));
    expect(paraAvisar(jaAvisada, 45, "2026-10-23").map((o) => o.chaveSistema)).not.toContain("black-friday");
  });

  it("o texto do lembrete diz o que é e quanto falta; várias viram resumo", () => {
    const um = textoDoLembrete([{ titulo: "Black Friday", dia: "2026-11-27" }], "2026-10-23");
    expect(um.title).toBe("📅 Hora de começar: Black Friday");
    expect(um.body).toContain("faltam 35 dias");
    const varias = textoDoLembrete(
      [
        { titulo: "A", dia: "2026-11-01" },
        { titulo: "B", dia: "2026-11-02" },
        { titulo: "C", dia: "2026-11-03" },
        { titulo: "D", dia: "2026-11-04" },
      ],
      "2026-10-23"
    );
    expect(varias.title).toBe("📅 4 datas chegando");
    expect(varias.body).toContain("e mais 1");
  });

  it("a tela mostra do 1º dia do mês até o fim do 12º mês; o lembrete olha um ano à frente", () => {
    expect(intervaloDaTela("2026-10-23")).toEqual({ de: "2026-10-01", ate: "2027-09-30" });
    expect(intervaloDaTela("2026-01-31")).toEqual({ de: "2026-01-01", ate: "2026-12-31" });
    // o lembrete olha a MESMA janela da tela: nunca aponta para data invisível
    expect(janelaDoLembrete("2026-10-23")).toEqual({ de: "2026-10-23", ate: "2027-09-30" });
  });

  it("data da loja fora da janela da tela é recusada com a frase do caminho", () => {
    expect(foraDaJanela("2026-10-01", "2026-10-23")).toBeNull();
    expect(foraDaJanela("2027-09-30", "2026-10-23")).toBeNull();
    expect(foraDaJanela("2026-09-30", "2026-10-23")).toContain("começa em 01/10/2026");
    expect(foraDaJanela("2027-10-01", "2026-10-23")).toContain("mostra até 30/09/2027");
  });
});

describe("RN-092 · módulo com chave, só gerência", () => {
  // a entrada DE VERDADE do menu (app-shell), não um objeto montado no teste:
  // tirar a chave ou o "só gerência" de lá tem que derrubar este teste
  const linha = ler("src/components/app-shell.tsx")
    .split("\n")
    .find((l) => l.includes('href: "/calendario"'))!;
  const item: ItemDoMenu = {
    href: "/calendario",
    calendarioOnly: /calendarioOnly: true/.test(linha),
    managerOnly: /managerOnly: true/.test(linha),
    supportHidden: /supportHidden: true/.test(linha),
  };

  it("o menu só mostra com a chave da loja e para a gerência", () => {
    expect(linha).toBeTruthy();
    expect(itemVisivel(item, { role: "ADMIN", calendarioEnabled: true })).toBe(true);
    expect(itemVisivel(item, { role: "MANAGER", calendarioEnabled: true })).toBe(true);
    expect(itemVisivel(item, { role: "SELLER", calendarioEnabled: true })).toBe(false);
    expect(itemVisivel(item, { role: "SUPPORT", calendarioEnabled: true })).toBe(false);
    expect(itemVisivel(item, { role: "ADMIN", calendarioEnabled: false })).toBe(false);
  });

  it("o catálogo de módulos conhece a chave e ainda não tem preço (o dono define)", () => {
    const m = MODULOS.find((x) => x.key === "CALENDARIO");
    expect(m?.flag).toBe("calendarioEnabled");
    expect(m?.precoTabela).toBe(0);
  });

  it("toda rota do calendário passa pela porteira, handler por handler", () => {
    const pasta = join(raiz, "src/app/api/calendario");
    const arquivos: string[] = [];
    const andar = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) andar(p);
        else if (n === "route.ts") arquivos.push(p);
      }
    };
    andar(pasta);
    expect(arquivos.length).toBeGreaterThanOrEqual(4);
    for (const arq of arquivos) {
      const src = readFileSync(arq, "utf8");
      const handlers = [...src.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)\b/g)];
      expect(handlers.length, arq).toBeGreaterThan(0);
      for (const h of handlers) {
        const corpo = src.slice(h.index!, src.indexOf("\n}\n", h.index!));
        expect(corpo, `${arq} ${h[1]}`).toContain("comPorteira(");
      }
    }
  });

  it("o lembrete só roda com a chave ligada: ela é condição da própria trava", () => {
    const agora = new Date("2026-10-23T15:00:00Z");
    const onde = ondeTomarATrava("loja-1", agora);
    expect(onde).toMatchObject({ id: "loja-1", calendarioEnabled: true });
    // e a trava dura 6 h
    const limite = (onde.OR[1] as { calendarioAvisoRunAt: { lt: Date } }).calendarioAvisoRunAt.lt;
    expect(agora.getTime() - limite.getTime()).toBe(6 * 60 * 60 * 1000);
  });
});
