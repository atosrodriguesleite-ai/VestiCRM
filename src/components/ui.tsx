import { initials } from "@/lib/format";

export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-white rounded-2xl border border-gray-100 shadow-card ${className}`}
    >
      {children}
    </div>
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
    <div className="flex items-start justify-between gap-4 mb-6">
      <div>
        <h1 className="text-xl md:text-2xl font-semibold tracking-tight">
          {title}
        </h1>
        {subtitle && <p className="text-sm text-gray-500 mt-1">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Badge({
  children,
  color = "#7c3aed",
}: {
  children: React.ReactNode;
  color?: string;
}) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap"
      style={{ backgroundColor: `${color}1a`, color }}
    >
      {children}
    </span>
  );
}

export function Avatar({
  name,
  color = "#7c3aed",
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
      className={`${cls} rounded-full inline-flex items-center justify-center font-semibold text-white shrink-0`}
      style={{ backgroundColor: color }}
      title={name}
    >
      {initials(name)}
    </span>
  );
}

const convStatusStyles: Record<string, string> = {
  OPEN: "bg-emerald-50 text-emerald-700",
  WAITING_CLIENT: "bg-amber-50 text-amber-700",
  WAITING_PAYMENT: "bg-orange-50 text-orange-700",
  CLOSED: "bg-gray-100 text-gray-500",
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
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${convStatusStyles[status] ?? "bg-gray-100 text-gray-600"}`}
    >
      {label}
    </span>
  );
}

export function PriorityDot({ priority }: { priority: string }) {
  const color =
    priority === "ALTA"
      ? "bg-rose-500"
      : priority === "MEDIA"
        ? "bg-amber-400"
        : "bg-gray-300";
  return <span className={`size-2 rounded-full inline-block ${color}`} />;
}

export function EmptyState({
  title,
  hint,
  icon,
}: {
  title: string;
  hint?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center text-gray-400">
      {icon && <div className="mb-3 [&>svg]:size-8">{icon}</div>}
      <p className="text-sm font-medium text-gray-500">{title}</p>
      {hint && <p className="text-xs mt-1 max-w-xs">{hint}</p>}
    </div>
  );
}
