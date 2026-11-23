// src/controllers/relatorioPersonalizadoController.ts
// Construtor de relatórios (detalhado / cruzado) e modelos salvos.
// Regra de unidade: gerente vê só a própria unidade; admin vê tudo ou a unidade escolhida.
import { Request, Response } from 'express';
import { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { FONTES, fontePorId, type Fonte } from '../relatorios/fontes';
import { configSchema, descreverFiltros, ErroConfig, executar, LIMITE_REGISTROS } from '../relatorios/motor';

const prisma = new PrismaClient();

const ehAdmin = (req: Request) => req.user?.role === 'admin';

const fontesPermitidas = (req: Request): Fonte[] => FONTES.filter((f) => !f.somenteAdmin || ehAdmin(req));

/** Resolve a unidade efetiva do relatório conforme o perfil. */
const resolverUnidade = (req: Request, pedida: number | null | undefined): number | null => {
  if (ehAdmin(req)) return pedida ?? null;
  const propria = req.user?.unidade_id;
  if (!propria) throw new ErroConfig('Seu usuário não está vinculado a uma unidade.');
  return propria; // gerente: ignora o que vier do cliente
};

// GET /relatorios/personalizado/fontes
export const listarFontes = async (req: Request, res: Response) => {
  const unidades = ehAdmin(req)
    ? await prisma.unidades_organizacionais.findMany({ select: { id: true, nome: true }, orderBy: { nome: 'asc' } })
    : [];
  res.json({
    fontes: fontesPermitidas(req).map(({ id, nome, grupo, descricao, campoData, campos }) => ({
      id,
      nome,
      grupo,
      descricao,
      tem_periodo: !!campoData,
      campos,
    })),
    unidades, // só o admin escolhe unidade
  });
};

// POST /relatorios/personalizado/gerar
export const gerarRelatorio = async (req: Request, res: Response) => {
  try {
    const cfg = configSchema.parse(req.body);
    const fonte = fontePorId(cfg.fonte);
    if (!fonte || (fonte.somenteAdmin && !ehAdmin(req))) {
      return res.status(403).json({ message: 'Fonte de dados não disponível para o seu perfil.' });
    }

    const unidadeId = resolverUnidade(req, cfg.unidade_id);

    let periodo: { gte?: Date; lte?: Date } | undefined;
    if (fonte.campoData && (cfg.periodo?.inicio || cfg.periodo?.fim)) {
      periodo = {};
      if (cfg.periodo.inicio) periodo.gte = new Date(`${cfg.periodo.inicio}T00:00:00`);
      if (cfg.periodo.fim) periodo.lte = new Date(`${cfg.periodo.fim}T23:59:59.999`);
    }

    const dados = await fonte.buscar({ unidadeId, periodo, limite: LIMITE_REGISTROS });
    const resultado = executar(fonte, cfg, dados);

    const [usuario, unidade] = await Promise.all([
      prisma.usuarios.findUnique({ where: { id: req.user!.id }, select: { nome_completo: true, role: true } }),
      unidadeId ? prisma.unidades_organizacionais.findUnique({ where: { id: unidadeId }, select: { nome: true } }) : null,
    ]);

    const fmt = (d?: string) => (d ? d.split('-').reverse().join('/') : '');
    const descricaoPeriodo =
      periodo && (cfg.periodo?.inicio || cfg.periodo?.fim)
        ? `${cfg.periodo?.inicio ? fmt(cfg.periodo.inicio) : 'início'} a ${cfg.periodo?.fim ? fmt(cfg.periodo.fim) : 'hoje'}`
        : 'Todo o período';

    res.json({
      ...resultado,
      meta: {
        titulo: cfg.titulo || fonte.nome,
        fonte: fonte.nome,
        tipo: cfg.tipo,
        gerado_em: new Date().toISOString(),
        gerado_por: { nome: usuario?.nome_completo ?? 'Desconhecido', papel: usuario?.role ?? req.user!.role },
        unidade: unidade?.nome ?? 'Todas as unidades',
        periodo: fonte.campoData ? descricaoPeriodo : null,
        filtros: descreverFiltros(fonte, cfg),
      },
    });
  } catch (error) {
    if (error instanceof ErroConfig) return res.status(400).json({ message: error.message });
    if (error instanceof z.ZodError) return res.status(400).json({ message: 'Configuração de relatório inválida.', details: error.issues });
    console.error('Erro ao gerar relatório personalizado:', error);
    res.status(500).json({ message: 'Erro ao gerar o relatório.' });
  }
};

// ---------- Modelos salvos ----------
const modeloSchema = z.object({
  nome: z.string().trim().min(3, 'Dê um nome com pelo menos 3 letras.').max(150),
  descricao: z.string().trim().max(500).nullable().optional(),
  compartilhado: z.boolean().default(false),
  configuracao: configSchema,
});

const serializarModelo = (m: {
  id: number;
  nome: string;
  descricao: string | null;
  compartilhado: boolean;
  configuracao: Prisma.JsonValue;
  usuario_id: number;
  atualizado_em: Date;
  usuario?: { nome_completo: string } | null;
}) => ({
  id: m.id,
  nome: m.nome,
  descricao: m.descricao,
  compartilhado: m.compartilhado,
  configuracao: m.configuracao,
  usuario_id: m.usuario_id,
  autor: m.usuario?.nome_completo ?? null,
  atualizado_em: m.atualizado_em,
});

// GET /relatorios/personalizado/modelos — os meus + os compartilhados
export const listarModelos = async (req: Request, res: Response) => {
  const modelos = await prisma.relatorioModelo.findMany({
    where: { OR: [{ usuario_id: req.user!.id }, { compartilhado: true }] },
    include: { usuario: { select: { nome_completo: true } } },
    orderBy: { nome: 'asc' },
  });
  // Esconde modelos de fontes que este perfil não pode usar.
  const permitidas = new Set(fontesPermitidas(req).map((f) => f.id));
  res.json(
    modelos
      .filter((m) => permitidas.has(String((m.configuracao as { fonte?: string } | null)?.fonte)))
      .map(serializarModelo),
  );
};

export const criarModelo = async (req: Request, res: Response) => {
  try {
    const dados = modeloSchema.parse(req.body);
    const modelo = await prisma.relatorioModelo.create({
      data: {
        nome: dados.nome,
        descricao: dados.descricao ?? null,
        compartilhado: dados.compartilhado,
        configuracao: dados.configuracao as Prisma.InputJsonValue,
        usuario_id: req.user!.id,
      },
      include: { usuario: { select: { nome_completo: true } } },
    });
    res.status(201).json(serializarModelo(modelo));
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ message: error.issues[0]?.message || 'Dados inválidos.' });
    res.status(500).json({ message: 'Erro ao salvar o modelo.' });
  }
};

