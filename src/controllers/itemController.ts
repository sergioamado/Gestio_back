// src/controllers/itemController.ts
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { getIO } from '../socket';

const prisma = new PrismaClient();

// VALIDAÇÕES ZOD BLINDADAS
const itemSchema = z.object({
  codigo_sipac: z.string().optional().nullable(),
  codigo_ref: z.string().optional().nullable(), 
  pregao: z.string().optional().nullable(),
  descricao: z.string().min(3, "Descrição é obrigatória"),
  tipo: z.string().optional().nullable(),
  categoria: z.string().default("Consumo"),
  unidade_medida: z.string().optional().default("UND"),
  localizacao: z.string().optional().nullable(),
  
  // Transformadores Mágicos: Se vier NaN, vazio, ou null do Frontend, vira 0
  preco_unitario: z.any().transform(v => Number(v) || 0),
  // Transformador de ID: Se vier NaN, vazio, ou 0, vira NULL para não quebrar o Prisma
  unidade_id: z.any().transform(v => Number(v) || null),
  is_permanente: z.any().transform(v => v === 'true' || v === true),
  
  patrimonio_item: z.string().optional().nullable(),   
  quantidade_estoque: z.any().transform(v => Number(v) || 0),
  quantidade_teste: z.any().transform(v => Number(v) || 0),
  quantidade_defeito: z.any().transform(v => Number(v) || 0),
  localizacao_teste: z.string().optional().nullable(),
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
    
    if (unidade_id) where.unidade_id = Number(unidade_id);
    if (is_permanente !== undefined && is_permanente !== '') {
      where.is_permanente = is_permanente === 'true';
    }
    if (categoria) where.categoria = String(categoria);

    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    const [itens, total] = await Promise.all([
      prisma.itens.findMany({
        where, skip, take,
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
      meta: { total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / Number(limit)) }
    });
  } catch (error) {
    console.error("Erro em getAllItens:", error);
    res.status(500).json({ message: 'Erro ao buscar itens.' });
  }
};

export const createItem = async (req: Request, res: Response) => {
  try {
    const data = itemSchema.parse(req.body);
    const payload = {
      ...data,
      quantidade: data.quantidade_estoque || 0
    };
    const newItem = await prisma.itens.create({ data: payload as any }); 
    try { getIO().emit('atualizar_estoque'); } catch(e) {}    
    return res.status(201).json(newItem);
  } catch (error: any) { 
    // CORREÇÃO DA MENSAGEM UNDEFINED
    if (error instanceof z.ZodError) {
      console.error("Erro Zod Create:", error.format());
      return res.status(400).json({ message: 'Dados inválidos.', details: error.format() });
    }
    res.status(500).json({ message: 'Erro interno.', details: error.message });
  }
};

export const updateItem = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    // 1. O Zod valida os dados (a quantidade_estoque vem formatada)
    const data = itemSchema.parse(req.body);
    
    // 2. A CORREÇÃO: Sincronizar o campo "quantidade" com o "quantidade_estoque"
    // Se o gestor enviou um novo valor de quantidade de estoque, o campo 'quantidade' geral tem de seguir
    const payload = {
      ...data,
      quantidade: data.quantidade_estoque !== undefined ? data.quantidade_estoque : 0
    };

    // 3. Atualizar no Banco de Dados
    const updatedItem = await prisma.itens.update({
      where: { id: Number(id) },
      data: payload as any, //  Usa o payload com a quantidade sincronizada
    });
    
    // 4. Avisar o rádio para atualizar a tela de todos
    try { getIO().emit('atualizar_estoque'); } catch(e) {}    
    
    return res.json(updatedItem);
  } catch (error: any) { 
    if (error instanceof z.ZodError) {
      console.error("Erro Zod Update:", error.format());
      return res.status(400).json({ message: 'Dados inválidos.', details: error.format() });
    }
    res.status(500).json({ message: 'Erro interno.', details: error.message });
  }
};

export const deleteItem = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await prisma.itens.delete({ where: { id: Number(id) } });
    try { getIO().emit('atualizar_estoque'); } catch(e) {}
    return res.status(204).send();
  } catch (error) {
    res.status(500).json({ message: 'Erro ao deletar item. Pode estar em uso.' });
  }
};