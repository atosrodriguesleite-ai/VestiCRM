-- DATA É DIA, GUARDADO AO MEIO-DIA EM UTC (RN-030).
--
-- `saldoInicialEm` era a ÚNICA data do módulo gravada por `z.coerce.date()`,
-- ou seja, à MEIA-NOITE UTC. Em São Paulo (UTC−3) isso é o dia anterior: a
-- conta aberta em 01/09 aparecia com a linha "saldo inicial" em 31/08 no
-- extrato e, no fluxo de caixa, o dinheiro caía na coluna de AGOSTO — duas
-- telas de dinheiro discordando por um mês inteiro. As rotas passaram a
-- gravar ao meio-dia; aqui o que já está no banco é acertado.
--
-- Só as datas exatamente à meia-noite UTC são mexidas (é a assinatura do
-- defeito); qualquer coisa já gravada com hora fica como está.
UPDATE "FinConta"
   SET "saldoInicialEm" = date_trunc('day', "saldoInicialEm") + interval '12 hours'
 WHERE "saldoInicialEm" = date_trunc('day', "saldoInicialEm");

-- E o CARTÃO não guarda dinheiro (RN-039). O cadastro novo já zerava o saldo
-- inicial do cartão, mas a EDIÇÃO não: converter uma conta de banco em cartão
-- deixava o saldo dela entrando no "saldo hoje" e no saldo previsto, dentro
-- de um cartão de crédito. A rota passou a zerar; aqui o que já existe é
-- acertado.
UPDATE "FinConta"
   SET "saldoInicial" = 0
 WHERE "tipo" = 'CARTAO' AND "saldoInicial" <> 0;
