import { z } from "zod";

/**
 * O QUE A API ACEITA numa ficha de funcionário (RN-025) — compartilhado entre
 * criar e editar, para as duas portas nunca discordarem.
 *
 * A foto tem teto de ~2 MB (data-URL) e os textos têm limite: ficha de RH é
 * digitada por gente, não por integração — campo sem teto vira depósito.
 */
export const fichaSchema = z.object({
  nome: z.string().min(1).max(120),
  // só data-URL: um endereço externo aqui viraria <img src> na tela e cada
  // admin que abrisse a Equipe entregaria o próprio IP ao servidor do link
  fotoUrl: z.string().startsWith("data:").max(2_000_000).nullable().optional(),
  nascimento: z.string().nullable().optional(),
  cpf: z.string().max(20).nullable().optional(),
  telefone: z.string().max(25).nullable().optional(),
  email: z.string().max(120).nullable().optional(),
  zip: z.string().max(12).nullable().optional(),
  street: z.string().max(160).nullable().optional(),
  streetNumber: z.string().max(20).nullable().optional(),
  complement: z.string().max(80).nullable().optional(),
  district: z.string().max(80).nullable().optional(),
  city: z.string().max(80).nullable().optional(),
  state: z.string().max(2).nullable().optional(),
  cargo: z.string().max(80).nullable().optional(),
  vinculo: z.enum(["CLT", "MEI_PJ", "DIARISTA", "ESTAGIO", "INFORMAL"]).optional(),
  inicio: z.string().nullable().optional(),
  remuneracao: z.number().min(0).optional(),
  periodicidade: z.enum(["MENSAL", "SEMANAL", "DIARIA", "POR_PECA"]).optional(),
  formaPagamento: z.enum(["PIX", "DINHEIRO", "TRANSFERENCIA"]).optional(),
  chavePix: z.string().max(120).nullable().optional(),
  banco: z.string().max(80).nullable().optional(),
  agencia: z.string().max(20).nullable().optional(),
  conta: z.string().max(30).nullable().optional(),
  emergenciaNome: z.string().max(120).nullable().optional(),
  emergenciaParentesco: z.string().max(40).nullable().optional(),
  emergenciaTelefone: z.string().max(25).nullable().optional(),
  restricaoAlimentar: z.string().max(300).nullable().optional(),
  alergias: z.string().max(300).nullable().optional(),
  beneficios: z.array(z.string().max(60)).max(12).optional(),
  observacoes: z.string().max(2000).nullable().optional(),
});

/** "2026-08-26" (do input date) ou ISO completo → Date; lixo → null. */
export const dataOuNull = (v: string | null | undefined) => {
  if (!v) return null;
  const t = Date.parse(v.length === 10 ? `${v}T12:00:00Z` : v);
  return Number.isNaN(t) ? null : new Date(t);
};

/**
 * Converte o corpo validado para o formato do banco (datas de verdade).
 *
 * Campo AUSENTE fica ausente: o PATCH parcial (ex.: desligar/reativar manda só
 * `desligamento`) não pode apagar nascimento e data de início por tabela —
 * transformar ausente em null já perdeu dados aqui.
 */
export function corpoDaFicha(d: Partial<z.infer<typeof fichaSchema>>) {
  const { nascimento, inicio, ...resto } = d;
  return {
    ...resto,
    ...(nascimento !== undefined ? { nascimento: dataOuNull(nascimento) } : {}),
    ...(inicio !== undefined ? { inicio: dataOuNull(inicio) } : {}),
  };
}

// ---- Formulário público do funcionário (RN-025, link sem login) -------------

/** O link ESCREVE (via conferência) — então vence, como o da cliente (RN-024). */
export const VALIDADE_LINK_FICHA_MS = 7 * 24 * 60 * 60 * 1000;

/** Teto de anexos por link: segura abuso de quem pegar o link no meio. */
export const TETO_DOCS_POR_LINK = 15;

