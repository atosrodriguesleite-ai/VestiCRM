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
  CHECKLIST_POR_VINCULO,
  DIAS_AVISO_VENCIMENTO,
  vinculoLabel,
} from "../funcionarios";
import { fichaSchema, corpoDaFicha, dataOuNull } from "../ficha-funcionario";

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
