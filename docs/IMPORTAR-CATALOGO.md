# Importar catálogo (arquivo `.json`)

Permite subir um catálogo inteiro de uma vez para a loja, em vez de cadastrar
produto por produto. Os produtos entram como **registros reais e editáveis**:
a loja continua controlando estoque, inativando esgotados, editando e
adicionando itens normalmente.

## Onde usar

Produtos → botão **Importar catálogo** → escolher o arquivo `.json` → conferir a
prévia → **Importar produtos**.

Funciona também com o Super Admin dentro da loja (**Acessar loja**): a
importação respeita a loja que está sendo acessada.

## Formato do arquivo

```jsonc
{
  // (opcional) identidade visual da loja — atualiza a vitrine pública
  "store": {
    "tagline": "Moda com atitude",
    "whatsapp": "(31) 98888-7777",
    "logoUrl": "data:image/png;base64,…",   // ou uma URL http
    "catalogPrimary": "#1E3A5F",
    "catalogSecondary": "#93C5FD",
    "catalogBg": "#FFFFFF",
    "catalogFont": "montserrat"              // montserrat|inter|poppins|playfair|lora
  },

  // (opcional) paleta com os HEX das cores usadas
  "palette": [
    { "name": "Preto", "hex": "#211E1D" },
    { "name": "Branco", "hex": "#FAF6EF" }
  ],

  // (opcional) padrões aplicados a todo produto que não trouxer o seu próprio
  "defaults": {
    "stock": 8,                    // estoque padrão por variação
    "sizes": ["P", "M", "G", "GG"],
    "minQuantity": 1
  },

  "products": [
    {
      "name": "Regata Assimétrica",      // obrigatório
      "sku": "REG-001",                  // opcional (gerado a partir do nome se faltar)
      "category": "Blusas",
      "collection": "Verão",             // opcional
      "description": "…",                // opcional
      "retailPrice": 79.9,               // preço varejo
      "wholesalePrice": 49.9,            // opcional (atacado)
      "costPrice": 0,                    // opcional (custo)
      "minQuantity": 1,                  // opcional
      "tags": "lançamento",              // opcional (texto ou lista)
      "active": true,                    // opcional (default true)
      "colors": ["Preto", "Branco"],
      "sizes": ["P", "M", "G", "GG"],    // se ausente, usa defaults.sizes
      "stock": 10,                       // estoque de todas as variações do produto
      "stockByVariant": {                // opcional — sobrepõe por cor/tamanho
        "Preto/P": 5,
        "Preto/M": 3
      },
      "images": ["data:image/…", "https://…"]  // URLs ou imagens embutidas
    }
  ]
}
```

## Como o estoque é definido

Cada variação (cor × tamanho) recebe o estoque na seguinte ordem de
prioridade — ou seja, **já sobe definido, sem edição peça por peça**:

1. `stockByVariant["Cor/Tamanho"]` (mais específico)
2. `stock` do produto
3. `defaults.stock`
4. `0` (se nada for informado — o produto aparece como indisponível)

## Fotos

- **Embutidas** (`data:image/...;base64,…`): o arquivo carrega as próprias
  imagens; um arquivo resolve tudo. Ideal para montar aqui e subir de uma vez.
- **Por link** (`https://…`): o arquivo fica leve, mas as fotos precisam estar
  hospedadas.

Os dois formatos podem ser misturados no mesmo arquivo.

## Reimportar

Produtos são identificados pelo `sku` dentro da loja. Reimportar um `sku`
existente **atualiza** os dados e o estoque daquele produto (não duplica).

Veja um exemplo pronto em [`catalogo-modelo.json`](./catalogo-modelo.json).
