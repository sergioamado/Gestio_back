// src/controllers/servicosController.ts
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { dispararNotificacao } from './notificacaoController';
const prisma = new PrismaClient();


// VALIDAÇÕES (ZOD)

// Validação para quando o gestor cria/edita um serviço no catálogo
const catalogoSchema = z.object({
  nome_servico: z.string().min(1, "O nome do serviço é obrigatório"),
  categoria: z.string().min(1, "A categoria é obrigatória"),
  valor_estimado: z.number().min(0, "O valor não pode ser negativo"),
  ativo: z.boolean().optional().default(true),
});

// Validação para quando o técnico regista o fechamento de um serviço
const producaoSchema = z.object({
  servicos: z.array(z.number()).min(1, "Selecione pelo menos um serviço."),
  observacoes: z.string().nullable().optional(),
  patrimonio_serie: z.string().nullable().optional(),
  tipo_vinculo: z.string().optional(),
  vinculo_id: z.union([z.string(), z.number()]).optional(),
  solicitacao_peca_id: z.number().nullable().optional(),
  atendimento_impr_id: z.number().nullable().optional(),
  manutencao_eletr_id: z.number().nullable().optional(),
  numero_glpi: z.string().nullable().optional(),
});


// GESTÃO DO CATÁLOGO DE SERVIÇOS (Apenas Gestor/Admin)


export const getCatalogo = async (req: Request, res: Response) => {
  try {
    const catalogo = await prisma.catalogoServico.findMany({
      orderBy: { categoria: 'asc' } // Organiza alfabeticamente por categoria
    });
    res.json(catalogo);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar catálogo de serviços.' });
  }
};

export const createCatalogoItem = async (req: Request, res: Response) => {
  try {
    const data = catalogoSchema.parse(req.body);
    const novoServico = await prisma.catalogoServico.create({ data });
    res.status(201).json(novoServico);
  } catch (error: any) {
    res.status(400).json({ message: 'Erro ao criar serviço no catálogo.', details: error.errors });
  }
};

export const updateCatalogoItem = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const data = catalogoSchema.parse(req.body);
    const servicoAtualizado = await prisma.catalogoServico.update({
      where: { id: Number(id) },
      data
    });
    res.json(servicoAtualizado);
  } catch (error: any) {
    res.status(400).json({ message: 'Erro ao atualizar serviço no catálogo.', details: error.errors });
  }
};

