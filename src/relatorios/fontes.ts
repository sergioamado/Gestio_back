// src/relatorios/fontes.ts
// Catálogo de FONTES do construtor de relatórios: cada fonte é uma tabela (ou visão) do sistema,
// com os campos que o gestor pode usar e a regra de UNIDADE aplicada na consulta:
//   - gerente: sempre filtrado pela própria unidade (aplicado aqui, no banco);
//   - admin: todas as unidades, ou só a escolhida.
// Campos sensíveis (senhas, tokens, chat do Telegram) nunca entram.
import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export type TipoCampo = 'texto' | 'numero' | 'moeda' | 'data' | 'mes' | 'booleano';

export interface Campo {
  key: string;
  label: string;
  tipo: TipoCampo;
  /** false = número de identificação (Nº OS, ano...): não é somado nem tirado média. */
  agregavel?: boolean;
}

export type Linha = Record<string, string | number | boolean | null>;

export interface ContextoBusca {
  /** null = todas as unidades (somente admin) */
  unidadeId: number | null;
  periodo?: { gte?: Date; lte?: Date };
  limite: number;
}

export interface Fonte {
  id: string;
  nome: string;
  grupo: string;
  descricao: string;
  /** Campo usado pelo filtro de período (se a fonte tiver data) */
  campoData?: string;
  /** Fontes sem vínculo com unidade: só o admin vê */
  somenteAdmin?: boolean;
  campos: Campo[];
  buscar: (ctx: ContextoBusca) => Promise<Linha[]>;
}

// ---------- helpers ----------
const num = (v: Prisma.Decimal | number | null | undefined) => (v == null ? 0 : Number(v));
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const mes = (d: Date | null | undefined) =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : null;
const ano = (d: Date | null | undefined) => (d ? d.getFullYear() : null);
/** Campos derivados de uma data: dia/hora, mês e ano. */
const camposData = (prefixo: string, label: string): Campo[] => [
  { key: prefixo, label, tipo: 'data' },
  { key: `${prefixo}_mes`, label: `${label} (Mês)`, tipo: 'mes' },
  { key: `${prefixo}_ano`, label: `${label} (Ano)`, tipo: 'numero', agregavel: false },
];
const valoresData = (prefixo: string, d: Date | null | undefined) => ({
  [prefixo]: iso(d),
  [`${prefixo}_mes`]: mes(d),
  [`${prefixo}_ano`]: ano(d),
});
const siUnidade = (ctx: ContextoBusca) => (ctx.unidadeId == null ? {} : { unidade_id: ctx.unidadeId });
const periodo = (ctx: ContextoBusca, campo: string) => (ctx.periodo ? { [campo]: ctx.periodo } : {});

const PAPEIS: Record<string, string> = {
  admin: 'Administrador',
  gerente: 'Gerente',
  tecnico: 'Técnico',
  tecnico_impressora: 'Técnico de Impressoras',
  tecnico_eletronica: 'Técnico de Eletrônica',
};
const rotulo = (v: string | null | undefined) => (v ? v.replace(/_/g, ' ') : null);

