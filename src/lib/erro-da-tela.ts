/**
 * RN-065 · A TELA QUE QUEBROU SE RECUPERA — E CONTA O QUE HOUVE.
 *
 * Relato do dono (20/09/2026, print do iPhone): *"quando o aplicativo fica
 * muito tempo aberto e volto nele dá esse erro"* — a tela crua do Next,
 * em inglês: "Application error: a client-side exception has occurred".
 * O app não tinha tela de erro nenhuma: qualquer tropeço no navegador
 * derrubava a página inteira e deixava a lojista num beco sem botão.
 *
 * Aqui mora só a REGRA (pura, sem React e sem navegador — é o que o teste
 * alcança). Quem aplica é `components/tela-de-erro.tsx`.
 *
 * Três decisões:
 *
 *  1. **Versão velha recarrega SOZINHA — com trava.** Toda entrega vira
 *     versão nova em ~3 min; o aparelho que ficou aberto segue na antiga e,
 *     ao pedir um pedaço de código que só existia nela, o servidor não tem
 *     mais. A cura é recarregar. Mas uma tela que recarrega sozinha, se o
 *     motivo não for esse, entra em LOOP e o sistema fica inutilizável —
 *     então a trava tem DOIS degraus, por aba: no máximo uma recarga por
 *     `MS_ENTRE_RECARGAS` E no máximo `MAX_RECARGAS_NA_JANELA` dentro de
 *     `MS_JANELA_DE_RECARGAS`. Só o primeiro não bastava (achado da
 *     revisão): uma peça que falta de verdade e quebra a tela 61s depois de
 *     abrir recarregaria a cada minuto, para sempre, disfarçada de
 *     "atualização". Sem conseguir ler/gravar a trava (navegador que
 *     bloqueia o armazenamento), NÃO recarrega sozinha: sem trava, a regra
 *     vira aposta. E **sem internet não recarrega**: no app instalado do
 *     iPhone, recarregar offline dá a tela branca do sistema, sem botão —
 *     pior que a tela de socorro; a recarga espera a conexão voltar.
 *  2. **Qualquer outro erro mostra o que aconteceu, em português, com o
 *     botão de recarregar** — nunca recarrega sozinho. Um erro de verdade
 *     que recarregasse às escondidas sumiria da vista de todo mundo, e a
 *     lojista que acabou de clicar "salvar" precisa saber que algo falhou.
 *  3. **O erro é CONTADO para o painel de Saúde** (`relatoDoErro`), dizendo
 *     se a recarga automática de fato aconteceu: versão velha que a trava
 *     barrou é peça faltando DE VERDADE, e arquivá-la como "se curou"
 *     esconderia justamente o defeito que a trava existe para expor. O Next
 *     15 JÁ recarrega sozinho quando a navegação encontra versão nova
 *     (conferido em `fetch-server-response.js`: build diferente → navegação
 *     completa), então "versão velha" é suspeita, não certeza — e consertar
 *     no escuro já custou caro aqui (o endereço errado do Bling, três
 *     tentativas). Sem o relato, a próxima tela quebrada seria outro chute.
 */

/** Entre duas recargas automáticas da mesma aba, no mínimo isto. */
export const MS_ENTRE_RECARGAS = 60_000;

/** E no máximo `MAX_RECARGAS_NA_JANELA` recargas automáticas nesta janela. */
export const MS_JANELA_DE_RECARGAS = 30 * 60_000;
export const MAX_RECARGAS_NA_JANELA = 3;

/** sessionStorage: quando aconteceram as recargas automáticas (lista de ms). */
export const CHAVE_RECARGAS = "atacadopro:erro-tela:recargas";

/** Relato guardado há mais que isto não vale mais a viagem ao servidor. */
export const MS_VALIDADE_DO_RELATO = 7 * 24 * 60 * 60_000;

/**
 * Fonte no painel de Saúde do caso "versão velha QUE SE CUROU" (recarregou
 * sozinha): é ESPERADO depois de cada entrega, então fica fora da conta de
 * erros e da lista — senão cada entrega enterraria os erros de verdade
 * (achado da revisão). Versão velha que a trava NÃO deixou recarregar é
 * peça que falta de verdade: vai como quebra ("client"), que é o que ela é.
 */
export const FONTE_TELA_VERSAO_VELHA = "tela.versao";

