-- CreateTable
CREATE TABLE "relatorios_analiticos" (
    "id" SERIAL NOT NULL,
    "unidade_id" INTEGER NOT NULL,
    "tecnico_id" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
    "numero" INTEGER,
    "ano" INTEGER,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL,
    "motivo_devolucao" TEXT,
    "assinado_por_id" INTEGER,
    "assinado_em" TIMESTAMPTZ(6),
    "cargo_assinante" VARCHAR(150),
    "codigo_verificacao" VARCHAR(32),
    "documento" JSONB,
    "anulado_por_id" INTEGER,
    "anulado_em" TIMESTAMPTZ(6),
    "motivo_anulacao" TEXT,
    "origem_id" INTEGER,
    CONSTRAINT "relatorios_analiticos_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "relatorios_analiticos_itens" (
    "id" SERIAL NOT NULL,
    "relatorio_id" INTEGER NOT NULL,
    "ordem" INTEGER NOT NULL,
    "equipamento" VARCHAR(200) NOT NULL,
    "patrimonio" VARCHAR(60) NOT NULL,
    CONSTRAINT "relatorios_analiticos_itens_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "relatorios_analiticos_codigo_verificacao_key" ON "relatorios_analiticos"("codigo_verificacao");
-- CreateIndex
CREATE INDEX "relatorios_analiticos_status_idx" ON "relatorios_analiticos"("status");
-- CreateIndex
CREATE UNIQUE INDEX "relatorios_analiticos_unidade_id_ano_numero_key" ON "relatorios_analiticos"("unidade_id", "ano", "numero");
-- CreateIndex
CREATE INDEX "relatorios_analiticos_itens_relatorio_id_idx" ON "relatorios_analiticos_itens"("relatorio_id");
-- CreateIndex
CREATE INDEX "relatorios_analiticos_itens_patrimonio_idx" ON "relatorios_analiticos_itens"("patrimonio");
-- AddForeignKey
ALTER TABLE "relatorios_analiticos" ADD CONSTRAINT "relatorios_analiticos_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades_organizacionais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "relatorios_analiticos" ADD CONSTRAINT "relatorios_analiticos_tecnico_id_fkey" FOREIGN KEY ("tecnico_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "relatorios_analiticos" ADD CONSTRAINT "relatorios_analiticos_assinado_por_id_fkey" FOREIGN KEY ("assinado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "relatorios_analiticos" ADD CONSTRAINT "relatorios_analiticos_anulado_por_id_fkey" FOREIGN KEY ("anulado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "relatorios_analiticos_itens" ADD CONSTRAINT "relatorios_analiticos_itens_relatorio_id_fkey" FOREIGN KEY ("relatorio_id") REFERENCES "relatorios_analiticos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
