-- SEMENTE: produto "Implementação de CRM Vendas - Pro" no Portfólio.
--
-- Conteúdo vindo do material de origem (documento de produto + cronograma).
-- É uma migração de DADOS, não de estrutura: cria o produto uma única vez.
-- Depois disso o dono edita pela tela — e se apagar, não volta.
--
-- Só insere se a empresa-plataforma existir e se o produto ainda não estiver
-- lá, para o deploy nunca quebrar por causa de conteúdo.

INSERT INTO "PortfolioProduct" (
  "id","companyId","name","shortDesc","category","status","duration",
  "baseValue","ownerName","fullDesc","icpText","icpForWhom","icpHowValue",
  "scope","deliveryFormat","teamInvolved","howToSell","howToDeliver","notes",
  "order","createdAt","updatedAt"
)
SELECT
  'seed_crm_vendas_pro', c."id",
  'Implementação de CRM Vendas - Pro',
  'Transforma a operação de vendas em uma máquina controlada: múltiplos pipelines, fila de atendimento com rotação de leads, governança de dados e automações.',
  'TER', 'DISPONIVEL', '3 semanas',
  NULL, NULL,
  'Introdução ao Produto
O produto Implementação CRM Vendas - Pro está classificado na categoria TER e representa um estágio avançado na estruturação tecnológica da área comercial. Sua função estratégica no portfólio é fornecer a base para operações de vendas que atingiram um nível de complexidade e escala, necessitando de automação, governança de dados e múltiplas linhas de funil. Ao contrário de uma implementação básica focada na padronização, esta solução existe para garantir o Controle da Máquina de Vendas, onde a distribuição de leads e o acompanhamento gerencial são manuais, gerando lentidão, atrito e cegueira sobre os gargalos do processo. Onde o processo se torna complexo, envolvendo SDRs, Closers e diferentes linhas de produto, este serviço se encaixa como a solução que transforma a metodologia em um sistema automatizado e monitorável.

CONTEXTO E PROBLEMAS QUE RESOLVE

O produto aborda dois cenários de alta complexidade: a Empresa com Múltiplas Etapas de Venda e Falha na Distribuição (Foco Escala) e a Empresa com Dependência de Comunicação Externa e Ausência de Automação (Foco Ferramentas). No primeiro caso, a dor principal é a falta de governança e ineficiência na gestão de leads, onde a distribuição manual resulta em atritos na equipe, perda do timing de abordagem e baixa taxa de aceitação pelo SDR. O gestor não confia nos dados, não consegue explicar o motivo de perda detalhado e gasta tempo excessivo arbitrando a distribuição. O sintoma evidente é a falta de controle e a insegurança no forecast, decorrente da ausência de regras de negócio automatizadas no CRM e da confusão de pipelines.
No segundo cenário, o problema central é o desperdício de tempo do vendedor e a falta de histórico de comunicação. O vendedor precisa alternar entre o CRM e ferramentas externas (como WhatsApp ou telefone VoIP) para registrar notas ou iniciar contatos, gastando, em média, de 40 minutos a 1 hora por dia em tarefas de registro e troca de telas. Esta desconexão leva à baixa produtividade individual, falhas no follow-up devido à ausência de alertas automatizados e perda de histórico de comunicação, o que gera um risco de violar promessas ao cliente ou deixar leads inativos por longos períodos. O custo da inação, neste caso, é a ineficiência diária do vendedor e a dificuldade da liderança em fazer coaching eficaz.',
  'O produto é ideal para o contexto de necessidade de escala ou um compromisso de receita (o Evento Crítico). É recomendado para empresas cujo time precisa estar pronto para uma nova rodada de funding, para a alta temporada de vendas, ou que necessitam de produtividade máxima, onde cada minuto do vendedor é valioso. As principais personas beneficiadas são o Gerente de Vendas ou Coordenador de Operações de Vendas (Sales Ops), que buscam uma operação "no piloto automático" para focar em coaching e estratégia. Eles valorizam a confiabilidade da Rotação de Leads e a usabilidade dos Dashboards.
