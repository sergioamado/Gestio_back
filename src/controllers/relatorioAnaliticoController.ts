// src/controllers/relatorioAnaliticoController.ts
// Relatório Analítico: laudo emitido quando o equipamento não tem conserto (inservível).
//   - Técnico emite (PENDENTE) e pode editar/excluir enquanto não for assinado.
//   - Gerente da unidade assina (ASSINADO, recebe número) ou devolve com motivo (DEVOLVIDO).
//   - Gerente pode ANULAR um relatório assinado (o número continua reservado).
//   - Admin só visualiza.
// O documento assinado é guardado como "fotografia" (campo `documento`): é sempre reemitido idêntico.
import { Request, Response } from 'express';
import { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import crypto from 'crypto';
import { dispararNotificacao } from './notificacaoController';

const prisma = new PrismaClient();

// Texto fixo do documento (versão 1 do modelo oficial da COSUP).
const MODELO_V1 = {
  versao: 1,
  cabecalho: ['UNIVERSIDADE FEDERAL DE SERGIPE', 'SUPERINTENDENCIA DE TECNOLOGIA DA INFORMAÇÃO'],
  local: 'Cidade Universitária “Prof. José Aloisio de Campos”',
  titulo: 'RELATÓRIO ANALÍTICO',
  paragrafos: [
    'De acordo com o regulamento interno da Universidade Federal de Sergipe (UFS) e considerando que a Coordenação de Suporte é o departamento responsável pela manutenção, suporte e recuperação dos equipamentos de informática pertencentes ao patrimônio da instituição, gostaria de apresentar uma análise técnica dos bens móveis listados abaixo.',
    'Após avaliar as condições de uso e considerar o atraso tecnológico e a vida útil dos equipamentos de informática relacionados, concluímos que eles não são mais viáveis para uso. Estão obsoletos e, portanto, não é economicamente vantajoso realizar reparos, uma vez que apresentam defeitos que tornam a manutenção antieconômica.',
    'Portanto, recomendamos a coleta e subsequente alienação desses equipamentos, com base no exposto.',
  ],
};

class RegraError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const papel = (req: Request) => req.user!.role;
const ehTecnico = (req: Request) => papel(req).startsWith('tecnico');
const ehGerente = (req: Request) => papel(req) === 'gerente';

const formatarNumero = (numero: number | null, ano: number | null) =>
  numero && ano ? `${String(numero).padStart(3, '0')}/${ano}` : null;

/** Quem pode VER: técnico os seus; gerente os da unidade; admin todos. */
const filtroVisibilidade = (req: Request): Prisma.RelatorioAnaliticoWhereInput => {
  if (papel(req) === 'admin') return {};
  if (ehGerente(req)) return { unidade_id: req.user!.unidade_id ?? -1 };
  return { tecnico_id: req.user!.id };
};

const incluir = {
  itens: { orderBy: { ordem: 'asc' as const } },
  tecnico: { select: { id: true, nome_completo: true } },
  assinado_por: { select: { id: true, nome_completo: true } },
  anulado_por: { select: { id: true, nome_completo: true } },
  unidade: { select: { id: true, nome: true, sigla: true } },
};

const serializar = (r: Prisma.RelatorioAnaliticoGetPayload<{ include: typeof incluir }>) => ({
  ...r,
  numero_formatado: formatarNumero(r.numero, r.ano),
});

const buscarVisivel = async (req: Request, id: number) => {
  const r = await prisma.relatorioAnalitico.findFirst({ where: { id, ...filtroVisibilidade(req) }, include: incluir });
  if (!r) throw new RegraError(404, 'Relatório analítico não encontrado.');
  return r;
};

const exigirGerenteDaUnidade = (req: Request, unidadeId: number) => {
  if (!ehGerente(req) || req.user!.unidade_id !== unidadeId) {
    throw new RegraError(403, 'Somente o gerente (coordenador) da unidade pode realizar esta ação.');
  }
};

const notificarGerentes = async (unidadeId: number, titulo: string, mensagem: string) => {
  const gerentes = await prisma.usuarios.findMany({ where: { role: 'gerente', unidade_id: unidadeId }, select: { id: true } });
  for (const g of gerentes) {
    await dispararNotificacao({ usuario_id: g.id, titulo, mensagem, tipo: 'info', link_acao: '/relatorios-analiticos' });
  }
};

const tratarErro = (res: Response, error: unknown, padrao: string) => {
  if (error instanceof RegraError) return res.status(error.status).json({ message: error.message });
  if (error instanceof z.ZodError) return res.status(400).json({ message: error.issues[0]?.message || 'Dados inválidos.' });
  console.error(padrao, error);
  return res.status(500).json({ message: padrao });
};

// ---------- validação ----------
const itensSchema = z
  .array(
    z.object({
      equipamento: z.string().trim().min(2, 'Informe o equipamento.').max(200),
      patrimonio: z.string().trim().min(1, 'Informe o patrimônio.').max(60),
    }),
  )
  .min(1, 'Inclua pelo menos um equipamento.')
  .max(100, 'No máximo 100 equipamentos por relatório.');

const normalizarItens = (itens: z.infer<typeof itensSchema>) =>
  itens.map((i, ordem) => ({ ordem, equipamento: i.equipamento.toUpperCase(), patrimonio: i.patrimonio.toUpperCase() }));

/** Avisa se algum patrimônio já consta em outro relatório assinado (não impede: pode ser uma reemissão). */
const avisosDuplicidade = async (patrimonios: string[], ignorarId?: number) => {
  const existentes = await prisma.relatorioAnaliticoItem.findMany({
    where: {
      patrimonio: { in: patrimonios },
      relatorio: { status: 'ASSINADO', ...(ignorarId ? { NOT: { id: ignorarId } } : {}) },
    },
    include: { relatorio: { select: { numero: true, ano: true, unidade: { select: { sigla: true } } } } },
  });
  return existentes.map(
    (e) => `Patrimônio ${e.patrimonio} já consta no Relatório Analítico nº ${formatarNumero(e.relatorio.numero, e.relatorio.ano)}.`,
  );
};

// ---------- endpoints ----------

// GET /relatorios-analiticos?status=&ano=&busca=
export const listar = async (req: Request, res: Response) => {
  try {
    const { status, ano, busca } = req.query;
    const where: Prisma.RelatorioAnaliticoWhereInput = { ...filtroVisibilidade(req) };
    if (status) where.status = String(status);
    if (ano) where.ano = Number(ano);
    if (busca) {
      const termo = String(busca).trim();
      const [numero, anoBusca] = termo.split('/');
      where.OR = [
        { itens: { some: { patrimonio: { contains: termo, mode: 'insensitive' } } } },
        { itens: { some: { equipamento: { contains: termo, mode: 'insensitive' } } } },
        { codigo_verificacao: { equals: termo.toUpperCase() } },
        ...(Number(numero) ? [{ numero: Number(numero), ...(Number(anoBusca) ? { ano: Number(anoBusca) } : {}) }] : []),
      ];
    }
    const lista = await prisma.relatorioAnalitico.findMany({ where, include: incluir, orderBy: { criado_em: 'desc' }, take: 500 });
    res.json(lista.map(serializar));
  } catch (error) {
    tratarErro(res, error, 'Erro ao listar relatórios analíticos.');
  }
};

// GET /relatorios-analiticos/:id
export const obter = async (req: Request, res: Response) => {
  try {
    res.json(serializar(await buscarVisivel(req, Number(req.params.id))));
  } catch (error) {
    tratarErro(res, error, 'Erro ao buscar o relatório analítico.');
  }
};

// POST /relatorios-analiticos  { itens: [{equipamento, patrimonio}] }
export const criar = async (req: Request, res: Response) => {
  try {
    if (!ehTecnico(req)) throw new RegraError(403, 'Somente técnicos emitem relatórios analíticos.');
    if (!req.user!.unidade_id) throw new RegraError(400, 'Seu usuário não está vinculado a uma unidade.');
    const itens = normalizarItens(itensSchema.parse(req.body.itens));

    const novo = await prisma.relatorioAnalitico.create({
      data: { unidade_id: req.user!.unidade_id, tecnico_id: req.user!.id, status: 'PENDENTE', itens: { create: itens } },
      include: incluir,
    });
    await notificarGerentes(
      novo.unidade_id,
      '📄 Relatório Analítico para assinar',
      `${novo.tecnico.nome_completo} emitiu um Relatório Analítico com ${itens.length} equipamento(s). Aguardando sua assinatura.`,
    );
    res.status(201).json({ ...serializar(novo), avisos: await avisosDuplicidade(itens.map((i) => i.patrimonio)) });
  } catch (error) {
    tratarErro(res, error, 'Erro ao emitir o relatório analítico.');
  }
};

/** Técnico só mexe no que é seu e ainda não foi assinado. */
const buscarEditavel = async (req: Request) => {
  const r = await buscarVisivel(req, Number(req.params.id));
  if (r.tecnico_id !== req.user!.id) throw new RegraError(403, 'Somente o técnico que emitiu pode alterar este relatório.');
  if (r.status !== 'PENDENTE' && r.status !== 'DEVOLVIDO') {
    throw new RegraError(400, 'Relatórios assinados ou anulados não podem ser alterados. Use "Gerar novo a partir deste".');
  }
  return r;
};

// PUT /relatorios-analiticos/:id  { itens }
export const atualizar = async (req: Request, res: Response) => {
  try {
    const r = await buscarEditavel(req);
    const itens = normalizarItens(itensSchema.parse(req.body.itens));
    const atualizado = await prisma.$transaction(async (tx) => {
      await tx.relatorioAnaliticoItem.deleteMany({ where: { relatorio_id: r.id } });
      return tx.relatorioAnalitico.update({
        where: { id: r.id },
        // Devolvido e corrigido: volta para a fila de assinatura
        data: { status: 'PENDENTE', motivo_devolucao: null, itens: { create: itens } },
        include: incluir,
      });
    });
    if (r.status === 'DEVOLVIDO') {
      await notificarGerentes(r.unidade_id, '📄 Relatório Analítico corrigido', `${r.tecnico.nome_completo} corrigiu um Relatório Analítico devolvido. Aguardando sua assinatura.`);
    }
    res.json({ ...serializar(atualizado), avisos: await avisosDuplicidade(itens.map((i) => i.patrimonio), r.id) });
  } catch (error) {
    tratarErro(res, error, 'Erro ao atualizar o relatório analítico.');
  }
};

// DELETE /relatorios-analiticos/:id  (só rascunho do próprio técnico)
export const excluir = async (req: Request, res: Response) => {
  try {
    const r = await buscarEditavel(req);
    await prisma.relatorioAnalitico.delete({ where: { id: r.id } });
    res.status(204).send();
  } catch (error) {
    tratarErro(res, error, 'Erro ao excluir o relatório analítico.');
  }
};

// GET /relatorios-analiticos/cargo-sugerido  (último cargo usado pelo gerente ao assinar)
export const cargoSugerido = async (req: Request, res: Response) => {
  const ultimo = await prisma.relatorioAnalitico.findFirst({
    where: { assinado_por_id: req.user!.id, cargo_assinante: { not: null } },
    orderBy: { assinado_em: 'desc' },
    select: { cargo_assinante: true },
  });
  res.json({ cargo: ultimo?.cargo_assinante ?? 'Coordenador(a) de Suporte' });
};

// POST /relatorios-analiticos/:id/assinar  { cargo }
export const assinar = async (req: Request, res: Response) => {
  try {
    const cargo = z.string().trim().min(3, 'Informe o cargo de quem assina.').max(150).parse(req.body.cargo);
    const r = await buscarVisivel(req, Number(req.params.id));
    exigirGerenteDaUnidade(req, r.unidade_id);
    if (r.status !== 'PENDENTE') throw new RegraError(400, 'Só é possível assinar relatórios aguardando assinatura.');

    const assinante = await prisma.usuarios.findUnique({ where: { id: req.user!.id }, select: { nome_completo: true } });
    const agora = new Date();
    const ano = agora.getFullYear();

    // Numeração sequencial por unidade e ano. Em caso de corrida, o índice único rejeita e tentamos de novo.
    for (let tentativa = 0; tentativa < 5; tentativa++) {
      try {
        const assinado = await prisma.$transaction(async (tx) => {
          const ultimo = await tx.relatorioAnalitico.aggregate({ where: { unidade_id: r.unidade_id, ano }, _max: { numero: true } });
          const numero = (ultimo._max.numero ?? 0) + 1;

          const documento = {
            modelo: MODELO_V1,
            numero,
            ano,
            numero_formatado: formatarNumero(numero, ano),
            unidade: { nome: r.unidade.nome, sigla: r.unidade.sigla },
            data_documento: agora.toISOString(),
            itens: r.itens.map((i) => ({ equipamento: i.equipamento, patrimonio: i.patrimonio })),
            tecnico: { nome: r.tecnico.nome_completo },
            assinante: { nome: assinante?.nome_completo ?? '', cargo },
            assinado_em: agora.toISOString(),
          };
          // Código de verificação: resumo criptográfico do conteúdo assinado.
          const hash = crypto.createHash('sha256').update(JSON.stringify(documento)).digest('hex').toUpperCase();
          const codigo = hash.slice(0, 16).match(/.{4}/g)!.join('-');

          return tx.relatorioAnalitico.update({
            where: { id: r.id, status: 'PENDENTE' },
            data: {
              status: 'ASSINADO',
              numero,
              ano,
              assinado_por_id: req.user!.id,
              assinado_em: agora,
              cargo_assinante: cargo,
              codigo_verificacao: codigo,
              documento: { ...documento, codigo_verificacao: codigo } as Prisma.InputJsonValue,
            },
            include: incluir,
          });
        });

        await dispararNotificacao({
          usuario_id: r.tecnico_id,
          titulo: '✅ Relatório Analítico assinado',
          mensagem: `Seu Relatório Analítico foi assinado: nº ${formatarNumero(assinado.numero, assinado.ano)}.`,
          tipo: 'sucesso',
          link_acao: '/relatorios-analiticos',
        });
        return res.json(serializar(assinado));
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue; // número disputado
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
          throw new RegraError(409, 'Este relatório foi alterado por outra pessoa. Recarregue a página.');
        }
        throw e;
      }
    }
    throw new RegraError(409, 'Não foi possível reservar o número do documento. Tente novamente.');
  } catch (error) {
    tratarErro(res, error, 'Erro ao assinar o relatório analítico.');
  }
};

