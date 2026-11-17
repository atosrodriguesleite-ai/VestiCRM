/**
 * RN-113 · A TELA QUE FICOU ABERTA SABE QUE SAIU VERSÃO NOVA.
 *
 * Relato do dono (17/11/2026): o "Filtro de ruído forte" aparecia no acesso
 * dele e não no das vendedoras. Não existe trava por papel — a tela é a
 * mesma para todo mundo. O que existe é a aba que ficou ABERTA desde antes
 * da entrega: a Central conversa com o servidor por pedidos de dados a cada
 * 3 s e nunca troca de página, então o código que roda nela é o do dia em
 * que foi aberta. O app instalado fica assim por dias.
 *
 * Parte PURA (o navegador importa este arquivo; nada de banco aqui).
 */

/**
 * A versão DESTE código: o commit de onde o build saiu. É escrita no código
 * na hora do build (`env` do `next.config.ts`), no navegador e no servidor —
 * então a tela aberta guarda a versão de quando carregou, e a rota
 * `/api/versao` responde a versão que está no ar AGORA.
 *
 * Vazia fora da Vercel (ou sem as variáveis de sistema expostas): aí não há
 * como comparar e o aviso simplesmente não existe — nunca um aviso inventado.
 */
export const VERSAO_DO_APP = (process.env.NEXT_PUBLIC_VERSAO_DO_APP ?? "").trim();

/** de quanto em quanto tempo a tela pergunta (só com a aba à vista) */
export const MS_ENTRE_CONFERENCIAS = 5 * 60_000;

/** "Depois": o aviso some e volta daqui a uma hora */
export const MS_DO_DEPOIS = 60 * 60_000;

/** onde fica anotada a versão para a qual esta aba JÁ recarregou */
export const CHAVE_VERSAO_TENTADA = "vesti:versao-tentada";

/** a versão como texto limpo, ou vazio quando não é uma */
function limpa(valor: unknown): string {
  return typeof valor === "string" ? valor.trim().slice(0, 80) : "";
}

/** o que a rota respondeu: `{ versao: "…" }` — qualquer outra coisa é "não sei" */
export function lerVersaoDaResposta(corpo: unknown): string {
  if (!corpo || typeof corpo !== "object") return "";
  return limpa((corpo as { versao?: unknown }).versao);
}

/**
 * Tem versão nova no ar? Só com as DUAS versões conhecidas e diferentes —
 * sem uma delas não se sabe, e "não sei" nunca vira aviso.
 */
export function haVersaoNova(minha: unknown, doServidor: unknown): boolean {
  const a = limpa(minha);
  const b = limpa(doServidor);
  return a !== "" && b !== "" && a !== b;
}

/** já passou o intervalo desde a última pergunta? */
export function horaDeConferir(agora: number, ultima: number): boolean {
  // relógio que andou para trás (o aparelho acordou e acertou a hora) não
  // pode travar a conferência para sempre
  return agora < ultima || agora - ultima >= MS_ENTRE_CONFERENCIAS;
}

/**
 * Vale avisar? Tem versão nova E esta aba ainda não recarregou por causa
 * DELA. Se já recarregou e continua diferente, recarregar de novo não vai
 * resolver — insistir viraria um aviso eterno que ninguém consegue calar.
 */
export function valeAvisar(minha: unknown, doServidor: unknown, jaTentada: unknown): boolean {
  return haVersaoNova(minha, doServidor) && limpa(jaTentada) !== limpa(doServidor);
}

/**
 * O que o painel de Saúde diz sobre o aviso. Ele depende de a Vercel informar
 * o commit NO BUILD — sem isso a versão fica vazia e o aviso fica desligado
 * sem ninguém perceber. Aviso que pode estar desligado em silêncio precisa
 * de um lugar que diga (achado da revisão).
 */
export function situacaoDoAviso(versao: unknown): { ligado: boolean; frase: string } {
  const v = limpa(versao);
  if (v)
    return {
      ligado: true,
      frase: `Aviso de versão nova: ligado — versão no ar ${v.slice(0, 7)}.`,
    };
  return {
    ligado: false,
    frase:
      "Aviso de versão nova: DESLIGADO — a Vercel não informou a versão neste build. Ligue em Settings → Environment Variables → \"Automatically expose System Environment Variables\" e faça um novo deploy.",
  };
}
