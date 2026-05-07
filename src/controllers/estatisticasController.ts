// src/controllers/estatisticasController.ts
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const getDashboardStats = async (req: Request, res: Response) => {
  const { role, unidade_id } = req.user!;

  try {
    // Busca paralela para máxima performance (Promise.all)
    const [
      totalOS_Pendentes,
      itensBaixoEstoque,
      totalBensAtivos
    ] = await Promise.all([
      // 1. Conta quantas OS estão pendentes (Se for gerente, filtra pela unidade dele)
      prisma.solicitacoes.count({
        where: {
          status: 'PENDENTE',
          ...(role === 'gerente' && unidade_id ? { unidade_id } : {})
        }
      }),
      // 2. Conta quantos itens estão com o estoque menor que 5
      prisma.itens.count({
        where: {
          quantidade: { lt: 5 },
          ...(role === 'gerente' && unidade_id ? { unidade_id } : {})
        }
      }),
      // 3. Conta o total de bens patrimoniais ativos (Apenas uma visão geral)
      prisma.bemPatrimonial.count({
        where: { status_atual: 'Ativo' } // Ajuste o status conforme o seu schema
      })
    ]);

    res.json({
      os_pendentes: totalOS_Pendentes,
      baixo_estoque: itensBaixoEstoque,
      patrimonio_ativo: totalBensAtivos
    });

  } catch (error) {
    console.error("Erro ao carregar estatísticas:", error);
    res.status(500).json({ message: 'Erro ao carregar dados do dashboard.' });
  }
};