"use client";

import { avisoDoTeto, limitarQuantidade } from "@/lib/catalogo/teto-do-estoque";

/** as três cores do tema da loja que a linha usa (recorte do `T` da vitrine) */
export type CoresDaLinha = { line: string; soft: string; primary: string };

/**
 * UMA LINHA DE TAMANHO na folha da peça do catálogo público: o tamanho, a
 * quantidade e os botões − / +.
 *
 * Separada da vitrine por UM motivo (RN-067, 25/09/2026): é aqui que a
 * quantidade PARA no estoque disponível, e essa é a regra que deixou a
 * cliente da Entre Linhas pedir 8 de uma peça com 1. Dentro das 2.300 linhas
 * da vitrine ela não tinha teste nenhum; como componente pequeno, o teste
 * clica no `+` e vê o número parar.
 *
 * - `disponivel` = QUANTAS há daquela cor × tamanho (0 = esgotado);
 * - o `+` não passa do disponível e a linha DIZ por quê ("só N disponíveis",
 *   e para peça acabando a frase aparece antes do primeiro toque);
 * - `onChange` recebe a quantidade NOVA, já dentro do teto, e só é chamada
 *   quando o número de fato muda — quem chama decide o que registrar.
 */
export function LinhaDeTamanho({
  size,
  disponivel,
  qty,
  cores,
  onChange,
}: {
  size: string;
  disponivel: number;
  qty: number;
  cores: CoresDaLinha;
  onChange: (proxima: number) => void;
}) {
  const available = disponivel > 0;
  const aviso = available ? avisoDoTeto(qty, disponivel) : null;
  const mudar = (pedida: number) => {
    const cabe = limitarQuantidade(pedida, disponivel);
    if (cabe !== qty) onChange(cabe);
  };
  return (
    <div
      className="flex items-center justify-between rounded-xl border py-[9px] pl-3.5 pr-2.5"
      style={{ borderColor: cores.line, opacity: available ? 1 : 0.45 }}
    >
      <span className="font-bold text-[15px] min-w-[46px]">
        {size}
        {!available && (
          <small className="block text-[10px] font-semibold" style={{ color: "#B33939" }}>
            esgotado
          </small>
        )}
        {aviso && (
          <small className="block text-[10px] font-semibold whitespace-nowrap" style={{ color: "#B33939" }}>
            {aviso}
          </small>
        )}
      </span>
      <div className="flex items-center gap-0.5 rounded-[10px] p-[3px]" style={{ background: cores.soft }}>
        <button
          type="button"
          aria-label={`Menos um ${size}`}
          disabled={!available || qty <= 0}
          onClick={() => mudar(qty - 1)}
          className="size-[38px] rounded-lg text-xl font-semibold flex items-center justify-center bg-white border disabled:opacity-60"
          style={{ borderColor: cores.line, color: cores.primary }}
        >
          −
        </button>
        <span
          className="min-w-[34px] text-center font-bold text-base tabular-nums"
          aria-label={`Quantidade ${size}`}
        >
          {qty}
        </span>
        <button
          type="button"
          aria-label={`Mais um ${size}`}
          // o `+` PARA no disponível (RN-067)
          disabled={!available || qty >= disponivel}
          onClick={() => mudar(qty + 1)}
          className="size-[38px] rounded-lg text-xl font-semibold flex items-center justify-center bg-white border disabled:opacity-60"
          style={{ borderColor: cores.line, color: cores.primary }}
        >
          +
        </button>
      </div>
    </div>
  );
}
