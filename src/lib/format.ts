import type {
  CustomerType,
  Origin,
  ConversationStatus,
  TaskType,
  TaskPriority,
  Role,
  TemplateCategory,
  MessageStatus,
  Channel,
} from "@prisma/client";

export const brl = (v: number) =>
  v.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: v % 1 === 0 ? 0 : 2,
  });

// Fuso oficial do produto: horário de São Paulo/Brasília. O servidor
// (Vercel) roda em UTC — sem fixar o fuso, as horas saem 3h à frente.
export const TIMEZONE = "America/Sao_Paulo";

export const dateShort = (d: Date | string) =>
  new Date(d).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    timeZone: TIMEZONE,
  });

export const dateFull = (d: Date | string) =>
  new Date(d).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: TIMEZONE,
  });

export const timeShort = (d: Date | string) =>
  new Date(d).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIMEZONE,
  });

export function relativeDays(d: Date | string): string {
  const diff = Math.floor(
    (Date.now() - new Date(d).getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diff <= 0) return "hoje";
  if (diff === 1) return "ontem";
  return `há ${diff} dias`;
}

export function daysSince(d: Date | string): number {
  return Math.floor(
    (Date.now() - new Date(d).getTime()) / (1000 * 60 * 60 * 24)
  );
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function formatPhone(p: string): string {
  const digits = p.replace(/\D/g, "").replace(/^55/, "");
  if (digits.length === 11)
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  return p;
}

export const customerTypeLabel: Record<CustomerType, string> = {
  VAREJO: "Varejo",
  ATACADO: "Atacado",
  REVENDEDORA: "Revendedora",
  LOJISTA: "Lojista",
  BOUTIQUE: "Boutique",
  SACOLEIRA: "Sacoleira",
};

/** Cor da etiqueta de cada canal de origem (identificação num relance). */
export const originColor: Record<Origin, string> = {
  WHATSAPP: "#1FA855",
  CATALOGO_PUBLICO: "#C4622D",
  INSTAGRAM: "#D6367F",
  FACEBOOK: "#1877F2",
  SITE: "#475569",
  NUVEMSHOP: "#0891B2",
  BLING: "#059669",
  MARKETPLACE: "#D97706",
  INDICACAO: "#0D9488",
  LOJA_FISICA: "#B45309",
  TRAFEGO_PAGO: "#7C3AED",
  GOOGLE: "#4285F4",
  EVENTO: "#8B5CF6",
  MANUAL: "#64748B",
  TELEGRAM: "#0EA5E9",
  EMAIL: "#64748B",
  SMS: "#64748B",
};

export const originLabel: Record<Origin, string> = {
  WHATSAPP: "WhatsApp",
  CATALOGO_PUBLICO: "Catálogo geral",
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
  SITE: "Site",
  NUVEMSHOP: "Nuvemshop",
  BLING: "Bling",
  MARKETPLACE: "Marketplace",
  INDICACAO: "Indicação",
  LOJA_FISICA: "Loja física",
  TRAFEGO_PAGO: "Tráfego pago",
  GOOGLE: "Google",
  EVENTO: "Evento",
  MANUAL: "Cadastro Manual",
  TELEGRAM: "Telegram",
  EMAIL: "E-mail",
  SMS: "SMS",
};

export const conversationStatusLabel: Record<ConversationStatus, string> = {
  OPEN: "Aberta",
  WAITING_CLIENT: "Aguardando cliente",
  WAITING_PAYMENT: "Aguardando pagamento",
  CLOSED: "Finalizada",
};

export const taskTypeLabel: Record<TaskType, string> = {
  LIGAR: "Ligar para cliente",
  ENVIAR_CATALOGO: "Enviar catálogo",
  COBRAR_PAGAMENTO: "Cobrar pagamento",
  POS_VENDA: "Pós-venda",
  REATIVAR: "Reativar cliente",
  ENVIAR_NOVIDADES: "Enviar novidades",
  CONFIRMAR_ENTREGA: "Confirmar entrega",
  FOLLOW_UP: "Follow-up",
  OUTRO: "Outro",
};

export const priorityLabel: Record<TaskPriority, string> = {
  BAIXA: "Baixa",
  MEDIA: "Média",
  ALTA: "Alta",
};

export const templateCategoryLabel: Record<TemplateCategory, string> = {
  PRIMEIRO_ATENDIMENTO: "Primeiro atendimento",
  CATALOGO: "Catálogo",
  COBRANCA: "Cobrança",
  POS_VENDA: "Pós-venda",
  RECOMPRA: "Recompra",
  PROMOCAO: "Promoção",
  CLIENTE_FRIO: "Cliente frio",
  ANIVERSARIO: "Aniversário",
  OUTRO: "Outros",
};

export const messageStatusLabel: Record<MessageStatus, string> = {
  ENVIANDO: "Enviando",
  ENVIADA: "Enviada",
  ENTREGUE: "Entregue",
  LIDA: "Lida",
  FALHOU: "Falhou",
  REENVIADA: "Reenviada",
  RECEBIDA: "Recebida",
};

export const channelLabel: Record<Channel, string> = {
  WHATSAPP: "WhatsApp",
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
  TELEGRAM: "Telegram",
  EMAIL: "E-mail",
  SMS: "SMS",
};

export const roleLabel: Record<Role, string> = {
  SUPERADMIN: "Superadmin",
  ADMIN: "Administrador",
  MANAGER: "Gerente",
  SELLER: "Vendedor(a)",
  SUPPORT: "Suporte",
};
