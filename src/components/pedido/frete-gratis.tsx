"use client";

/**
 * FRETE GRÁTIS — a caixinha e a linha da prévia, UMA vez (RN-099).
 *
 * Três telas montam/editam os valores do pedido (Novo pedido, montador da
 * Central e a ficha) e as três precisam da mesma coisa: a marca "frete por
 * conta da loja" e a linha "Frete · GRÁTIS" na prévia. Escritas três vezes
 * elas já tinham começado a divergir (achado da revisão). Aqui mora o
 * desenho; a régua do dinheiro (marcar zera, informar desmarca) é do
 * servidor, em `resolverFreteDoPedido` — a tela só mostra.
 *
 * O número digitado no frete NÃO é apagado ao marcar: a caixinha marcada sem
 * querer e desmarcada em seguida devolve o que estava lá (apagar fazia o
 * frete de R$ 25 sumir calado, sem marca e sem rastro).
 */

export function CaixaFreteGratis({
  marcado,
  aoMudar,
  compacto = false,
  detalhe,
}: {
  marcado: boolean;
  aoMudar: (marcado: boolean) => void;
  /** letra menor, para o montador da Central */
  compacto?: boolean;
  /** complemento depois do rótulo (ex.: "— sai em destaque no romaneio") */
  detalhe?: string;
}) {
  return (
    <label
      className={`mt-1.5 flex items-center gap-1.5 text-gray-600 ${compacto ? "text-[11px]" : "text-xs"}`}
    >
      <input
        type="checkbox"
        checked={marcado}
        onChange={(e) => aoMudar(e.target.checked)}
        className={`accent-brand-600 ${compacto ? "size-3" : "size-3.5"}`}
      />
      <span>
        Frete grátis (por conta da loja)
        {detalhe ? <span className="text-gray-400"> {detalhe}</span> : null}
      </span>
    </label>
  );
}

/** A linha da prévia de valores quando o pedido está marcado. */
export function LinhaFreteGratis() {
  return (
    <div className="flex justify-between font-semibold text-emerald-700">
      <span>Frete</span>
      <span>GRÁTIS</span>
    </div>
  );
}

/** O campo do frete enquanto a marca está ligada: vazio, apagado, "grátis". */
export const CAMPO_DO_FRETE_MARCADO = {
  placeholder: "grátis",
  className: "disabled:bg-gray-50 disabled:text-gray-400",
} as const;