/** Só o autor (ou o admin) altera/exclui um modelo. */
const buscarModeloEditavel = async (req: Request) => {
  const modelo = await prisma.relatorioModelo.findUnique({ where: { id: Number(req.params.id) } });
  if (!modelo) return { erro: [404, 'Modelo não encontrado.'] as const };
  if (modelo.usuario_id !== req.user!.id && !ehAdmin(req)) {
    return { erro: [403, 'Só quem criou o modelo pode alterá-lo ou excluí-lo.'] as const };
  }
  return { modelo };
};

export const atualizarModelo = async (req: Request, res: Response) => {
  try {
    const r = await buscarModeloEditavel(req);
    if (r.erro) return res.status(r.erro[0]).json({ message: r.erro[1] });
    const dados = modeloSchema.parse(req.body);
    const modelo = await prisma.relatorioModelo.update({
      where: { id: r.modelo.id },
      data: {
        nome: dados.nome,
        descricao: dados.descricao ?? null,
        compartilhado: dados.compartilhado,
        configuracao: dados.configuracao as Prisma.InputJsonValue,
      },
      include: { usuario: { select: { nome_completo: true } } },
    });
    res.json(serializarModelo(modelo));
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ message: error.issues[0]?.message || 'Dados inválidos.' });
    res.status(500).json({ message: 'Erro ao atualizar o modelo.' });
  }
};

export const excluirModelo = async (req: Request, res: Response) => {
  const r = await buscarModeloEditavel(req);
  if (r.erro) return res.status(r.erro[0]).json({ message: r.erro[1] });
  await prisma.relatorioModelo.delete({ where: { id: r.modelo.id } });
  res.status(204).send();
};
