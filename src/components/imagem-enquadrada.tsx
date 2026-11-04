import type { CSSProperties, ImgHTMLAttributes } from "react";
import { estiloDaJanela, type Enquadramento } from "@/lib/enquadramento";

/**
 * A foto dentro de um quadro 3:4 obedecendo ao ENQUADRAMENTO (RN-107).
 *
 * O componente é DONO do quadro (`relative` + `overflow-hidden`, proporção
 * 3:4): assim nenhum lugar novo desenha a janela sem a moldura certa — a
 * imagem ampliada vazaria por cima do vizinho (achado da revisão). Com
 * janela, a imagem é ampliada e deslocada para a janela ocupar o quadro
 * (`estiloDaJanela`, altura natural: nunca deforma); sem janela, o corte de
 * sempre do card (`object-cover object-top`). Serve ao card do catálogo, à
 * sacola, à miniatura do editor e à prévia dele: um desenho só, para o que
 * a loja vê ao enquadrar ser o que a cliente vê no catálogo.
 *
 * `quadroClassName` dimensiona o quadro (padrão: ocupa o pai, que já tem a
 * proporção); `quadroStyle` leva fundo e borda do tema.
 */
export function ImagemEnquadrada({
  enquadramento,
  quadroClassName = "w-full h-full",
  quadroStyle,
  className,
  style,
  ...img
}: ImgHTMLAttributes<HTMLImageElement> & {
  enquadramento?: Enquadramento | null;
  quadroClassName?: string;
  quadroStyle?: CSSProperties;
}) {
  const janela: CSSProperties | undefined = enquadramento ? estiloDaJanela(enquadramento) : undefined;
  return (
    <div className={`relative overflow-hidden ${quadroClassName}`} style={{ aspectRatio: "3/4", ...quadroStyle }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        {...img}
        alt={img.alt ?? ""}
        className={`${janela ? "block" : "w-full h-full object-cover object-top"} ${className ?? ""}`.trim()}
        style={{ ...janela, ...style }}
      />
    </div>
  );
}
