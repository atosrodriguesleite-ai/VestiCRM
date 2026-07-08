import { initials } from "@/lib/format";

/* ============================================================
   VestiCRM Design System — componentes base reutilizáveis.
   Um único padrão para toda a aplicação.
   ============================================================ */

export function Card({
  children,
  className = "",
  as: Tag = "div",
  interactive = false,
}: {
  children: React.ReactNode;
  className?: string;
  as?: React.ElementType;
  interactive?: boolean;
}) {
  return (
    <Tag
      className={`bg-white rounded-2xl border border-slate-200/70 shadow-card ${
        interactive
          ? "transition duration-200 hover:shadow-pop hover:border-slate-300/70 hover:-translate-y-0.5"
          : ""
      } ${className}`}
    >
      {children}
    </Tag>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4 mb-6 md:mb-7">
      <div className="min-w-0">
        <h1 className="text-[22px] md:text-[26px] font-semibold tracking-tight text-slate-900">
          {title}
        </h1>
        {subtitle && (
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">{subtitle}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/* ---- Button ------------------------------------------------ */

type ButtonProps = {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

const BTN_BASE =
  "inline-flex items-center justify-center gap-1.5 font-medium rounded-xl transition duration-150 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap";
const BTN_VARIANT: Record<string, string> = {
  primary:
    "bg-brand-600 text-white shadow-xs hover:bg-brand-700 hover:shadow-card",
  secondary:
    "bg-white text-slate-700 border border-slate-200 hover:border-slate-300 hover:bg-slate-50",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
  danger: "bg-danger text-white hover:brightness-95",
};
const BTN_SIZE: Record<string, string> = {
  sm: "text-xs px-3 py-2",
  md: "text-sm px-4 py-2.5",
};

export function Button({
  children,
  variant = "primary",
  size = "md",
  className = "",
  ...rest
}: ButtonProps) {
  return (
    <button
      className={`${BTN_BASE} ${BTN_VARIANT[variant]} ${BTN_SIZE[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ---- Input ------------------------------------------------- */

export const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10";

export function Input({
  className = "",
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${inputCls} ${className}`} {...rest} />;
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-slate-700 mb-1.5">
        {label}
      </span>
      {children}
      {hint && <span className="block text-xs text-slate-400 mt-1">{hint}</span>}
    </label>
  );
}

/* ---- Badge ------------------------------------------------- */

export function Badge({
  children,
  color = "#2563eb",
  soft = true,
}: {
  children: React.ReactNode;
  color?: string;
  soft?: boolean;
}) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset"
      style={{
        backgroundColor: soft ? `${color}14` : color,
        color: soft ? color : "#fff",
        // @ts-expect-error CSS var
        "--tw-ring-color": `${color}22`,
      }}
    >
      {children}
    </span>
  );
}

/* ---- Avatar ------------------------------------------------ */

export function Avatar({
  name,
  color = "#2563eb",
  size = "md",
}: {
  name: string;
  color?: string;
  size?: "sm" | "md" | "lg";
}) {
  const cls =
    size === "sm"
      ? "size-6 text-[10px]"
      : size === "lg"
        ? "size-12 text-base"
        : "size-8 text-xs";
  return (
    <span
      className={`${cls} rounded-full inline-flex items-center justify-center font-semibold text-white shrink-0 ring-2 ring-white`}
      style={{
        background: `linear-gradient(135deg, ${color}, ${color}cc)`,
      }}
      title={name}
    >
      {initials(name)}
    </span>
  );
}

/* ---- Status pills ------------------------------------------ */

const convStatusStyles: Record<string, string> = {
  OPEN: "bg-emerald-50 text-emerald-700 ring-emerald-600/10",
  WAITING_CLIENT: "bg-amber-50 text-amber-700 ring-amber-600/10",
  WAITING_PAYMENT: "bg-orange-50 text-orange-700 ring-orange-600/10",
  CLOSED: "bg-slate-100 text-slate-500 ring-slate-600/10",
};

export function ConvStatusPill({
  status,
  label,
}: {
  status: string;
  label: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${convStatusStyles[status] ?? "bg-slate-100 text-slate-600 ring-slate-600/10"}`}
    >
      {label}
    </span>
  );
}

export function PriorityDot({ priority }: { priority: string }) {
  const color =
    priority === "ALTA"
      ? "bg-danger"
      : priority === "MEDIA"
        ? "bg-warning"
        : "bg-slate-300";
  return (
    <span className={`size-2 rounded-full inline-block shrink-0 ${color}`} />
  );
}

/* ---- Alert ------------------------------------------------- */

export function Alert({
  children,
  tone = "info",
  icon,
}: {
  children: React.ReactNode;
  tone?: "info" | "success" | "warning" | "danger";
  icon?: React.ReactNode;
}) {
  const styles = {
    info: "bg-brand-50 text-brand-800 border-brand-100",
    success: "bg-emerald-50 text-emerald-800 border-emerald-100",
    warning: "bg-amber-50 text-amber-800 border-amber-100",
    danger: "bg-rose-50 text-rose-700 border-rose-100",
  }[tone];
  return (
    <div
      className={`flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm ${styles}`}
    >
      {icon && <span className="shrink-0 mt-0.5 [&>svg]:size-4">{icon}</span>}
      <div className="flex-1">{children}</div>
    </div>
  );
}

/* ---- Empty state ------------------------------------------- */

export function EmptyState({
  title,
  hint,
  icon,
  action,
}: {
  title: string;
  hint?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-14 px-6 text-center">
      {icon && (
        <div className="mb-3 size-12 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-300 [&>svg]:size-6">
          {icon}
        </div>
      )}
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {hint && <p className="text-xs mt-1 max-w-xs text-slate-400">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ---- Loading (spinner + skeleton) -------------------------- */

export function Spinner({ className = "size-4" }: { className?: string }) {
  return (
    <span
      className={`inline-block ${className} rounded-full border-2 border-current border-t-transparent animate-spin`}
    />
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <span className={`block rounded-lg skeleton ${className}`} />;
}

/* ---- Segmented tabs (links) -------------------------------- */

export function SegmentedItem({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`px-3.5 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition ${
        active
          ? "bg-white text-brand-700 shadow-xs"
          : "text-slate-500 hover:text-slate-800"
      }`}
    >
      {children}
    </span>
  );
}
