-- TELEFONE ÚNICO POR LOJA (auditoria 07/08/2026, incidente #0146).
--
-- Dois canais chegando no MESMO instante (WhatsApp + catálogo) passavam os
-- dois pela busca de dedup e criavam a mesma cliente duas vezes. O índice
-- único parcial fecha a corrida no banco: o segundo INSERT cai em P2002 e o
-- código re-busca o cadastro que o primeiro criou (lib/intake.ts).
--
-- CONDICIONAL DE PROPÓSITO: se alguma loja AINDA tiver telefones duplicados
-- (de antes da unificação de contatos), criar o índice quebraria a migração
-- e TRAVARIA TODOS os deploys. Nesse caso a criação é adiada (aviso no log);
-- depois de rodar "Unificar contatos" na loja, uma migração futura pode
-- criar o índice de vez.
--
-- Telefone vazio fica de fora (clientes anônimos do catálogo); os marcadores
-- ("ns-123", "ns-co-456") já nascem únicos e não atrapalham.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM "Customer"
     WHERE phone <> ''
     GROUP BY "companyId", phone
    HAVING COUNT(*) > 1
     LIMIT 1
  ) THEN
    RAISE NOTICE 'telefone_unico_por_loja: há telefones duplicados — índice adiado (rode a unificação de contatos e recrie).';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS "Customer_companyId_phone_unico"
      ON "Customer" ("companyId", phone)
      WHERE phone <> '';
  END IF;
END $$;
