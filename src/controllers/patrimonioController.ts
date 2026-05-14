import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();

// Schema para transferência de bens
const transferenciaSchema = z.object({
  bem_ids: z.array(z.number().int()),
  origem_unidade_id: z.number().int(),
  destino_unidade_id: z.number().int(),
  observacao: z.string().optional(),
});

// 1. Listar Bens com filtros (Localização, Descrição, Tombamento, Marca)
export const getAllBens = async (req: Request, res: Response) => {
  try {
    const { unidade_id, busca } = req.query;
    const where: any = {};

    if (unidade_id) where.unidade_id = Number(unidade_id);
    if (busca) {
      where.OR = [
        { tombamento: { contains: String(busca), mode: 'insensitive' } },
        { descricao: { contains: String(busca), mode: 'insensitive' } },
        { marca: { contains: String(busca), mode: 'insensitive' } }, // Corrigido para buscar por marca e não número de série
      ];
    }

    const bens = await prisma.bemPatrimonial.findMany({
      where,
      // CORREÇÃO TS(2353): O nome da relação no schema é 'unidade'
      include: { unidade: { select: { nome: true, sigla: true } } }, 
      orderBy: { descricao: 'asc' }
    });
    res.json(bens);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar bens patrimoniais.' });
  }
};

// 2. Lógica de Movimentação (Transferência entre Unidades)
export const transferirBens = async (req: Request, res: Response) => {
  try {
    const { bem_ids, origem_unidade_id, destino_unidade_id, observacao } = transferenciaSchema.parse(req.body);

    const resultado = await prisma.$transaction(async (tx) => {
      // Cria o registro da movimentação estritamente com os campos do schema
      const movimentacoes = await Promise.all(
        bem_ids.map(bem_id => 
          tx.movimentacaoBem.create({
            data: {
              bem_id,
              origem_unidade_id,
              destino_unidade_id,
              tipo: 'TRANSFERENCIA', // CORREÇÃO TS(2353): Campo obrigatório do schema
              subtipo: observacao,   // Usamos subtipo para guardar a observação opcional
              data_envio: new Date(),
            }
          })
        )
      );

      // Atualiza a localização atual de cada bem
      await tx.bemPatrimonial.updateMany({
        where: { id: { in: bem_ids } },
        data: { unidade_id: destino_unidade_id }
      });

      return movimentacoes;
    });

    res.status(201).json({ message: 'Movimentação registrada com sucesso.', resultado });
  } catch (error: any) {
    res.status(400).json({ message: error.message || 'Erro ao processar transferência.' });
  }
};

// 3. Processamento de Lista (Simulando extração de PDF do SIPAC)
export const importarDadosSipac = async (req: Request, res: Response) => {
  const { itens_extraidos } = req.body; 
  
  try {
    const importacao = await prisma.$transaction(
      itens_extraidos.map((item: any) => 
        prisma.bemPatrimonial.upsert({
          where: { tombamento: item.tombamento },
          update: { 
            descricao: item.descricao,
            unidade_id: item.unidade_id,
            // CORREÇÃO TS(2353): 'valor_contabil' removido
          },
          create: {
            tombamento: item.tombamento,
            descricao: item.descricao,
            localizacao_fisica: item.localizacao_fisica || 'Não informada', // Campo obrigatório no schema
            unidade_id: item.unidade_id,
            status_atual: 'Ativo',
            // CORREÇÃO TS(2353): 'valor_contabil' removido
          }
        })
      )
    );
    res.json({ message: 'Importação concluída.', total: importacao.length });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao importar dados do SIPAC.' });
  }
};

// 4. Gerar Lista de Bens Encontrados (Levantamento Patrimonial)
export const registrarConferencia = async (req: Request, res: Response) => {
    // O frontend deve enviar 'status_conferido' (Ex: "OK", "Nao Encontrado") e 'justificativa'
    const { levantamento_id, bem_id, status_conferido, justificativa } = req.body;
    
    try {
        const conferencia = await prisma.conferenciaLevantamento.create({
            data: {
                levantamento_id,
                bem_id,
                status_conferido, // CORREÇÃO TS(2353): Adequado ao schema
                justificativa,    // CORREÇÃO TS(2353): Adequado ao schema
            }
        });
        res.status(201).json(conferencia);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao registrar conferência.' });
    }
};

// Exemplo de como capturar o caminho no patrimonioController.ts
export const uploadFoto = async (req: Request, res: Response) => {
  const { id } = req.params;
  
  if (!req.file) {
    return res.status(400).json({ message: 'Nenhum ficheiro enviado.' });
  }

  const caminhoRelativo = req.file.path.replace(/\\/g, '/'); // Normaliza barras para Windows/Linux

  try {
    await prisma.bemPatrimonial.update({
      where: { id: Number(id) },
      data: { foto_url: caminhoRelativo }
    });
    res.json({ message: 'Foto atualizada!', url: caminhoRelativo });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao guardar caminho da foto.' });
  }
};