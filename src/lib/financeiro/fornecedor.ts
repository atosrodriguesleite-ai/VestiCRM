import { z } from "zod";
import { db } from "../db";
import { guardarDocumento } from "../documento";
import { conferirDocumentosFornecedor } from "./cadastros";

/**
 * A FICHA DO FORNECEDOR (RN-027) — validação e normalização num lugar só,
 * usada pelo POST (criar) e pelo PATCH (editar, que manda a ficha inteira).
 */

export const fornecedorSchema = z.object({
  nome: z.string().trim().min(1).max(120),
  razaoSocial: z.string().trim().max(160).nullish(),
  cnpj: z.string().trim().max(20).nullish(),
  cpf: z.string().trim().max(15).nullish(),
  ie: z.string().trim().max(20).nullish(),
  telefone: z.string().trim().max(20).nullish(),
  email: z.string().trim().email().max(120).nullish().or(z.literal("")),
  chavePix: z.string().trim().max(120).nullish(),
  dadosBancarios: z.string().trim().max(300).nullish(),
  observacoes: z.string().trim().max(1000).nullish(),
  categoriaPadraoId: z.string().nullish(),
});

export type FornecedorInput = z.infer<typeof fornecedorSchema>;

/** A ficha no formato do banco — tipada campo a campo (o Prisma exige). */
export type FornecedorData = {
  nome: string;
  razaoSocial: string | null;
  cnpj: string | null;
  cpf: string | null;
  ie: string | null;
  telefone: string | null;
  email: string | null;
  chavePix: string | null;
  dadosBancarios: string | null;
  observacoes: string | null;
  categoriaPadraoId: string | null;
};

/**
 * Confere e normaliza a ficha para o formato do banco (dígitos, nulls).
 * Devolve `{ erro }` com mensagem para a tela, ou `{ data }` pronto para
 * gravar. A IE só fica se houver CNPJ (mesma regra do cliente, RN-024 —
 * apagou o CNPJ, some a IE).
 */
export async function corpoDoFornecedor(
  companyId: string,
  dados: FornecedorInput
): Promise<{ erro: string } | { data: FornecedorData }> {
  const erroDoc = conferirDocumentosFornecedor(dados);
  if (erroDoc) return { erro: erroDoc };

  // categoria padrão precisa ser DESTA loja (RN-013), de DESPESA (fornecedor
  // é o lado de pagar) e NÃO arquivada — "arquivado some das escolhas novas"
  if (dados.categoriaPadraoId) {
    const cat = await db.finCategoria.findFirst({
      where: {
        id: dados.categoriaPadraoId,
        companyId,
        tipo: "DESPESA",
        arquivadaEm: null,
      },
    });
    if (!cat) return { erro: "Categoria padrão não encontrada" };
  }
  const cnpj = guardarDocumento(dados.cnpj);
  return {
    data: {
      nome: dados.nome,
      razaoSocial: dados.razaoSocial?.trim() || null,
      cnpj,
      cpf: guardarDocumento(dados.cpf),
      ie: cnpj ? dados.ie?.trim() || null : null,
      telefone: dados.telefone?.trim() || null,
      email: dados.email?.trim() || null,
      chavePix: dados.chavePix?.trim() || null,
      dadosBancarios: dados.dadosBancarios?.trim() || null,
      observacoes: dados.observacoes?.trim() || null,
      categoriaPadraoId: dados.categoriaPadraoId || null,
    },
  };
}