/** Avisa quem manda o relato que há um novo guardado (sem esperar recarga). */
export const EVENTO_RELATO_GUARDADO = "atacadopro:relato-guardado";

/** localStorage: o relato que ainda não chegou ao servidor. */
export const CHAVE_RELATO_PENDENTE = "atacadopro:erro-tela:pendente";

/** Tetos do relato — os mesmos do painel de Saúde (`logServerError`). */
export const TETO_MENSAGEM = 500;
export const TETO_DETALHE = 4000;
export const TETO_CAMINHO = 300;

/**
 * Frases com que cada navegador diz "o pedaço de código não veio".
 * O webpack (que monta o build de produção) usa as duas primeiras; as
 * outras são do `import()` nativo — o Safari do iPhone diz a última.
 */
const SINAIS_DE_VERSAO_VELHA: RegExp[] = [
  /Loading chunk [\w-]+ failed/i,
  /Loading CSS chunk [\w-]+ failed/i,
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
];

/**
 * O erro é "faltou um pedaço de código da versão que está aberta"?
 *
 * Só nomes e frases de CARREGAMENTO contam. Um erro comum que por acaso
 * cite "chunk" na mensagem não pode recarregar a página sozinho — é o
 * caminho para esconder defeito de verdade atrás de recargas.
 */
export function pareceVersaoVelha(erro: unknown): boolean {
  if (!erro || typeof erro !== "object") return false;
  const e = erro as { name?: unknown; message?: unknown };
  if (e.name === "ChunkLoadError") return true;
  const mensagem = typeof e.message === "string" ? e.message : "";
  return SINAIS_DE_VERSAO_VELHA.some((r) => r.test(mensagem));
}

/**
 * Pode recarregar sozinho AGORA?
 *
 * `recargas` são os carimbos das recargas automáticas anteriores desta aba.
 */
export function podeRecarregarSozinho(recargas: number[], agora: number): boolean {
  const naJanela = naJanelaDe(recargas, agora);
  if (naJanela.some((t) => agora - t < MS_ENTRE_RECARGAS)) return false;
  return naJanela.length < MAX_RECARGAS_NA_JANELA;
}

/**
 * Lê a lista guardada. Texto torto conta como "nunca recarregou" — mas o
 * que chega aqui já passou pelo teste de "gravou e leu de volta" da tela,
 * então torto só acontece com gente mexendo à mão no navegador.
 */
export function lerRecargas(texto: string | null): number[] {
  if (!texto) return [];
  try {
    const v: unknown = JSON.parse(texto);
    if (!Array.isArray(v)) return [];
    return v.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  } catch {
    return [];
  }
}

/** A lista a gravar depois de recarregar: só o que ainda está na janela. */
export function recargasComEsta(recargas: number[], agora: number): number[] {
  return [...naJanelaDe(recargas, agora), agora];
}

/**
 * As recargas que ainda contam. Carimbo no FUTURO é descartado: o iPhone
 * que dormiu horas acerta o relógio para trás ao acordar — justo no cenário
 * do app aberto por muito tempo —, e tratar esse carimbo como "recarregou
 * agora" travava a recarga daquela aba PARA SEMPRE, porque nada nunca o
 * apagaria (achado da revisão).
 */
function naJanelaDe(recargas: number[], agora: number): number[] {
  return recargas.filter((t) => t <= agora && agora - t < MS_JANELA_DE_RECARGAS);
}

export type RelatoDoErro = {
  /** sorteado no aparelho: o servidor não grava o mesmo relato duas vezes */
  id: string;
  mensagem: string;
  detalhe: string | null;
  caminho: string;
  versaoVelha: boolean;
  /** a recarga automática ACONTECEU — só então é o caso que se cura sozinho */
  recarregouSozinho: boolean;
  quando: string;
};

/**
 * Esse erro vale relato? O que chega com `digest` veio do SERVIDOR (o Next
 * esconde a mensagem e manda só o código), e lá o `onRequestError` já o
 * registrou — mandar de novo contava o mesmo erro duas vezes no painel.
 */
export function deveRelatar(erro: unknown): boolean {
  const digest = (erro as { digest?: unknown } | null)?.digest;
  return !(typeof digest === "string" && digest.length > 0);
}

/** Só a versão velha que DE FATO recarregou é o caso esperado. */
export function relatoEsperado(r: { versaoVelha: boolean; recarregouSozinho: boolean }): boolean {
  return r.versaoVelha && r.recarregouSozinho;
}