/** Link serve? Vencido ou JÁ USADO (uso único) não abre nem grava mais. */
export function linkUtilizavel(
  l: { expiresAt: Date; usadoEm: Date | null },
  agora: Date = new Date()
): boolean {
  return l.usadoEm === null && l.expiresAt.getTime() > agora.getTime();
}

/**
 * O QUE O FUNCIONÁRIO PODE MANDAR pelo link — recorte do fichaSchema por
 * lista do que ENTRA: cargo, vínculo, remuneração, benefícios e observações
 * são da EMPRESA e não existem aqui (mandar junto é descartado pelo zod).
 * O aceite LGPD é obrigatório e tem que ser literalmente `true`.
 */
export const formFichaSchema = fichaSchema
  .pick({
    // o NOME é do próprio funcionário (é a ficha DELE): ele confere e
    // corrige o que o admin digitou às pressas ("Maria da costura" vira
    // "Maria Aparecida da Silva"). Nada entra sozinho — a resposta fica
    // aguardando a conferência do admin, como todo o resto (RN-025).
    nome: true,
    fotoUrl: true,
    nascimento: true,
    cpf: true,
    telefone: true,
    email: true,
    zip: true,
    street: true,
    streetNumber: true,
    complement: true,
    district: true,
    city: true,
    state: true,
    chavePix: true,
    banco: true,
    agencia: true,
    conta: true,
    emergenciaNome: true,
    emergenciaParentesco: true,
    emergenciaTelefone: true,
    restricaoAlimentar: true,
    alergias: true,
  })
  .extend({
    // na FICHA o nome é obrigatório; no FORMULÁRIO é opcional — quem não
    // mexer no campo não pode ser barrado, e em branco não apaga o nome
    // que já está na ficha (mesma régua de todo o resto: só o preenchido
    // viaja e só entra depois da conferência do admin)
    nome: z.string().trim().min(1).max(120).optional(),
    dependentes: z
      .array(
        z.object({
          nome: z.string().trim().min(1).max(120),
          nascimento: z.string().nullable().optional(),
        })
      )
      .max(10)
      .optional(),
    aceiteLGPD: z.literal(true),
  });

/**
 * A resposta guardada para conferência: SÓ o que veio preenchido. Campo em
 * branco não viaja — o funcionário deixar vazio não pode apagar o que o
 * admin já preencheu (mesma lição do PATCH parcial, acima).
 */
export function limparResposta(d: z.infer<typeof formFichaSchema>) {
  const { aceiteLGPD: _aceite, dependentes, ...campos } = d;
  const resposta: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(campos)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && !v.trim()) continue;
    resposta[k] = typeof v === "string" ? v.trim() : v;
  }
  if (dependentes && dependentes.length > 0) resposta.dependentes = dependentes;
  return resposta;
}

/**
 * CONFERÊNCIA APROVADA → o que gravar na ficha. Revalida a resposta guardada
 * (Json no banco não é confiável por definição) e converte datas; devolve
 * null se ela não fizer mais sentido — aí a conferência recusa em vez de
 * gravar lixo.
 */
export function aplicarResposta(resposta: unknown): {
  dados: Record<string, unknown>;
  dependentes: { nome: string; nascimento: string | null }[];
} | null {
  if (!resposta || typeof resposta !== "object") return null;
  const parsed = formFichaSchema.omit({ aceiteLGPD: true }).safeParse(resposta);
  if (!parsed.success) return null;
  const { dependentes, ...campos } = parsed.data;
  // presença = veio preenchido (limparResposta já cortou os vazios)
  const presentes = Object.fromEntries(
    Object.entries(campos).filter(([, v]) => v !== undefined)
  );
  return {
    dados: corpoDaFicha(presentes),
    dependentes: (dependentes ?? []).map((d) => ({
      nome: d.nome,
      nascimento: d.nascimento ?? null,
    })),
  };
}
