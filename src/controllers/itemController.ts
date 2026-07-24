// src/controllers/itemController.ts
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();

// 🚀 Geral #11 e #3: Schema atualizado com categoria e unidade_id opcional
const itemSchema = z.object({
  codigo_sipac: z.string().optional().nullable(),
  codigo_ref: z.string().optional().nullable(), 
  pregao: z.string().optional().nullable(),
  descricao: z.string().min(3, "Descrição é obrigatória"),
  tipo: z.string().optional().nullable(),
  categoria: z.string().default("Consumo"), // NOVO
  unidade_medida: z.string(),
  localizacao: z.string().optional().nullable(),
  quantidade: z.number().int().min(0),
  preco_unitario: z.number().min(0),
  unidade_id: z.number().int().optional().nullable(), // NOVO: Opcional para o estoque central
  is_permanente: z.boolean().default(false), 
  patrimonio_item: z.string().optional().nullable(), 
});

export const getAllItems = async (req: Request, res: Response) => {
  try {
    const { search, unidade_id, is_permanente, categoria, page = 1, limit = 10 } = req.query;
    const where: any = {};

    if (search) {
      where.OR = [
        { descricao: { contains: String(search), mode: 'insensitive' } },
        { codigo_sipac: { contains: String(search) } }
      ];
    }
    
    // Filtros adicionais
    if (unidade_id) where.unidade_id = Number(unidade_id);
    if (is_permanente !== undefined) where.is_permanente = is_permanente === 'true';
    if (categoria) where.categoria = String(categoria);

    // Cálculo da paginação
    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    // Busca e contagem simultâneas
    const [itens, total] = await Promise.all([
      prisma.itens.findMany({
        where,
        skip,
        take,
        include: { unidades_organizacionais: { select: { nome: true } } },
        orderBy: { descricao: 'asc' }
      }),
      prisma.itens.count({ where })
    ]);

    const respostaFormatada = itens.map((item: any) => ({
      ...item,
      unidade_nome: item.unidades_organizacionais?.nome || 'Estoque Central (COSUP)'
    }));

    res.json({
      data: respostaFormatada,
      meta: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    console.error("Erro em getAllItens:", error);
    res.status(500).json({ message: 'Erro ao buscar itens.' });
  }
};

export const createItem = async (req: Request, res: Response) => {
  try {
    const data = itemSchema.parse(req.body);
    const newItem = await prisma.itens.create({ data: data as any }); 
    res.status(201).json(newItem);
  } catch (error) {
    res.status(400).json({ message: 'Dados inválidos.', details: error });
  }
};

export const updateItem = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const data = itemSchema.parse(req.body);
    const updatedItem = await prisma.itens.update({
      where: { id: Number(id) },
      data: data as any,
    });
    res.json(updatedItem);
  } catch (error) {
    res.status(400).json({ message: 'Dados inválidos ou item não encontrado.', details: error });
  }
};

export const deleteItem = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await prisma.itens.delete({
      where: { id: Number(id) },
    });
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ message: 'Erro ao deletar item. Pode estar em uso em uma solicitação.' });
  }
};