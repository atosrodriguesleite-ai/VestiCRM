// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FONTE_TELA_ABERTURA,
  ID_DO_VIGIA,
  ID_FIM_DA_PAGINA,
  MS_ENTRE_CONFERENCIAS,
  PRAZO_BRANCO_MS,
  PRAZO_DE_VIGIA_MS,
  PRAZO_INCOMPLETO_MS,
  SCRIPT_DO_VIGIA,
  SELETOR_DO_ESQUELETO,
  scriptDoVigiaEhSeguro,
} from "../vigia-da-abertura";
import { CHAVE_RELATO_PENDENTE, EVENTO_RELATO_GUARDADO } from "../erro-da-tela";

// Guarda RN-095
/**
 * A ABERTURA QUE NÃO TERMINA NÃO FICA BRANCA.
 *
 * Relato do dono (23/10/2026): "entra no aplicativo e a tela fica toda
 * branca" (Starlink no carro) — a segunda cliente. Reproduzido na bancada:
 * a página cortada entre o <head> e o esqueleto de carregamento fica em
 * branco para sempre, sem erro e sem botão, porque o JavaScript que
 * mostraria a tela de socorro (RN-066) nunca chegou.
 *
 * O vigia é um script miúdo nos PRIMEIROS bytes da página. Aqui ele roda de
 * verdade, num documento do jsdom, com o relógio falso — o que se prova é
 * QUANDO ele fala (só com certeza de página incompleta) e quando fica
 * quieto (página inteira, página lenta mas pintando).
 */

const raiz = join(__dirname, "..", "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

let recarregar: ReturnType<typeof vi.fn>;
let readyState: DocumentReadyState;

/**
 * Roda o script como a página o entrega: texto solto dentro de <script>.
 * O ouvinte de `load` é capturado (e devolvido) em vez de ficar preso na
 * janela compartilhada do jsdom — senão o `load` de um teste acordaria os
 * vigias de todos os testes anteriores.
 */
function rodarVigia() {
  const original = window.addEventListener;
  const originalDoc = document.addEventListener;
  let aoCarregar: (() => void) | null = null;
  let aoTerminarParser: (() => void) | null = null;
  window.addEventListener = ((tipo: string, ouvinte: EventListener, opcoes?: unknown) => {
    if (tipo === "load") {
      aoCarregar = ouvinte as () => void;
      return;
    }
    return original.call(window, tipo, ouvinte, opcoes as AddEventListenerOptions);
  }) as typeof window.addEventListener;
  document.addEventListener = ((tipo: string, ouvinte: EventListener, opcoes?: unknown) => {
    if (tipo === "DOMContentLoaded") {
      aoTerminarParser = ouvinte as () => void;
      return;
    }
    return originalDoc.call(document, tipo, ouvinte, opcoes as AddEventListenerOptions);
  }) as typeof document.addEventListener;
  try {
    new Function(SCRIPT_DO_VIGIA)();
  } finally {
    window.addEventListener = original;
    document.addEventListener = originalDoc;
  }
  return { load: () => aoCarregar?.(), parserTerminou: () => aoTerminarParser?.() };
}
function marcadorDeFim() {
  const s = document.createElement("span");
  s.id = ID_FIM_DA_PAGINA;
  s.hidden = true;
  document.body.appendChild(s);
  return s;
}
function esqueleto() {
  const d = document.createElement("div");
  d.setAttribute("aria-busy", "true");
  d.setAttribute("aria-label", "Carregando");
  document.body.appendChild(d);
  return d;
}
/** no jsdom nada tem tamanho; isto dá tamanho (e texto) a UM elemento, como na tela */
function visivel(el: HTMLElement, texto = "Pedidos") {
  Object.defineProperty(el, "offsetWidth", { configurable: true, get: () => 200 });
  Object.defineProperty(el, "offsetHeight", { configurable: true, get: () => 40 });
  if (texto) el.textContent = texto;
  return el;
}
function vigia() {
  return document.getElementById(ID_DO_VIGIA);
}
/** quantas vezes o vigia pediu o próximo tique (setTimeout com o intervalo dele) */
function contarTiques() {
  const espiao = vi.spyOn(globalThis, "setTimeout");
  return () => espiao.mock.calls.filter((c) => c[1] === MS_ENTRE_CONFERENCIAS).length;
}
function relato(): Record<string, unknown> | null {
  const t = window.localStorage.getItem(CHAVE_RELATO_PENDENTE);
  return t ? (JSON.parse(t) as Record<string, unknown>) : null;
}
function comInternet(sim: boolean) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => sim });
}

