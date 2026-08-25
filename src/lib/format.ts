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

/**
 * Lê um valor em reais digitado à brasileira ("1.000,50", "35,9", "1.000").
 * Ponto seguido de 3 dígitos é separador de MILHAR — sem essa regra,
 * "1.000" no campo de desconto virava R$ 1,00 (parseFloat para no 2º ponto).
 * Valor inválido ou negativo vira 0: os campos de dinheiro das telas são
 * todos não-negativos (o servidor rejeitaria com um erro genérico).
 */
export function numeroBR(texto: string): number {
  const limpo = texto.replace(/[^\d.,-]/g, "");
  const semMilhar = limpo.replace(/\.(?=\d{3}(?:\D|$))/g, "");
  const n = Number(semMilhar.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * MÁSCARA DO TELEFONE ENQUANTO A CLIENTE DIGITA — "(75) 99128-9575".
 *
 * Incidente Toque Leve (agosto/2026): duas clientes seguidas mandaram o
 * pedido do catálogo com o ÚLTIMO dígito errado. O campo do catálogo era o
 * único do sistema sem teclado numérico e sem máscara: a cliente digitava
 * onze dígitos crus, no teclado de letras, e um número errado passava sem
 * ninguém perceber — nascia um cadastro fantasma e a resposta da loja não
 * chegava em ninguém.
 *
 * Com a máscara, dígito faltando ou sobrando fica VISÍVEL na hora, porque o
 * formato não fecha. Número internacional (começa com "+") passa cru: a
 * máscara é brasileira e não pode atrapalhar quem é de fora.
 */
export function mascaraTelefoneBR(texto: string): string {
  if (texto.trim().startsWith("+")) return texto;
  // DDI 55 digitado junto some do visor — o que importa é o número brasileiro.
  // A regra do "55" mora num lugar só (telefoneNacional), senão as duas cópias
  // dela neste arquivo iam separando com o tempo.
  const d = telefoneNacional(texto);
  // MAIS DÍGITOS DO QUE CABE: passa CRU, nunca corta. Cortar em silêncio era
  // pior que o problema — "55 75 99128-9575" virava "(55) 75991-2895", um
  // número diferente e válido, que passava na conferência e criava o cadastro
  // fantasma que esta entrega veio evitar (achado da revisão).
  if (d.length > 11) return texto;
  if (d.length <= 2) return d ? `(${d}` : "";
  const ddd = d.slice(0, 2);
  const resto = d.slice(2);
  if (resto.length <= 4) return `(${ddd}) ${resto}`;
  const corte = resto.length <= 8 ? 4 : 5;
  return `(${ddd}) ${resto.slice(0, corte)}-${resto.slice(corte)}`;
}

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

/**
 * O NÚMERO DO JEITO QUE SE USA NO BRASIL — sem o 55 da frente.
 *
 * O sistema guarda todo telefone com o DDI ("5511910880083", 13 dígitos) para
 * casar com o WhatsApp. Quem lê esse número esperando um telefone brasileiro
 * (uma etiqueta de transportadora, por exemplo) toma o "55" como DDD e o
 * número sai TORTO: "(55) 11910-8800" — trocado e ainda por cima com os dois
 * últimos dígitos cortados. Foi assim que a etiqueta do Melhor Envio saiu com
 * um telefone que não era o da cliente.
 *
 * O 55 só cai quando é REALMENTE o DDI: número brasileiro tem 10 ou 11
 * dígitos, então DDI + número dá 12 ou 13. Tirar "55" de qualquer telefone
 * estragaria o DDD 55 de verdade, que existe (Santa Maria/RS).
 */
export function telefoneNacional(raw: string | null | undefined): string {
  const d = (raw ?? "").replace(/\D/g, "");
  return (d.length === 12 || d.length === 13) && d.startsWith("55")
    ? d.slice(2)
    : d;
}

export function formatPhone(p: string): string {
  const digits = telefoneNacional(p);
  if (digits.length === 11)
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10)
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
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