// POST /relatorios-analiticos/:id/devolver  { motivo }
export const devolver = async (req: Request, res: Response) => {
  try {
    const motivo = z.string().trim().min(5, 'Explique o motivo da devolução.').max(1000).parse(req.body.motivo);
    const r = await buscarVisivel(req, Number(req.params.id));
    exigirGerenteDaUnidade(req, r.unidade_id);
    if (r.status !== 'PENDENTE') throw new RegraError(400, 'Só é possível devolver relatórios aguardando assinatura.');
    const atualizado = await prisma.relatorioAnalitico.update({
      where: { id: r.id },
      data: { status: 'DEVOLVIDO', motivo_devolucao: motivo },
      include: incluir,
    });
    await dispararNotificacao({
      usuario_id: r.tecnico_id,
      titulo: '↩️ Relatório Analítico devolvido',
      mensagem: `Seu Relatório Analítico foi devolvido para correção. Motivo: ${motivo}`,
      tipo: 'alerta',
      link_acao: '/relatorios-analiticos',
    });
    res.json(serializar(atualizado));
  } catch (error) {
    tratarErro(res, error, 'Erro ao devolver o relatório analítico.');
  }
};

// POST /relatorios-analiticos/:id/anular  { motivo }
export const anular = async (req: Request, res: Response) => {
  try {
    const motivo = z.string().trim().min(5, 'Explique o motivo da anulação.').max(1000).parse(req.body.motivo);
    const r = await buscarVisivel(req, Number(req.params.id));
    exigirGerenteDaUnidade(req, r.unidade_id);
    if (r.status !== 'ASSINADO') throw new RegraError(400, 'Só relatórios assinados podem ser anulados.');
    const atualizado = await prisma.relatorioAnalitico.update({
      where: { id: r.id },
      data: { status: 'ANULADO', anulado_por_id: req.user!.id, anulado_em: new Date(), motivo_anulacao: motivo },
      include: incluir,
    });
    await dispararNotificacao({
      usuario_id: r.tecnico_id,
      titulo: '⛔ Relatório Analítico anulado',
      mensagem: `O Relatório Analítico nº ${formatarNumero(r.numero, r.ano)} foi anulado. Motivo: ${motivo}`,
      tipo: 'alerta',
      link_acao: '/relatorios-analiticos',
    });
    res.json(serializar(atualizado));
  } catch (error) {
    tratarErro(res, error, 'Erro ao anular o relatório analítico.');
  }
};

