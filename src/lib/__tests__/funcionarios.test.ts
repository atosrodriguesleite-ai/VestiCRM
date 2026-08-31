// Guarda RN-025
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Funcionario } from "@prisma/client";
import {
  fichaBasica,
  situacaoDoDocumento,
  descricaoMudancaSalario,
  documentosFaltantes,
  chaveDoDependente,
  CHECKLIST_POR_VINCULO,
  DIAS_AVISO_VENCIMENTO,
  vinculoLabel,
} from "../funcionarios";
import {
  fichaSchema,
  corpoDaFicha,
  dataOuNull,
  formFichaSchema,
  limparResposta,
  aplicarResposta,
  linkUtilizavel,
  VALIDADE_LINK_FICHA_MS,
} from "../ficha-funcionario";

/**
 * RN-025 · FICHA DE FUNCIONÁRIO — registro de RH da EMPRESA, sem vínculo com
 * login. As três regras que este arquivo defende:
 *
 *  1. salário, documentos, CPF/endereço, dependentes e observações: SÓ ADMIN
 *     — o recorte do gerente é montado por lista do que ENTRA, no servidor;
 *  2. ficha NUNCA é apagada — desligar arquiva, e a API nem tem DELETE;
 *  3. documento com validade vence e o sistema avisa antes.
 */

