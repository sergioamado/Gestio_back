// src/controllers/relatorioController.ts
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const getSolicitacoesPorTecnico = async (req: Request, res: Response) => {
  try {
    const result = await prisma.solicitacoes.groupBy({
      by: ['responsavel_usuario_id'],
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } }
    });
    
    const tecnicoIds = result.map((item: { responsavel_usuario_id: number }) => item.responsavel_usuario_id);
    
    const tecnicos = await prisma.usuarios.findMany({
        where: { id: { in: tecnicoIds } },
        select: { id: true, nome_completo: true }
    });

    const tecnicoMap = new Map(tecnicos.map((t: { id: any; nome_completo: any; }) => [t.id, t.nome_completo]));
    
    const response = result.map((item: { responsavel_usuario_id: number; _count: { id: number } }) => ({
        tecnico: tecnicoMap.get(item.responsavel_usuario_id),
        total_solicitacoes: item._count.id
    }));

    res.json(response);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao gerar relatório.' });
  }
};

export const getTopItens = async (req: Request, res: Response) => {
    try {
        const result = await prisma.solicitacao_itens.groupBy({
            by: ['item_id'],
            _sum: { quantidade_solicitada: true },
            orderBy: { _sum: { quantidade_solicitada: 'desc' } },
            take: 10 
        });
        
        const itemIds = result.map((item: { item_id: number }) => item.item_id);
        
        const itens = await prisma.itens.findMany({
            where: { id: { in: itemIds } },
            select: { id: true, descricao: true }
        });

        const itemMap = new Map(itens.map((i: { id: any; descricao: any; }) => [i.id, i.descricao]));
        
        const response = result.map((item: { item_id: number; _sum: { quantidade_solicitada: number | null } }) => ({
            descricao: itemMap.get(item.item_id),
            quantidade_total: item._sum.quantidade_solicitada
        }));

        res.json(response);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao gerar relatório.' });
    }
}

export const getStatsGlobal = async (req: Request, res: Response) => {
  try {
    const [totalUnidades, totalUsuarios, totalItens, solicitacoesPendentes] = await prisma.$transaction([
      prisma.unidades_organizacionais.count(),
      prisma.usuarios.count(),
      prisma.itens.aggregate({ _sum: { quantidade: true } }),
      prisma.solicitacoes.count({ where: { status: 'Pendente' } })
    ]);

    res.json({
      total_unidades: totalUnidades,
      total_usuarios: totalUsuarios,
      total_itens: totalItens._sum.quantidade || 0,
      solicitacoes_pendentes: solicitacoesPendentes,
    });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar estatísticas globais.' });
  }
};

export const getRelatorioDetalhadoPorTecnico = async (req: Request, res: Response) => {
  const { tecnicoId, dataInicio, dataFim } = req.query;

  if (!tecnicoId || !dataInicio || !dataFim) {
    return res.status(400).json({ message: 'ID do técnico, data de início e data de fim são obrigatórios.' });
  }

  try {
    const relatorio = await prisma.solicitacoes.findMany({
      where: {
        responsavel_usuario_id: Number(tecnicoId),
        data_solicitacao: {
          gte: new Date(dataInicio as string), // gte = Greater Than or Equal
          lte: new Date(dataFim as string),   // lte = Less Than or Equal
        },
      },
      include: {
        solicitacao_itens: {
          include: {
            itens: {
              select: { descricao: true }
            }
          }
        }
      },
      orderBy: { data_solicitacao: 'desc' }
    });
    res.json(relatorio);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao gerar relatório detalhado.' });
  }
};