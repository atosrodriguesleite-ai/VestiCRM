-- LIMPEZA ÚNICA DA ENTRE LINHAS (pedido do dono, 05/09/2026).
--
-- A loja conectou o WhatsApp uma vez, por pouco tempo, e quer conectar de
-- novo "começando do zero": hoje tem quase mil conversas que nasceram só de
-- pedidos do catálogo (RN-008/RN-010). Decisão alinhada: ENCERRAR todas
-- (nada é apagado — Fila e Chats ficam vazios, o histórico segue em Contatos
-- e a cliente antiga que escrever reabre a conversa dela, como sempre).
--
-- SÓ ESTA LOJA (RN-013). O alvo é achado pelo NOME EXATO informado pelo dono
-- ("Entre Linhas", sem diferença de maiúscula nem espaço nas pontas) OU pelo
-- endereço do catálogo ("entre-linhas"), e a instrução exige que isso aponte
-- para EXATAMENTE UMA loja: zero ou duas, e ela não faz nada — mas deixa o
-- rastro na Central de Comunicação DA PLATAFORMA (evento sem loja), porque um
-- aviso perdido no log do deploy ninguém lê, e a migração não roda de novo
-- (achado da revisão). Nunca chuta. Roda uma vez e nunca mais.
DO $$
DECLARE
  alvo    TEXT;
  quantas INT;
  n       INT;
BEGIN
  SELECT count(DISTINCT "id") INTO quantas
    FROM "Company"
   WHERE lower(trim("name")) = 'entre linhas' OR "slug" = 'entre-linhas';

  IF quantas <> 1 THEN
    INSERT INTO "CommEvent" ("id", "companyId", "channel", "direction", "type", "status", "payload", "error", "durationMs", "attempts", "createdAt")
    VALUES (
      'evt_' || replace(gen_random_uuid()::text, '-', ''),
      NULL, 'WHATSAPP', 'OUT', 'conversas.encerradas-em-lote', 'ERRO',
      jsonb_build_object('loja', 'Entre Linhas', 'encontradas', quantas)::text,
      'Limpeza da Entre Linhas NÃO rodou: ' || quantas || ' loja(s) com esse nome/endereço — conferir no painel Lojas e refazer com o nome certo',
      0, 1, NOW()
    );
    RAISE NOTICE 'Limpeza Entre Linhas: % loja(s) com esse nome — nada feito', quantas;
    RETURN;
  END IF;

  SELECT "id" INTO alvo
    FROM "Company"
   WHERE lower(trim("name")) = 'entre linhas' OR "slug" = 'entre-linhas'
   LIMIT 1;

  -- quantas vão MUDAR de status (é o número que interessa no rastro)
  SELECT count(*) INTO n FROM "Conversation" WHERE "companyId" = alvo AND "status" <> 'CLOSED';

  -- o MESMO gesto do botão Encerrar (status), o marcador de não lida zerado
  -- na loja inteira (mil bolinhas em Contatos seriam barulho) e o updatedAt
  -- tocado em TODA linha mexida — é por ele que o sync da tela enxerga a
  -- mudança sem recarregar (uma instrução só, senão a linha que só perdeu a
  -- bolinha ficava fora do sync — achado da revisão)
  UPDATE "Conversation"
     SET "status" = 'CLOSED', "unreadCount" = 0, "updatedAt" = NOW()
   WHERE "companyId" = alvo AND ("status" <> 'CLOSED' OR "unreadCount" > 0);

  -- rastro na Central de Comunicação da própria loja
  INSERT INTO "CommEvent" ("id", "companyId", "channel", "direction", "type", "status", "payload", "durationMs", "attempts", "createdAt")
  VALUES (
    'evt_' || replace(gen_random_uuid()::text, '-', ''),
    alvo, 'WHATSAPP', 'OUT', 'conversas.encerradas-em-lote', 'OK',
    jsonb_build_object('motivo', 'Limpeza combinada com o dono para reconectar do zero', 'conversas', n)::text,
    0, 1, NOW()
  );
  RAISE NOTICE 'Limpeza Entre Linhas: % conversas encerradas', n;
END $$;