// POST /relatorios-analiticos/:id/duplicar  → novo relatório PENDENTE com os mesmos equipamentos
export const duplicar = async (req: Request, res: Response) => {
  try {
    if (!ehTecnico(req)) throw new RegraError(403, 'Somente técnicos emitem relatórios analíticos.');
    const origem = await prisma.relatorioAnalitico.findFirst({
      where: { id: Number(req.params.id), unidade_id: req.user!.unidade_id ?? -1 },
      include: { itens: { orderBy: { ordem: 'asc' } } },
    });
    if (!origem) throw new RegraError(404, 'Relatório de origem não encontrado na sua unidade.');
    const novo = await prisma.relatorioAnalitico.create({
      data: {
        unidade_id: origem.unidade_id,
        tecnico_id: req.user!.id,
        status: 'PENDENTE',
        origem_id: origem.id,
        itens: { create: origem.itens.map(({ ordem, equipamento, patrimonio }) => ({ ordem, equipamento, patrimonio })) },
      },
      include: incluir,
    });
    await notificarGerentes(
      novo.unidade_id,
      '📄 Relatório Analítico para assinar',
      `${novo.tecnico.nome_completo} emitiu um novo Relatório Analítico (a partir do nº ${formatarNumero(origem.numero, origem.ano) ?? 'rascunho'}).`,
    );
    res.status(201).json(serializar(novo));
  } catch (error) {
    tratarErro(res, error, 'Erro ao gerar o novo relatório analítico.');
  }
};

// GET /relatorios-analiticos/verificar/:codigo  → confere a autenticidade de um documento
export const verificar = async (req: Request, res: Response) => {
  const codigo = String(req.params.codigo || '').trim().toUpperCase();
  const r = await prisma.relatorioAnalitico.findUnique({
    where: { codigo_verificacao: codigo },
    include: { itens: { orderBy: { ordem: 'asc' } }, unidade: { select: { nome: true } }, assinado_por: { select: { nome_completo: true } } },
  });
  if (!r) return res.status(404).json({ valido: false, message: 'Nenhum documento encontrado com este código.' });
  res.json({
    valido: r.status === 'ASSINADO',
    status: r.status,
    numero_formatado: formatarNumero(r.numero, r.ano),
    unidade: r.unidade.nome,
    assinado_por: r.assinado_por?.nome_completo,
    assinado_em: r.assinado_em,
    anulado_em: r.anulado_em,
    motivo_anulacao: r.motivo_anulacao,
    itens: r.itens.map((i) => ({ equipamento: i.equipamento, patrimonio: i.patrimonio })),
  });
};
