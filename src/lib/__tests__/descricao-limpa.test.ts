import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  decodificarEntidades,
  limparDescricaoHtml,
  temEntidadeHtml,
} from "../descricao-limpa";

/**
 * DESCRIÇÃO DO PRODUTO — dois defeitos casados (Entre Linhas, 06/08/2026):
 *  1. o catálogo mostrava "Especifica&ccedil;&otilde;es t&eacute;cnicas"
 *     (o sync tirava as tags mas não traduzia os códigos das letras);
 *  2. a lojista corrigia o texto na mão e o sync da Nuvemshop SOBRESCREVIA
 *     minutos depois — "editei e sumiu, aí voltou sozinho".
 */

describe("tradução do computês (&ccedil; → ç)", () => {
  it("o texto real do print da Entre Linhas fica legível", () => {
    expect(
      decodificarEntidades(
        "Especifica&ccedil;&otilde;es t&eacute;cnicas Medida: conjunto tamanho &Uacute;NICO com elasticidade, podendo vestir do tamanho 36 ao 42"
      )
    ).toBe(
      "Especificações técnicas Medida: conjunto tamanho ÚNICO com elasticidade, podendo vestir do tamanho 36 ao 42"
    );
  });

  it("códigos numéricos também traduzem (&#231; e &#xE7; são o ç)", () => {
    expect(decodificarEntidades("fabrica&#231;&#227;o")).toBe("fabricação");
    expect(decodificarEntidades("fabrica&#xE7;&#xE3;o")).toBe("fabricação");
  });

  it("código DUPLO (&amp;ccedil;) — como estava gravado — também resolve", () => {
    expect(decodificarEntidades("Composi&amp;ccedil;&amp;atilde;o")).toBe(
      "Composição"
    );
  });

  it("texto normal com & solto passa intacto", () => {
    expect(decodificarEntidades("Blusa P&B; linda & barata")).toBe(
      "Blusa P&B; linda & barata"
    );
  });
});

describe("limpeza completa do HTML da Nuvemshop", () => {
  it("tira tags, traduz códigos e normaliza espaços", () => {
    expect(
      limparDescricaoHtml(
        "<p>85% Poliamida - 15% Elastano&nbsp;</p><br><p>N&atilde;o usar alvejante.</p>"
      )
    ).toBe("85% Poliamida - 15% Elastano Não usar alvejante.");
  });
});

describe("detector de descrição suja (é ele que dispara o conserto retroativo)", () => {
  it("acusa códigos conhecidos e numéricos; ignora & de texto normal", () => {
    expect(temEntidadeHtml("Especifica&ccedil;&otilde;es")).toBe(true);
    expect(temEntidadeHtml("fabrica&#231;o")).toBe(true);
    expect(temEntidadeHtml("Blusa P&B; com renda")).toBe(false);
    expect(temEntidadeHtml("Texto limpo, sem nada")).toBe(false);
  });
});

describe("o sync da Nuvemshop respeita o texto editado na loja", () => {
  const ns = readFileSync(join(process.cwd(), "src/lib/nuvemshop.ts"), "utf8");

  it("descrição entra limpa nos dois caminhos (espelho novo e vínculo 1↔1)", () => {
    expect(ns.split("limparDescricaoHtml(").length).toBeGreaterThanOrEqual(3);
  });

  it("edição manual NUNCA é sobrescrita — só preenche vazia ou limpa a suja", () => {
    expect(ns).toContain("temEntidadeHtml(descricaoLocal)");
    // o jeito antigo (reescrever a cada rodada) não pode voltar
    expect(ns).not.toContain('description: texto(p.description)');
  });
});
