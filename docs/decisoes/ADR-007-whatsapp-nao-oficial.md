# ADR-007 — WhatsApp não-oficial (Evolution self-hosted), com termo de aceite

- **Situação:** aceita, com risco declarado
- **Regras ligadas:** RN-017
- **Registrada em:** 14/08/2026 (decisão anterior, documentada agora)

## Contexto

A Central de Atendimento é o coração do produto: é onde a lojista vende. Havia
dois caminhos para conectar o WhatsApp:

| | API oficial (Meta Cloud API) | Não-oficial (Evolution) |
|---|---|---|
| Número | precisa de número novo, migrado para a API | **usa o número que a loja já tem** |
| Custo | por conversa | servidor fixo |
| Aprovação | Business Manager, verificação da empresa | nenhuma |
| Mensagem proativa | só template aprovado | livre |
| Risco | nenhum | **banimento do número pela Meta** |

A lojista de atacado **não migra o número dela**. É o número que está na
etiqueta, no Instagram, no cartão, na boca das clientes há anos. Exigir número
novo mata a adoção do produto.

## Decisão

Usar a **Evolution API self-hosted** (VPS Hostinger) como provedor padrão, com
o risco assumido de forma explícita e documentada:

1. **Termo de aceite obrigatório e registrado.** Sem o aceite, o QR Code nunca
   aparece. O registro guarda quem aceitou (nome, e-mail, cargo), IP,
   navegador, data/hora e o **hash do texto do termo** — prova de qual versão
   a pessoa leu. Só o admin da loja pode aceitar.
2. **Ritmo anti-banimento:** resposta dentro da janela de 24h sai na hora;
   envio proativo sai com ritmo humano (4 a 9 segundos entre mensagens).
3. **Camada agnóstica de provedor** (`lib/comm/`): o `CloudApiProvider` (Meta
   oficial) já existe na estrutura. Se uma loja crescer a ponto de precisar do
   oficial, é troca de provedor, não reescrita.
4. Tudo é registrado em `CommEvent` (Central de Comunicação).

## Consequências

- ✅ A loja conecta o número que já usa, em minutos, sem aprovação de ninguém.
- ✅ Se o número for banido, existe prova de que a loja foi avisada e aceitou.
- ❌ O uso viola os Termos de Serviço da Meta. O termo protege o AtacadoPro
  perante o lojista; **não muda esse fato**.
- ❌ Servidor Evolution é infraestrutura nossa para manter (daí o vigia em
  `lib/health.ts`).

## Revisão

Reavaliar quando: (a) uma loja grande exigir o oficial por política própria,
ou (b) a taxa de banimento passar a incomodar. A porta já está aberta pelo
`CloudApiProvider`.
