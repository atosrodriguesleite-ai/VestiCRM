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
