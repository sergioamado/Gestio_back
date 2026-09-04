// src/controllers/analiseController.ts
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ============================================================================
// 1. O SUPER CATÁLOGO ANALÍTICO (O que aparece na Dropdown do Frontend)
// ============================================================================
export const getCatalog = async (req: Request, res: Response) => {
  const catalog = [
    {
      id: "producao_tecnico",
      nome: "Produtividade por Técnico",
      dominio: "Produção e Serviços",
      dimensoes: [{ campo: "tecnico", label: "Técnico" }],
      metricas: [
        { campo: "valor_total", label: "Valor Total Produzido (R$)", agregacao: "SUM" },
        { campo: "qtd_servicos", label: "Quantidade de Serviços", agregacao: "COUNT" }
      ]
    },
    {
      id: "top_servicos",
      nome: "Serviços Mais Executados (Catálogo)",
      dominio: "Produção e Serviços",
      dimensoes: [{ campo: "servico", label: "Nome do Serviço" }],
      metricas: [
        { campo: "quantidade", label: "Vezes Executado", agregacao: "COUNT" },
        { campo: "valor_gerado", label: "Valor Gerado (R$)", agregacao: "SUM" }
      ]
    },
    {
      id: "reincidencia_equipamentos",
      nome: "Equipamentos Problemáticos (Reincidência)",
      dominio: "Manutenção",
      dimensoes: [{ campo: "patrimonio", label: "Patrimônio / N° Série" }],
      metricas: [
        { campo: "quantidade", label: "Qtd de Manutenções", agregacao: "COUNT" },
        { campo: "custo_total", label: "Custo Total de Manutenção (R$)", agregacao: "SUM" }
      ]
    },
    {
      id: "chamados_status",
      nome: "Volume de Chamados por Status",
      dominio: "Solicitações",
      dimensoes: [{ campo: "status", label: "Status do Chamado" }],
      metricas: [
        { campo: "quantidade", label: "Quantidade de Chamados", agregacao: "COUNT" }
      ]
    },
    {
      id: "estoque_tipo",
      nome: "Posição de Estoque (Permanente vs Consumo)",
      dominio: "Estoque",
      dimensoes: [{ campo: "tipo", label: "Tipo de Item" }],
      metricas: [
        { campo: "quantidade_estoque", label: "Quantidade em Estoque", agregacao: "SUM" }
      ]
    }
  ];
  return res.json(catalog);
};

// ============================================================================
// 2. O MOTOR DE CONSULTAS (Faz a matemática pesada)
// ============================================================================
export const runQuery = async (req: Request, res: Response) => {
  try {
    const { dataset } = req.body;
    let resultado: any[] = [];

    switch (dataset) {
      // ---------------------------------------------------------
      case 'producao_tecnico':
        const prodData = await prisma.producaoServico.groupBy({
          by: ['tecnico_id'],
          _sum: { valor_total_produzido: true },
          _count: { id: true },
        });

        // Troca o ID do técnico pelo Nome Real
        for (const item of prodData) {
          let nomeTecnico = "Desconhecido";
          if (item.tecnico_id) {
            const user = await prisma.usuarios.findUnique({ where: { id: item.tecnico_id } });
            nomeTecnico = user?.nome_completo || "Desconhecido";
          }
          resultado.push({
            tecnico: nomeTecnico,
            valor_total: item._sum.valor_total_produzido || 0,
            qtd_servicos: item._count.id
          });
        }
        break;

      // ---------------------------------------------------------
      case 'top_servicos':
        const servicosData = await prisma.producaoServico.groupBy({
          by: ['servico_id'],
          _count: { id: true },
          _sum: { valor_total_produzido: true }
        });

        for (const item of servicosData) {
          if (item.servico_id) {
            const svc = await prisma.catalogoServico.findUnique({ where: { id: item.servico_id } });
            resultado.push({
              servico: svc?.nome_servico || "Serviço Removido",
              quantidade: item._count.id,
              valor_gerado: item._sum.valor_total_produzido || 0
            });
          }
        }
        resultado.sort((a, b) => b.quantidade - a.quantidade); // Ordena do maior para o menor
        break;

      // ---------------------------------------------------------
      case 'reincidencia_equipamentos':
        const equipData = await prisma.producaoServico.groupBy({
          by: ['patrimonio_serie'],
          _count: { id: true },
          _sum: { valor_total_produzido: true }
        });

        resultado = equipData
          .filter(e => e.patrimonio_serie != null && e.patrimonio_serie !== '') // Remove os em branco
          .map(e => ({
            patrimonio: e.patrimonio_serie,
            quantidade: e._count.id,
            custo_total: e._sum.valor_total_produzido || 0
          }))
          .sort((a, b) => b.quantidade - a.quantidade); // Os mais problemáticos no topo
        break;

      // ---------------------------------------------------------
      case 'chamados_status':
        const solData = await prisma.solicitacoes.groupBy({
          by: ['status'],
          _count: { id: true }
        });
        
        resultado = solData.map(item => ({
          status: item.status,
          quantidade: item._count.id
        }));
        break;

      // ---------------------------------------------------------
      case 'estoque_tipo':
        const estData = await prisma.itens.groupBy({
          by: ['is_permanente'],
          _sum: { quantidade: true }
        });

        resultado = estData.map(item => ({
          tipo: item.is_permanente ? "Bem Permanente / Tombado" : "Material de Consumo",
          quantidade_estoque: item._sum.quantidade || 0
        }));
        break;

      default:
        return res.status(400).json({ message: "Dataset desconhecido." });
    }

    return res.json(resultado);

  } catch (error) {
    console.error("Erro no Motor Analítico:", error);
    res.status(500).json({ message: "Erro ao processar a consulta." });
  }
};

// ============================================================================
// 3. CRUD DE DASHBOARDS (Mantido igual)
// ============================================================================
export const saveDashboard = async (req: Request, res: Response) => {
  try {
    const { nome, descricao, widgets } = req.body;
    const usuario_id = req.user?.id || 1; 

    const novoDash = await prisma.dashboard.create({
      data: {
        nome, descricao, usuario_id,
        widgets: {
          create: widgets.map((w: any) => ({
            titulo: w.titulo, tipo: w.tipo, dataset: w.dataset,
            configuracao: w.configuracao, posicao_x: w.posicao_x,
            posicao_y: w.posicao_y, largura: w.largura, altura: w.altura
          }))
        }
      }
    });
    res.status(201).json(novoDash);
  } catch (error) {
    res.status(500).json({ message: "Erro ao salvar o Dashboard." });
  }
};

export const getDashboards = async (req: Request, res: Response) => {
  try {
    const dashboards = await prisma.dashboard.findMany({ include: { widgets: true }, orderBy: { data_criacao: 'desc' } });
    res.json(dashboards);
  } catch (error) {
    res.status(500).json({ message: "Erro ao buscar Dashboards." });
  }
};