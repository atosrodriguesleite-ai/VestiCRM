/* eslint-disable @next/next/no-img-element */
/**
 * Identidade visual do AtacadoPro — Manual da Marca V1.
 * Monograma "AP": em fundo claro usa a versão espresso+cobre
 * (/brand/mark.png); em fundo escuro usa a versão creme+cobre
 * (/brand/mark-dark.png), sem chip — o logo já foi feito para escuro.
 * O nome escreve-se sempre AtacadoPro, com "Pro" em cobre.
 */

export function LogoMark({
  className = "size-8",
  onDark = false,
}: {
  className?: string;
  rounded?: string;
  onDark?: boolean;
}) {
  return (
    <span className={`inline-flex items-center justify-center ${className}`} aria-hidden="true">
      <img
        src={onDark ? "/brand/mark-dark.png" : "/brand/mark.png"}
        alt=""
        className="size-full object-contain"
      />
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
      <LogoMark className={mark} onDark={onDark} />
      <div className="leading-tight">
        <p
          className={`font-bold tracking-tight ${text} ${onDark ? "text-creme" : "text-ink"}`}
        >
          Atacado<span className="text-cobre">Pro</span>
        </p>
        {subtitle && (
          <p
            className={`text-[11px] truncate max-w-40 ${onDark ? "text-creme/50" : "text-slate-400"}`}
          >
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}
