-- CreateTable
CREATE TABLE "relatorio_modelos" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(150) NOT NULL,
    "descricao" VARCHAR(500),
    "configuracao" JSONB NOT NULL,
    "compartilhado" BOOLEAN NOT NULL DEFAULT false,
    "usuario_id" INTEGER NOT NULL,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "relatorio_modelos_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "relatorio_modelos_usuario_id_idx" ON "relatorio_modelos"("usuario_id");
-- AddForeignKey
ALTER TABLE "relatorio_modelos" ADD CONSTRAINT "relatorio_modelos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
