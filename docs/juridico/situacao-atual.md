# Jurídico e LGPD — o que existe e o que falta

Levantamento feito em **14/08/2026**, lendo o código (não é opinião: cada item
"existe" foi conferido no repositório).

> ⚠️ Este documento descreve o **estado técnico**. Os textos jurídicos
> (Termos, Política de Privacidade, DPA) precisam de revisão de advogado —
> nada aqui substitui isso.

## ✅ O que já existe

### Termo de aceite do WhatsApp — o mais bem resolvido

`WhatsappConsent` + `POST /api/whatsapp/evolution/consent`

- Termo com 6 cláusulas (risco de banimento, segurança, responsabilidade da
  loja), versionado — `TERMO_WA_VERSAO` em `lib/comm/evolution.ts`.
- **Só o admin da loja pode aceitar.**
- **Sem aceite, o QR Code nunca é liberado** — não há como pular.
- O registro guarda: nome, e-mail, cargo, **IP**, navegador, data/hora e o
  **hash SHA do texto**. O hash é o que prova *qual versão* a pessoa leu, mesmo
  depois de o termo mudar.
- Registro permanente, visível no painel Super Admin (tela Lojas).

Este é o padrão que os outros aceites devem seguir.

### Consentimento de rastreamento no catálogo público

Banner "Aceitar / Recusar" antes de qualquer coleta
(`public-catalog.tsx` + `lib/tracking/client.ts`). Nada é gravado sem o sim;
o `visitorId` só nasce depois do consentimento.

### Aceite no formulário de demonstração

Checkbox obrigatório de LGPD no site (`demo-form.tsx`), validado também no
servidor (`/api/demo`).

### Webhooks LGPD da Nuvemshop

`/api/nuvemshop/lgpd` — os três obrigatórios (apagar dados do cliente, pedido
de dados, loja desinstalada), com assinatura HMAC para ninguém forjar exclusão.

### Base técnica

- Credenciais criptografadas (AES-256-GCM, `lib/crypto.ts`).
- Auditoria de quem alterou credenciais (`CommAudit`) — nomes dos campos,
  nunca os valores.
- Isolamento total entre lojas (ADR-009), auditado rota a rota em 24/07/2026.
- Exportação de clientes, conversas e pedidos.

## ❌ O que falta

### 🔴 Crítico — a loja usa a plataforma sem contrato

| Falta | Por quê |
|---|---|
| **Termos de Uso** | Não existe página nem aceite. Hoje a loja entra e usa. Perda de dado, número banido, cobrança contestada — nada escrito de nenhum dos lados. |
| **Política de Privacidade** | Exigida pela LGPD e **por Meta, Google, Nuvemshop, Mercado Pago e Melhor Envio** na aprovação de app. Pode barrar crescimento. |
| **Contrato de assinatura** | Preço, módulos inclusos, prazo, reajuste, cancelamento e **suspensão por inadimplência** (`Company.suspended` já existe no código, sem base contratual). |

### 🟠 Importante — LGPD de verdade

| Falta | Por quê |
|---|---|
| **DPA / Contrato de Operador** | A loja é a **controladora** dos dados das clientes dela; o AtacadoPro é o **operador**. A LGPD (art. 39) exige contrato definindo isso. Sem ele, num vazamento a responsabilidade fica indefinida. |
| **Direitos do titular** | Não há caminho para a cliente final pedir exclusão ou portabilidade. Só existe o webhook da Nuvemshop. Não existe nem `DELETE` de cliente na API. |
| **Aviso de privacidade no catálogo** | O banner cobre *rastreamento*. Quando a cliente digita nome, telefone e endereço para fechar o pedido, não há aviso de tratamento. |
| **Canal de privacidade (encarregado)** | A LGPD pede um contato para assuntos de dados. Não existe. |
| **Retenção e saída** | Sem regra escrita do que acontece com os dados quando uma loja sai da plataforma. |

### 🟡 Menor

- Rodapé do site tem só "© AtacadoPro" — **sem links** para Termos e
  Privacidade.
- O site `atacadopro.com` não tem banner de cookies (o catálogo tem).

## Ordem sugerida

1. **Política de Privacidade + Termos de Uso** — páginas públicas e links no
   rodapé. Desbloqueia aprovação nos serviços externos.
2. **Aceite obrigatório dos Termos** no primeiro login da loja, com o mesmo
   registro à prova de contestação do termo do WhatsApp (IP, hash, data).
3. **DPA** (controladora × operador).
4. **Direitos do titular** — apagar e exportar dados da cliente final.

O trabalho técnico de cada item é pequeno; o que leva tempo é o texto. A
recomendação é: primeira versão escrita a partir do que o sistema realmente
faz (este documento é a matéria-prima), revisão de advogado, e só então
publicar.
