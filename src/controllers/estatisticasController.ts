// src/controllers/estatisticasController.ts
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const getDashboardStats = async (req: Request, res: Response) => {
  const { id: userId, role, unidade_id } = req.user!;

  try {
    // 1. Regra de Filtro Inteligente baseada no Cargo (Role)
    let whereOS: any = {};
    let whereEstoque: any = {};

    if (role === 'gerente' && unidade_id) {
        whereOS = { unidade_id };
        whereEstoque = { unidade_id };
    } else if (role.startsWith('tecnico')) {
        whereOS = { responsavel_usuario_id: userId }; // Técnico só vê as próprias OS
        if (unidade_id) whereEstoque = { unidade_id }; // Mas vê o estoque da unidade toda
    }

    // 2. Busca Paralela de Alta Performance
    const [
      totalOS_Pendentes,
      itensBaixoEstoque,
      totalBensAtivos,
      osPorStatus
    ] = await Promise.all([
      prisma.solicitacoes.count({
        where: { status: 'PENDENTE', ...whereOS }
      }),
      prisma.itens.count({
        where: { quantidade: { lt: 5 }, ...whereEstoque }
      }),
      prisma.bemPatrimonial.count({
        where: { status_atual: 'Ativo' } 
      }),
      prisma.solicitacoes.groupBy({
        by: ['status'],
        _count: { status: true },
        where: whereOS
      })
    ]);

    const grafico_status = osPorStatus.map(item => ({
      name: item.status,
      quantidade: item._count.status
    }));

    res.json({
      os_pendentes: totalOS_Pendentes,
      baixo_estoque: itensBaixoEstoque,
      patrimonio_ativo: totalBensAtivos,
      grafico_status 
    });

  } catch (error) {
    console.error("Erro ao carregar estatísticas:", error);
    res.status(500).json({ message: 'Erro ao carregar dados do dashboard.' });
  }
};