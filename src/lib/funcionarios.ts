import type {
  Funcionario,
  FuncionarioVinculo,
  FuncionarioDocTipo,
  PeriodicidadePagamento,
  FormaPagamentoFuncionario,
} from "@prisma/client";

/**
 * FICHA DE FUNCIONÁRIO (RN-025) — as regras, fora de qualquer tela.
 *
 * A ficha é um registro de RH da EMPRESA, sem vínculo com login: a maior
 * parte dos funcionários (costureira, diarista, facção) nunca entra no
 * sistema. Três regras que decidem tudo:
 *
 *  1. QUEM VÊ O QUÊ. Salário, documentos, CPF/endereço, dependentes e
 *     observações internas: SÓ ADMIN. Gerente vê o básico + emergência e
 *     alergias (é para isso que servem numa emergência). Vendedora: nada.
 *     O recorte acontece AQUI, no servidor — a tela nunca recebe o que o
 *     papel não pode ver.
 *  2. FICHA NUNCA É APAGADA. Questão trabalhista dura anos: desligar
 *     arquiva, com data e motivo, e o histórico (salário, desligamento)
 *     fica registrado com quem e quando.
 *  3. DOCUMENTO VENCE. ASO, CNH e comprovante de residência têm validade;
 *     o sistema avisa antes de vencer em vez de deixar descobrir na hora
 *     da fiscalização.
 */

export const vinculoLabel: Record<FuncionarioVinculo, string> = {
  CLT: "CLT",
  MEI_PJ: "MEI / PJ",
  DIARISTA: "Diarista",
  ESTAGIO: "Estágio",
  INFORMAL: "Informal",
};

export const periodicidadeLabel: Record<PeriodicidadePagamento, string> = {
  MENSAL: "por mês",
  SEMANAL: "por semana",
  DIARIA: "por dia",
  POR_PECA: "por peça",
};

export const formaPagamentoLabel: Record<FormaPagamentoFuncionario, string> = {
  PIX: "Pix",
  DINHEIRO: "Dinheiro",
  TRANSFERENCIA: "Transferência",
};

export const docTipoLabel: Record<FuncionarioDocTipo, string> = {
  RG: "RG",
  CNH: "CNH",
  CPF_DOC: "CPF",
  COMPROVANTE_RESIDENCIA: "Comprovante de residência",
  TITULO_ELEITOR: "Título de eleitor",
  RESERVISTA: "Reservista",
  ESCOLARIDADE: "Escolaridade",
  CERTIDAO: "Certidão (nascimento/casamento)",
  ASO: "ASO (exame admissional/periódico)",
  CONTRATO: "Contrato",
  VACINACAO: "Caderneta de vacinação (dependente)",
  FREQUENCIA_ESCOLAR: "Frequência escolar (dependente)",
  OUTRO: "Outro documento",
};

/** Benefícios marcáveis na ficha (com observação livre ao lado). */
export const BENEFICIOS = [
  "Vale-transporte",
  "Plano de saúde",
  "Vale-refeição/alimentação",
  "Cesta básica",
] as const;

/**
 * Checklist de documentos por vínculo — o que faz sentido PEDIR.
 *
 * O checklist de admissão CLT completo não serve para a diarista nem para o
 * MEI: pedir reservista de quem emite nota é digitação inútil. A lista se
 * adapta, e "OUTRO" está sempre disponível.
 */
export const CHECKLIST_POR_VINCULO: Record<FuncionarioVinculo, FuncionarioDocTipo[]> = {
  CLT: [
    "RG",
    "CPF_DOC",
    "COMPROVANTE_RESIDENCIA",
    "TITULO_ELEITOR",
    "RESERVISTA",
    "ESCOLARIDADE",
    "CERTIDAO",
    "ASO",
    "CONTRATO",
  ],
  MEI_PJ: ["RG", "CPF_DOC", "CONTRATO"],
  ESTAGIO: ["RG", "CPF_DOC", "COMPROVANTE_RESIDENCIA", "ESCOLARIDADE", "CONTRATO"],
  DIARISTA: ["RG", "CPF_DOC"],
  INFORMAL: ["RG", "CPF_DOC"],
};

