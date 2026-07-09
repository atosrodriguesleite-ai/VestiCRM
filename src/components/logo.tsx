/**
 * Identidade visual do AtacadoPro.
 * Marca: monograma "AP" — o "A" (Atacado) em roxo escuro e o "P" (Pro) em
 * roxo vibrante, formas angulares que remetem a movimento e evolução.
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
  const aColor = onDark ? "#FFFFFF" : "#0E0142"; // A — roxo escuro (ou branco no negativo)
  const pColor = "#6D28FF"; // P — roxo vibrante
  return (
    <span className={`inline-flex ${className} ${rounded} overflow-hidden`}>
      <svg
        viewBox="0 0 100 100"
        className="size-full"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {/* A — duas pernas (peça angular) */}
        <path d="M50 17 L21 83" stroke={aColor} strokeWidth="15" />
        <path d="M50 17 L64 49" stroke={aColor} strokeWidth="15" />
        {/* P — haste + bojo em seta para a frente */}
        <path d="M43 52 L32 83" stroke={pColor} strokeWidth="15" />
        <path
          d="M42 51 L69 51 L82 65 L69 79 L50 79"
          stroke={pColor}
          strokeWidth="15"
        />
      </svg>
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
      <LogoMark className={mark} rounded="rounded-none" onDark={onDark} />
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
