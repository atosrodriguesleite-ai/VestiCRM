# ADR-003 — Fotos e mídias como data-URL no banco

- **Situação:** aceita com prazo (é a dívida técnica nº 1)
- **Registrada em:** 14/08/2026 (decisão anterior, documentada agora)

## Contexto

O catálogo é o produto: cada peça tem foto, e a lojista sobe foto o dia
inteiro. No início do projeto não havia nem conta de storage nem tempo para
montar upload assinado, CDN e limpeza de órfãos.

## Decisão

A imagem é guardada como **data-URL dentro do Postgres** e servida por
`/api/img/[id]`, com cache HTTP forte.

## Consequências

- ✅ Zero configuração, zero serviço extra, zero segredo novo. Funciona.
- ✅ Backup do banco = backup das imagens. Nada se perde separado.
- ❌ O banco cresce rápido e fica caro no Neon.
- ❌ Toda foto passa pela função serverless (custo de execução), em vez de sair
  direto de um CDN.
- ❌ Base64 é ~33% maior que o arquivo original.

## Plano de saída

Migrar para blob storage (Vercel Blob ou S3/R2), mantendo `/api/img/[id]` como
endereço estável — assim nenhuma tela, nenhum PDF e nenhum link já enviado a
cliente quebra. A rota passa a redirecionar em vez de servir o conteúdo.

**Gatilho para executar:** custo do banco virar incômodo real, ou o tempo de
resposta das telas de catálogo passar a incomodar. Antes disso, não vale o
risco de mexer.

## Alternativas descartadas

- **Guardar o arquivo no repositório:** deploy da Vercel é imutável; lojista
  não sobe foto para o Git.
- **Hotlink de imagem da Nuvemshop:** só serve para produto que veio de lá, e
  quebra se a loja sair da integração.
