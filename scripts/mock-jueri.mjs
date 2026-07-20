/**
 * Mock local da API Jueri para testar a integração sem internet.
 * Sobe em http://127.0.0.1:4033 — aponte JUERI_API_BASE pra cá no .env.
 * Fixtures: 2 páginas de produtos de semijoias (com e sem foto, inativo,
 * cor com hexadecimal, dois preços) espelhando os campos reais da Jueri.
 */
import { createServer } from "http";

const TOKEN = "35080|teste-token-valido";
const CLIENTE = "10422";

const categorias = [
  { id: 1, nome: "Anéis" },
  { id: 2, nome: "Brincos" },
  { id: 3, nome: "Colares" },
];
const tipoPreco = [
  { id: 1, nome: "Varejo" },
  { id: 2, nome: "Atacado" },
  { id: 3, nome: "Filial" },
];
const precos = (v, a) => [
  { id: 1, nome: "Varejo", pivot: { preco: v } },
  { id: 2, nome: "Atacado", pivot: { preco: a } },
];
const produtos = [
  { id: 101, descricao: "Anel Grosso Decorado", descricao_completa: "Banho de ouro 18k", referencia: "AN-101", codigo_barras: "2775487991032", cor: "Dourado", cor_hexadecimal: "D4AF37", quantidade: 5, custo_compra_bruto: 12, custo_total: 18, fk_categoria_id: 1, fk_status_id: 1, imagem: "https://exemplo.jueri.com.br/img/anel-101.jpg", fotos_adicionais: ["https://exemplo.jueri.com.br/img/anel-101b.jpg"], tipo_preco: precos(129, 35) },
  { id: 102, descricao: "Piercing 3 Perolas Shell", referencia: "PI-102", codigo_barras: "7180930604639", cor: "Prata", cor_hexadecimal: "C0C0C0", quantidade: 4, custo_compra_bruto: 5, fk_categoria_id: 2, fk_status_id: 1, imagem: "https://jueri.com.br/sis/images/foto-padrao.jpg", fotos_adicionais: [], tipo_preco: precos(45, 15) },
  { id: 103, descricao: "Anel Oval Solitario", referencia: "", codigo_barras: "2712822988920", cor: "Dourado", cor_hexadecimal: "D4AF37", quantidade: 0, fk_categoria_id: 1, fk_status_id: 1, imagem: null, fotos_adicionais: null, tipo_preco: precos(119, 39.9) },
  { id: 104, descricao: "Colar Ponto de Luz", referencia: "CO-104", codigo_barras: "5551112223334", cor: "Rosé", cor_hexadecimal: "B76E79", quantidade: 9, fk_categoria_id: 3, fk_status_id: 1, imagem: "https://exemplo.jueri.com.br/img/colar-104.jpg", fotos_adicionais: [{ imagem: "https://exemplo.jueri.com.br/img/colar-104b.jpg" }], tipo_preco: precos(89, 29) },
  { id: 105, descricao: "Produto Desativado", referencia: "XX-105", codigo_barras: "9990001112223", cor: "Prata", quantidade: 2, fk_categoria_id: 2, fk_status_id: 2, imagem: null, tipo_preco: precos(10, 5) },
  { id: 106, descricao: "Brinco Argola Torcida", referencia: "BR-106", codigo_barras: "4445556667778", cor: "Dourado", cor_hexadecimal: "D4AF37", quantidade: 12, fk_categoria_id: 2, fk_status_id: 1, imagem: "https://exemplo.jueri.com.br/img/brinco-106.jpg", tipo_preco: precos(59, 19) },
];

const PER = 4; // força 2 páginas
createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const auth = req.headers.authorization ?? "";
  const json = (code, body) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (auth !== `Bearer ${TOKEN}`) return json(401, { message: "Unauthenticated." });
  const partes = url.pathname.split("/").filter(Boolean); // [cliente, ...resto]
  if (partes[0] !== CLIENTE) return json(403, { message: "Cliente inválido" });
  const resto = "/" + partes.slice(1).join("/");

  if (resto === "/status") return json(200, { ok: true });
  if (resto === "/tipo-preco") return json(200, tipoPreco);
  if (resto === "/produto/categoria") return json(200, categorias);
  if (resto === "/produto") {
    const page = Number(url.searchParams.get("page") ?? 1);
    const ini = (page - 1) * PER;
    const data = produtos.slice(ini, ini + PER);
    return json(200, {
      current_page: page,
      data,
      next_page_url: ini + PER < produtos.length ? `http://x?page=${page + 1}` : null,
      per_page: PER,
    });
  }
  const detalhe = resto.match(/^\/produto\/(\d+)$/);
  if (detalhe) {
    const p = produtos.find((x) => String(x.id) === detalhe[1]);
    return p ? json(200, p) : json(404, { message: "Not found" });
  }
  json(404, { message: "rota desconhecida " + resto });
}).listen(4033, "127.0.0.1", () => console.log("mock Jueri em http://127.0.0.1:4033"));