O produto também é crítico para o SDR/Closer ou Vendedor Sênior (o usuário final), que é movido pela produtividade pessoal. Para eles, a boa prática é o uso da Conexão Simples com 1 Ferramenta de Comunicação, que centraliza o trabalho e elimina o switch de telas, o que é um critério de decisão atrelado à satisfação e adoção da equipe. Uma armadilha comum a evitar é a falta de validação das regras da Fila de Atendimento pelo gestor, o que pode levar a um retorno à arbitragem manual de conflitos e anular o impacto positivo da automação.',
  'Gerente de Vendas / Coordenador de Operações de Vendas (Sales Ops), que busca uma operação "no piloto automático" para focar em coaching e estratégia — valoriza a confiabilidade da Rotação de Leads e a usabilidade dos Dashboards.

SDR / Closer / Vendedor Sênior (usuário final), movido por produtividade pessoal — valoriza a Conexão com 1 Ferramenta de Comunicação, que elimina a troca de telas.',
  'A Proposta de Valor atua em duas frentes: a Central de Produtividade e o Controle da Máquina de Vendas. Para a gestão, o serviço entrega o controle da operação ao estruturar Múltiplos Pipelines e a Fila de Atendimento (Rotação de Leads), garantindo a equidade e a velocidade da distribuição. Este controle se traduz na redução de até 30% no tempo que o gestor gasta gerenciando a distribuição de leads e no aumento da confiança da equipe na liderança. A visibilidade é reforçada pela configuração de 5+ Relatórios/Dashboards Essenciais com Campos de Governança (como motivo de perda detalhado), permitindo que o gestor identifique o gargalo (seja ele SDR, Closer ou Prospecção) e faça análises detalhadas.
Para o vendedor (usuário final), o valor é o foco e a otimização do tempo, eliminando tarefas repetitivas. Ao implementar a Conexão Simples com 1 Ferramenta de Comunicação e 2 Fluxos de Automação Interna (ex: alerta de lead inativo), o produto centraliza a comunicação no CRM, permitindo que o vendedor ligue ou envie mensagens sem sair do sistema. O impacto racional é significativo: estima-se um aumento de 20% no tempo que o vendedor passa em conversas com clientes, em vez de registrando atividades. Isso aumenta a adoção do CRM e eleva a moral e produtividade do time, transformando a ferramenta de um repositório de dados em uma central de trabalho eficiente.',
  'O escopo do projeto se desenvolve ao longo de 3 Semanas e é dividido em três módulos principais: Onboarding, Configuração Essencial (Core) e Entrega Final + Treinamento. Os principais entregáveis da Configuração Essencial são:
Configuração de Múltiplos Pipelines (Ex: Prospecção, Oportunidades, Fechamento), para organizar a complexidade das etapas de venda.
Definição e Mapeamento de Fila de Atendimento (Ex: Rotação de Leads e Distribuição), garantindo que o Speed to Lead seja consistente e que as regras de negócio sejam respeitadas.
Criação de 5+ Relatórios/Dashboards de Acompanhamento na própria plataforma, fornecendo visibilidade gerencial.
Criação de Campos de Governança (Ex: Motivo de Perda Detalhado, Status de Follow-up), essenciais para a análise de perdas.
Na fase de Implementação Operacional, são entregues 2 Fluxos de Automação Interna (Ex: Alerta de Lead Inativo, Notificação ao Gestor), para eliminar falhas no follow-up e tarefas de baixo valor. Adicionalmente, é realizada a Conexão Simples com 1 Ferramenta de Comunicação (Ex: WhatsApp, Telefone VoIP) e a Migração Detalhada de Dados de Oportunidades e Histórico de Negócios. É crucial notar o limite do escopo na automação e integração, que se restringe a 2 fluxos de automação interna e 1 ferramenta de comunicação simples. O ciclo se encerra com o Treinamento Intermediário focado em Funil, Relatórios e Uso de Templates, e a Validação da Estrutura, Automações e Testes de Rotação de Leads.',
  'Duração de 3 semanas, em três módulos: Onboarding, Configuração Essencial (Core) e Entrega Final + Treinamento. Esforço estimado da equipe: 26,5 horas.

