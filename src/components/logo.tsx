/* eslint-disable @next/next/no-img-element */
/**
 * Identidade visual do AtacadoPro.
 * Marca oficial (arquivo em /public/brand/mark.png): monograma "AP" — o "A"
 * (Atacado) em roxo escuro e o "P" (Pro) em roxo vibrante.
 * Em fundos escuros, o símbolo vai sobre um chip branco arredondado para o
 * "A" escuro não sumir.
 * Usada em login, sidebar, header, favicon e catálogo.
 */

export function LogoMark({
  className = "size-8",
  rounded = "rounded-[10px]",
  onDark = false,
}: {
  className?: string;
  rounded?: string;
  onDark?: boolean;
}) {
  if (onDark) {
    return (
      <span
        className={`inline-flex items-center justify-center ${className} ${rounded} bg-white`}
        aria-hidden="true"
      >
        <img src="/brand/mark.png" alt="" className="size-[74%] object-contain" />
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center justify-center ${className}`} aria-hidden="true">
      <img src="/brand/mark.png" alt="" className="size-full object-contain" />
    </span>
  );
}

export function Logo({
  className = "",
  size = "md",
  subtitle,
  onDark = false,
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
  subtitle?: string;
  onDark?: boolean;
}) {
  const mark =
    size === "lg" ? "size-10" : size === "sm" ? "size-7" : "size-8";
  const text =
    size === "lg" ? "text-xl" : size === "sm" ? "text-[15px]" : "text-[17px]";
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <LogoMark className={mark} rounded="rounded-[8px]" onDark={onDark} />
      <div className="leading-tight">
        <p
          className={`font-bold tracking-tight ${text} ${onDark ? "text-white" : "text-ink"}`}
        >
          Atacado<span className={onDark ? "text-brand-300" : "text-brand-600"}>Pro</span>
        </p>
        {subtitle && (
          <p
            className={`text-[11px] truncate max-w-40 ${onDark ? "text-slate-400" : "text-slate-400"}`}
          >
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}
