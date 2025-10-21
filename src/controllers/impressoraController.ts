// src/controllers/impressoraController.ts
import { Request, Response } from 'express';
import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Impressoras
export const getAllImpressoras = async (req: Request, res: Response) => {
    const { ip, numero_serie, unidade_id_filtro, politicas_aplicadas } = req.query;

    const where: Prisma.ImpressoraWhereInput = {
        ativo: true
    };
    if (req.user?.role !== 'admin') {
        if (req.user?.unidade_id) {
            where.unidade_id = req.user.unidade_id;
        } else {
            return res.json([]);
        }
    }

    if (ip) {
        where.ip = { contains: String(ip), mode: 'insensitive' };
    }
    if (numero_serie) {
        where.numero_serie = { contains: String(numero_serie), mode: 'insensitive' };
    }
    if (unidade_id_filtro && req.user?.role === 'admin') {
        where.unidade_id = Number(unidade_id_filtro);
    }
    if (politicas_aplicadas === 'true' || politicas_aplicadas === 'false') {
        where.politicas_aplicadas = politicas_aplicadas === 'true';
    }
    
    const impressoras = await prisma.impressora.findMany({ 
        where, 
        include: { 
            unidades_organizacionais: { select: { nome: true } } 
        },
        orderBy: { nome: 'asc' }
    });
    res.json(impressoras);
};

export const createImpressora = async (req: Request, res: Response) => {
    try {
        const novaImpressora = await prisma.impressora.create({ data: req.body });
        res.status(201).json(novaImpressora);
    } catch (error) {
        res.status(400).json({ message: 'Erro ao criar impressora.', details: error });
    }
};

export const updateImpressora = async (req: Request, res: Response) => {
    const { id } = req.params;
    const dataToUpdate = req.body; 

    try {
        const impressoraAtualizada = await prisma.impressora.update({
            where: { id: Number(id) },
            data: dataToUpdate,
        });
        res.json(impressoraAtualizada);
    } catch (error) {
        console.error("Erro ao atualizar impressora:", error);
        res.status(400).json({ message: 'Erro ao atualizar impressora. Verifique se o ID é válido.' });
    }
};

export const deleteImpressora = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        await prisma.impressora.update({
            where: { id: Number(id) },
            data: { ativo: false },
        });
        res.status(204).send();
    } catch (error) {
        res.status(500).json({ message: 'Erro ao excluir impressora.' });
    }
};

// Controle de Suprimentos
export const getControleSuprimentos = async (req: Request, res: Response) => {
    try {
        const registros = await prisma.controleSuprimentos.findMany({ 
            include: { 
                tecnico: { select: { nome_completo: true } }
            },
            orderBy: { data: 'desc' }
        });
        res.json(registros);
    } catch (error) {
        console.error("Erro ao buscar histórico de suprimentos:", error);
        res.status(500).json({ message: 'Erro ao buscar histórico de suprimentos.' });
    }
};

export const createControleSuprimentos = async (req: Request, res: Response) => {
    const requisicao = req.body;
    const tecnico_id = req.user!.id;

    try {
        const resultado = await prisma.$transaction(async (tx) => {
            const estoque = await tx.estoqueSuprimentos.findUnique({
                where: { id: 1 },
            });

            if (!estoque) {
                throw new Error("Inventário de suprimentos não encontrado.");
            }

            if (
                estoque.unidade_imagem_total < requisicao.unidade_imagem_solicitadas ||
                estoque.toner_preto_total < requisicao.toner_preto_solicitados
            ) {
                throw new Error("Stock insuficiente para completar a requisição.");
            }
            await tx.estoqueSuprimentos.update({
                where: { id: 1 },
                data: {
                    unidade_imagem_total: { decrement: requisicao.unidade_imagem_solicitadas },
                    toner_preto_total: { decrement: requisicao.toner_preto_solicitados },
                    toner_ciano_total: { decrement: requisicao.toner_ciano_solicitados || 0 },
                    toner_magenta_total: { decrement: requisicao.toner_magenta_solicitados || 0 },
                    toner_amarelo_total: { decrement: requisicao.toner_amarelo_solicitados || 0 },
                }
            });
            const novoControle = await tx.controleSuprimentos.create({
                data: { ...requisicao, tecnico_id: tecnico_id },
            });

            return novoControle;
        });

        res.status(201).json(resultado);

    } catch (error: any) {
        console.error("Erro na transação de suprimentos:", error);
        res.status(400).json({ message: error.message || 'Erro ao registar a requisição de suprimento.' });
    }
};

// Busca o estado atual do estoque
export const getEstoqueSuprimentos = async (req: Request, res: Response) => {
    try {
        const estoque = await prisma.estoqueSuprimentos.findUnique({
            where: { id: 1 },
        });
        if (!estoque) {
            // Se não existir, cria o registo inicial
            const novoEstoque = await prisma.estoqueSuprimentos.create({ data: { id: 1 }});
            return res.json(novoEstoque);
        }
        res.json(estoque);
    } catch (error) {
        console.error("Erro ao buscar estoque de suprimentos:", error);
        res.status(500).json({ message: 'Erro ao buscar estoque de suprimentos.' });
    }
};

// Adiciona quantidades ao estoque (apenas admin)
export const addEstoqueSuprimentos = async (req: Request, res: Response) => {
    const { unidade_imagem_total, toner_preto_total, toner_ciano_total, toner_magenta_total, toner_amarelo_total } = req.body;
    try {
        const estoqueAtualizado = await prisma.estoqueSuprimentos.update({
            where: { id: 1 },
            data: {
                unidade_imagem_total: { increment: Number(unidade_imagem_total) || 0 },
                toner_preto_total: { increment: Number(toner_preto_total) || 0 },
                toner_ciano_total: { increment: Number(toner_ciano_total) || 0 },
                toner_magenta_total: { increment: Number(toner_magenta_total) || 0 },
                toner_amarelo_total: { increment: Number(toner_amarelo_total) || 0 },
            }
        });
        res.json(estoqueAtualizado);
    } catch (error) {
        console.error("Erro ao atualizar estoque de suprimentos:", error);
        res.status(500).json({ message: 'Erro ao atualizar estoque de suprimentos.' });
    }
};

// Atendimentos
export const getAtendimentos = async (req: Request, res: Response) => {
    const atendimentos = await prisma.atendimentoImpressora.findMany({ include: { impressora : true, unidades_organizacionais: true } });
    res.json(atendimentos);
};

export const createAtendimento = async (req: Request, res: Response) => {
    try {
        const novoAtendimento = await prisma.atendimentoImpressora.create({ data: req.body });
        res.status(201).json(novoAtendimento);
    } catch (error) {
        res.status(400).json({ message: 'Erro ao registrar atendimento.', details: error });
    }
};