Limite de escopo: 2 fluxos de automação interna e 1 ferramenta de comunicação simples.',
  'A sustentação técnica do projeto baseia-se na Configuração de Múltiplos Pipelines e na implementação de regras automatizadas. O stack digital primário é o ambiente de CRM, que é transformado em uma Central de Produtividade. A qualidade e a repetibilidade da entrega são garantidas por meio da Criação de Campos de Governança, que servem para padronizar e medir o real motivo de perda. O recurso de Conexão Simples com 1 Ferramenta de Comunicação e os 2 Fluxos de Automação Interna (implementados no sistema) asseguram que a metodologia e as tarefas de rotina sejam executadas automaticamente, reduzindo a falha humana e a dispersão da comunicação.
A equipe de entrega é composta pelo Account Manager (para kick-off e alinhamento de escopo e cronograma), o Analista de CRM (responsável pela configuração, mapeamento, criação de relatórios, automações, treinamento e documentação) e o Desenvolvedor (necessário para a Conexão Simples com 1 Ferramenta de Comunicação e para a Migração Detalhada de Dados de Oportunidades). A presença de um desenvolvedor para estas tarefas sinaliza a natureza de maior complexidade técnica deste produto, que lida com integrações e migração de dados históricos.',
  'O projeto tem uma duração total de 3 Semanas. O esforço estimado de trabalho dedicado pela equipe é de 26,5 horas, distribuídas entre as atividades de Onboarding, Configuração Essencial (Core) e Entrega Final. A lógica por trás desta duração é a necessidade de realizar atividades detalhadas e complexas em um período concentrado, como a Migração Detalhada de Dados de Oportunidades (3,0 horas) e a Conexão Simples com 1 Ferramenta de Comunicação (3,5 horas). O Evento Crítico que impulsiona a compra geralmente está ligado à necessidade de escala ou a um compromisso de receita, como o início de uma alta temporada de vendas ou um prazo final para a próxima rodada de contratações massivas.

ARMADILHA A EVITAR

A falta de validação das regras da Fila de Atendimento pelo gestor leva à volta da arbitragem manual de conflitos e anula o impacto da automação.',
  'O produto Implementação CRM Vendas - Pro se posiciona como uma solução de otimização de Nível 2. Ele pressupõe a necessidade de lidar com múltiplos pipelines e regras de negócio complexas, indicando que o cliente já superou a fase inicial de padronização (o que seria o escopo de um produto Basic). A entrega resulta em um sistema com estrutura, automações e testes de rotação de leads validados, e um Treinamento Intermediário focado em funil e relatórios.
O próximo passo lógico para o cliente é a sustentação e a expansão da automação, talvez integrando mais ferramentas ou desenvolvendo playbooks mais robustos, já que a Fila de Atendimento e os Campos de Governança estarão prontos. O sucesso do projeto é medido pela confiabilidade da Rotação de Leads e a usabilidade dos Dashboards, preparando a empresa para a escala contínua com controle gerencial.

OBSERVAÇÕES FINAIS

O foco da Implementação CRM Vendas - Pro é a transformação da operação de vendas em uma máquina controlada e produtiva, eliminando a arbitragem manual de leads e a perda de tempo dos vendedores. A complexidade do projeto é confirmada pela necessidade de envolver um Desenvolvedor para a migração e as integrações.',
  'VALORES E PREMISSAS: informação não encontrada no material de origem.
informação não encontrada
Esta ausência impede a avaliação do Retorno sobre o Investimento (ROI) do cliente e a comparação direta de custo-benefício. Tipicamente, esta seção detalharia o valor final do serviço, as condições de pagamento e as premissas críticas, como o fornecimento das credenciais de acesso às plataformas de prospecção/mídia e a responsabilidade pela organização inicial dos dados a serem migrados, que são etapas essenciais para a realização das tarefas de Onboarding e Migração Detalhada.

CASOS E EVIDÊNCIAS REAIS: informação não encontrada no material de origem.
informação não encontrada
A documentação de casos e evidências práticas é um elemento crítico para a redução de risco percebido e para fornecer previsibilidade ao potencial cliente. A demonstração de como a Configuração de Múltiplos Pipelines ou a Fila de Atendimento funcionou para uma empresa com problema similar de distribuição desigual, por exemplo, serviria como prova social. A ausência de exemplos concretos obriga o cliente a basear sua decisão puramente em promessas técnicas e dificulta a validação dos critérios de sucesso exigidos, como a confiabilidade de 99% na distribuição de leads ou nos relatórios.',
  0, NOW(), NOW()
