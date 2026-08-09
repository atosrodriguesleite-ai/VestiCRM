import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  abaDaTarefa,
  contarPorAba,
  ordenarTarefas,
  tarefasDaAba,
  casaTarefa,
} from "../agenda";

/**
 * "MARCO A TAREFA COMO CONCLUÍDA E ELA CONTINUA ATRASADA."
 *
 * Relato do dono (07/08/2026). O banco NÃO era o problema — reproduzido
 * localmente, a rota grava CONCLUIDA certinho. O problema era a tela:
 *
 *   const [tasks, setTasks] = useState(initialTasks)
 *
 * Isso guarda a lista UMA VEZ e nunca mais olha para o servidor. Quando o
 * salvamento falhava, o código chamava `router.refresh()` para trazer a
 * verdade de volta — e a tela IGNORAVA, porque `useState` não reage a
 * prop nova. A tarefa ficava verde na tela, PENDENTE no banco, e no dia
 * seguinte reaparecia atrasada. Ninguém era avisado de nada.
 *
 * Duas coisas foram feitas: a lista voltou a acreditar no servidor, e o
 * erro de salvamento passou a aparecer (com "Desfazer").
 */

const t = (
  id: string,
  dueAt: string,
  over: Partial<Parameters<typeof abaDaTarefa>[0]> = {}
) => ({
  id,
  title: `Tarefa ${id}`,
  dueAt,
  priority: "MEDIA",
  status: "PENDENTE",
  customer: null,
  ...over,
});

const AGORA = new Date("2026-08-07T15:00:00-03:00");

describe("em que aba cada tarefa mora", () => {
  it("vencida ontem é ATRASADA", () => {
    expect(abaDaTarefa(t("a", "2026-08-06T23:59:00-03:00"), AGORA)).toBe("atrasadas");
  });

  it("vence hoje mais tarde é HOJE", () => {
    expect(abaDaTarefa(t("a", "2026-08-07T23:59:00-03:00"), AGORA)).toBe("hoje");
  });

  it("vence amanhã é PRÓXIMA", () => {
    expect(abaDaTarefa(t("a", "2026-08-08T09:00:00-03:00"), AGORA)).toBe("proximas");
  });

  it("CONCLUÍDA sai de atrasada mesmo vencida — é o coração do relato", () => {
    const vencida = t("a", "2026-08-01T09:00:00-03:00", { status: "CONCLUIDA" });
    expect(abaDaTarefa(vencida, AGORA)).toBe("concluidas");
    expect(abaDaTarefa(vencida, AGORA)).not.toBe("atrasadas");
  });

  it("CANCELADA também não fica em Atrasadas (achado de revisão)", () => {
    // a API aceita CANCELADA; sem esta regra a tarefa cancelada ficava
    // eternamente vermelha na lista, parecendo pendente
    const cancelada = t("a", "2026-08-01T09:00:00-03:00", { status: "CANCELADA" });
    expect(abaDaTarefa(cancelada, AGORA)).not.toBe("atrasadas");
  });

  it("cada tarefa mora em UMA aba só (nada aparece em duas nem some)", () => {
    const lista = [
      t("a", "2026-08-01T09:00:00-03:00"),
      t("b", "2026-08-07T20:00:00-03:00"),
      t("c", "2026-08-20T09:00:00-03:00"),
      t("d", "2026-08-01T09:00:00-03:00", { status: "CONCLUIDA" }),
    ];
    const c = contarPorAba(lista, AGORA);
    expect(c.atrasadas + c.hoje + c.proximas + c.concluidas).toBe(lista.length);
    expect(c).toEqual({ atrasadas: 1, hoje: 1, proximas: 1, concluidas: 1 });
  });
});