beforeEach(() => {
  vi.useFakeTimers();
  recarregar = vi.fn();
  readyState = "loading";
  Object.defineProperty(document, "readyState", { configurable: true, get: () => readyState });
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { pathname: "/pedidos/482", href: "https://www.atacadopro.com/pedidos/482?c=SEGREDO", reload: recarregar },
  });
  comInternet(true);
  document.body.innerHTML = "";
  window.localStorage.clear();
  // o relógio falso herda temporizadores do ambiente; os testes que contam
  // temporizadores medem a DIFERENÇA, e aqui se parte do zero
  vi.clearAllTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("o script em si", () => {
  it("vai inteiro dentro de uma tag <script>: sem `</script`, crase ou ${", () => {
    expect(scriptDoVigiaEhSeguro(SCRIPT_DO_VIGIA)).toBe(true);
    expect(scriptDoVigiaEhSeguro("x</script>y")).toBe(false);
    expect(scriptDoVigiaEhSeguro("x`y")).toBe(false);
  });

  it("carrega as constantes da lib (marcador, aviso, prazos, esqueleto, chave do relato)", () => {
    expect(SCRIPT_DO_VIGIA).toContain(`"${ID_FIM_DA_PAGINA}"`);
    expect(SCRIPT_DO_VIGIA).toContain(`"${ID_DO_VIGIA}"`);
    expect(SCRIPT_DO_VIGIA).toContain(`"${CHAVE_RELATO_PENDENTE}"`);
    expect(SCRIPT_DO_VIGIA).toContain(`PRAZO_BRANCO=${PRAZO_BRANCO_MS}`);
    expect(SCRIPT_DO_VIGIA).toContain(`PRAZO_INCOMPLETO=${PRAZO_INCOMPLETO_MS}`);
    expect(SCRIPT_DO_VIGIA).toContain(SELETOR_DO_ESQUELETO);
  });

  it("o esqueleto que ele procura é o do app", () => {
    const loading = ler("src/app/(app)/loading.tsx");
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain('aria-label="Carregando"');
  });

  it("é JavaScript antigo: sem const/let/arrow, para o Safari velho abrir a página", () => {
    expect(SCRIPT_DO_VIGIA).not.toMatch(/\b(const|let)\s/);
    expect(SCRIPT_DO_VIGIA).not.toContain("=>");
  });
});

describe("quando ele FICA QUIETO", () => {
  it("página inteira (marcador presente, sem esqueleto): nada, nem relato", () => {
    rodarVigia();
    marcadorDeFim();
    readyState = "complete";
    vi.advanceTimersByTime(PRAZO_INCOMPLETO_MS + 30_000);
    expect(vigia()).toBeNull();
    expect(relato()).toBeNull();
  });

  it("página lenta mas PINTANDO (algo visível, download parado há pouco): não incomoda antes do prazo longo", () => {
    rodarVigia();
    visivel(document.body.appendChild(document.createElement("div")));
    vi.advanceTimersByTime(PRAZO_INCOMPLETO_MS - 2_000);
    expect(vigia()).toBeNull();
  });

  it("download LENTO mas andando (nós chegando a cada tique) não é 'parou': nada em 12 s nem em 40 s", () => {
    rodarVigia();
    for (let t = 0; t < PRAZO_INCOMPLETO_MS + 10_000; t += 2_000) {
      document.body.appendChild(document.createElement("div")); // mais um pedaço chegou
      vi.advanceTimersByTime(2_000);
    }
    expect(vigia()).toBeNull();
    expect(relato()).toBeNull();
  });

  it("depois que a página chegou INTEIRA ele se cala: o esqueleto da navegação seguinte e a tela de socorro não são com ele", () => {
    rodarVigia();
    const marcador = marcadorDeFim();
    vi.advanceTimersByTime(2_000); // viu a página inteira: acabou
    // a navegação seguinte mostra o esqueleto por muito tempo
    esqueleto();
    vi.advanceTimersByTime(PRAZO_INCOMPLETO_MS + 10_000);
    expect(vigia()).toBeNull();
    // a tela de socorro da RN-066 troca o corpo e leva o marcador junto
    marcador.remove();
    readyState = "complete";
    vi.advanceTimersByTime(PRAZO_INCOMPLETO_MS + 10_000);
    expect(vigia()).toBeNull();
    expect(relato()).toBeNull();
  });

  it("um contêiner VAZIO com altura não é 'algo visível' — é a própria tela branca", () => {
    rodarVigia();
    visivel(document.body.appendChild(document.createElement("div")), "");
    readyState = "complete";
    vi.advanceTimersByTime(2_000);
    expect(vigia()).not.toBeNull();
  });

  it("download em curso há pouco tempo, ainda sem nada: espera (não é página quebrada)", () => {
    rodarVigia();
    vi.advanceTimersByTime(PRAZO_BRANCO_MS - 2_000);
    expect(vigia()).toBeNull();
  });
});