FROM "Company" c
WHERE c."slug" = 'vesticrm'
  AND NOT EXISTS (SELECT 1 FROM "PortfolioProduct" p WHERE p."id" = 'seed_crm_vendas_pro');


-- Posições alocadas (papéis do time; as horas por papel não constam no material)
INSERT INTO "PortfolioPosition" ("id","productId","role","hours","cost","note","order")
SELECT 'seed_crm_vendas_pro_pos0', 'seed_crm_vendas_pro', 'Account Manager', 0, 0, 'Kick-off, alinhamento de escopo e cronograma.', 0
WHERE EXISTS (SELECT 1 FROM "PortfolioProduct" WHERE "id" = 'seed_crm_vendas_pro')
  AND NOT EXISTS (SELECT 1 FROM "PortfolioPosition" WHERE "id" = 'seed_crm_vendas_pro_pos0');
INSERT INTO "PortfolioPosition" ("id","productId","role","hours","cost","note","order")
SELECT 'seed_crm_vendas_pro_pos1', 'seed_crm_vendas_pro', 'Analista de CRM', 0, 0, 'Configuração, mapeamento, relatórios, automações, treinamento e documentação.', 1
WHERE EXISTS (SELECT 1 FROM "PortfolioProduct" WHERE "id" = 'seed_crm_vendas_pro')
  AND NOT EXISTS (SELECT 1 FROM "PortfolioPosition" WHERE "id" = 'seed_crm_vendas_pro_pos1');
INSERT INTO "PortfolioPosition" ("id","productId","role","hours","cost","note","order")
SELECT 'seed_crm_vendas_pro_pos2', 'seed_crm_vendas_pro', 'Desenvolvedor', 0, 0, 'Conexão com ferramenta de comunicação e migração detalhada de dados.', 2
WHERE EXISTS (SELECT 1 FROM "PortfolioProduct" WHERE "id" = 'seed_crm_vendas_pro')
  AND NOT EXISTS (SELECT 1 FROM "PortfolioPosition" WHERE "id" = 'seed_crm_vendas_pro_pos2');

-- Etapas de entrega (16 tarefas do cronograma, agrupadas pelos 3 módulos)
INSERT INTO "PortfolioStep" ("id","productId","stage","task","detail","executor","estimate","popUrl","order")
SELECT 'seed_crm_vendas_pro_step1', 'seed_crm_vendas_pro', 'Onboarding', 'Criar Grupo com o Cliente + Boas-Vindas', NULL, 'Account Manager', NULL, NULL, 0
WHERE EXISTS (SELECT 1 FROM "PortfolioProduct" WHERE "id" = 'seed_crm_vendas_pro')
  AND NOT EXISTS (SELECT 1 FROM "PortfolioStep" WHERE "id" = 'seed_crm_vendas_pro_step1');
INSERT INTO "PortfolioStep" ("id","productId","stage","task","detail","executor","estimate","popUrl","order")
SELECT 'seed_crm_vendas_pro_step2', 'seed_crm_vendas_pro', 'Onboarding', 'Envio e Análise do Briefing Detalhado (Múltiplos Funis e Regras de Negócio)', NULL, 'Analista de CRM', NULL, NULL, 1
WHERE EXISTS (SELECT 1 FROM "PortfolioProduct" WHERE "id" = 'seed_crm_vendas_pro')
  AND NOT EXISTS (SELECT 1 FROM "PortfolioStep" WHERE "id" = 'seed_crm_vendas_pro_step2');
INSERT INTO "PortfolioStep" ("id","productId","stage","task","detail","executor","estimate","popUrl","order")
SELECT 'seed_crm_vendas_pro_step3', 'seed_crm_vendas_pro', 'Onboarding', 'Reunião para Alinhamento de Escopo, Fluxos e Regras de Automação de Vendas', NULL, 'Account Manager', NULL, NULL, 2
WHERE EXISTS (SELECT 1 FROM "PortfolioProduct" WHERE "id" = 'seed_crm_vendas_pro')
  AND NOT EXISTS (SELECT 1 FROM "PortfolioStep" WHERE "id" = 'seed_crm_vendas_pro_step3');
