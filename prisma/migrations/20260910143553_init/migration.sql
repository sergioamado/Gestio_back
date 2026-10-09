-- CreateEnum
CREATE TYPE "StatusManutencao" AS ENUM ('Pendente', 'Em_manutencao', 'Concluido');

-- CreateEnum
CREATE TYPE "StatusAtendimento" AS ENUM ('Aguardando_Assistencia', 'Em_Atendimento', 'Aguardando_Peca', 'Aguardando_Peca_Com_Backup', 'Aguardando_Peca_Impressao_Redirecionada', 'Concluido', 'Cancelado');

-- CreateTable
CREATE TABLE "itens" (
    "id" SERIAL NOT NULL,
    "codigo_sipac" VARCHAR(50),
    "codigo_ref" VARCHAR(50),
    "pregao" VARCHAR(100),
    "descricao" TEXT NOT NULL,
    "quantidade_teste" INTEGER NOT NULL DEFAULT 0,
    "quantidade_com_defeito" INTEGER NOT NULL DEFAULT 0,
    "quantidade_estoque" INTEGER NOT NULL DEFAULT 0,
    "quantidade_defeito" INTEGER NOT NULL DEFAULT 0,
    "localizacao_teste" TEXT,
    "tipo" VARCHAR(100),
    "categoria" VARCHAR(50) NOT NULL DEFAULT 'Consumo',
    "unidade_medida" VARCHAR(20) NOT NULL DEFAULT 'UND',
    "localizacao" VARCHAR(100),
    "quantidade" INTEGER NOT NULL,
    "preco_unitario" DECIMAL(10,2) NOT NULL,
    "unidade_id" INTEGER,
    "is_permanente" BOOLEAN NOT NULL DEFAULT false,
    "patrimonio_item" VARCHAR(50),

    CONSTRAINT "itens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notificacoes" (
    "id" SERIAL NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "titulo" VARCHAR(255) NOT NULL,
    "mensagem" TEXT NOT NULL,
    "tipo" VARCHAR(50) NOT NULL DEFAULT 'SISTEMA',
    "link_acao" VARCHAR(255),
    "lida" BOOLEAN NOT NULL DEFAULT false,
    "data_criacao" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notificacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solicitacao_itens" (
    "id" SERIAL NOT NULL,
    "solicitacao_id" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "quantidade_solicitada" INTEGER NOT NULL,
    "status_entrega" VARCHAR(50) NOT NULL DEFAULT 'Pendente',
    "data_entrega" TIMESTAMPTZ(6),
    "tipo_uso" TEXT NOT NULL DEFAULT 'CONSUMO',

    CONSTRAINT "solicitacao_itens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solicitacoes" (
    "id" SERIAL NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "responsavel_usuario_id" INTEGER NOT NULL,
    "setor_equipamento" VARCHAR(255),
    "numero_glpi" INTEGER NOT NULL,
    "patrimonio" VARCHAR(50),
    "data_solicitacao" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "status" VARCHAR(50) NOT NULL DEFAULT 'PENDENTE',
    "tipo_requisicao" VARCHAR(20) NOT NULL DEFAULT 'PEDIDO',
    "justificativa" TEXT,
    "numero_pedido_externo" VARCHAR(100),
    "documento_emitido_em" TIMESTAMPTZ(6),
    "unidade_id" INTEGER NOT NULL,

    CONSTRAINT "solicitacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unidades_organizacionais" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(255) NOT NULL,
    "sigla" VARCHAR(20),
    "campus" VARCHAR(100),
    "data_criacao" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unidades_organizacionais_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuarios" (
    "id" SERIAL NOT NULL,
    "username" VARCHAR(100) NOT NULL,
    "hashed_password" VARCHAR(255) NOT NULL,
    "nome_completo" VARCHAR(255) NOT NULL,
    "role" VARCHAR(50) NOT NULL,
    "telefone" VARCHAR(20),
    "email" VARCHAR(255),
    "telegram_chat_id" VARCHAR(50),
    "telegram_token" VARCHAR(100),
    "notificacoes_app" BOOLEAN NOT NULL DEFAULT true,
    "notificacoes_bot" BOOLEAN NOT NULL DEFAULT true,
    "unidade_id" INTEGER,
    "data_criacao" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "preferencias_notificacao" JSONB,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manutencao_eletronica" (
    "id" SERIAL NOT NULL,
    "glpi" VARCHAR(50),
    "tecnico_responsavel_id" INTEGER NOT NULL,
    "aberto_por_id" INTEGER,
    "equipamento" VARCHAR(255) NOT NULL,
    "descricao_problema" TEXT NOT NULL,
    "data_entrada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "StatusManutencao" NOT NULL DEFAULT 'Pendente',
    "laudo_tecnico" TEXT,
    "patrimonio" VARCHAR(50),

    CONSTRAINT "manutencao_eletronica_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Impressora" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(150) NOT NULL,
    "modelo" VARCHAR(100) NOT NULL,
    "numero_serie" VARCHAR(100) NOT NULL,
    "ip" VARCHAR(45),
    "localizacao" VARCHAR(255) NOT NULL,
    "servidor" VARCHAR(100),
    "politicas_aplicadas" BOOLEAN NOT NULL DEFAULT false,
    "status_verificacao" VARCHAR(50) NOT NULL DEFAULT 'Não Verificado',
    "unidade_id" INTEGER NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "is_colorida" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Impressora_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AtendimentoImpressora" (
    "id" SERIAL NOT NULL,
    "data" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "numero_glpi" VARCHAR(50) NOT NULL,
    "status" "StatusAtendimento" NOT NULL DEFAULT 'Aguardando_Assistencia',
    "setor_visitado" BOOLEAN NOT NULL DEFAULT false,
    "necessita_pecas" BOOLEAN NOT NULL DEFAULT false,
    "descricao_pecas" TEXT,
    "chamado_assistencia" VARCHAR(100),
    "assistencia_realizada" BOOLEAN NOT NULL DEFAULT false,
    "parecer_tecnico" TEXT,
    "assistencia_concluiu" BOOLEAN NOT NULL DEFAULT false,
    "parecer_final_assistencia" TEXT,
    "necessita_backup" BOOLEAN NOT NULL DEFAULT false,
    "backup_impressora_nome" VARCHAR(150),
    "backup_impressora_modelo" VARCHAR(100),
    "backup_numero_serie" VARCHAR(100),
    "backup_ip" VARCHAR(45),
    "backup_data_disponibilizacao" TIMESTAMPTZ(6),
    "backup_data_retirada" TIMESTAMPTZ(6),
    "unidade_id" INTEGER NOT NULL,
    "impressora_id" INTEGER NOT NULL,
    "tecnico_id" INTEGER NOT NULL,
    "data_visita" DATE,

    CONSTRAINT "AtendimentoImpressora_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImpressaoForaUnidade" (
    "id" SERIAL NOT NULL,
    "data_inicio" DATE NOT NULL,
    "data_fim" DATE,
    "usuario_id" INTEGER NOT NULL,
    "unidade_original_id" INTEGER NOT NULL,
    "unidade_temporaria_id" INTEGER NOT NULL,
    "atendimento_id" INTEGER,

    CONSTRAINT "ImpressaoForaUnidade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstoqueSuprimentos" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "unidade_imagem_total" INTEGER NOT NULL DEFAULT 0,
    "toner_preto_total" INTEGER NOT NULL DEFAULT 0,
    "toner_ciano_total" INTEGER NOT NULL DEFAULT 0,
    "toner_magenta_total" INTEGER NOT NULL DEFAULT 0,
    "toner_amarelo_total" INTEGER NOT NULL DEFAULT 0,
    "data_ultima_atualizacao" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EstoqueSuprimentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ControleSuprimentos" (
    "id" SERIAL NOT NULL,
    "data" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "numero_glpi" VARCHAR(50),
    "unidade_imagem_solicitadas" INTEGER NOT NULL DEFAULT 0,
    "toner_preto_solicitados" INTEGER NOT NULL DEFAULT 0,
    "toner_ciano_solicitados" INTEGER NOT NULL DEFAULT 0,
    "toner_magenta_solicitados" INTEGER NOT NULL DEFAULT 0,
    "toner_amarelo_solicitados" INTEGER NOT NULL DEFAULT 0,
    "tecnico_id" INTEGER NOT NULL,
    "impressora_id" INTEGER NOT NULL,

    CONSTRAINT "ControleSuprimentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BemPatrimonial" (
    "id" SERIAL NOT NULL,
    "tombamento" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "marca" TEXT,
    "localizacao_fisica" TEXT NOT NULL,
    "foto_url" TEXT,
    "status_atual" TEXT NOT NULL DEFAULT 'Ativo',
    "unidade_id" INTEGER NOT NULL,
    "data_importacao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BemPatrimonial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AtribuicaoTecnico" (
    "id" SERIAL NOT NULL,
    "bem_id" INTEGER NOT NULL,
    "tecnico_id" INTEGER NOT NULL,
    "data_atribuicao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data_devolucao" TIMESTAMP(3),
    "observacoes" TEXT,

    CONSTRAINT "AtribuicaoTecnico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistoricoPatrimonio" (
    "id" SERIAL NOT NULL,
    "bem_id" INTEGER NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "tecnico_id" INTEGER,
    "acao" VARCHAR(100) NOT NULL,
    "detalhes" TEXT,
    "data_registro" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HistoricoPatrimonio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MovimentacaoBem" (
    "id" SERIAL NOT NULL,
    "bem_id" INTEGER NOT NULL,
    "tipo" VARCHAR(50) NOT NULL,
    "subtipo" VARCHAR(50),
    "origem_unidade_id" INTEGER NOT NULL,
    "destino_unidade_id" INTEGER,
    "data_envio" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data_recebimento" TIMESTAMPTZ(6),

    CONSTRAINT "MovimentacaoBem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LevantamentoPatrimonial" (
    "id" SERIAL NOT NULL,
    "data_inicio" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data_fim" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'Aberto',

    CONSTRAINT "LevantamentoPatrimonial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConferenciaLevantamento" (
    "id" SERIAL NOT NULL,
    "levantamento_id" INTEGER NOT NULL,
    "bem_id" INTEGER NOT NULL,
    "status_conferido" TEXT NOT NULL,
    "justificativa" TEXT,

    CONSTRAINT "ConferenciaLevantamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "historico_suprimentos" (
    "id" SERIAL NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "cor" TEXT NOT NULL,
    "tipo_acao" TEXT NOT NULL,
    "quantidade_adicionada" INTEGER,
    "quantidade_anterior" INTEGER,
    "quantidade_nova" INTEGER,
    "justificativa" TEXT,
    "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historico_suprimentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reportes_erro_estoque" (
    "id" SERIAL NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "mensagem" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "data_criacao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reportes_erro_estoque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogoServico" (
    "id" SERIAL NOT NULL,
    "nome_servico" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "valor_estimado" DECIMAL(10,2) NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CatalogoServico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProducaoServico" (
    "id" SERIAL NOT NULL,
    "data_registro" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tecnico_id" INTEGER NOT NULL,
    "servico_id" INTEGER NOT NULL,
    "patrimonio_serie" TEXT,
    "solicitacao_peca_id" INTEGER,
    "atendimento_impr_id" INTEGER,
    "manutencao_eletr_id" INTEGER,
    "numero_glpi" TEXT,
    "valor_servico_aplicado" DECIMAL(10,2) NOT NULL,
    "valor_pecas_aplicado" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "valor_total_produzido" DECIMAL(10,2) NOT NULL,
    "observacoes" TEXT,

    CONSTRAINT "ProducaoServico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dashboard" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "usuario_id" INTEGER,
    "publico" BOOLEAN NOT NULL DEFAULT false,
    "configuracao" JSONB,
    "data_criacao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Dashboard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardWidget" (
    "id" SERIAL NOT NULL,
    "dashboard_id" INTEGER NOT NULL,
    "titulo" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "dataset" TEXT NOT NULL,
    "configuracao" JSONB NOT NULL,
    "posicao_x" INTEGER NOT NULL DEFAULT 0,
    "posicao_y" INTEGER NOT NULL DEFAULT 0,
    "largura" INTEGER NOT NULL DEFAULT 6,
    "altura" INTEGER NOT NULL DEFAULT 4,

    CONSTRAINT "DashboardWidget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "itens_codigo_sipac_unidade_id_key" ON "itens"("codigo_sipac", "unidade_id");

-- CreateIndex
CREATE INDEX "notificacoes_usuario_id_idx" ON "notificacoes"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "unidades_organizacionais_nome_key" ON "unidades_organizacionais"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "unidades_organizacionais_sigla_key" ON "unidades_organizacionais"("sigla");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_username_key" ON "usuarios"("username");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_telegram_chat_id_key" ON "usuarios"("telegram_chat_id");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_telegram_token_key" ON "usuarios"("telegram_token");

-- CreateIndex
CREATE UNIQUE INDEX "Impressora_numero_serie_key" ON "Impressora"("numero_serie");

-- CreateIndex
CREATE UNIQUE INDEX "Impressora_ip_key" ON "Impressora"("ip");

-- CreateIndex
CREATE UNIQUE INDEX "BemPatrimonial_tombamento_key" ON "BemPatrimonial"("tombamento");

-- CreateIndex
CREATE UNIQUE INDEX "ProducaoServico_solicitacao_peca_id_key" ON "ProducaoServico"("solicitacao_peca_id");

-- CreateIndex
CREATE UNIQUE INDEX "ProducaoServico_atendimento_impr_id_key" ON "ProducaoServico"("atendimento_impr_id");

-- CreateIndex
CREATE UNIQUE INDEX "ProducaoServico_manutencao_eletr_id_key" ON "ProducaoServico"("manutencao_eletr_id");

-- AddForeignKey
ALTER TABLE "itens" ADD CONSTRAINT "itens_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades_organizacionais"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notificacoes" ADD CONSTRAINT "notificacoes_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitacao_itens" ADD CONSTRAINT "solicitacao_itens_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "itens"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "solicitacao_itens" ADD CONSTRAINT "solicitacao_itens_solicitacao_id_fkey" FOREIGN KEY ("solicitacao_id") REFERENCES "solicitacoes"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "solicitacoes" ADD CONSTRAINT "solicitacoes_responsavel_usuario_id_fkey" FOREIGN KEY ("responsavel_usuario_id") REFERENCES "usuarios"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "solicitacoes" ADD CONSTRAINT "solicitacoes_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades_organizacionais"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "solicitacoes" ADD CONSTRAINT "solicitacoes_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades_organizacionais"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "manutencao_eletronica" ADD CONSTRAINT "manutencao_eletronica_tecnico_responsavel_id_fkey" FOREIGN KEY ("tecnico_responsavel_id") REFERENCES "usuarios"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "manutencao_eletronica" ADD CONSTRAINT "manutencao_eletronica_aberto_por_id_fkey" FOREIGN KEY ("aberto_por_id") REFERENCES "usuarios"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Impressora" ADD CONSTRAINT "Impressora_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades_organizacionais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtendimentoImpressora" ADD CONSTRAINT "AtendimentoImpressora_impressora_id_fkey" FOREIGN KEY ("impressora_id") REFERENCES "Impressora"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtendimentoImpressora" ADD CONSTRAINT "AtendimentoImpressora_tecnico_id_fkey" FOREIGN KEY ("tecnico_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtendimentoImpressora" ADD CONSTRAINT "AtendimentoImpressora_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades_organizacionais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpressaoForaUnidade" ADD CONSTRAINT "ImpressaoForaUnidade_atendimento_id_fkey" FOREIGN KEY ("atendimento_id") REFERENCES "AtendimentoImpressora"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpressaoForaUnidade" ADD CONSTRAINT "ImpressaoForaUnidade_unidade_original_id_fkey" FOREIGN KEY ("unidade_original_id") REFERENCES "unidades_organizacionais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpressaoForaUnidade" ADD CONSTRAINT "ImpressaoForaUnidade_unidade_temporaria_id_fkey" FOREIGN KEY ("unidade_temporaria_id") REFERENCES "unidades_organizacionais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpressaoForaUnidade" ADD CONSTRAINT "ImpressaoForaUnidade_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControleSuprimentos" ADD CONSTRAINT "ControleSuprimentos_impressora_id_fkey" FOREIGN KEY ("impressora_id") REFERENCES "Impressora"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControleSuprimentos" ADD CONSTRAINT "ControleSuprimentos_tecnico_id_fkey" FOREIGN KEY ("tecnico_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BemPatrimonial" ADD CONSTRAINT "BemPatrimonial_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades_organizacionais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtribuicaoTecnico" ADD CONSTRAINT "AtribuicaoTecnico_bem_id_fkey" FOREIGN KEY ("bem_id") REFERENCES "BemPatrimonial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtribuicaoTecnico" ADD CONSTRAINT "AtribuicaoTecnico_tecnico_id_fkey" FOREIGN KEY ("tecnico_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricoPatrimonio" ADD CONSTRAINT "HistoricoPatrimonio_bem_id_fkey" FOREIGN KEY ("bem_id") REFERENCES "BemPatrimonial"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricoPatrimonio" ADD CONSTRAINT "HistoricoPatrimonio_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricoPatrimonio" ADD CONSTRAINT "HistoricoPatrimonio_tecnico_id_fkey" FOREIGN KEY ("tecnico_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimentacaoBem" ADD CONSTRAINT "MovimentacaoBem_bem_id_fkey" FOREIGN KEY ("bem_id") REFERENCES "BemPatrimonial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimentacaoBem" ADD CONSTRAINT "MovimentacaoBem_origem_unidade_id_fkey" FOREIGN KEY ("origem_unidade_id") REFERENCES "unidades_organizacionais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimentacaoBem" ADD CONSTRAINT "MovimentacaoBem_destino_unidade_id_fkey" FOREIGN KEY ("destino_unidade_id") REFERENCES "unidades_organizacionais"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConferenciaLevantamento" ADD CONSTRAINT "ConferenciaLevantamento_levantamento_id_fkey" FOREIGN KEY ("levantamento_id") REFERENCES "LevantamentoPatrimonial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConferenciaLevantamento" ADD CONSTRAINT "ConferenciaLevantamento_bem_id_fkey" FOREIGN KEY ("bem_id") REFERENCES "BemPatrimonial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historico_suprimentos" ADD CONSTRAINT "historico_suprimentos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reportes_erro_estoque" ADD CONSTRAINT "reportes_erro_estoque_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProducaoServico" ADD CONSTRAINT "ProducaoServico_tecnico_id_fkey" FOREIGN KEY ("tecnico_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProducaoServico" ADD CONSTRAINT "ProducaoServico_servico_id_fkey" FOREIGN KEY ("servico_id") REFERENCES "CatalogoServico"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProducaoServico" ADD CONSTRAINT "ProducaoServico_solicitacao_peca_id_fkey" FOREIGN KEY ("solicitacao_peca_id") REFERENCES "solicitacoes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProducaoServico" ADD CONSTRAINT "ProducaoServico_atendimento_impr_id_fkey" FOREIGN KEY ("atendimento_impr_id") REFERENCES "AtendimentoImpressora"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProducaoServico" ADD CONSTRAINT "ProducaoServico_manutencao_eletr_id_fkey" FOREIGN KEY ("manutencao_eletr_id") REFERENCES "manutencao_eletronica"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardWidget" ADD CONSTRAINT "DashboardWidget_dashboard_id_fkey" FOREIGN KEY ("dashboard_id") REFERENCES "Dashboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