describe("quando ele FALA", () => {
  it("a página terminou (load) SEM o marcador e sem nada na tela: é a cortada — aviso na hora, com botão", () => {
    rodarVigia();
    readyState = "complete";
    vi.advanceTimersByTime(2_000);
    const v = vigia();
    expect(v).not.toBeNull();
    expect(v!.textContent).toContain("não terminou de carregar");
    expect(v!.textContent).toContain("Nada se perdeu");
    const botao = v!.querySelector("button")!;
    expect(botao.textContent).toBe("Tentar de novo");
    expect(recarregar).not.toHaveBeenCalled(); // com internet NUNCA recarrega sozinho
    botao.click();
    expect(recarregar).toHaveBeenCalledTimes(1);
  });

  it("download PARADO (nenhum nó novo) e nada visível: aviso no prazo curto", () => {
    rodarVigia();
    vi.advanceTimersByTime(PRAZO_BRANCO_MS - 2_000);
    expect(vigia()).toBeNull();
    vi.advanceTimersByTime(2_000);
    expect(vigia()).not.toBeNull();
    expect(relato()?.mensagem).toContain("o download parou no meio");
  });

  it("download parado mesmo com algo na tela: aviso no prazo longo", () => {
    visivel(document.body.appendChild(document.createElement("div")));
    rodarVigia();
    vi.advanceTimersByTime(PRAZO_INCOMPLETO_MS);
    expect(vigia()).not.toBeNull();
    expect(relato()?.mensagem).toContain("o download parou no meio");
  });

  it("download que anda mas NUNCA termina: aviso no fim do prazo de vigia", () => {
    rodarVigia();
    for (let t = 0; t < PRAZO_DE_VIGIA_MS; t += 2_000) {
      document.body.appendChild(document.createElement("div"));
      vi.advanceTimersByTime(2_000);
    }
    expect(vigia()).not.toBeNull();
    expect(relato()?.mensagem).toContain("o download não terminou");
  });

  it("esqueleto chegou e a tela ficou PRESA nele: aviso no prazo longo contado DO ESQUELETO — e some se a tela chegar", () => {
    rodarVigia();
    const esq = esqueleto();
    marcadorDeFim();
    // o esqueleto é visto na 1ª conferência (2 s); o prazo conta dali
    vi.advanceTimersByTime(PRAZO_INCOMPLETO_MS);
    expect(vigia()).toBeNull();
    vi.advanceTimersByTime(2_000);
    expect(vigia()).not.toBeNull();
    expect(relato()?.mensagem).toContain("presa no carregando");
    // a tela chega (o esqueleto sai): o aviso some sozinho
    esq.remove();
    vi.advanceTimersByTime(2_000);
    expect(vigia()).toBeNull();
  });

  it("a página que chega DEPOIS do aviso apaga o aviso", () => {
    rodarVigia();
    readyState = "complete";
    vi.advanceTimersByTime(2_000);
    expect(vigia()).not.toBeNull();
    marcadorDeFim();
    vi.advanceTimersByTime(2_000);
    expect(vigia()).toBeNull();
  });

  it("aviso uma vez só, com um botão só — mesmo com o `load` chegando no meio", () => {
    const v = rodarVigia();
    readyState = "complete";
    v.load();
    expect(vigia()).not.toBeNull(); // o `load` confere na hora, sem esperar o tique
    vi.advanceTimersByTime(10_000);
    expect(document.querySelectorAll(`#${ID_DO_VIGIA}`)).toHaveLength(1);
    expect(document.querySelectorAll("button")).toHaveLength(1);
  });

  it("o parser terminou ('interactive') sem o marcador: já é certeza, sem esperar o `load`", () => {
    rodarVigia();
    readyState = "interactive";
    vi.advanceTimersByTime(2_000);
    expect(vigia()).not.toBeNull();
    expect(relato()?.mensagem).toContain("a página chegou cortada");
  });

  it("a página chegou inteira e QUEBROU na hidratação antes do 1º tique: o parser terminar já a marca como 'chegou'", () => {
    const v = rodarVigia();
    const marcador = marcadorDeFim();
    v.parserTerminou(); // DOMContentLoaded: o marcador está lá
    // a tela de socorro da RN-066 troca o corpo e leva o marcador, ainda antes de 2 s
    marcador.remove();
    visivel(document.body.appendChild(document.createElement("p")), "Algo deu errado nesta tela");
    readyState = "complete";
    vi.advanceTimersByTime(PRAZO_INCOMPLETO_MS + 10_000);
    expect(vigia()).toBeNull();
    expect(relato()).toBeNull();
  });

  it("o `load` não abre um segundo relógio: um laço só", () => {
    // (o jsdom também agenda temporizadores ao gravar no localStorage, então
    // o que se conta aqui é quantas vezes o VIGIA pediu o próximo tique)
    const agendamentos = contarTiques();
    const v = rodarVigia();
    v.load();
    v.load();
    expect(agendamentos()).toBe(1);
    vi.advanceTimersByTime(2_000);
    expect(agendamentos()).toBe(2); // um por tique, nunca dois
  });

  it("o aviso na tela some quando a página termina de chegar depois, e aí ele para de olhar", () => {
    const agendamentos = contarTiques();
    rodarVigia();
    readyState = "complete";
    vi.advanceTimersByTime(2_000);
    expect(vigia()).not.toBeNull();
    vi.advanceTimersByTime(PRAZO_DE_VIGIA_MS * 2); // segue olhando enquanto o aviso está na tela
    expect(agendamentos()).toBeGreaterThan(PRAZO_DE_VIGIA_MS / 2_000);
    marcadorDeFim();
    vi.advanceTimersByTime(2_000);
    expect(vigia()).toBeNull();
    const depoisDeParar = agendamentos();
    vi.advanceTimersByTime(60_000);
    expect(agendamentos()).toBe(depoisDeParar); // parou de olhar
    // a página se recuperou: não fica no painel como "não terminou"
    expect(relato()).toBeNull();
  });
});