INSERT INTO "PortfolioStep" ("id","productId","stage","task","detail","executor","estimate","popUrl","order")
SELECT 'seed_crm_vendas_pro_step4', 'seed_crm_vendas_pro', 'Onboarding', 'Mapeamento e Solicitação de Credenciais de Ferramentas de Prospecção/Mídia', NULL, 'Analista de CRM', NULL, NULL, 3
WHERE EXISTS (SELECT 1 FROM "PortfolioProduct" WHERE "id" = 'seed_crm_vendas_pro')
  AND NOT EXISTS (SELECT 1 FROM "PortfolioStep" WHERE "id" = 'seed_crm_vendas_pro_step4');
INSERT INTO "PortfolioStep" ("id","productId","stage","task","detail","executor","estimate","popUrl","order")
SELECT 'seed_crm_vendas_pro_step5', 'seed_crm_vendas_pro', 'Configuração Essencial (Core)', 'Configuração de Múltiplos Pipelines (Ex: Prospecção, Oportunidades, Fechamento)', NULL, 'Analista de CRM', NULL, NULL, 4
WHERE EXISTS (SELECT 1 FROM "PortfolioProduct" WHERE "id" = 'seed_crm_vendas_pro')
  AND NOT EXISTS (SELECT 1 FROM "PortfolioStep" WHERE "id" = 'seed_crm_vendas_pro_step5');
INSERT INTO "PortfolioStep" ("id","productId","stage","task","detail","executor","estimate","popUrl","order")
SELECT 'seed_crm_vendas_pro_step6', 'seed_crm_vendas_pro', 'Configuração Essencial (Core)', 'Definição e Mapeamento de Fila de Atendimento (Ex: Rotação de Leads e Distribuição)', NULL, 'Analista de CRM', NULL, NULL, 5
WHERE EXISTS (SELECT 1 FROM "PortfolioProduct" WHERE "id" = 'seed_crm_vendas_pro')
  AND NOT EXISTS (SELECT 1 FROM "PortfolioStep" WHERE "id" = 'seed_crm_vendas_pro_step6');
INSERT INTO "PortfolioStep" ("id","productId","stage","task","detail","executor","estimate","popUrl","order")
SELECT 'seed_crm_vendas_pro_step7', 'seed_crm_vendas_pro', 'Configuração Essencial (Core)', 'Criação de 5+ Relatórios/Dashboards de Acompanhamento (Da própria plataforma)', NULL, 'Analista de CRM', NULL, NULL, 6
WHERE EXISTS (SELECT 1 FROM "PortfolioProduct" WHERE "id" = 'seed_crm_vendas_pro')
  AND NOT EXISTS (SELECT 1 FROM "PortfolioStep" WHERE "id" = 'seed_crm_vendas_pro_step7');
INSERT INTO "PortfolioStep" ("id","productId","stage","task","detail","executor","estimate","popUrl","order")
SELECT 'seed_crm_vendas_pro_step8', 'seed_crm_vendas_pro', 'Configuração Essencial (Core)', 'Criação de Campos de Governança (Ex: Motivo de Perda Detalhado, Status de Follow-up)', NULL, 'Analista de CRM', NULL, NULL, 7
WHERE EXISTS (SELECT 1 FROM "PortfolioProduct" WHERE "id" = 'seed_crm_vendas_pro')
  AND NOT EXISTS (SELECT 1 FROM "PortfolioStep" WHERE "id" = 'seed_crm_vendas_pro_step8');
INSERT INTO "PortfolioStep" ("id","productId","stage","task","detail","executor","estimate","popUrl","order")
SELECT 'seed_crm_vendas_pro_step9', 'seed_crm_vendas_pro', 'Configuração Essencial (Core)', 'Criação de 2 Fluxos de Automação Interna (Ex: Alerta de Lead Inativo, Notificação ao Gestor)', NULL, 'Analista de CRM', NULL, NULL, 8
WHERE EXISTS (SELECT 1 FROM "PortfolioProduct" WHERE "id" = 'seed_crm_vendas_pro')
  AND NOT EXISTS (SELECT 1 FROM "PortfolioStep" WHERE "id" = 'seed_crm_vendas_pro_step9');
