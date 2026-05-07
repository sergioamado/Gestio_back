// src/controllers/relatorioController.ts
import { Request, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

// 1. Relatório Dinâmico de Solicitações (Ideal para tabelas e exportação Excel)
export const getRelatorioSolicitacoes = async (req: Request, res: Response) => {
  try {
    const { data_inicio, data_fim, status, unidade_id, responsavel_usuario_id } = req.query;
    
    // Constrói o filtro dinamicamente
    const where: Prisma.solicitacoesWhereInput = {};
    if (status) where.status = String(status);
    if (unidade_id) where.unidade_id = Number(unidade_id);
    if (responsavel_usuario_id) where.responsavel_usuario_id = Number(responsavel_usuario_id);
    
    // Filtro de período (Historico)
    if (data_inicio || data_fim) {
      where.data_solicitacao = {};
      if (data_inicio) where.data_solicitacao.gte = new Date(String(data_inicio));
      if (data_fim) where.data_solicitacao.lte = new Date(String(data_fim));
    }

    const relatorio = await prisma.solicitacoes.findMany({
      where,
      include: {
        unidades_organizacionais: { select: { nome: true } },
        usuarios_solicitacoes_usuario_idTousuarios: { select: { nome_completo: true } },
        usuarios_solicitacoes_responsavel_usuario_idTousuarios: { select: { nome_completo: true } },
        solicitacao_itens: {
          include: { itens: { select: { descricao: true, is_permanente: true } } }
        }
      },
      orderBy: { data_solicitacao: 'desc' }
    });

    res.json(relatorio);
  } catch (error) {
    console.error("Erro no relatório de solicitações:", error);
    res.status(500).json({ message: 'Erro ao gerar relatório.' });
  }
};

// 2. Dados Agregados para Gráficos (Ex: Pizza de Status, Barras por Mês)
export const getDadosGraficos = async (req: Request, res: Response) => {
  try {
    // Busca a contagem de OS agrupadas por Status
    const statusCount = await prisma.solicitacoes.groupBy({
      by: ['status'],
      _count: { id: true }
    });

    // Busca a contagem de OS agrupadas por Tipo (Pedido vs Teste)
    const tipoCount = await prisma.solicitacoes.groupBy({
      by: ['tipo_requisicao'],
      _count: { id: true }
    });

    // Busca o top 5 itens mais solicitados na história do sistema
    const itensMaisSolicitados = await prisma.solicitacao_itens.groupBy({
      by: ['item_id'],
      _sum: { quantidade_solicitada: true },
      orderBy: { _sum: { quantidade_solicitada: 'desc' } },
      take: 5
    });

    // Enriquecendo os dados dos itens com seus nomes
    const itensComNomes = await Promise.all(
      itensMaisSolicitados.map(async (item) => {
        const itemInfo = await prisma.itens.findUnique({ where: { id: item.item_id } });
        return {
          descricao: itemInfo?.descricao || 'Item Removido',
          total_solicitado: item._sum.quantidade_solicitada
        };
      })
    );

    res.json({
      grafico_status: statusCount,
      grafico_tipos: tipoCount,
      top_itens: itensComNomes
    });
  } catch (error) {
    console.error("Erro nos dados de gráficos:", error);
    res.status(500).json({ message: 'Erro ao gerar dados para os gráficos.' });
  }
};

// 3. Relatório de Posição de Estoque Atual
export const getRelatorioEstoque = async (req: Request, res: Response) => {
  try {
    const { unidade_id, is_permanente } = req.query;
    const where: Prisma.itensWhereInput = {};

    if (unidade_id) where.unidade_id = Number(unidade_id);
    if (is_permanente !== undefined) where.is_permanente = is_permanente === 'true';

    const estoque = await prisma.itens.findMany({
      where,
      include: { unidades_organizacionais: { select: { nome: true } } },
      orderBy: { quantidade: 'asc' } // Mostra os de menor quantidade (críticos) primeiro
    });

    res.json(estoque);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao gerar relatório de estoque.' });
  }
};

// 4. Histórico Completo de Patrimônio (Tudo que foi feito/movido)
export const getHistoricoPatrimonio = async (req: Request, res: Response) => {
  try {
    const historico = await prisma.movimentacaoBem.findMany({
      include: {
        bem: { select: { tombamento: true, descricao: true } },
        unidade_origem: { select: { nome: true } },
        unidade_destino: { select: { nome: true } }
      },
      orderBy: { data_envio: 'desc' }
    });

    res.json(historico);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao gerar histórico de patrimônio.' });
  }
};