describe("ordem: o que não pode esperar primeiro", () => {
  it("ALTA vem antes de MÉDIA e BAIXA", () => {
    const r = ordenarTarefas([
      t("baixa", "2026-08-01T09:00:00-03:00", { priority: "BAIXA" }),
      t("alta", "2026-08-06T09:00:00-03:00", { priority: "ALTA" }),
      t("media", "2026-08-02T09:00:00-03:00", { priority: "MEDIA" }),
    ]);
    expect(r.map((x) => x.id)).toEqual(["alta", "media", "baixa"]);
  });

  it("dentro da mesma prioridade, a mais antiga primeiro", () => {
    const r = ordenarTarefas([
      t("nova", "2026-08-06T09:00:00-03:00", { priority: "ALTA" }),
      t("velha", "2026-08-01T09:00:00-03:00", { priority: "ALTA" }),
    ]);
    expect(r.map((x) => x.id)).toEqual(["velha", "nova"]);
  });

  it("não mexe na lista original", () => {
    const lista = [t("a", "2026-08-06T09:00:00-03:00"), t("b", "2026-08-01T09:00:00-03:00")];
    ordenarTarefas(lista);
    expect(lista.map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("a lupa da agenda", () => {
  const comCliente = (id: string, nome: string, titulo: string) => ({
    ...t(id, "2026-08-01T09:00:00-03:00"),
    title: titulo,
    customer: { name: nome },
  });

  it("acha pelo nome da cliente, sem acento", () => {
    const tarefa = comCliente("a", "Alaúte", "Follow-up");
    expect(casaTarefa(tarefa, "alaute")).toBe(true);
  });

  it("acha pelo título", () => {
    expect(casaTarefa(comCliente("a", "Ana", "Cobrar o Pix"), "pix")).toBe(true);
  });

  it("busca vazia não esconde nada", () => {
    expect(casaTarefa(t("a", "2026-08-01T09:00:00-03:00"), "  ")).toBe(true);
  });

  it("a busca NÃO muda a contagem das abas (senão o número mente)", () => {
    const lista = [
      comCliente("a", "Ana", "Chamar"),
      comCliente("b", "Bia", "Chamar"),
    ];
    expect(contarPorAba(lista, AGORA).atrasadas).toBe(2);
    expect(tarefasDaAba(lista, "atrasadas", "ana", AGORA)).toHaveLength(1);
  });
});

describe("a tela voltou a acreditar no servidor", () => {
  const tela = readFileSync(
    join(process.cwd(), "src/app/(app)/tarefas/task-board.tsx"),
    "utf8"
  );

  it("a lista se refaz quando o servidor manda dado novo", () => {
    // sem isto, `router.refresh()` não conserta nada na tela — foi o bug
    expect(/useEffect\(\(\) => \{\s*setTasks\(initialTasks\);\s*\}, \[initialTasks\]\)/.test(tela)).toBe(
      true
    );
  });

  it("salvamento que falha VOLTA ATRÁS na tela e avisa", () => {
    expect(/aplicar\(antes\)/.test(tela)).toBe(true);
    expect(tela).toContain("A tarefa continua em aberto.");
    // silêncio é o pecado que já causou incidente nesta casa
    expect(/if \(!res\.ok\) router\.refresh\(\);/.test(tela)).toBe(false);
  });

  it("concluir tem DESFAZER (clique errado não vira caçada)", () => {
    expect(/desfazer/.test(tela)).toBe(true);
  });

  it("o alvo de toque da bolinha cabe num dedo", () => {
    // 20px era menor que o mínimo de 44px: no celular o toque errava e
    // "concluir" simplesmente não acontecia, sem reação nenhuma
    expect(/className="size-11 -m-1\.5 flex items-center justify-center shrink-0/.test(tela)).toBe(
      true
    );
  });

  it("dá para concluir em massa (162 atrasadas não se limpam uma a uma)", () => {
    expect(/concluirSelecionadas/.test(tela)).toBe(true);
    const rota = readFileSync(
      join(process.cwd(), "src/app/api/tasks/bulk/route.ts"),
      "utf8"
    );
    // a régua de quem pode mexer é a MESMA da tela
    expect(/taskScope\(user\)/.test(rota)).toBe(true);
    expect(/\.max\(500\)/.test(rota)).toBe(true);
  });
});
