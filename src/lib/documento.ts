/**
 * CPF E CNPJ — dois documentos, dois campos.
 *
 * Pedido da lojista (31/07/2026): "alguma transportadora usa CNPJ e outra usa
 * CPF, então eu preciso dos dois". É a realidade do atacado — a cliente é uma
 * loja (CNPJ) mas quem assina/recebe é a titular (CPF), e cada destino pede
 * um deles:
 *
 *   • Melhor Envio: CPF vai no campo `document`, CNPJ no `company_document`;
 *   • NF-e (Bling): CNPJ = pessoa jurídica, CPF = pessoa física;
 *   • declaração de conteúdo: imprime o que houver.
 *
 * Aqui mora TUDO que tem a ver com esses documentos: limpar, formatar e
 * CONFERIR OS DÍGITOS. A conferência importa de verdade: CPF digitado errado
 * só aparece lá na frente, quando a transportadora recusa a etiqueta ou a
 * Receita rejeita a nota — com a venda já fechada e a cliente esperando.
 */

/** Só os números (o resto é máscara que a pessoa digitou). */
export function soDigitos(v: string | null | undefined): string {
  return (v ?? "").replace(/\D/g, "");
}

/** 000.000.000-00 */
export function formatarCpf(v: string | null | undefined): string {
  const d = soDigitos(v).slice(0, 11);
  if (d.length !== 11) return v?.trim() ?? "";
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** 00.000.000/0000-00 */
export function formatarCnpj(v: string | null | undefined): string {
  const d = soDigitos(v).slice(0, 14);
  if (d.length !== 14) return v?.trim() ?? "";
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/**
 * CPF válido? Confere os dois dígitos verificadores.
 *
 * Também recusa os "repetidos" (111.111.111-11 e afins): eles passam na
 * conta, mas não existem — é o erro clássico de quem preenche por preencher.
 */
export function cpfValido(v: string | null | undefined): boolean {
  const d = soDigitos(v);
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;
  for (const [ate, pos] of [
    [9, 10],
    [10, 11],
  ] as const) {
    let soma = 0;
    for (let i = 0; i < ate; i++) soma += Number(d[i]) * (pos - i);
    const resto = (soma * 10) % 11 % 10;
    if (resto !== Number(d[ate])) return false;
  }
  return true;
}

/** CNPJ válido? Mesma ideia, com os pesos próprios do CNPJ. */
export function cnpjValido(v: string | null | undefined): boolean {
  const d = soDigitos(v);
  if (d.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(d)) return false;
  const conta = (ate: number): number => {
    let peso = ate - 7;
    let soma = 0;
    for (let i = 0; i < ate; i++) {
      soma += Number(d[i]) * peso--;
      if (peso < 2) peso = 9;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return conta(12) === Number(d[12]) && conta(13) === Number(d[13]);
}

export type DocumentosDoCliente = {
  cpf?: string | null;
  cnpj?: string | null;
};

/**
 * Como o documento aparece na tela, no PDF e na declaração.
 *
 * Tem os dois? Mostra os dois, cada um com o nome certo — quem confere a
 * etiqueta precisa saber qual é qual. Tem um só? Mostra só ele.
 */
export function documentoParaMostrar(c: DocumentosDoCliente): string {
  return [
    c.cnpj ? `CNPJ: ${formatarCnpj(c.cnpj)}` : null,
    c.cpf ? `CPF: ${formatarCpf(c.cpf)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * QUAL DOCUMENTO MANDA NA NOTA FISCAL.
 *
 * A NF-e aceita UM documento e ele decide se a nota é de pessoa jurídica ou
 * física. Tendo CNPJ, é a loja que compra (pessoa jurídica) — é o caso normal
 * do atacado. Só sem CNPJ é que vale o CPF.
 */
export function documentoFiscal(
  c: DocumentosDoCliente
): { numero: string; tipoPessoa: "J" | "F" } | null {
  const cnpj = soDigitos(c.cnpj);
  if (cnpj.length === 14) return { numero: cnpj, tipoPessoa: "J" };
  const cpf = soDigitos(c.cpf);
  if (cpf.length === 11) return { numero: cpf, tipoPessoa: "F" };
  return null;
}

/**
 * CONFERE O QUE FOI DIGITADO antes de gravar.
 *
 * Devolve a mensagem de erro (em português, para a vendedora ler) ou `null`
 * quando está tudo certo. Campo vazio é permitido — o documento é opcional;
 * o que não pode é ficar gravado um número que não existe.
 */
export function conferirDocumentos(c: DocumentosDoCliente): string | null {
  if (soDigitos(c.cpf) && !cpfValido(c.cpf))
    return "CPF inválido — confira os números digitados.";
  if (soDigitos(c.cnpj) && !cnpjValido(c.cnpj))
    return "CNPJ inválido — confira os números digitados.";
  return null;
}

/** Como o documento vai para o banco: só os dígitos, ou nada. */
export function guardarDocumento(v: string | null | undefined): string | null {
  return soDigitos(v) || null;
}

/**
 * O que guardar quando chega um documento SEM saber qual é (importação da
 * Nuvemshop, colagem de mensagem): 14 dígitos é CNPJ, 11 é CPF.
 */
export function separarDocumento(v: string | null | undefined): {
  cpf: string | null;
  cnpj: string | null;
} {
  const d = soDigitos(v);
  if (d.length === 14) return { cpf: null, cnpj: d };
  if (d.length === 11) return { cpf: d, cnpj: null };
  return { cpf: null, cnpj: null };
}
