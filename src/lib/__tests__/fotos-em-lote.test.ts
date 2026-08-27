import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TETO_FOTOS_DE_UMA_VEZ, nomeJpeg } from "../comprimir-foto";

/**
 * VÁRIAS FOTOS DE UMA VEZ NO CHAT (pedido do dono, 27/08/2026).
 *
 * A vendedora mandava a arara peça por peça: um seletor de arquivo por foto.
 * Agora escolhe até 20 de uma vez — e elas saem UMA ATRÁS DA OUTRA, que é o
 * que mantém a ordem, respeita o teto de tamanho (que é por envio) e não
 * dispara vinte envios simultâneos no WhatsApp (RN-017).
 *
 * As fotos também passaram a sair em ALTA RESOLUÇÃO: a cliente dá zoom para
 * ver trama e acabamento, e 1600px virava borrão.
 */

const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const inbox = ler("src/app/(app)/whatsapp/inbox.tsx");
const lib = ler("src/lib/comprimir-foto.ts");

describe("o teto de fotos por vez", () => {
  it("são 20, e o número vive num lugar só (tela e teste bebem da mesma fonte)", () => {
    expect(TETO_FOTOS_DE_UMA_VEZ).toBe(20);
    expect(inbox).toContain("TETO_FOTOS_DE_UMA_VEZ");
    // a tela corta no teto em vez de tentar mandar tudo
    expect(inbox).toContain("escolhidos.slice(0, TETO_FOTOS_DE_UMA_VEZ)");
  });

  it("só FOTO aceita várias (vídeo e documento pesam 3 MB cada)", () => {
    expect(inbox).toContain('fileRef.current.multiple = kind === "IMAGE"');
  });
});

describe("a fila: uma atrás da outra, e uma falha não derruba as outras", () => {
  it("o envio é sequencial (await dentro do laço), não todos de uma vez", () => {
    // Promise.all aqui mandaria vinte envios simultâneos: estoura o teto do
    // pedido e é o padrão que faz o WhatsApp desconfiar da conta (RN-017)
    const trecho = inbox.slice(
      inbox.indexOf("async function onFileChosen"),
      inbox.indexOf("// ---- Gravação de áudio")
    );
    expect(trecho).toContain("for (let i = 0; i < fotos.length; i++)");
    // o envio da fila é aguardado (a chamada é multilinha: `await
    // sendPayload(` seguido do objeto) — a versão antiga desta asserção
    // passava por casar com o envio de vídeo/documento mais abaixo
    expect(trecho).toContain("const foi = await sendPayload(");
    expect(trecho).not.toContain("Promise.all");
  });

  it("foto ilegível e grande demais é anotada e a fila CONTINUA", () => {
    expect(inbox).toContain("naoLidas.push(foto.name)");
    expect(inbox).toContain("continue;");
  });

  it("foto que o navegador não leu ainda vai CRUA quando cabe (plano B de sempre)", () => {
    expect(inbox).toContain("comprimida ?? (await blobToDataUrl(foto))");
  });

  it("a lista do seletor é copiada ANTES de qualquer espera", () => {
    // a FileList é viva: a próxima escolha zera o campo e apagaria a fila
    expect(inbox).toContain("Array.from(e.target.files ?? [])");
  });

  it("a tela mostra o andamento (vinte fotos em silêncio pareciam travadas)", () => {
    expect(inbox).toContain("setFilaFotos({ feito: 0, total: fotos.length, convId: convDaFila })");
    expect(inbox).toContain("Enviando foto");
    // e a barra sempre volta ao normal, mesmo se algo estourar no meio
    expect(inbox).toContain("setFilaFotos(null)");
  });
});