/**
 * O que ainda falta anexar para o vínculo — contando SÓ documento do próprio
 * funcionário: a certidão do filho (dependenteId preenchido) não satisfaz a
 * exigência do pai, senão o checklist fecha verde com a pasta incompleta.
 */
export function documentosFaltantes(
  vinculo: FuncionarioVinculo,
  documentos: { tipo: FuncionarioDocTipo; dependenteId: string | null }[]
): FuncionarioDocTipo[] {
  return CHECKLIST_POR_VINCULO[vinculo].filter(
    (t) => !documentos.some((d) => d.tipo === t && !d.dependenteId)
  );
}

/** Quantos dias antes do vencimento o aviso começa. */
export const DIAS_AVISO_VENCIMENTO = 30;

export type SituacaoDocumento = "SEM_VALIDADE" | "OK" | "VENCENDO" | "VENCIDO";

/** ASO, CNH, comprovante… vencido não é achismo: é conta de calendário. */
export function situacaoDoDocumento(
  validade: Date | string | null | undefined,
  agora: Date = new Date()
): SituacaoDocumento {
  if (!validade) return "SEM_VALIDADE";
  const v = new Date(validade).getTime();
  if (v < agora.getTime()) return "VENCIDO";
  const diasRestantes = (v - agora.getTime()) / 86_400_000;
  return diasRestantes <= DIAS_AVISO_VENCIMENTO ? "VENCENDO" : "OK";
}

/** A ficha que o GERENTE recebe: básico + emergência/alergias, e nada mais. */
export type FichaBasica = {
  id: string;
  nome: string;
  fotoUrl: string | null;
  nascimento: string | null;
  telefone: string | null;
  cargo: string | null;
  vinculo: FuncionarioVinculo;
  inicio: string | null;
  desligamento: string | null;
  emergenciaNome: string | null;
  emergenciaParentesco: string | null;
  emergenciaTelefone: string | null;
  restricaoAlimentar: string | null;
  alergias: string | null;
};

/**
 * O RECORTE DO GERENTE É POR LISTA DO QUE ENTRA, nunca do que sai.
 *
 * Filtrar "tirando os campos proibidos" quebra em silêncio: o próximo campo
 * sensível adicionado à ficha (um novo dado bancário, por exemplo) passaria
 * direto para o gerente até alguém lembrar de escondê-lo. Montando o objeto
 * só com o que PODE, campo novo nasce invisível — errar aqui é errar para o
 * lado seguro.
 */
export function fichaBasica(f: Funcionario): FichaBasica {
  return {
    id: f.id,
    nome: f.nome,
    fotoUrl: f.fotoUrl,
    nascimento: f.nascimento?.toISOString() ?? null,
    telefone: f.telefone,
    cargo: f.cargo,
    vinculo: f.vinculo,
    inicio: f.inicio?.toISOString() ?? null,
    desligamento: f.desligamento?.toISOString() ?? null,
    emergenciaNome: f.emergenciaNome,
    emergenciaParentesco: f.emergenciaParentesco,
    emergenciaTelefone: f.emergenciaTelefone,
    restricaoAlimentar: f.restricaoAlimentar,
    alergias: f.alergias,
  };
}

/** Linha do histórico quando o salário muda — sem expor o valor antigo à toa. */
export function descricaoMudancaSalario(
  antes: { remuneracao: number; periodicidade: PeriodicidadePagamento },
  depois: { remuneracao: number; periodicidade: PeriodicidadePagamento }
): string | null {
  if (
    antes.remuneracao === depois.remuneracao &&
    antes.periodicidade === depois.periodicidade
  )
    return null;
  const fmt = (v: number, p: PeriodicidadePagamento) =>
    `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} ${periodicidadeLabel[p]}`;
  return `Remuneração alterada: ${fmt(antes.remuneracao, antes.periodicidade)} → ${fmt(
    depois.remuneracao,
    depois.periodicidade
  )}`;
}
