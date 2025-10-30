// src/controllers/impressoraController.ts
import { Request, Response } from 'express';
import { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();

// --- ZOD SCHEMAS PARA VALIDAÇÃO ---

const impressoraCreateSchema = z.object({
  nome: z.string().min(1, "O nome é obrigatório"),
  modelo: z.string().min(1, "O modelo é obrigatório"),
  numero_serie: z.string().min(1, "O número de série é obrigatório"),
  ip: z.string().optional(),
  localizacao: z.string().min(1, "A localização é obrigatória"),
  servidor: z.string().optional(),
  politicas_aplicadas: z.boolean().optional(),
  is_colorida: z.boolean().optional(),
  unidade_id: z.number().int(),
});

const impressoraUpdateSchema = impressoraCreateSchema.omit({ unidade_id: true });

const atendimentoCreateSchema = z.object({
  numero_glpi: z.string().min(1, "O GLPI é obrigatório"),
  impressora_id: z.number().int(),
  unidade_id: z.number().int(),
  tecnico_id: z.number().int(),
});

// >>>>> INÍCIO DA CORREÇÃO <<<<<
// Schema para ATUALIZAR um atendimento. Todos os campos são opcionais.
const atendimentoUpdateSchema = z.object({
  status: z.nativeEnum(Prisma.StatusAtendimento).optional(),
  setor_visitado: z.boolean().optional(),
  necessita_pecas: z.boolean().optional(),
  descricao_pecas: z.string().nullable().optional(),
  chamado_assistencia: z.string().nullable().optional(),
  assistencia_realizada: z.boolean().optional(),
  parecer_tecnico: z.string().nullable().optional(),
  assistencia_concluiu: z.boolean().optional(),
  parecer_final_assistencia: z.string().nullable().optional(),
  necessita_backup: z.boolean().optional(),
  backup_impressora_nome: z.string().nullable().optional(),
  backup_impressora_modelo: z.string().nullable().optional(),
  backup_numero_serie: z.string().nullable().optional(),
  backup_ip: z.string().nullable().optional(),
  // Converte strings de data (ou strings vazias) para Date ou null
  data_visita: z.preprocess((arg) => (arg ? new Date(arg as string) : null), z.date().nullable()).optional(),
  backup_data_disponibilizacao: z.preprocess((arg) => (arg ? new Date(arg as string) : null), z.date().nullable()).optional(),
  backup_data_retirada: z.preprocess((arg) => (arg ? new Date(arg as string) : null), z.date().nullable()).optional(),
}).partial();
// >>>>> FIM DA CORREÇÃO <<<<<


// --- FUNÇÕES DE IMPRESSORA (sem alterações) ---
export const getAllImpressoras = async (req: Request, res: Response) => {
    const { ip, numero_serie, unidade_id_filtro, politicas_aplicadas } = req.query;
    const where: Prisma.ImpressoraWhereInput = { ativo: true };
    if (req.user?.role !== 'admin') {
        if (req.user?.unidade_id) {
            where.unidade_id = req.user.unidade_id;
        } else {
            return res.json([]);
        }
    }
    if (ip) where.ip = { contains: String(ip), mode: 'insensitive' };
    if (numero_serie) where.numero_serie = { contains: String(numero_serie), mode: 'insensitive' };
    if (unidade_id_filtro && req.user?.role === 'admin') where.unidade_id = Number(unidade_id_filtro);
    if (politicas_aplicadas === 'true' || politicas_aplicadas === 'false') where.politicas_aplicadas = politicas_aplicadas === 'true';
    
    const impressoras = await prisma.impressora.findMany({ 
        where, 
        include: { unidades_organizacionais: { select: { nome: true } } },
        orderBy: { nome: 'asc' }
    });
    res.json(impressoras);
};

export const createImpressora = async (req: Request, res: Response) => {
    try {
        const data = impressoraCreateSchema.parse(req.body);
        const novaImpressora = await prisma.impressora.create({ data });
        res.status(201).json(novaImpressora);
    } catch (error) {
        res.status(400).json({ message: 'Erro ao criar impressora.', details: error });
    }
};

export const updateImpressora = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const dataToUpdate = impressoraUpdateSchema.parse(req.body);
        const impressoraAtualizada = await prisma.impressora.update({
            where: { id: Number(id) },
            data: dataToUpdate,
        });
        res.json(impressoraAtualizada);
    } catch (error) {
        console.error("Erro ao atualizar impressora:", error);
        res.status(400).json({ message: 'Erro ao atualizar impressora. Verifique se o ID é válido.', details: error });
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


// --- FUNÇÕES DE CONTROLE DE SUPRIMENTOS (sem alterações) ---
export const getControleSuprimentos = async (req: Request, res: Response) => {
    try {
        const registros = await prisma.controleSuprimentos.findMany({ 
            include: { 
                tecnico: { select: { nome_completo: true } },
                impressora: { select: { nome: true, modelo: true } }
            },
            orderBy: { data: 'desc' }
        });
        res.json(registros);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar histórico de suprimentos.' });
    }
};

export const createControleSuprimentos = async (req: Request, res: Response) => {
    const { impressora_id, ...requisicao } = req.body;
    const tecnico_id = req.user!.id;

    if (!impressora_id) {
        return res.status(400).json({ message: "A impressora é obrigatória." });
    }

    try {
        const resultado = await prisma.$transaction(async (tx) => {
            const estoque = await tx.estoqueSuprimentos.findUnique({ where: { id: 1 } });
            if (!estoque) throw new Error("Inventário de suprimentos não encontrado.");
            
            if (
                estoque.unidade_imagem_total < (requisicao.unidade_imagem_solicitadas || 0) ||
                estoque.toner_preto_total < (requisicao.toner_preto_solicitados || 0) ||
                estoque.toner_ciano_total < (requisicao.toner_ciano_solicitados || 0) ||
                estoque.toner_magenta_total < (requisicao.toner_magenta_solicitados || 0) ||
                estoque.toner_amarelo_total < (requisicao.toner_amarelo_solicitados || 0)
            ) {
                throw new Error("Stock insuficiente para completar a requisição.");
            }

            await tx.estoqueSuprimentos.update({
                where: { id: 1 },
                data: {
                    unidade_imagem_total: { decrement: requisicao.unidade_imagem_solicitadas || 0 },
                    toner_preto_total: { decrement: requisicao.toner_preto_solicitados || 0 },
                    toner_ciano_total: { decrement: requisicao.toner_ciano_solicitados || 0 },
                    toner_magenta_total: { decrement: requisicao.toner_magenta_solicitados || 0 },
                    toner_amarelo_total: { decrement: requisicao.toner_amarelo_solicitados || 0 },
                }
            });
            
            const novoControle = await tx.controleSuprimentos.create({
                data: { ...requisicao, tecnico_id, impressora_id },
            });

            return novoControle;
        });
        res.status(201).json(resultado);
    } catch (error: any) {
        res.status(400).json({ message: error.message || 'Erro ao registar a requisição.' });
    }
};


// --- FUNÇÕES DE ESTOQUE DE SUPRIMENTOS (sem alterações) ---
export const getEstoqueSuprimentos = async (req: Request, res: Response) => {
    try {
        const estoque = await prisma.estoqueSuprimentos.findUnique({
            where: { id: 1 },
        });
        if (!estoque) {
            const novoEstoque = await prisma.estoqueSuprimentos.create({ data: { id: 1 }});
            return res.json(novoEstoque);
        }
        res.json(estoque);
    } catch (error) {
        console.error("Erro ao buscar estoque de suprimentos:", error);
        res.status(500).json({ message: 'Erro ao buscar estoque de suprimentos.' });
    }
};

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


// --- FUNÇÕES DE ATENDIMENTOS (CORRIGIDAS) ---

export const getAtendimentos = async (req: Request, res: Response) => {
    try {
        const atendimentos = await prisma.atendimentoImpressora.findMany({ 
            include: { 
                impressora: { select: { nome: true, modelo: true, localizacao: true } }, 
                tecnico : { select: { nome_completo: true } }
            },
            orderBy: { data: 'desc' }
        });
        res.json(atendimentos);
    } catch (error) {
        res.status(500).json({ message: "Erro ao buscar atendimentos." });
    }
};

export const createAtendimento = async (req: Request, res: Response) => {
    try {
        const data = atendimentoCreateSchema.parse(req.body);
        const novoAtendimento = await prisma.atendimentoImpressora.create({ data });
        res.status(201).json(novoAtendimento);
    } catch (error) {
        console.error("Erro ao criar atendimento:", error);
        res.status(400).json({ message: 'Erro de validação ao criar atendimento.', details: error });
    }
};

// >>>>> INÍCIO DA CORREÇÃO <<<<<
export const updateAtendimento = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const dataToUpdate = atendimentoUpdateSchema.parse(req.body);
        const atendimentoAtualizado = await prisma.atendimentoImpressora.update({
            where: { id: Number(id) },
            data: dataToUpdate,
        });
        res.json(atendimentoAtualizado);
    } catch (error) {
        console.error("Erro ao atualizar atendimento:", error);
        res.status(400).json({ message: 'Erro ao atualizar atendimento.', details: error });
    }
};
// >>>>> FIM DA CORREÇÃO <<<<<