describe("o que a revisão pegou (27/08/2026)", () => {
  const rota = ler("src/app/api/conversations/[id]/messages/route.ts");

  it("a mídia segue saindo em SEGUNDO PLANO (segurar o pedido já causou entrega dupla)", () => {
    // tentamos esperar o envio dentro do pedido para serializar: isso
    // reintroduzia o incidente do áudio — a função morria no meio, a bolha
    // dizia "falhou" com a mídia JÁ entregue e o Reenviar mandava de novo
    expect(rota).toContain("background: ehMidia,");
    expect(rota).not.toContain("aguardarEnvio");
  });

  it("o ritmo vem do NAVEGADOR: pausa entre uma foto e a próxima", () => {
    expect(inbox).toContain("const MS_ENTRE_FOTOS = 2000");
    expect(inbox).toContain("setTimeout(r, MS_ENTRE_FOTOS)");
  });

  it("uma foto do lote não apaga a bolha da outra (todas têm o mesmo corpo)", () => {
    // o dedup do sync casava por sentido+texto: a foto anterior que voltava
    // apagava a bolha da foto EM VOO, e o erro dela nunca aparecia
    expect(inbox).toContain("const jaCasadas = new Set<string>()");
    expect(inbox).toContain("jaCasadas.add(par.id)");
    expect(inbox).toContain("fm.mediaType === m.mediaType");
  });

  it("dá para PARAR a fila, e três falhas seguidas param sozinhas", () => {
    expect(inbox).toContain("cancelarFilaRef.current = true");
    expect(inbox).toContain("if (cancelarFilaRef.current) break");
    expect(inbox).toContain("if (falhas >= 3)");
  });

  it("a barra é da conversa DELA (nas outras, o chat funciona normal)", () => {
    expect(inbox).toContain("filaFotos && filaFotos.convId === selected.id");
    expect(inbox).toContain("if (filaFotos && filaFotos.convId === selected.id) return;");
  });

  it("o andamento conta o que JÁ saiu (a barra chegava em 0% e nunca em 100%)", () => {
    expect(inbox).toContain("setFilaFotos({ feito: i + 1, total: fotos.length, convId: convDaFila })");
  });

  it("o aviso final não promete o que não sabe", () => {
    // dizia "as demais foram enviadas" mesmo com envios que falharam
    expect(inbox).not.toContain("As demais foram enviadas");
    expect(inbox).toContain("confira as bolhas com ⚠️");
  });

  it("erro numa foto não leva as seguintes embora (try por volta)", () => {
    const trecho = inbox.slice(
      inbox.indexOf("const naoLidas: string[] = []"),
      inbox.indexOf("setFilaFotos(null)")
    );
    expect(trecho).toContain("try {");
    expect(trecho).toContain("} catch {");
  });

  it("não dá para abrir outra fila por cima, nem brigar com o áudio", () => {
    expect(inbox).toContain("Espere as fotos atuais terminarem");
    expect(inbox).toContain("Termine o áudio antes de enviar arquivos");
    // e a gravação não começa na conversa que está com a fila (a barra é dela)
    expect(inbox).toContain("if (filaFotos && filaFotos.convId === selected.id) return;");
  });

  it("só o PRIMEIRO envio assume a conversa (eram 20 PATCH iguais)", () => {
    expect(inbox).toContain("pularAssumir");
    // "i > 0" não servia: a foto 0 pode ser pulada (ilegível e grande) e aí
    // ninguém assumia — a conversa ficava na Fila até o sync de 3s
    expect(inbox).toContain("{ pularAssumir: jaAssumiu }");
    expect(inbox).toContain("jaAssumiu = true;");
  });

  it("a gravação de voz manda na barra (microfone aberto precisa de parar)", () => {
    // ESTA ASSERÇÃO JÁ GUARDOU O BUG: a versão anterior exigia
    // `recording || preparando ? null`, que era exatamente o defeito —
    // `null` encerra a cadeia e as barras de gravação ficavam inalcançáveis,
    // deixando a área de escrever em branco (ninguém mandava áudio,
    // 28/08/2026). Teste que descreve o código em vez do COMPORTAMENTO
    // protege o erro. Agora a régua é: a fila cede a vez à gravação.
    expect(inbox).toContain("!recording &&");
    expect(inbox).toContain("!preparando ? (");
    expect(inbox).not.toContain("recording || preparando ? null");
  });

  it("o botão parar responde na hora (o ref sozinho não redesenha)", () => {
    expect(inbox).toContain("setParandoFila(true)");
    expect(inbox).toContain('? "Parando…"');
  });

  it("codificador que falha cai no caminho síncrono, não vira 'formato ruim'", () => {
    // devolver null ali acusava "salve como JPG" numa foto JPEG comum — e,
    // se ela coubesse no teto, mandava o arquivo ORIGINAL sem comprimir
    expect(lib).toContain("const plandoB = ()");
    expect(lib).toContain("reader.onerror = plandoB;");
  });
});

describe("alta resolução", () => {
  it("o lado maior é 2560px (era 1600 — a peça virava borrão no zoom)", () => {
    expect(lib).toContain("const LADO_MAX = 2560");
  });

  it("o alvo cabe folgado no teto do envio (~4,5 MB no servidor)", () => {
    const alvo = Number(lib.match(/const ALVO_DATAURL = ([\d_]+)/)![1].replace(/_/g, ""));
    const teto = Number(lib.match(/const TETO_DATAURL = ([\d_]+)/)![1].replace(/_/g, ""));
    expect(alvo).toBeLessThan(teto);
    // o zod da rota recusa acima de 6.000.000 caracteres
    expect(teto).toBeLessThan(6_000_000);
  });

  it("foto que nem no mínimo cabe volta ao tamanho antigo (entregue > perfeita)", () => {
    expect(lib).toContain("await desenhar(img, largura, altura, 1600)");
  });

  it("a memória é liberada entre as fotos (vinte seguidas derrubavam o celular)", () => {
    expect(lib).toContain("canvas.width = 0");
    expect(lib).toContain('if (img && "close" in img) img.close()');
  });

  it("a codificação não trava a tela (toBlob, não toDataURL na linha principal)", () => {
    // vinte fotos de 2560px codificadas na linha principal congelavam a
    // tela em solavancos — inclusive a barra de andamento
    expect(lib).toContain("canvas.toBlob(");
    expect(lib).toContain("typeof canvas.toBlob !== \"function\"");
  });

  it("o nome do arquivo acompanha o formato final", () => {
    expect(nomeJpeg("IMG_0042.HEIC")).toBe("IMG_0042.jpg");
    expect(nomeJpeg("regata azul.png")).toBe("regata azul.jpg");
  });
});