describe("sem internet", () => {
  it("diz que é a conexão, mostra o botão mesmo assim e recarrega UMA vez quando a internet volta", () => {
    comInternet(false);
    rodarVigia();
    readyState = "complete";
    vi.advanceTimersByTime(2_000);
    const v = vigia()!;
    expect(v.textContent).toContain("Sem conexão com a internet");
    expect(v.querySelector("button")).not.toBeNull();
    expect(recarregar).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("online"));
    expect(recarregar).toHaveBeenCalledTimes(1);
  });
});

describe("o relato ao painel de Saúde (pelo caminho da RN-066)", () => {
  it("tem o formato do relato da tela, a marca de abertura e SÓ o primeiro pedaço do caminho", () => {
    rodarVigia();
    readyState = "complete";
    vi.advanceTimersByTime(2_000);
    const r = relato()!;
    expect(r.abertura).toBe(true);
    expect(r.versaoVelha).toBe(false);
    expect(r.recarregouSozinho).toBe(false);
    expect(typeof r.id).toBe("string");
    expect((r.id as string).length).toBeGreaterThanOrEqual(8);
    expect(r.caminho).toBe("/pedidos"); // nunca o id do pedido, nunca a busca
    expect(r.mensagem).toContain("a página chegou cortada");
    expect(r.mensagem).toContain("com internet");
    expect(r.detalhe).toContain("readyState: complete");
    expect(typeof r.quando).toBe("string");
  });

  it("a recuperação apaga SÓ o relato do vigia — o de quebra de código guardado no meio fica", () => {
    rodarVigia();
    readyState = "complete";
    vi.advanceTimersByTime(2_000);
    expect(relato()?.abertura).toBe(true);
    // uma quebra de verdade gravada por cima enquanto o aviso estava na tela
    window.localStorage.setItem(CHAVE_RELATO_PENDENTE, JSON.stringify({ id: "quebra-de-verdade" }));
    marcadorDeFim();
    vi.advanceTimersByTime(2_000);
    expect(relato()?.id).toBe("quebra-de-verdade");
  });

  it("avisa quem manda o relato na hora em que ele é guardado (o evento da RN-066)", () => {
    const ouvinte = vi.fn();
    window.addEventListener(EVENTO_RELATO_GUARDADO, ouvinte, { once: true });
    rodarVigia();
    readyState = "complete";
    vi.advanceTimersByTime(2_000);
    expect(ouvinte).toHaveBeenCalledTimes(1);
  });

  it("não sobrescreve um relato de QUEBRA DE CÓDIGO que ainda espera para sair", () => {
    window.localStorage.setItem(CHAVE_RELATO_PENDENTE, JSON.stringify({ id: "quebra-de-verdade" }));
    rodarVigia();
    readyState = "complete";
    vi.advanceTimersByTime(2_000);
    expect(vigia()).not.toBeNull(); // o aviso aparece do mesmo jeito
    expect(relato()?.id).toBe("quebra-de-verdade");
  });

  it("a fonte própria no painel existe e é a do vigia", () => {
    expect(FONTE_TELA_ABERTURA).toBe("tela.abertura");
  });
});