/**
 * Monta o que vai para o painel de Saúde.
 *
 * O caminho chega aqui já limpo (`caminhoSemCodigos`). O `digest` do Next
 * entra no detalhe — é ele que casa o erro da tela com o do servidor,
 * quando a quebra veio de lá.
 */
export function relatoDoErro(
  erro: unknown,
  caminho: string,
  agora: Date,
  extra: { id: string; recarregouSozinho: boolean }
): RelatoDoErro {
  const e = (erro && typeof erro === "object" ? erro : {}) as {
    name?: unknown;
    message?: unknown;
    stack?: unknown;
    digest?: unknown;
  };
  const nome = typeof e.name === "string" && e.name ? e.name : "Erro";
  const mensagemCrua =
    typeof e.message === "string" && e.message
      ? e.message
      : typeof erro === "string"
        ? erro
        : "Erro sem mensagem";
  const partes: string[] = [];
  if (typeof e.digest === "string" && e.digest) partes.push(`digest: ${e.digest}`);
  if (typeof e.stack === "string" && e.stack) partes.push(e.stack);
  const detalhe = partes.length > 0 ? partes.join("\n").slice(0, TETO_DETALHE) : null;
  return {
    id: extra.id,
    mensagem: `${nome}: ${mensagemCrua}`.slice(0, TETO_MENSAGEM),
    detalhe,
    caminho: soOCaminho(caminho).slice(0, TETO_CAMINHO),
    versaoVelha: pareceVersaoVelha(erro),
    recarregouSozinho: extra.recarregouSozinho,
    quando: agora.toISOString(),
  };
}

/**
 * O CAMINHO DA TELA SEM OS CÓDIGOS DE ACESSO — que moram no próprio
 * caminho, não só na busca (achado da revisão): `/dados/<token>` escreve
 * na ficha de uma cliente, `/ficha/<código>` abre a ficha de RH, e
 * `/catalogo/<loja>/l/<código>` é o link de ATACADO, sorteado para o preço
 * não se descobrir por tentativa. Em vez de uma lista dessas rotas (que
 * esqueceria a próxima), TODO parâmetro dinâmico da rota vira o nome dele:
 * `/dados/[token]`, `/pedidos/[id]`. Quem diz o que é parâmetro é o
 * próprio Next (`useParams`). O tipo de tela é o que o diagnóstico usa; o
 * número exato fica de fora.
 */
export function caminhoSemCodigos(
  caminho: string,
  parametros: Record<string, string | string[] | undefined> | null
): string {
  const base = soOCaminho(caminho);
  // sem saber quais pedaços são parâmetro (a quebra levou o roteador
  // junto), vale o lado seguro: só o primeiro pedaço, o resto some
  if (parametros === null) {
    const [, primeiro, ...resto] = base.split("/");
    if (!primeiro) return "/";
    return resto.some(Boolean) ? `/${primeiro}/…` : `/${primeiro}`;
  }
  const trocas = new Map<string, string>();
  for (const [nome, valor] of Object.entries(parametros ?? {})) {
    for (const v of Array.isArray(valor) ? valor : valor ? [valor] : []) {
      if (v) trocas.set(v, `[${nome}]`);
    }
  }
  const pedacos = base.split("/").map((p) => {
    if (!p) return p;
    let decodificado = p;
    try {
      decodificado = decodeURIComponent(p);
    } catch {
      // pedaço mal formado: compara como veio
    }
    return trocas.get(decodificado) ?? trocas.get(p) ?? p;
  });
  return pedacos.join("/") || "/";
}

/** "/pedidos/12?c=abc#x" → "/pedidos/12". Endereço inteiro também serve. */
export function soOCaminho(endereco: string): string {
  const semHash = endereco.split("#")[0] ?? "";
  const semBusca = semHash.split("?")[0] ?? "";
  try {
    // endereço completo ("https://www.atacadopro.com/x") vira só "/x"
    if (/^https?:\/\//i.test(semBusca)) return new URL(semBusca).pathname || "/";
  } catch {
    // cai no texto como veio
  }
  return semBusca || "/";
}

/** O relato guardado ainda vale a viagem? Sem data legível, não. */
export function relatoAindaVale(quando: unknown, agora: number): boolean {
  if (typeof quando !== "string") return false;
  const t = Date.parse(quando);
  if (!Number.isFinite(t)) return false;
  return agora - t <= MS_VALIDADE_DO_RELATO;
}