INSERT INTO "PortfolioStep" ("id","productId","stage","task","detail","executor","estimate","popUrl","order")
SELECT 'seed_crm_vendas_pro_step10', 'seed_crm_vendas_pro', 'Configuração Essencial (Core)', 'Conexão Simples com 1 Ferramenta de Comunicação', NULL, 'Desenvolvedor', '3,5 h', NULL, 9
WHERE EXISTS (SELECT 1 FROM "PortfolioProduct" WHERE "id" = 'seed_crm_vendas_pro')
  AND NOT EXISTS (SELECT 1 FROM "PortfolioStep" WHERE "id" = 'seed_crm_vendas_pro_step10');
INSERT INTO "PortfolioStep" ("id","productId","stage","task","detail","executor","estimate","popUrl","order")
SELECT 'seed_crm_vendas_pro_step11', 'seed_crm_vendas_pro', 'Configuração Essencial (Core)', 'Migração Detalhada de Dados de Oportunidades e Histórico de Negócios', NULL, 'Desenvolvedor', '3,0 h', NULL, 10
WHERE EXISTS (SELECT 1 FROM "PortfolioProduct" WHERE "id" = 'seed_crm_vendas_pro')
  AND NOT EXISTS (SELECT 1 FROM "PortfolioStep" WHERE "id" = 'seed_crm_vendas_pro_step11');
INSERT INTO "PortfolioStep" ("id","productId","stage","task","detail","executor","estimate","popUrl","order")
SELECT 'seed_crm_vendas_pro_step12', 'seed_crm_vendas_pro', 'Entrega Final + Treinamento', 'Reunião pós Semana 2', NULL, 'Account Manager', NULL, NULL, 11
WHERE EXISTS (SELECT 1 FROM "PortfolioProduct" WHERE "id" = 'seed_crm_vendas_pro')
  AND NOT EXISTS (SELECT 1 FROM "PortfolioStep" WHERE "id" = 'seed_crm_vendas_pro_step12');
INSERT INTO "PortfolioStep" ("id","productId","stage","task","detail","executor","estimate","popUrl","order")
SELECT 'seed_crm_vendas_pro_step13', 'seed_crm_vendas_pro', 'Entrega Final + Treinamento', 'Treinamento Intermediário (Foco em Funil, Relatórios e Uso de Templates)', NULL, 'Analista de CRM', NULL, NULL, 12
WHERE EXISTS (SELECT 1 FROM "PortfolioProduct" WHERE "id" = 'seed_crm_vendas_pro')
  AND NOT EXISTS (SELECT 1 FROM "PortfolioStep" WHERE "id" = 'seed_crm_vendas_pro_step13');
INSERT INTO "PortfolioStep" ("id","productId","stage","task","detail","executor","estimate","popUrl","order")
SELECT 'seed_crm_vendas_pro_step14', 'seed_crm_vendas_pro', 'Entrega Final + Treinamento', 'Validação da Estrutura, Automações e Testes de Rotação de Leads', NULL, 'Analista de CRM', NULL, NULL, 13
WHERE EXISTS (SELECT 1 FROM "PortfolioProduct" WHERE "id" = 'seed_crm_vendas_pro')
  AND NOT EXISTS (SELECT 1 FROM "PortfolioStep" WHERE "id" = 'seed_crm_vendas_pro_step14');
INSERT INTO "PortfolioStep" ("id","productId","stage","task","detail","executor","estimate","popUrl","order")
SELECT 'seed_crm_vendas_pro_step15', 'seed_crm_vendas_pro', 'Entrega Final + Treinamento', 'Documentação da Configuração Base e Repasse ao Cliente', NULL, 'Analista de CRM', NULL, NULL, 14
WHERE EXISTS (SELECT 1 FROM "PortfolioProduct" WHERE "id" = 'seed_crm_vendas_pro')
  AND NOT EXISTS (SELECT 1 FROM "PortfolioStep" WHERE "id" = 'seed_crm_vendas_pro_step15');
INSERT INTO "PortfolioStep" ("id","productId","stage","task","detail","executor","estimate","popUrl","order")
SELECT 'seed_crm_vendas_pro_step16', 'seed_crm_vendas_pro', 'Entrega Final + Treinamento', 'Reunião de Fechamento de Projeto', NULL, 'Account Manager', NULL, NULL, 15
WHERE EXISTS (SELECT 1 FROM "PortfolioProduct" WHERE "id" = 'seed_crm_vendas_pro')
  AND NOT EXISTS (SELECT 1 FROM "PortfolioStep" WHERE "id" = 'seed_crm_vendas_pro_step16');