// ---------- fontes ----------
export const FONTES: Fonte[] = [
  {
    id: 'producao',
    nome: 'Produção de Serviços',
    grupo: 'Produção',
    descricao: 'Serviços lançados pelos técnicos, com valores de mão de obra e peças.',
    campoData: 'data',
    campos: [
      ...camposData('data', 'Data'),
      { key: 'tecnico', label: 'Técnico', tipo: 'texto' },
      { key: 'unidade', label: 'Unidade do Técnico', tipo: 'texto' },
      { key: 'servico', label: 'Serviço', tipo: 'texto' },
      { key: 'categoria', label: 'Categoria', tipo: 'texto' },
      { key: 'vinculo', label: 'Tipo de Vínculo', tipo: 'texto' },
      { key: 'glpi', label: 'GLPI', tipo: 'texto' },
      { key: 'patrimonio', label: 'Patrimônio / Série', tipo: 'texto' },
      { key: 'quantidade', label: 'Quantidade', tipo: 'numero' },
      { key: 'valor_servico', label: 'Mão de Obra (R$)', tipo: 'moeda' },
      { key: 'valor_pecas', label: 'Peças (R$)', tipo: 'moeda' },
      { key: 'valor_total', label: 'Valor Total (R$)', tipo: 'moeda' },
    ],
    buscar: async (ctx) => {
      const rows = await prisma.producaoServico.findMany({
        where: {
          ...(ctx.unidadeId == null ? {} : { tecnico: { unidade_id: ctx.unidadeId } }),
          ...periodo(ctx, 'data_registro'),
        },
        include: {
          tecnico: { select: { nome_completo: true, unidades_organizacionais: { select: { nome: true } } } },
          servico: { select: { nome_servico: true, categoria: true } },
        },
        orderBy: { data_registro: 'asc' },
        take: ctx.limite,
      });
      return rows.map((p) => ({
        ...valoresData('data', p.data_registro),
        tecnico: p.tecnico?.nome_completo ?? null,
        unidade: p.tecnico?.unidades_organizacionais?.nome ?? null,
        servico: p.servico?.nome_servico ?? null,
        categoria: p.servico?.categoria ?? null,
        vinculo: p.solicitacao_peca_id
          ? 'OS de Peças'
          : p.atendimento_impr_id
            ? 'Atendimento de Impressora'
            : p.manutencao_eletr_id
              ? 'Manutenção Eletrônica'
              : 'Avulso',
        glpi: p.numero_glpi,
        patrimonio: p.patrimonio_serie,
        quantidade: p.quantidade,
        valor_servico: num(p.valor_servico_aplicado),
        valor_pecas: num(p.valor_pecas_aplicado),
        valor_total: num(p.valor_total_produzido),
      }));
    },
  },
  {
    id: 'catalogo_servicos',
    nome: 'Catálogo de Serviços',
    grupo: 'Produção',
    descricao: 'Serviços cadastrados e seus valores de referência.',
    campos: [
      { key: 'servico', label: 'Serviço', tipo: 'texto' },
      { key: 'categoria', label: 'Categoria', tipo: 'texto' },
      { key: 'valor_estimado', label: 'Valor Estimado (R$)', tipo: 'moeda' },
      { key: 'ativo', label: 'Ativo', tipo: 'booleano' },
    ],
    buscar: async (ctx) => {
      const rows = await prisma.catalogoServico.findMany({ orderBy: { nome_servico: 'asc' }, take: ctx.limite });
      return rows.map((c) => ({
        servico: c.nome_servico,
        categoria: c.categoria,
        valor_estimado: num(c.valor_estimado),
        ativo: c.ativo,
      }));
    },
  },
  {
    id: 'solicitacoes',
    nome: 'Ordens de Serviço',
    grupo: 'Chamados & Peças',
    descricao: 'OS abertas pelos técnicos (uma linha por OS).',
    campoData: 'data',
    campos: [
      { key: 'os', label: 'Nº OS', tipo: 'numero', agregavel: false },
      { key: 'glpi', label: 'GLPI', tipo: 'texto' },
      ...camposData('data', 'Data de Abertura'),
      { key: 'status', label: 'Status', tipo: 'texto' },
      { key: 'tipo', label: 'Tipo de Requisição', tipo: 'texto' },
      { key: 'unidade', label: 'Unidade', tipo: 'texto' },
      { key: 'tecnico', label: 'Técnico', tipo: 'texto' },
      { key: 'responsavel', label: 'Responsável pela Máquina', tipo: 'texto' },
      { key: 'patrimonio', label: 'Patrimônio', tipo: 'texto' },
      { key: 'setor', label: 'Setor', tipo: 'texto' },
      { key: 'qtd_pecas', label: 'Qtd. de Peças', tipo: 'numero' },
    ],
    buscar: async (ctx) => {
      const rows = await prisma.solicitacoes.findMany({
        where: { ...siUnidade(ctx), ...periodo(ctx, 'data_solicitacao') },
        include: {
          unidades_organizacionais: { select: { nome: true } },
          usuarios_solicitacoes_usuario_idTousuarios: { select: { nome_completo: true } },
          usuarios_solicitacoes_responsavel_usuario_idTousuarios: { select: { nome_completo: true } },
          _count: { select: { solicitacao_itens: true } },
        },
        orderBy: { data_solicitacao: 'asc' },
        take: ctx.limite,
      });
      return rows.map((s) => ({
        os: s.id,
        glpi: String(s.numero_glpi),
        ...valoresData('data', s.data_solicitacao),
        status: s.status,
        tipo: s.tipo_requisicao,
        unidade: s.unidades_organizacionais?.nome ?? null,
        tecnico: s.usuarios_solicitacoes_usuario_idTousuarios?.nome_completo ?? null,
        responsavel: s.usuarios_solicitacoes_responsavel_usuario_idTousuarios?.nome_completo ?? null,
        patrimonio: s.patrimonio,
        setor: s.setor_equipamento,
        qtd_pecas: s._count.solicitacao_itens,
      }));
    },
  },
  {
    id: 'pecas_os',
    nome: 'Peças das Ordens de Serviço',
    grupo: 'Chamados & Peças',
    descricao: 'Cada peça pedida nas OS, com pedido SIPAC, almoxarifado e valor.',
    campoData: 'data',
    campos: [
      { key: 'os', label: 'Nº OS', tipo: 'numero', agregavel: false },
      { key: 'glpi', label: 'GLPI', tipo: 'texto' },
      ...camposData('data', 'Data da OS'),
      { key: 'status_os', label: 'Status da OS', tipo: 'texto' },
      { key: 'unidade', label: 'Unidade', tipo: 'texto' },
      { key: 'tecnico', label: 'Técnico', tipo: 'texto' },
      { key: 'peca', label: 'Peça', tipo: 'texto' },
      { key: 'codigo_sipac', label: 'Código SIPAC', tipo: 'texto' },
      { key: 'categoria_peca', label: 'Categoria da Peça', tipo: 'texto' },
      { key: 'tipo_uso', label: 'Tipo de Uso', tipo: 'texto' },
      { key: 'status_peca', label: 'Status da Peça', tipo: 'texto' },
      { key: 'pedido_sipac', label: 'Nº Pedido SIPAC', tipo: 'texto' },
      { key: 'almoxarifado', label: 'Almoxarifado', tipo: 'texto' },
      { key: 'data_entrega', label: 'Data de Entrega', tipo: 'data' },
      { key: 'quantidade', label: 'Quantidade', tipo: 'numero' },
      { key: 'valor_unitario', label: 'Valor Unitário (R$)', tipo: 'moeda' },
      { key: 'valor_total', label: 'Valor Total (R$)', tipo: 'moeda' },
    ],
    buscar: async (ctx) => {
      const rows = await prisma.solicitacao_itens.findMany({
        where: { solicitacoes: { ...siUnidade(ctx), ...periodo(ctx, 'data_solicitacao') } },
        include: {
          itens: { select: { descricao: true, codigo_sipac: true, categoria: true, preco_unitario: true } },
          solicitacoes: {
            select: {
              id: true,
              numero_glpi: true,
              data_solicitacao: true,
              status: true,
              unidades_organizacionais: { select: { nome: true } },
              usuarios_solicitacoes_usuario_idTousuarios: { select: { nome_completo: true } },
            },
          },
        },
        orderBy: { id: 'asc' },
        take: ctx.limite,
      });
      return rows.map((i) => {
        const preco = num(i.itens?.preco_unitario);
        return {
          os: i.solicitacoes.id,
          glpi: String(i.solicitacoes.numero_glpi),
          ...valoresData('data', i.solicitacoes.data_solicitacao),
          status_os: i.solicitacoes.status,
          unidade: i.solicitacoes.unidades_organizacionais?.nome ?? null,
          tecnico: i.solicitacoes.usuarios_solicitacoes_usuario_idTousuarios?.nome_completo ?? null,
          peca: i.itens?.descricao ?? null,
          codigo_sipac: i.itens?.codigo_sipac ?? null,
          categoria_peca: i.itens?.categoria ?? null,
          tipo_uso: i.tipo_uso,
          status_peca: i.status_entrega,
          pedido_sipac: i.numero_pedido_sipac,
          almoxarifado: i.almoxarifado,
          data_entrega: iso(i.data_entrega),
          quantidade: i.quantidade_solicitada,
          valor_unitario: preco,
          valor_total: preco * i.quantidade_solicitada,
        };
      });
    },
  },
  {
    id: 'estoque',
    nome: 'Estoque de Peças',
    grupo: 'Chamados & Peças',
    descricao: 'Catálogo de peças com quantidades e valor em estoque.',
    campos: [
      { key: 'peca', label: 'Peça', tipo: 'texto' },
      { key: 'codigo_sipac', label: 'Código SIPAC', tipo: 'texto' },
      { key: 'codigo_ref', label: 'Código de Referência', tipo: 'texto' },
      { key: 'pregao', label: 'Pregão', tipo: 'texto' },
      { key: 'categoria', label: 'Categoria', tipo: 'texto' },
      { key: 'tipo', label: 'Tipo', tipo: 'texto' },
      { key: 'permanente', label: 'Bem Permanente', tipo: 'booleano' },
      { key: 'unidade', label: 'Unidade', tipo: 'texto' },
      { key: 'localizacao', label: 'Localização', tipo: 'texto' },
      { key: 'unidade_medida', label: 'Unidade de Medida', tipo: 'texto' },
      { key: 'qtd_estoque', label: 'Qtd. em Estoque', tipo: 'numero' },
      { key: 'qtd_teste', label: 'Qtd. de Teste', tipo: 'numero' },
      { key: 'qtd_defeito', label: 'Qtd. com Defeito', tipo: 'numero' },
      { key: 'preco_unitario', label: 'Preço Unitário (R$)', tipo: 'moeda' },
      { key: 'valor_estoque', label: 'Valor em Estoque (R$)', tipo: 'moeda' },
    ],
    buscar: async (ctx) => {
      const rows = await prisma.itens.findMany({
        where: siUnidade(ctx),
        include: { unidades_organizacionais: { select: { nome: true } } },
        orderBy: { descricao: 'asc' },
        take: ctx.limite,
      });
      return rows.map((i) => {
        const preco = num(i.preco_unitario);
        return {
          peca: i.descricao,
          codigo_sipac: i.codigo_sipac,
          codigo_ref: i.codigo_ref,
          pregao: i.pregao,
          categoria: i.categoria,
          tipo: i.tipo,
          permanente: i.is_permanente,
          unidade: i.unidades_organizacionais?.nome ?? 'Estoque Central',
          localizacao: i.localizacao,
          unidade_medida: i.unidade_medida,
          qtd_estoque: i.quantidade_estoque,
          qtd_teste: i.quantidade_teste,
          qtd_defeito: i.quantidade_defeito,
          preco_unitario: preco,
          valor_estoque: preco * i.quantidade_estoque,
        };
      });
    },
  },
  {
    id: 'manutencao_eletronica',
    nome: 'Manutenção Eletrônica',
    grupo: 'Eletrônica',
    descricao: 'Fila de manutenção eletrônica (unidade = unidade do técnico responsável).',
    campoData: 'data',
    campos: [
      { key: 'id', label: 'Nº', tipo: 'numero', agregavel: false },
      { key: 'glpi', label: 'GLPI', tipo: 'texto' },
      ...camposData('data', 'Data de Entrada'),
      { key: 'equipamento', label: 'Equipamento', tipo: 'texto' },
      { key: 'patrimonio', label: 'Patrimônio', tipo: 'texto' },
      { key: 'status', label: 'Status', tipo: 'texto' },
      { key: 'tecnico', label: 'Técnico Responsável', tipo: 'texto' },
      { key: 'unidade', label: 'Unidade', tipo: 'texto' },
      { key: 'aberto_por', label: 'Aberto por', tipo: 'texto' },
      { key: 'problema', label: 'Problema', tipo: 'texto' },
    ],
    buscar: async (ctx) => {
      const rows = await prisma.manutencao_eletronica.findMany({
        where: {
          ...(ctx.unidadeId == null ? {} : { usuarios: { unidade_id: ctx.unidadeId } }),
          ...periodo(ctx, 'data_entrada'),
        },
        include: {
          usuarios: { select: { nome_completo: true, unidades_organizacionais: { select: { nome: true } } } },
          aberto_por: { select: { nome_completo: true } },
        },
        orderBy: { data_entrada: 'asc' },
        take: ctx.limite,
      });
      return rows.map((m) => ({
        id: m.id,
        glpi: m.glpi,
        ...valoresData('data', m.data_entrada),
        equipamento: m.equipamento,
        patrimonio: m.patrimonio,
        status: rotulo(m.status),
        tecnico: m.usuarios?.nome_completo ?? null,
        unidade: m.usuarios?.unidades_organizacionais?.nome ?? null,
        aberto_por: m.aberto_por?.nome_completo ?? null,
        problema: m.descricao_problema,
      }));
    },
  },
  {
    id: 'impressoras',
    nome: 'Impressoras',
    grupo: 'Impressoras & Suprimentos',
    descricao: 'Parque de impressoras cadastradas.',
    campos: [
      { key: 'nome', label: 'Nome', tipo: 'texto' },
      { key: 'modelo', label: 'Modelo', tipo: 'texto' },
      { key: 'numero_serie', label: 'Nº de Série', tipo: 'texto' },
      { key: 'ip', label: 'IP', tipo: 'texto' },
      { key: 'localizacao', label: 'Localização', tipo: 'texto' },
      { key: 'servidor', label: 'Servidor', tipo: 'texto' },
      { key: 'status_verificacao', label: 'Status de Verificação', tipo: 'texto' },
      { key: 'ativa', label: 'Ativa', tipo: 'booleano' },
      { key: 'colorida', label: 'Colorida', tipo: 'booleano' },
      { key: 'politicas', label: 'Políticas Aplicadas', tipo: 'booleano' },
      { key: 'unidade', label: 'Unidade', tipo: 'texto' },
      { key: 'qtd', label: 'Quantidade', tipo: 'numero' },
    ],
    buscar: async (ctx) => {
      const rows = await prisma.impressora.findMany({
        where: siUnidade(ctx),
        include: { unidades_organizacionais: { select: { nome: true } } },
        orderBy: { nome: 'asc' },
        take: ctx.limite,
      });
      return rows.map((i) => ({
        nome: i.nome,
        modelo: i.modelo,
        numero_serie: i.numero_serie,
        ip: i.ip,
        localizacao: i.localizacao,
        servidor: i.servidor,
        status_verificacao: i.status_verificacao,
        ativa: i.ativo,
        colorida: i.is_colorida,
        politicas: i.politicas_aplicadas,
        unidade: i.unidades_organizacionais?.nome ?? null,
        qtd: 1,
      }));
    },
  },
  {
    id: 'atendimentos_impressora',
    nome: 'Atendimentos de Impressoras',
    grupo: 'Impressoras & Suprimentos',
    descricao: 'Chamados técnicos de impressoras.',
    campoData: 'data',
    campos: [
      { key: 'id', label: 'Nº', tipo: 'numero', agregavel: false },
      ...camposData('data', 'Data'),
      { key: 'glpi', label: 'GLPI', tipo: 'texto' },
      { key: 'status', label: 'Status', tipo: 'texto' },
      { key: 'impressora', label: 'Impressora', tipo: 'texto' },
      { key: 'modelo', label: 'Modelo', tipo: 'texto' },
      { key: 'numero_serie', label: 'Nº de Série', tipo: 'texto' },
      { key: 'tecnico', label: 'Técnico', tipo: 'texto' },
      { key: 'unidade', label: 'Unidade', tipo: 'texto' },
      { key: 'necessita_pecas', label: 'Necessita Peças', tipo: 'booleano' },
      { key: 'pecas', label: 'Peças', tipo: 'texto' },
      { key: 'chamado_assistencia', label: 'Chamado da Assistência', tipo: 'texto' },
      { key: 'necessita_backup', label: 'Necessita Backup', tipo: 'booleano' },
      { key: 'data_visita', label: 'Data da Visita', tipo: 'data' },
    ],
    buscar: async (ctx) => {
      const rows = await prisma.atendimentoImpressora.findMany({
        where: { ...siUnidade(ctx), ...periodo(ctx, 'data') },
        include: {
          impressora: { select: { nome: true, modelo: true, numero_serie: true } },
          tecnico: { select: { nome_completo: true } },
          unidades_organizacionais: { select: { nome: true } },
        },
        orderBy: { data: 'asc' },
        take: ctx.limite,
      });
      return rows.map((a) => ({
        id: a.id,
        ...valoresData('data', a.data),
        glpi: a.numero_glpi,
        status: rotulo(a.status),
        impressora: a.impressora?.nome ?? null,
        modelo: a.impressora?.modelo ?? null,
        numero_serie: a.impressora?.numero_serie ?? null,
        tecnico: a.tecnico?.nome_completo ?? null,
        unidade: a.unidades_organizacionais?.nome ?? null,
        necessita_pecas: a.necessita_pecas,
        pecas: a.descricao_pecas,
        chamado_assistencia: a.chamado_assistencia,
        necessita_backup: a.necessita_backup,
        data_visita: iso(a.data_visita),
      }));
    },
  },
  {
    id: 'suprimentos_saida',
    nome: 'Saída de Suprimentos (Toners)',
    grupo: 'Impressoras & Suprimentos',
    descricao: 'Toners e unidades de imagem entregues por impressora.',
    campoData: 'data',
    campos: [
      ...camposData('data', 'Data'),
      { key: 'glpi', label: 'GLPI', tipo: 'texto' },
      { key: 'impressora', label: 'Impressora', tipo: 'texto' },
      { key: 'unidade', label: 'Unidade', tipo: 'texto' },
      { key: 'tecnico', label: 'Técnico', tipo: 'texto' },
      { key: 'toner_preto', label: 'Toner Preto', tipo: 'numero' },
      { key: 'toner_ciano', label: 'Toner Ciano', tipo: 'numero' },
      { key: 'toner_magenta', label: 'Toner Magenta', tipo: 'numero' },
      { key: 'toner_amarelo', label: 'Toner Amarelo', tipo: 'numero' },
      { key: 'total_toners', label: 'Total de Toners', tipo: 'numero' },
      { key: 'unidade_imagem', label: 'Unidades de Imagem', tipo: 'numero' },
    ],
    buscar: async (ctx) => {
      const rows = await prisma.controleSuprimentos.findMany({
        where: {
          ...(ctx.unidadeId == null ? {} : { impressora: { unidade_id: ctx.unidadeId } }),
          ...periodo(ctx, 'data'),
        },
        include: {
          impressora: { select: { nome: true, unidades_organizacionais: { select: { nome: true } } } },
          tecnico: { select: { nome_completo: true } },
        },
        orderBy: { data: 'asc' },
        take: ctx.limite,
      });
      return rows.map((c) => ({
        ...valoresData('data', c.data),
        glpi: c.numero_glpi,
        impressora: c.impressora?.nome ?? null,
        unidade: c.impressora?.unidades_organizacionais?.nome ?? null,
        tecnico: c.tecnico?.nome_completo ?? null,
        toner_preto: c.toner_preto_solicitados,
        toner_ciano: c.toner_ciano_solicitados,
        toner_magenta: c.toner_magenta_solicitados,
        toner_amarelo: c.toner_amarelo_solicitados,
        total_toners:
          c.toner_preto_solicitados + c.toner_ciano_solicitados + c.toner_magenta_solicitados + c.toner_amarelo_solicitados,
        unidade_imagem: c.unidade_imagem_solicitadas,
      }));
    },
  },
  {
    id: 'suprimentos_movimentacoes',
    nome: 'Entradas e Correções de Suprimentos',
    grupo: 'Impressoras & Suprimentos',
    descricao: 'Histórico do estoque central de toners (sem unidade: somente admin).',
    campoData: 'data',
    somenteAdmin: true,
    campos: [
      ...camposData('data', 'Data'),
      { key: 'usuario', label: 'Usuário', tipo: 'texto' },
      { key: 'cor', label: 'Cor', tipo: 'texto' },
      { key: 'tipo_acao', label: 'Tipo de Ação', tipo: 'texto' },
      { key: 'qtd_adicionada', label: 'Qtd. Adicionada', tipo: 'numero' },
      { key: 'qtd_anterior', label: 'Qtd. Anterior', tipo: 'numero' },
      { key: 'qtd_nova', label: 'Qtd. Nova', tipo: 'numero' },
      { key: 'unidade_imagem', label: 'Unidades de Imagem', tipo: 'numero' },
      { key: 'justificativa', label: 'Justificativa', tipo: 'texto' },
    ],
    buscar: async (ctx) => {
      const rows = await prisma.historicoSuprimento.findMany({
        where: periodo(ctx, 'data'),
        include: { usuario: { select: { nome_completo: true } } },
        orderBy: { data: 'asc' },
        take: ctx.limite,
      });
      return rows.map((h) => ({
        ...valoresData('data', h.data),
        usuario: h.usuario?.nome_completo ?? null,
        cor: h.cor,
        tipo_acao: h.tipo_acao,
        qtd_adicionada: h.quantidade_adicionada,
        qtd_anterior: h.quantidade_anterior,
        qtd_nova: h.quantidade_nova,
        unidade_imagem: h.unidade_imagem_solicitadas,
        justificativa: h.justificativa,
      }));
    },
  },
  {
    id: 'reportes_estoque',
    nome: 'Reportes de Divergência de Estoque',
    grupo: 'Impressoras & Suprimentos',
    descricao: 'Divergências reportadas pelos técnicos (somente admin).',
    campoData: 'data',
    somenteAdmin: true,
    campos: [
      ...camposData('data', 'Data'),
      { key: 'usuario', label: 'Técnico', tipo: 'texto' },
      { key: 'mensagem', label: 'Mensagem', tipo: 'texto' },
      { key: 'status', label: 'Status', tipo: 'texto' },
    ],
    buscar: async (ctx) => {
      const rows = await prisma.reporteErroEstoque.findMany({
        where: periodo(ctx, 'data_criacao'),
        include: { usuario: { select: { nome_completo: true } } },
        orderBy: { data_criacao: 'asc' },
        take: ctx.limite,
      });
      return rows.map((r) => ({
        ...valoresData('data', r.data_criacao),
        usuario: r.usuario?.nome_completo ?? null,
        mensagem: r.mensagem,
        status: r.status,
      }));
    },
  },
  {
    id: 'patrimonio',
    nome: 'Bens Patrimoniais',
    grupo: 'Patrimônio',
    descricao: 'Inventário de bens, com quem está a posse atual.',
    campoData: 'data_importacao',
    campos: [
      { key: 'tombamento', label: 'Tombamento', tipo: 'texto' },
      { key: 'descricao', label: 'Descrição', tipo: 'texto' },
      { key: 'marca', label: 'Marca', tipo: 'texto' },
      { key: 'localizacao', label: 'Localização Física', tipo: 'texto' },
      { key: 'status', label: 'Status', tipo: 'texto' },
      { key: 'unidade', label: 'Unidade', tipo: 'texto' },
      { key: 'posse', label: 'Em Posse de', tipo: 'texto' },
      ...camposData('data_importacao', 'Data de Cadastro'),
      { key: 'qtd', label: 'Quantidade', tipo: 'numero' },
    ],
    buscar: async (ctx) => {
      const rows = await prisma.bemPatrimonial.findMany({
        where: { ...siUnidade(ctx), ...periodo(ctx, 'data_importacao') },
        include: {
          unidade: { select: { nome: true } },
          atribuicoes: {
            where: { data_devolucao: null },
            include: { tecnico: { select: { nome_completo: true } } },
            orderBy: { data_atribuicao: 'desc' },
            take: 1,
          },
        },
        orderBy: { tombamento: 'asc' },
        take: ctx.limite,
      });
      return rows.map((b) => ({
        tombamento: b.tombamento,
        descricao: b.descricao,
        marca: b.marca,
        localizacao: b.localizacao_fisica,
        status: b.status_atual,
        unidade: b.unidade?.nome ?? null,
        posse: b.atribuicoes[0]?.tecnico?.nome_completo ?? 'No setor',
        ...valoresData('data_importacao', b.data_importacao),
        qtd: 1,
      }));
    },
  },
  {
    id: 'historico_patrimonio',
    nome: 'Movimentações de Patrimônio',
    grupo: 'Patrimônio',
    descricao: 'Atribuições, devoluções e transferências de bens.',
    campoData: 'data',
    campos: [
      ...camposData('data', 'Data'),
      { key: 'acao', label: 'Ação', tipo: 'texto' },
      { key: 'tombamento', label: 'Tombamento', tipo: 'texto' },
      { key: 'bem', label: 'Bem', tipo: 'texto' },
      { key: 'usuario', label: 'Executado por', tipo: 'texto' },
      { key: 'tecnico', label: 'Técnico', tipo: 'texto' },
      { key: 'origem', label: 'Unidade de Origem', tipo: 'texto' },
      { key: 'destino', label: 'Unidade de Destino', tipo: 'texto' },
      { key: 'detalhes', label: 'Detalhes', tipo: 'texto' },
    ],
    buscar: async (ctx) => {
      const u = ctx.unidadeId;
      const rows = await prisma.historicoPatrimonio.findMany({
        where: {
          ...(u == null ? {} : { OR: [{ bem: { unidade_id: u } }, { origem_unidade_id: u }, { destino_unidade_id: u }] }),
          ...periodo(ctx, 'data_registro'),
        },
        include: {
          bem: { select: { tombamento: true, descricao: true } },
          usuario_acao: { select: { nome_completo: true } },
          tecnico_alvo: { select: { nome_completo: true } },
          unidade_origem: { select: { nome: true } },
          unidade_destino: { select: { nome: true } },
        },
        orderBy: { data_registro: 'asc' },
        take: ctx.limite,
      });
      return rows.map((h) => ({
        ...valoresData('data', h.data_registro),
        acao: h.acao,
        tombamento: h.bem?.tombamento ?? null,
        bem: h.bem?.descricao ?? null,
        usuario: h.usuario_acao?.nome_completo ?? null,
        tecnico: h.tecnico_alvo?.nome_completo ?? null,
        origem: h.unidade_origem?.nome ?? null,
        destino: h.unidade_destino?.nome ?? null,
        detalhes: h.detalhes,
      }));
    },
  },
  {
    id: 'conferencias_levantamento',
    nome: 'Auditoria Física (Levantamentos)',
    grupo: 'Patrimônio',
    descricao: 'Resultado da conferência de cada bem nos levantamentos.',
    campoData: 'data_inicio',
    campos: [
      { key: 'levantamento', label: 'Nº Levantamento', tipo: 'numero', agregavel: false },
      ...camposData('data_inicio', 'Início do Levantamento'),
      { key: 'status_levantamento', label: 'Status do Levantamento', tipo: 'texto' },
      { key: 'tombamento', label: 'Tombamento', tipo: 'texto' },
      { key: 'bem', label: 'Bem', tipo: 'texto' },
      { key: 'unidade', label: 'Unidade', tipo: 'texto' },
      { key: 'status_conferido', label: 'Resultado da Conferência', tipo: 'texto' },
      { key: 'justificativa', label: 'Justificativa', tipo: 'texto' },
    ],
    buscar: async (ctx) => {
      const rows = await prisma.conferenciaLevantamento.findMany({
        where: {
          ...(ctx.unidadeId == null ? {} : { bem: { unidade_id: ctx.unidadeId } }),
          ...(ctx.periodo ? { levantamento: { data_inicio: ctx.periodo } } : {}),
        },
        include: {
          levantamento: true,
          bem: { select: { tombamento: true, descricao: true, unidade: { select: { nome: true } } } },
        },
        orderBy: { id: 'asc' },
        take: ctx.limite,
      });
      return rows.map((c) => ({
        levantamento: c.levantamento_id,
        ...valoresData('data_inicio', c.levantamento?.data_inicio),
        status_levantamento: c.levantamento?.status ?? null,
        tombamento: c.bem?.tombamento ?? null,
        bem: c.bem?.descricao ?? null,
        unidade: c.bem?.unidade?.nome ?? null,
        status_conferido: c.status_conferido,
        justificativa: c.justificativa,
      }));
    },
  },
  {
    id: 'usuarios',
    nome: 'Usuários',
    grupo: 'Administração',
    descricao: 'Usuários do sistema (sem senhas ou dados de acesso).',
    campoData: 'data_criacao',
    campos: [
      { key: 'nome', label: 'Nome', tipo: 'texto' },
      { key: 'username', label: 'Usuário', tipo: 'texto' },
      { key: 'papel', label: 'Perfil', tipo: 'texto' },
      { key: 'unidade', label: 'Unidade', tipo: 'texto' },
      { key: 'email', label: 'E-mail', tipo: 'texto' },
      { key: 'telefone', label: 'Telefone', tipo: 'texto' },
      { key: 'telegram', label: 'Telegram Vinculado', tipo: 'booleano' },
      ...camposData('data_criacao', 'Data de Cadastro'),
      { key: 'qtd', label: 'Quantidade', tipo: 'numero' },
    ],
    buscar: async (ctx) => {
      const rows = await prisma.usuarios.findMany({
        where: { ...siUnidade(ctx), ...periodo(ctx, 'data_criacao') },
        select: {
          nome_completo: true,
          username: true,
          role: true,
          email: true,
          telefone: true,
          telegram_chat_id: true,
          data_criacao: true,
          unidades_organizacionais: { select: { nome: true } },
        },
        orderBy: { nome_completo: 'asc' },
        take: ctx.limite,
      });
      return rows.map((u) => ({
        nome: u.nome_completo,
        username: u.username,
        papel: PAPEIS[u.role] ?? u.role,
        unidade: u.unidades_organizacionais?.nome ?? null,
        email: u.email,
        telefone: u.telefone,
        telegram: !!u.telegram_chat_id,
        ...valoresData('data_criacao', u.data_criacao),
        qtd: 1,
      }));
    },
  },
  {
    id: 'unidades',
    nome: 'Unidades Organizacionais',
    grupo: 'Administração',
    descricao: 'Unidades cadastradas (somente admin).',
    somenteAdmin: true,
    campos: [
      { key: 'nome', label: 'Nome', tipo: 'texto' },
      { key: 'sigla', label: 'Sigla', tipo: 'texto' },
      { key: 'campus', label: 'Campus', tipo: 'texto' },
      { key: 'usuarios', label: 'Qtd. de Usuários', tipo: 'numero' },
      { key: 'impressoras', label: 'Qtd. de Impressoras', tipo: 'numero' },
      { key: 'bens', label: 'Qtd. de Bens', tipo: 'numero' },
      { key: 'os', label: 'Qtd. de OS', tipo: 'numero' },
    ],
    buscar: async (ctx) => {
      const rows = await prisma.unidades_organizacionais.findMany({
        where: ctx.unidadeId == null ? {} : { id: ctx.unidadeId },
        include: { _count: { select: { usuarios: true, impressoras: true, bens: true, solicitacoes: true } } },
        orderBy: { nome: 'asc' },
        take: ctx.limite,
      });
      return rows.map((u) => ({
        nome: u.nome,
        sigla: u.sigla,
        campus: u.campus,
        usuarios: u._count.usuarios,
        impressoras: u._count.impressoras,
        bens: u._count.bens,
        os: u._count.solicitacoes,
      }));
    },
  },
];

export const fontePorId = (id: string) => FONTES.find((f) => f.id === id);