const FICHA: Funcionario = {
  id: "f1",
  companyId: "c1",
  nome: "Maria das Costuras",
  fotoUrl: null,
  nascimento: new Date("1990-05-10T12:00:00Z"),
  cpf: "123.456.789-00",
  telefone: "75999990000",
  email: "maria@exemplo.com",
  zip: "44000-000",
  street: "Rua das Flores",
  streetNumber: "10",
  complement: null,
  district: "Centro",
  city: "Feira de Santana",
  state: "BA",
  cargo: "Costureira",
  vinculo: "CLT",
  inicio: new Date("2026-01-05T12:00:00Z"),
  desligamento: null,
  motivoDesligamento: null,
  remuneracao: 2200,
  periodicidade: "MENSAL",
  formaPagamento: "PIX",
  chavePix: "75999990000",
  banco: null,
  agencia: null,
  conta: null,
  emergenciaNome: "João",
  emergenciaParentesco: "esposo",
  emergenciaTelefone: "75988880000",
  restricaoAlimentar: "sem lactose",
  alergias: "dipirona",
  beneficios: ["Vale-transporte"],
  observacoes: "anotação interna",
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("o que o GERENTE recebe (fichaBasica)", () => {
  const basica = fichaBasica(FICHA) as Record<string, unknown>;

  it("recebe o básico + emergência e saúde (para isso servem numa emergência)", () => {
    expect(basica.nome).toBe("Maria das Costuras");
    expect(basica.cargo).toBe("Costureira");
    expect(basica.emergenciaNome).toBe("João");
    expect(basica.alergias).toBe("dipirona");
    expect(basica.restricaoAlimentar).toBe("sem lactose");
  });

  it("NÃO recebe salário, pagamento, CPF, endereço nem observações", () => {
    // o recorte é por lista do que ENTRA: campo sensível novo nasce invisível
    for (const proibido of [
      "remuneracao", "periodicidade", "formaPagamento", "chavePix", "banco",
      "agencia", "conta", "cpf", "email", "zip", "street", "streetNumber",
      "district", "city", "state", "observacoes", "beneficios",
      "motivoDesligamento",
    ])
      expect(basica, proibido).not.toHaveProperty(proibido);
  });
});

describe("ficha nunca é apagada", () => {
  it("a rota da ficha não tem DELETE — desligar arquiva", () => {
    const rota = readFileSync(
      join(process.cwd(), "src/app/api/funcionarios/[id]/route.ts"),
      "utf8"
    );
    expect(rota).not.toContain("export async function DELETE");
    expect(rota).toContain("desligamento");
  });
});

describe("documento vence, o sistema avisa antes", () => {
  const agora = new Date("2026-08-26T12:00:00Z");
  const dias = (n: number) => new Date(agora.getTime() + n * 86_400_000);

  it("sem validade não é vencido nem vencendo", () => {
    expect(situacaoDoDocumento(null, agora)).toBe("SEM_VALIDADE");
  });

  it("dentro do prazo, vencendo e vencido", () => {
    expect(situacaoDoDocumento(dias(90), agora)).toBe("OK");
    expect(situacaoDoDocumento(dias(DIAS_AVISO_VENCIMENTO), agora)).toBe("VENCENDO");
    expect(situacaoDoDocumento(dias(5), agora)).toBe("VENCENDO");
    expect(situacaoDoDocumento(dias(-1), agora)).toBe("VENCIDO");
  });
});

describe("o checklist se adapta ao vínculo", () => {
  it("todo vínculo tem checklist (e rótulo)", () => {
    for (const v of Object.keys(vinculoLabel))
      expect(
        CHECKLIST_POR_VINCULO[v as keyof typeof CHECKLIST_POR_VINCULO].length
      ).toBeGreaterThan(0);
  });

  it("CLT pede a lista cheia; diarista só o essencial", () => {
    expect(CHECKLIST_POR_VINCULO.CLT).toContain("ASO");
    expect(CHECKLIST_POR_VINCULO.CLT).toContain("RESERVISTA");
    expect(CHECKLIST_POR_VINCULO.DIARISTA).toEqual(["RG", "CPF_DOC"]);
    // pedir reservista de quem emite nota é digitação inútil
    expect(CHECKLIST_POR_VINCULO.MEI_PJ).not.toContain("RESERVISTA");
  });

  it("documento do DEPENDENTE não fecha o checklist do funcionário", () => {
    // a certidão do filho satisfazia a exigência do pai e a pasta fechava
    // verde incompleta
    const soDoFilho = [{ tipo: "RG" as const, dependenteId: "dep1" }];
    expect(documentosFaltantes("DIARISTA", soDoFilho)).toContain("RG");
    const daPropria = [{ tipo: "RG" as const, dependenteId: null }];
    expect(documentosFaltantes("DIARISTA", daPropria)).toEqual(["CPF_DOC"]);
  });
});

describe("PATCH parcial não apaga o que não veio (corpoDaFicha)", () => {
  it("campo AUSENTE fica ausente — desligar/reativar não zera nascimento/início", () => {
    // era o bug real: {desligamento: "..."} sozinho gravava NULL em
    // nascimento e inicio, perdendo os dados em silêncio
    const so = corpoDaFicha({ cargo: "Costureira" });
    expect(so).not.toHaveProperty("nascimento");
    expect(so).not.toHaveProperty("inicio");
  });

  it("campo presente converte: data válida vira Date, null limpa, lixo vira null", () => {
    const ok = corpoDaFicha({ nascimento: "1990-05-10", inicio: null });
    expect(ok.nascimento).toBeInstanceOf(Date);
    expect(ok.inicio).toBeNull();
    expect(dataOuNull("não-é-data")).toBeNull(); // lixo nunca vira new Date(NaN) → 500
    expect(dataOuNull("2026-08-26T10:00:00Z")).toBeInstanceOf(Date);
  });
});

describe("a foto da ficha é arquivo, não endereço", () => {
  it("aceita data-URL e recusa link externo (que vazaria o IP de quem abre a tela)", () => {
    const base = { nome: "Maria" };
    expect(fichaSchema.safeParse({ ...base, fotoUrl: "data:image/png;base64,AAA" }).success).toBe(true);
    expect(fichaSchema.safeParse({ ...base, fotoUrl: "https://exemplo.com/foto.png" }).success).toBe(false);
    expect(fichaSchema.safeParse({ ...base, fotoUrl: null }).success).toBe(true);
  });
});

describe("salário não muda em silêncio", () => {
  it("mudou → vira linha de histórico com antes e depois", () => {
    const d = descricaoMudancaSalario(
      { remuneracao: 2200, periodicidade: "MENSAL" },
      { remuneracao: 2500, periodicidade: "MENSAL" }
    );
    expect(d).toContain("2.200");
    expect(d).toContain("2.500");
  });

  it("não mudou → nada de linha vazia no histórico", () => {
    expect(
      descricaoMudancaSalario(
        { remuneracao: 2200, periodicidade: "MENSAL" },
        { remuneracao: 2200, periodicidade: "MENSAL" }
      )
    ).toBeNull();
  });

  it("mudar só a periodicidade também registra (por mês → por peça)", () => {
    const d = descricaoMudancaSalario(
      { remuneracao: 10, periodicidade: "MENSAL" },
      { remuneracao: 10, periodicidade: "POR_PECA" }
    );
    expect(d).toContain("por peça");
  });
});

describe("formulário do link (RN-025): o funcionário só manda o que é dele", () => {
  const base = { aceiteLGPD: true as const, telefone: "75 99999-0000" };

  it("cargo, vínculo, remuneração e observações NÃO passam pelo formulário", () => {
    // o link é público: mandar remuneracao junto não pode virar aumento
    const parsed = formFichaSchema.parse({
      ...base,
      remuneracao: 99999,
      cargo: "Diretor",
      vinculo: "CLT",
      observacoes: "hack",
    } as Record<string, unknown>);
    for (const proibido of ["remuneracao", "cargo", "vinculo", "observacoes", "beneficios"])
      expect(parsed, proibido).not.toHaveProperty(proibido);
  });

  it("sem o aceite LGPD marcado, o envio é recusado", () => {
    expect(formFichaSchema.safeParse({ telefone: "75 99999-0000" }).success).toBe(false);
    expect(formFichaSchema.safeParse({ ...base, aceiteLGPD: false }).success).toBe(false);
    expect(formFichaSchema.safeParse(base).success).toBe(true);
  });

  it("limparResposta guarda SÓ o preenchido — em branco não apaga nada depois", () => {
    const r = limparResposta(
      formFichaSchema.parse({ ...base, email: "  ", chavePix: null, banco: " Caixa " })
    );
    expect(r).toEqual({ telefone: "75 99999-0000", banco: "Caixa" });
  });

  it("aplicarResposta revalida o Json e converte datas; ausente fica ausente", () => {
    const ok = aplicarResposta({ nascimento: "1990-05-10", telefone: "75 9" });
    expect(ok).not.toBeNull();
    expect(ok!.dados.nascimento).toBeInstanceOf(Date);
    expect(ok!.dados).not.toHaveProperty("inicio");
    expect(ok!.dependentes).toEqual([]);
    // Json adulterado no banco não vira gravação: recusa em vez de gravar lixo
    expect(aplicarResposta({ telefone: 12345 })).toBeNull();
    expect(aplicarResposta(null)).toBeNull();
    expect(aplicarResposta("texto")).toBeNull();
  });

  it("o link vence em 7 dias e morre no primeiro uso", () => {
    const agora = new Date("2026-08-28T12:00:00Z");
    const vivo = { expiresAt: new Date(agora.getTime() + 1000), usadoEm: null };
    const vencido = { expiresAt: new Date(agora.getTime() - 1000), usadoEm: null };
    const usado = { expiresAt: new Date(agora.getTime() + 1000), usadoEm: agora };
    expect(linkUtilizavel(vivo, agora)).toBe(true);
    expect(linkUtilizavel(vencido, agora)).toBe(false);
    expect(linkUtilizavel(usado, agora)).toBe(false);
    expect(VALIDADE_LINK_FICHA_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("as portas do formulário são PÚBLICAS no middleware (senão o link cai no login)", () => {
    const mw = readFileSync(join(process.cwd(), "src/middleware.ts"), "utf8");
    for (const rota of ["/ficha/", "/api/ficha-form/"]) expect(mw).toContain(`"${rota}"`);
  });
});

describe("conferência e anexo não podem gravar duas vezes nem sem consentimento", () => {
  const rota = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("aprovar é tudo-ou-nada, com a porteira do já-conferido DENTRO da transação", () => {
    // duplo clique criava os dependentes de novo: a porteira tem que estar no
    // próprio update, junto com a gravação
    const r = rota("src/app/api/funcionarios/[id]/conferir/route.ts");
    expect(r).toContain("db.$transaction");
    expect(r).toMatch(/updateMany\(\{\s*where: \{ id: link\.id, conferidoEm: null \}/);
  });

  it("dispensar APAGA a resposta — CPF e conta bancária não ficam guardados", () => {
    const r = rota("src/app/api/funcionarios/[id]/conferir/route.ts");
    expect(r).toContain("resposta: Prisma.DbNull");
  });

  it("dependente que já está na ficha não entra de novo", () => {
    const r = rota("src/app/api/funcionarios/[id]/conferir/route.ts");
    expect(r).toContain("chaveDoDependente");
    expect(r).toMatch(/filter\(\(d\) => !conhecidos\.has/);
  });

  it("o mesmo filho escrito de outro jeito é a MESMA pessoa", () => {
    // a prova pegou: "joana  prova" (dois espaços do teclado do celular)
    // entrava como filha nova ao lado de "Joana Prova"
    expect(chaveDoDependente("joana  prova")).toBe(chaveDoDependente("Joana Prova"));
    expect(chaveDoDependente("  JOÃO  da Silva ")).toBe(chaveDoDependente("joao da silva"));
    expect(chaveDoDependente("Ana")).not.toBe(chaveDoDependente("Ana Paula"));
  });

  it("depois de queimar o link, histórico e aviso não derrubam o envio", () => {
    // a resposta já está salva: falha de registro não pode virar 500 e mandar
    // o funcionário preencher tudo de novo (lição da RN-010)
    const r = rota("src/app/api/ficha-form/[codigo]/route.ts");
    const depoisDoConsumo = r.slice(r.indexOf("consumo.count === 0"));
    expect(depoisDoConsumo).toContain(".catch(() => {})");
    expect(depoisDoConsumo.match(/\.catch\(\(\) => \{\}\)/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("anexar documento exige e registra o aceite LGPD", () => {
    // o documento entra na pasta ANTES do envio final: sem isso, quem anexava
    // e desistia deixava RG guardado sem consentimento registrado
    const doc = rota("src/app/api/ficha-form/[codigo]/documento/route.ts");
    expect(doc).toContain("aceiteLGPD: z.literal(true)");
    expect(doc).toContain("aceiteLGPDEm: new Date()");
    // e a faxina não apaga o link que carrega essa prova
    expect(rota("src/lib/ficha-form-link.ts")).toContain("aceiteLGPDEm: null");
  });
});

describe("o formulário do funcionário, do jeito que o dono pediu (28/08/2026)", () => {
  const rota = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const form = rota("src/app/ficha/[codigo]/formulario.tsx");
  const rotaDoc = rota("src/app/api/ficha-form/[codigo]/documento/route.ts");

  it("NOME COMPLETO é o primeiro campo — e ele pode corrigir o que o admin digitou", () => {
    expect(formFichaSchema.safeParse({ aceiteLGPD: true, nome: "Maria Aparecida" }).success).toBe(true);
    expect(form).toContain("Nome completo");
    // primeiro de todos: vem antes do nascimento (o campo que abria a lista)
    expect(form.indexOf("Nome completo")).toBeLessThan(form.indexOf("Nascimento"));
  });

  it("o nome só entra na ficha DEPOIS da conferência do admin (nada automático)", () => {
    // mesma porta de todo o resto: a resposta fica aguardando conferência
    const r = aplicarResposta({ nome: "Maria Aparecida da Silva" });
    expect(r!.dados.nome).toBe("Maria Aparecida da Silva");
    expect(rota("src/app/api/ficha-form/[codigo]/route.ts")).toContain("limparResposta");
  });

  it("o vínculo NÃO aparece para o funcionário ('informal' é classificação interna)", () => {
    expect(form).not.toContain("vinculoLabel");
    expect(form).not.toContain("A empresa precisa");
  });

  it("documento: só o CPF — sem lista de tipos e sem data de validade", () => {
    expect(form).toContain("📎 Foto do CPF");
    expect(form).not.toContain("docTipo,"); // o seletor de tipo saiu
    expect(form).not.toContain("docValidade"); // o campo de data saiu
    expect(form).not.toContain('type="date" className={campo} value={docValidade}');
  });

  it("quem decide o tipo é o SERVIDOR (o formulário não escolhe mais)", () => {
    expect(rotaDoc).toContain('tipo: "CPF_DOC"');
    expect(rotaDoc).not.toContain("tipo: parsed.data.tipo");
    expect(rotaDoc).not.toContain("validade: dataOuNull");
  });

  it("o nome só viaja se ele CORRIGIR (aba antiga não desfaz correção do admin)", () => {
    // o campo nasce preenchido; mandar sempre faria o envio de uma aba
    // aberta há dias devolver o nome velho por cima do que o admin ajustou
    expect(form).toContain("f.nome.trim() !== nome.trim()");
  });

  it("o texto não convida a mandar RG/CNH (entrariam rotulados como CPF)", () => {
    expect(form).toContain("Envie a foto do seu <b>CPF</b>");
    expect(form).not.toContain("documento com o número dele");
  });

  it("o rótulo do anexo tem UMA fonte só: o servidor (cliente não manda tipo)", () => {
    expect(form).not.toMatch(/tipo: "CPF_DOC"/);
    expect(rotaDoc).toContain('tipo: "CPF_DOC"');
  });

  it("o checklist por vínculo continua valendo na tela do ADMIN", () => {
    // o admin segue anexando qualquer documento, com validade, pela Equipe
    expect(CHECKLIST_POR_VINCULO.CLT).toContain("ASO");
    expect(rota("src/app/(app)/equipe/funcionarios-view.tsx")).toContain("docTipoLabel");
  });
});