describe("onde ele mora (guardas de código)", () => {
  it("é o PRIMEIRO filho do <body> do layout raiz, e o marcador é o ÚLTIMO", () => {
    const layout = ler("src/app/layout.tsx");
    const corpo = layout.slice(layout.indexOf("<body"), layout.indexOf("</body>"));
    const primeiroFilho = corpo.slice(corpo.indexOf(">") + 1).replace(/\{\/\*[\s\S]*?\*\/\}/g, "").trim();
    expect(primeiroFilho.startsWith("<script dangerouslySetInnerHTML={{ __html: SCRIPT_DO_VIGIA }} />")).toBe(true);
    const filhos = primeiroFilho.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").trim();
    expect(filhos.endsWith("<span id={ID_FIM_DA_PAGINA} hidden />")).toBe(true);
  });

  it("o service worker é registrado para toda a equipe logada, e só lá", () => {
    expect(ler("src/app/(app)/layout.tsx")).toContain("<RegistrarServiceWorker />");
    expect(ler("src/app/layout.tsx")).not.toContain("RegistrarServiceWorker");
  });

  it("o service worker: rede primeiro, reserva SÓ quando a rede falha, só navegação, nenhum cache", () => {
    const sw = ler("public/sw.js");
    expect(sw).toContain('if (req.mode !== "navigate") return;');
    expect(sw).toContain("daRede.catch(");
    // a navegação sai em paralelo com a partida do worker
    expect(sw).toContain("navigationPreload.enable()");
    expect(sw).toContain("event.preloadResponse");
    // link de download (/api/img?baixar=1, PDF do catálogo) não recebe a reserva como arquivo
    expect(sw).toContain('if (caminho.indexOf("/api/") === 0) return;');
    // guardar página seria "versão velha servida pelo service worker" — e a
    // página de reserva guardada precisaria do React para o botão funcionar
    expect(sw).not.toMatch(/\bcaches\b/);
    expect(sw).not.toContain("cache.put(");
    expect(sw).not.toContain("cache.add(");
    // a reserva mora no próprio arquivo, com os botões escritos nela
    expect(sw).toContain("var HTML_SEM_CONEXAO");
    expect(sw).toContain('onclick="location.reload()"');
    expect(sw).toContain("addEventListener('online'");
    expect(sw).toContain("Sem conexão com a internet");
    // as notificações de venda continuam
    expect(sw).toContain('self.addEventListener("push"');
    expect(sw).toContain('self.addEventListener("notificationclick"');
  });

  it("a página de reserva do service worker é HTML inteiro, sem crase e sem depender de nada", () => {
    const sw = ler("public/sw.js");
    const inicio = sw.indexOf("var HTML_SEM_CONEXAO");
    const fim = sw.indexOf('self.addEventListener("install"');
    const reserva = sw.slice(inicio, fim);
    expect(reserva).toContain("<!doctype html>");
    expect(reserva).toContain('<meta name="viewport"');
    expect(reserva).not.toContain("/_next/");
    expect(reserva).not.toContain("<link");
  });

  it("a Saúde e a Gestão deixam a fonte de abertura fora da conta de erros", () => {
    for (const p of ["src/app/(app)/saude/page.tsx", "src/app/(app)/gestao/page.tsx"]) {
      const texto = ler(p);
      expect(texto).toContain("FONTE_TELA_ABERTURA");
      const notIns = texto.match(/notIn: \[[^\]]*\]/g) ?? [];
      expect(notIns.length).toBeGreaterThan(0);
      for (const n of notIns) expect(n).toContain("FONTE_TELA_ABERTURA");
    }
  });
});
