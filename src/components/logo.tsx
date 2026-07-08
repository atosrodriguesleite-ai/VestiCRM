/**
 * Identidade visual do VestiCRM.
 * Marca: monograma "V" em duas tonalidades de azul sobre gradiente
 * petróleo→azul, remetendo a um cabide/caimento. Usada em login,
 * sidebar, header, favicon e catálogo.
 */

export function LogoMark({
  className = "size-8",
  rounded = "rounded-[10px]",
}: {
  className?: string;
  rounded?: string;
}) {
  const id = "vesti-grad";
  return (
    <span className={`inline-flex ${className} ${rounded} overflow-hidden`}>
      <svg viewBox="0 0 32 32" className="size-full" aria-hidden="true">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#1E3A5F" />
            <stop offset="1" stopColor="#2563EB" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" fill={`url(#${id})`} />
        <path
          d="M8.5 9.5 L16 22.5"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
        <path
          d="M16 22.5 L23.5 9.5"
          fill="none"
          stroke="#93C5FD"
          strokeWidth="2.6"
          strokeLinecap="round"
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
      <LogoMark className={mark} />
      <div className="leading-tight">
        <p
          className={`font-semibold tracking-tight ${text} ${onDark ? "text-white" : "text-ink"}`}
        >
          Vesti<span className={onDark ? "text-brand-300" : "text-brand-600"}>CRM</span>
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
