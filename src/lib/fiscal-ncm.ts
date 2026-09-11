/**
 * RN-055 · A INFORMAÇÃO FISCAL DA PEÇA MORA AQUI, E VAI NA NOTA.
 *
 * Relato do dono (11/09/2026), montando o Bling: *"não quero ter que cadastrar
 * manualmente lá sendo que já tenho tudo aqui"*. Ele estava certo, e a
 * documentação do Bling deu a saída: o item da nota aceita
 * **`classificacaoFiscal`** (o NCM) e **`origem`**. Mandando os dois, a nota
 * sai completa daqui e **a loja não precisa manter um segundo catálogo no
 * Bling** — que era o trabalho que fazia a integração não valer a pena.
 *
 * O NCM é do TIPO da peça, não de cada cor × tamanho: uma confecção tem
 * dezenas de modelos e 5 a 15 tipos. Por isso a régua é a MESMA da RN-051
 * (mínimo de estoque), e pelo mesmo motivo — cadastrar por categoria resolve
 * o catálogo inteiro com poucos números:
 *
 *   NCM da PEÇA (exceção) > NCM da CATEGORIA (o normal) > NCM da LOJA
 *
 * O degrau da LOJA existe para o atacado que vende um tipo só (só regata, só
 * moda praia): ele cadastra um número e acabou.
 *
 * **Os números são do CONTADOR.** O sistema não inventa NCM, não deduz pelo
 * nome da peça e não tem lista embutida: NCM errado é imposto errado, e quem
 * responde é a loja. Sem NCM cadastrado o sistema **não manda o campo** — a
 * nota tenta sair pelo cadastro do Bling, como antes —, mas a ficha do pedido
 * AVISA antes de emitir, porque quase sempre isso termina em recusa da SEFAZ.
 */

/** Só os dígitos, do jeito que a pessoa digitar ("6109.10.00" → "61091000"). */
export function digitosDoNcm(v: string | null | undefined): string {
  return (v ?? "").replace(/\D/g, "");
}

/**
 * NCM válido é o de 8 dígitos. Nem 7 nem 9: a tabela da Receita tem oito, e
 * número curto passa na nossa tela para morrer na SEFAZ com uma mensagem que
 * ninguém entende.
 */
export function ncmValido(v: string | null | undefined): boolean {
  return digitosDoNcm(v).length === 8;
}

/**
 * Como o Bling recebe: com os pontos ("6109.10.00"). É o formato do exemplo
 * da API v3 (`classificacaoFiscal`), e mandar cru já foi motivo de recusa em
 * integração de gente que passou por aqui antes.
 */
export function ncmParaNota(v: string | null | undefined): string | null {
  const d = digitosDoNcm(v);
  if (d.length !== 8) return null;
  return `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6, 8)}`;
}

/** Como a tela mostra (mesmo formato do Bling e do que o contador manda). */
export const ncmFormatado = ncmParaNota;

export type DegrausDoNcm = {
  /** NCM da própria peça (`Product.ncm`) — a exceção */
  daPeca?: string | null;
  /** NCM da categoria daquela peça (`FiscalCategoria.ncm`) — o normal */
  daCategoria?: string | null;
  /** NCM da loja (`BlingConnection.ncmPadrao`) — o último degrau */
  daLoja?: string | null;
};

export type OrigemDoNcm = "PECA" | "CATEGORIA" | "LOJA" | "NENHUM";

/**
 * Qual NCM vale para esta peça, e de qual degrau ele veio.
 *
 * Devolver de ONDE veio não é luxo: é o que deixa a tela explicar "essa peça
 * está usando o NCM da categoria Regatas" em vez de mostrar um número solto
 * que ninguém sabe conferir.
 *
 * Degrau com número INVÁLIDO é pulado, não derruba a conta: alguém digitou 7
 * dígitos na categoria e a peça tem o dela certo — vale o certo.
 */
export function ncmEfetivo(d: DegrausDoNcm): { ncm: string | null; de: OrigemDoNcm } {
  if (ncmValido(d.daPeca)) return { ncm: digitosDoNcm(d.daPeca), de: "PECA" };
  if (ncmValido(d.daCategoria)) return { ncm: digitosDoNcm(d.daCategoria), de: "CATEGORIA" };
  if (ncmValido(d.daLoja)) return { ncm: digitosDoNcm(d.daLoja), de: "LOJA" };
  return { ncm: null, de: "NENHUM" };
}

/**
 * ORIGEM DA MERCADORIA (campo `origem` do item).
 *
 * 0 = nacional, que é o caso da confecção brasileira — e por isso o padrão.
 * Fica configurável porque quem revende peça importada tem outro código, e
 * origem errada é imposto errado. O sistema não adivinha: usa o que a loja
 * configurou, e o padrão só vale para quem não mexeu.
 */
export const ORIGEM_NACIONAL = 0;

/** Origens que a Receita aceita (0 a 8). Fora disso, vale o nacional. */
export function origemValida(v: number | null | undefined): number {
  return Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 8
    ? (v as number)
    : ORIGEM_NACIONAL;
}

/**
 * O que a ficha do pedido diz ANTES de emitir sobre as peças sem NCM.
 *
 * Nota fiscal não se desfaz com um clique, e "Rejeição 999" não ensina nada a
 * ninguém. Então o aviso vem antes, com o nome das peças e o caminho para
 * resolver — que é cadastrar a CATEGORIA, não peça por peça.
 */
export function avisoDePecasSemNcm(
  pecas: { nome: string; categoria: string }[]
): string | null {
  if (pecas.length === 0) return null;
  const categorias = [...new Set(pecas.map((p) => p.categoria).filter(Boolean))];
  const quais =
    categorias.length > 0
      ? ` Falta o NCM da${categorias.length > 1 ? "s categorias" : " categoria"} ${categorias
          .map((c) => `"${c}"`)
          .join(", ")}.`
      : "";
  // um MODELO em três cores são três linhas do pedido com o mesmo nome, e
  // "Regata Lisa, Regata Lisa, Regata Lisa" parecia defeito de tela. A conta
  // segue sendo de LINHAS (é o que a loja vê no pedido); só o nome não repete.
  const distintos = [...new Set(pecas.map((p) => p.nome))];
  const nomes = distintos.slice(0, 3);
  const resto = distintos.length - nomes.length;
  return (
    `${pecas.length} peça${pecas.length > 1 ? "s" : ""} sem NCM (${nomes.join(", ")}` +
    `${resto > 0 ? ` e mais ${resto}` : ""}).${quais}` +
    ` Cadastre em Configurações → Bling; sem o NCM a SEFAZ costuma recusar a nota.`
  );
}
