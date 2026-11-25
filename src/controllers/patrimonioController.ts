// src/controllers/patrimonioController.ts
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import { z } from 'zod';
const xlsx = require('xlsx');
const pdfParse = require('pdf-parse');
import { dispararNotificacao } from './notificacaoController';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// REGRAS DE UNIDADE DO PATRIMÔNIO
//  - admin: vê e mexe em todas as unidades (por isso não tem unidade);
//  - gerente: vê e mexe só nos bens da PRÓPRIA unidade. Transfere bens da unidade dele
//    para outra (o bem sai da lista dele) e atribui bens aos técnicos da unidade dele
//    (o bem continua na unidade, mostrando com quem está).
// ---------------------------------------------------------------------------
class RegraPatrimonioError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
/** Unidade a que o usuário está preso (gerente) ou null (admin: todas). */
const unidadeDoGestor = (req: Request): number | null => {
  const u = req.user!;
  if (u.role === 'admin') return null;
  if (!u.unidade_id) throw new RegraPatrimonioError(403, 'Seu usuário não está vinculado a uma unidade.');
  return u.unidade_id;
};
const exigirBemDaMinhaUnidade = (req: Request, bem: { unidade_id: number }) => {
  const minha = unidadeDoGestor(req);
  if (minha !== null && bem.unidade_id !== minha) {
    throw new RegraPatrimonioError(403, 'Este bem não pertence à sua unidade.');
  }
};
const responderErro = (res: Response, error: unknown, padrao: string, status = 500) => {
  if (error instanceof RegraPatrimonioError) return res.status(error.status).json({ message: error.message });
  if (error instanceof z.ZodError) return res.status(400).json({ message: 'Dados inválidos.', details: error.issues });
  console.error(padrao, error);
  return res.status(status).json({ message: padrao });
};

// Schemas de Validação (Zod)
const transferenciaSchema = z.object({
  bem_ids: z.array(z.number().int()).min(1, 'Escolha pelo menos um bem.'),
  origem_unidade_id: z.number().int().optional(), // ignorado: a origem é a unidade atual de cada bem
  destino_unidade_id: z.number().int(),
  observacao: z.string().optional(),
});

const bemPatrimonialSchema = z.object({
  tombamento: z.string().min(3, "Tombamento é obrigatório"),
  descricao: z.string().min(3, "Descrição é obrigatória"),
  marca: z.string().optional().nullable(),
  localizacao_fisica: z.string().min(2, "Localização é obrigatória"),
  status_atual: z.string().default("Ativo"),
  unidade_id: z.number().int("Unidade é obrigatória")
});


//  ALIMENTAÇÃO DO BANCO DE DADOS

export const createBem = async (req: Request, res: Response) => {
  try {
    const data = bemPatrimonialSchema.parse(req.body);
    // Gerente só cadastra bens na própria unidade
    const minha = unidadeDoGestor(req);
    if (minha !== null) data.unidade_id = minha;
    const existente = await prisma.bemPatrimonial.findUnique({
      where: { tombamento: data.tombamento }
    });

    if (existente) {
      return res.status(400).json({ message: 'Já existe um equipamento com este número de tombamento.' });
    }

    const novoBem = await prisma.bemPatrimonial.create({ data });
    res.status(201).json({ message: 'Bem registrado com sucesso!', data: novoBem });
  } catch (error) {
    responderErro(res, error, 'Dados inválidos.', 400);
  }
};



export const updateBem = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const data = bemPatrimonialSchema.parse(req.body);
    const atual = await prisma.bemPatrimonial.findUnique({ where: { id: Number(id) } });
    if (!atual) return res.status(404).json({ message: 'Bem não encontrado.' });
    exigirBemDaMinhaUnidade(req, atual);
    // Mudar de unidade é TRANSFERÊNCIA (fica no histórico e avisa o destino), não edição.
    if (unidadeDoGestor(req) !== null) data.unidade_id = atual.unidade_id;
    const updatedBem = await prisma.bemPatrimonial.update({
      where: { id: Number(id) },
      data
    });
    res.json({ message: 'Bem atualizado com sucesso!', data: updatedBem });
  } catch (error) {
    responderErro(res, error, 'Erro ao atualizar. Verifique os dados.', 400);
  }
};



export const deleteBem = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const atual = await prisma.bemPatrimonial.findUnique({ where: { id: Number(id) } });
    if (!atual) return res.status(404).json({ message: 'Bem não encontrado.' });
    exigirBemDaMinhaUnidade(req, atual);
    await prisma.bemPatrimonial.delete({
      where: { id: Number(id) },
    });
    res.status(204).send();
  } catch (error) {
    responderErro(res, error, 'Erro ao deletar bem. Pode estar em uso num termo de cautela ou movimentação.');
  }
};



const decodificarTexto = (buf: Buffer): string => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
};

// Bem que já existe e veio de novo no arquivo do SIPAC.
// Se estava em outra unidade, passa para a unidade de quem importou (regra confirmada), e isso
// fica registrado: histórico "origem ➔ destino (Importação do SIPAC)". Se estava com um técnico
// da unidade antiga, a atribuição é encerrada (bem e técnico precisam ser da mesma unidade).
// Retorna a unidade de origem quando o bem mudou de unidade (para avisar os gerentes de lá).
const atualizarBemImportado = async (
  bem: { id: number; tombamento: string; unidade_id: number },
  descricao: string,
  unidadeDestino: number,
  usuarioId: number,
): Promise<number | null> => {
  const mudouDeUnidade = bem.unidade_id !== unidadeDestino;
  await prisma.$transaction(async (tx) => {
    await tx.bemPatrimonial.update({ where: { id: bem.id }, data: { descricao, unidade_id: unidadeDestino } });
    if (!mudouDeUnidade) return;
    const aberta = await tx.atribuicaoTecnico.findFirst({ where: { bem_id: bem.id, data_devolucao: null } });
    if (aberta) {
      await tx.atribuicaoTecnico.update({ where: { id: aberta.id }, data: { data_devolucao: new Date() } });
      await tx.historicoPatrimonio.create({
        data: { bem_id: bem.id, usuario_id: usuarioId, tecnico_id: aberta.tecnico_id, acao: 'Devolução', detalhes: 'Atribuição encerrada: o bem mudou de unidade pela importação do SIPAC.' },
      });
    }
    await tx.historicoPatrimonio.create({
      data: { bem_id: bem.id, usuario_id: usuarioId, origem_unidade_id: bem.unidade_id, destino_unidade_id: unidadeDestino, acao: 'Transferência', detalhes: 'Importação do SIPAC.' },
    });
  });
  return mudouDeUnidade ? bem.unidade_id : null;
};

// Importação Massiva via PDF (SIPAC)
export const importarDadosSipac = async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ message: 'O servidor recusou o arquivo. Verifique se é um PDF ou CSV válido.' });
  }

  // Gerente importa só para a própria unidade
  const unidadeGestor = req.user!.role === 'admin' ? null : req.user!.unidade_id;
  const unidadeIdImportacao = unidadeGestor ?? (req.body.unidade_id ? Number(req.body.unidade_id) : null); 
  if (!unidadeIdImportacao) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); 
      return res.status(400).json({ message: 'Para importar os dados, é obrigatório informar a Unidade de destino.' });
  }

  const filePath = req.file.path;
  const isPDF = filePath.toLowerCase().endsWith('.pdf');

  try {
    let novos = 0;
    let atualizados = 0;
    // bens que vieram de outra unidade: { unidade de origem: [tombamentos] }
    const movidos = new Map<number, string[]>();
    const registrarMovido = (origem: number | null, tombamento: string) => {
      if (origem === null) return;
      movidos.set(origem, [...(movidos.get(origem) ?? []), tombamento]);
    };
    let erros = 0;
    let totalEncontrados = 0;

    if (isPDF) {
      const dataBuffer = fs.readFileSync(filePath);
      const pdfData = await pdfParse(dataBuffer);
      const textoLimpo = (pdfData.text || '').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
      const regexTombamento = /([0-9]{9,12})/g;
      const partes = textoLimpo.split(regexTombamento);

      if (partes.length < 3) {
          throw new Error("Nenhum tombamento de 9 a 12 dígitos foi encontrado no PDF.");
      }

      totalEncontrados = Math.floor((partes.length - 1) / 2);

      for (let i = 1; i < partes.length; i += 2) {
        const tombamento = partes[i];
        let descricao = "";
        const textoAnterior = partes[i - 1]?.trim() || "";
        const textoProximo = partes[i + 1]?.trim() || "";

        const limparLixo = (txt: string) => txt
              .replace(/UFS SIPAC.*?Contratos/gi, '')
              .replace(/JOAO NYLSON.*?LEVAN.*?(ANUAL|PATRIMONIAL)/gi, '')
              .replace(/Tombamento\s+Descrição\s+Marca/gi, '')
              .replace(/BENS NÃO INFORMADOS NO LEVANTAMENTO.*?Marca/gi, '')
              .replace(/Emitido em.*?Página \d+\/\d+/gi, '')
              .replace(/SIPAC Telafonts.*?dba1244/gi, '').trim();

        const anteriorLimpo = limparLixo(textoAnterior);
        const proximoLimpo = limparLixo(textoProximo);

        descricao = proximoLimpo.length > anteriorLimpo.length ? proximoLimpo : anteriorLimpo;
        if (proximoLimpo.length > anteriorLimpo.length) partes[i + 1] = ""; 
        
        descricao = descricao.substring(0, 200).trim() || "Descrição não identificada";

        try {
          const bemExistente = await prisma.bemPatrimonial.findUnique({ where: { tombamento } });
          if (bemExistente) {
            registrarMovido(await atualizarBemImportado(bemExistente, descricao, unidadeIdImportacao, req.user!.id), tombamento);
            atualizados++;
          } else {
            await prisma.bemPatrimonial.create({
              data: { tombamento, descricao, localizacao_fisica: 'Importado do SIPAC (PDF)', status_atual: 'Ativo', unidade_id: unidadeIdImportacao }
            });
            novos++;
          }
        } catch (err) { erros++; }
      }
    } else {
      // CSV: lido como texto para (1) detectar a codificação — UTF-8 ou Windows-1252, que é o
      // que o Excel antigo grava — e não quebrar acentos dos cabeçalhos ("Denominação"), e
      // (2) manter os valores como texto (raw), preservando zeros à esquerda do tombamento.
      const workbook = filePath.toLowerCase().endsWith('.csv')
        ? xlsx.read(decodificarTexto(fs.readFileSync(filePath)), { type: 'string', raw: true })
        : xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rawData = xlsx.utils.sheet_to_json(sheet, { defval: "" });

      if (rawData.length === 0) throw new Error("A planilha está vazia.");

      for (const row of rawData as any[]) {
        const tombamento = (row['Tombamento'] || row['tombamento'] || row['TOMBAMENTO'] || row['codigo'] || '')?.toString().trim();
        let descricao = (row['Denominação'] || row['Descrição'] || row['descricao'] || row['DESCRICAO'] || row['nome'] || '')?.toString().trim();

        if (!tombamento || tombamento.length < 5) continue; 
        
        descricao = descricao.substring(0, 200) || "Descrição não identificada";
        totalEncontrados++;

        try {
          const bemExistente = await prisma.bemPatrimonial.findUnique({ where: { tombamento } });
          if (bemExistente) {
            registrarMovido(await atualizarBemImportado(bemExistente, descricao, unidadeIdImportacao, req.user!.id), tombamento);
            atualizados++;
          } else {
            await prisma.bemPatrimonial.create({
              data: { tombamento, descricao, localizacao_fisica: 'Importado do SIPAC (CSV)', status_atual: 'Ativo', unidade_id: unidadeIdImportacao }
            });
            novos++;
          }
        } catch (err) { erros++; }
      }
    }

    if (fs.existsSync(filePath)) fs.unlinkSync(filePath); 

    if (novos === 0 && atualizados === 0 && erros === 0) {
       return res.status(400).json({ message: 'Nenhum equipamento foi processado. O arquivo pode estar vazio ou as colunas não foram identificadas.' });
    }

    // Avisa os gerentes das unidades de onde saíram bens
    const destinoNome = (await prisma.unidades_organizacionais.findUnique({ where: { id: unidadeIdImportacao }, select: { nome: true } }))?.nome ?? 'outra unidade';
    for (const [origem, tombamentos] of movidos) {
      const gerentes = await prisma.usuarios.findMany({ where: { role: 'gerente', unidade_id: origem }, select: { id: true } });
      for (const g of gerentes) {
        if (g.id === req.user!.id) continue;
        await dispararNotificacao({
          usuario_id: g.id,
          titulo: '📦 Bens movidos pela importação do SIPAC',
          mensagem: `${tombamentos.length} bem(ns) da sua unidade constam no SIPAC de ${destinoNome} e foram movidos para lá:\n${tombamentos.slice(0, 20).join(', ')}${tombamentos.length > 20 ? '…' : ''}`,
          tipo: 'alerta',
          link_acao: '/lista-bens',
        });
      }
    }
    const totalMovidos = [...movidos.values()].reduce((n, l) => n + l.length, 0);

    res.status(200).json({
      message: 'Sincronização concluída com sucesso!',
      detalhes: {
        total_bens_encontrados: totalEncontrados,
        novos_registos: novos,
        atualizados: atualizados,
        vindos_de_outra_unidade: totalMovidos,
        erros: erros
      }
    });

  } catch (error: any) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ message: `Erro ao processar arquivo: ${error.message || 'Falha desconhecida.'}` });
  }
};



// VISUALIZAÇÃO 

export const getAllBens = async (req: Request, res: Response) => {
  try {
    const { search, unidade_id, status_atual, com_tecnico, page = 1, limit = 10 } = req.query;
    const where: any = {};
    // Gerente: sempre a própria unidade (o servidor garante, não só a tela)
    const minha = unidadeDoGestor(req);

    if (search) {
      where.OR = [
        { descricao: { contains: String(search), mode: 'insensitive' } },
        { tombamento: { contains: String(search) } }
      ];
    }
    if (minha !== null) where.unidade_id = minha;
    else if (unidade_id) where.unidade_id = Number(unidade_id);
    if (status_atual) where.status_atual = String(status_atual);
    // "Com técnico": bens atribuídos (termo de cautela aberto)
    if (com_tecnico === 'sim') where.atribuicoes = { some: { data_devolucao: null } };

    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    const [bens, total] = await Promise.all([
      prisma.bemPatrimonial.findMany({
        where,
        skip,
        take,
        include: { 
          unidade: { select: { nome: true } },
          atribuicoes: {
            where: { data_devolucao: null },
            include: { tecnico: { select: { nome_completo: true } } }
          }
        },
        orderBy: { data_importacao: 'desc' }
      }),
      prisma.bemPatrimonial.count({ where })
    ]);

    const respostaFormatada = bens.map((bem: any) => ({
      ...bem,
      unidade_nome: bem.unidade?.nome || 'Não definida',
      tecnico_responsavel: bem.atribuicoes.length > 0 ? bem.atribuicoes[0].tecnico.nome_completo : null
    }));

    res.json({
      data: respostaFormatada,
      meta: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    responderErro(res, error, 'Erro ao buscar bens patrimoniais.');
  }
};




export const transferirBens = async (req: Request, res: Response) => {
  try {
    const { bem_ids, destino_unidade_id, observacao } = transferenciaSchema.parse(req.body);
    const minha = unidadeDoGestor(req);

    const destino = await prisma.unidades_organizacionais.findUnique({ where: { id: destino_unidade_id } });
    if (!destino) return res.status(400).json({ message: 'Unidade de destino não encontrada.' });

    const bens = await prisma.bemPatrimonial.findMany({
      where: { id: { in: bem_ids } },
      include: {
        unidade: { select: { nome: true } },
        atribuicoes: { where: { data_devolucao: null }, include: { tecnico: { select: { nome_completo: true } } } },
      },
    });
    if (bens.length !== bem_ids.length) return res.status(404).json({ message: 'Algum dos bens não foi encontrado.' });

    // Gerente transfere só bens da própria unidade
    if (minha !== null) {
      const deFora = bens.filter((b) => b.unidade_id !== minha);
      if (deFora.length) throw new RegraPatrimonioError(403, `Você só pode transferir bens da sua unidade. Fora dela: ${deFora.map((b) => b.tombamento).join(', ')}.`);
    }
    const jaNoDestino = bens.filter((b) => b.unidade_id === destino_unidade_id);
    if (jaNoDestino.length) throw new RegraPatrimonioError(400, `Já estão na unidade de destino: ${jaNoDestino.map((b) => b.tombamento).join(', ')}.`);
    // Bem com técnico precisa ser devolvido antes (senão o técnico de uma unidade ficaria com bem de outra)
    const comTecnico = bens.filter((b) => b.atribuicoes.length);
    if (comTecnico.length) {
      throw new RegraPatrimonioError(400, `Registre a devolução antes de transferir: ${comTecnico.map((b) => `${b.tombamento} (com ${b.atribuicoes[0].tecnico.nome_completo})`).join(', ')}.`);
    }

    await prisma.$transaction(async (tx) => {
      for (const bem of bens) {
        await tx.movimentacaoBem.create({
          data: { bem_id: bem.id, origem_unidade_id: bem.unidade_id, destino_unidade_id, tipo: 'TRANSFERENCIA', subtipo: observacao, data_envio: new Date() },
        });
        // Histórico oficial do bem (aparece na aba "Histórico")
        await tx.historicoPatrimonio.create({
          data: {
            bem_id: bem.id,
            usuario_id: req.user!.id,
            origem_unidade_id: bem.unidade_id,
            destino_unidade_id,
            acao: 'Transferência',
            detalhes: observacao || 'Transferência entre unidades.',
          },
        });
      }
      // O bem passa a ser da unidade de destino (sai da lista da origem). A situação continua "Ativo".
      await tx.bemPatrimonial.updateMany({
        where: { id: { in: bem_ids } },
        data: { unidade_id: destino_unidade_id },
      });
    });

    // Avisa os gerentes da unidade que recebeu
    const gerentesDestino = await prisma.usuarios.findMany({ where: { role: 'gerente', unidade_id: destino_unidade_id }, select: { id: true } });
    const origemNome = bens[0].unidade?.nome ?? 'outra unidade';
    const lista = bens.map((b) => `${b.tombamento} – ${b.descricao}`).join('\n');
    for (const g of gerentesDestino) {
      if (g.id === req.user!.id) continue;
      await dispararNotificacao({
        usuario_id: g.id,
        titulo: '📦 Bens recebidos por transferência',
        mensagem: `${bens.length} bem(ns) transferido(s) de ${origemNome} para a sua unidade:\n${lista}${observacao ? `\n\n📝 ${observacao}` : ''}`,
        tipo: 'info',
        link_acao: '/lista-bens',
      });
    }

    res.status(201).json({ message: `${bens.length} bem(ns) transferido(s) para ${destino.nome}.` });
  } catch (error: any) {
    responderErro(res, error, error?.message || 'Erro ao processar transferência.', 400);
  }
};



export const uploadFoto = async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!req.file) return res.status(400).json({ message: 'Nenhum arquivo enviado.' });
  try {
    const atual = await prisma.bemPatrimonial.findUnique({ where: { id: Number(id) } });
    if (!atual) return res.status(404).json({ message: 'Bem não encontrado.' });
    exigirBemDaMinhaUnidade(req, atual);
  } catch (error) {
    return responderErro(res, error, 'Erro ao salvar a foto.');
  }
  const caminhoRelativo = req.file.path.replace(/\\/g, '/'); 
  try {
    await prisma.bemPatrimonial.update({ where: { id: Number(id) }, data: { foto_url: caminhoRelativo } });
    res.json({ message: 'Foto atualizada!', url: caminhoRelativo });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao salvar caminho da foto.' });
  }
};



//  REGRA INVENTÁRIO #1: Atribuição de Bens gravando no HistoricoPatrimonio
export const atribuirBem = async (req: Request, res: Response) => {
  const { bem_id, tecnico_id, observacoes } = req.body;
  const usuarioLogadoId = (req as any).user?.id || 1; // Fallback de segurança

  try {
    const bem = await prisma.bemPatrimonial.findUnique({ where: { id: Number(bem_id) } });
    if (!bem) return res.status(404).json({ message: 'Bem não encontrado.' });

    exigirBemDaMinhaUnidade(req, bem);

    const tecnico = await prisma.usuarios.findUnique({ where: { id: Number(tecnico_id) }, select: { id: true, nome_completo: true, unidade_id: true } });
    if (!tecnico) return res.status(404).json({ message: 'Técnico não encontrado.' });
    // O técnico tem que ser da unidade dona do bem (o bem continua na unidade, com ele)
    if (tecnico.unidade_id !== bem.unidade_id) {
      throw new RegraPatrimonioError(400, `${tecnico.nome_completo} não é da unidade deste bem. Atribua a um técnico da mesma unidade.`);
    }
    const jaAtribuido = await prisma.atribuicaoTecnico.findFirst({ where: { bem_id: bem.id, data_devolucao: null }, include: { tecnico: { select: { nome_completo: true } } } });
    if (jaAtribuido) throw new RegraPatrimonioError(400, `Este bem já está com ${jaAtribuido.tecnico.nome_completo}. Registre a devolução antes.`);

    const atribuicao = await prisma.$transaction(async (tx) => {
      // A situação do bem NÃO muda: ele continua "Ativo" na unidade, só passa a estar com o técnico.
      // (Antes ficava "Transferido", parecia ter saído da unidade e sumia da Auditoria Física.)

      const novaAtribuicao = await tx.atribuicaoTecnico.create({
        data: { bem_id: Number(bem_id), tecnico_id: Number(tecnico_id), observacoes }
      });

      // Gravação na tabela oficial de Histórico
      await tx.historicoPatrimonio.create({
        data: {
          bem_id: Number(bem_id),
          usuario_id: usuarioLogadoId,
          tecnico_id: Number(tecnico_id),
          acao: 'Atribuição',
          detalhes: observacoes || 'Equipamento atribuído ao técnico.'
        }
      });

      return novaAtribuicao;
    });

    await dispararNotificacao({
      usuario_id: Number(tecnico_id),
      titulo: '💼 Termo de Cautela Emitido',
      mensagem: `O equipamento *${bem.descricao}* (Tombamento: ${bem.tombamento}) foi atribuído à sua responsabilidade.${observacoes ? `\n\n📝 Obs: ${observacoes}` : ''}`,
      tipo: 'info',
      link_acao: '/lista-bens'
    });

    res.status(201).json({ message: 'Bem atribuído com sucesso!', data: atribuicao });
  } catch (error) {
    responderErro(res, error, 'Erro ao atribuir bem.');
  }
};



//  REGRA INVENTÁRIO #1: Devolução gravando no HistoricoPatrimonio
export const devolverBem = async (req: Request, res: Response) => {
  const { bem_id } = req.body;
  const usuarioLogadoId = (req as any).user?.id || 1;

  try {
    const bem = await prisma.bemPatrimonial.findUnique({ where: { id: Number(bem_id) } });
    if (!bem) return res.status(404).json({ message: 'Bem não encontrado.' });

    exigirBemDaMinhaUnidade(req, bem);

    const atribuicaoAberta = await prisma.atribuicaoTecnico.findFirst({
      where: { bem_id: Number(bem_id), data_devolucao: null }
    });

    if (!atribuicaoAberta) return res.status(400).json({ message: 'Este bem não está atribuído a ninguém atualmente.' });

    await prisma.$transaction(async (tx) => {
      await tx.atribuicaoTecnico.update({
        where: { id: atribuicaoAberta.id },
        data: { data_devolucao: new Date() }
      });

      // A situação do bem não muda na devolução (continua "Ativo" na unidade).

      // Gravação na tabela oficial de Histórico
      await tx.historicoPatrimonio.create({
        data: {
          bem_id: Number(bem_id),
          usuario_id: usuarioLogadoId,
          tecnico_id: atribuicaoAberta.tecnico_id,
          acao: 'Devolução',
          detalhes: 'Bem devolvido ao estoque / devolvido à unidade.'
        }
      });
    });

    await dispararNotificacao({
      usuario_id: atribuicaoAberta.tecnico_id,
      titulo: '↩️ Equipamento Devolvido',
      mensagem: `A sua responsabilidade sobre o equipamento *${bem.descricao}* (Tombamento: ${bem.tombamento}) foi encerrada com sucesso. O item voltou para o inventário geral.`,
      tipo: 'sucesso',
      link_acao: '/lista-bens'
    });

    res.json({ message: 'Bem devolvido com sucesso!' });
  } catch (error) {
    responderErro(res, error, 'Erro ao devolver bem.');
  }
};



//  REGRA INVENTÁRIO #2: Transferência Direta entre Técnicos
export const transferirEntreTecnicos = async (req: Request, res: Response) => {
  const { bem_id, tecnico_destino_id, observacoes } = req.body;
  const usuarioLogadoId = (req as any).user?.id || 1;

  try {
    const bem = await prisma.bemPatrimonial.findUnique({ where: { id: Number(bem_id) } });
    if (!bem) return res.status(404).json({ message: 'Bem não encontrado.' });

    const atribuicaoAberta = await prisma.atribuicaoTecnico.findFirst({
      where: { bem_id: Number(bem_id), data_devolucao: null }
    });

    if (!atribuicaoAberta) {
      return res.status(400).json({ message: 'Este bem não está com nenhum técnico. Faça uma atribuição normal.' });
    }

    if (atribuicaoAberta.tecnico_id === Number(tecnico_destino_id)) {
      return res.status(400).json({ message: 'O equipamento já está na posse deste técnico.' });
    }

    await prisma.$transaction(async (tx) => {
      // 1. Fecha a cautela do técnico atual
      await tx.atribuicaoTecnico.update({
        where: { id: atribuicaoAberta.id },
        data: { data_devolucao: new Date() }
      });

      // 2. Abre a cautela para o novo técnico
      await tx.atribuicaoTecnico.create({
        data: {
          bem_id: Number(bem_id),
          tecnico_id: Number(tecnico_destino_id),
          observacoes: observacoes || 'Transferência direta.'
        }
      });

      // 3. Regista o Histórico Completo
      await tx.historicoPatrimonio.create({
        data: {
          bem_id: Number(bem_id),
          usuario_id: usuarioLogadoId,
          tecnico_id: Number(tecnico_destino_id),
          acao: 'Transferência Direta',
          detalhes: `Equipamento repassado diretamente do técnico anterior para o novo. Obs: ${observacoes || 'Nenhuma'}`
        }
      });
    });

    // Notifica quem enviou
    await dispararNotificacao({
      usuario_id: atribuicaoAberta.tecnico_id,
      titulo: '🔄 Transferência Concluída',
      mensagem: `A responsabilidade do equipamento *${bem.descricao}* foi repassada para outro técnico.`,
      tipo: 'info'
    });

    // Notifica quem recebeu
    await dispararNotificacao({
      usuario_id: Number(tecnico_destino_id),
      titulo: '💼 Termo de Cautela Recebido',
      mensagem: `O equipamento *${bem.descricao}* (Tombamento: ${bem.tombamento}) foi transferido diretamente para si.${observacoes ? `\n\n📝 Obs: ${observacoes}` : ''}`,
      tipo: 'sucesso',
      link_acao: '/lista-bens'
    });

    res.json({ message: 'Transferência direta realizada com sucesso!' });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao transferir equipamento.' });
  }
};


//  REGRA INVENTÁRIO #1: Buscando da nova tabela de Auditoria
export const getHistoricoBem = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const historico = await prisma.historicoPatrimonio.findMany({
      where: { bem_id: Number(id) },
      include: {
        usuario_acao: { select: { nome_completo: true } },
        tecnico_alvo: { select: { nome_completo: true } },
        unidade_origem: { select: { nome: true } },
        unidade_destino: { select: { nome: true } }
      },
      orderBy: { data_registro: 'desc' }
    });

    res.status(200).json(historico);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar o histórico oficial do equipamento.' });
  }
};



export const iniciarLevantamento = async (req: Request, res: Response) => {
  try {
    const aberto = await prisma.levantamentoPatrimonial.findFirst({
      where: { status: 'Aberto' }
    });

    if (aberto) {
      return res.status(400).json({ message: 'Já existe um levantamento em aberto. Finalize-o antes de iniciar outro.' });
    }

    const novoLevantamento = await prisma.levantamentoPatrimonial.create({
      data: { status: 'Aberto' }
    });

    res.status(201).json({ message: 'Levantamento iniciado com sucesso!', data: novoLevantamento });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao iniciar o levantamento.' });
  }
};



export const getLevantamentoAtual = async (req: Request, res: Response) => {
  const { unidade_id } = req.query;

  try {
    const levantamento = await prisma.levantamentoPatrimonial.findFirst({
      where: { status: 'Aberto' },
      include: { conferencias: true }
    });

    if (!levantamento) return res.json(null);

    // Sem unidade_id = todas as unidades (admin acompanhando o levantamento geral)
    const unidadeFiltro = unidade_id ? Number(unidade_id) : undefined;
    const bensDaUnidade = await prisma.bemPatrimonial.findMany({
      where: { ...(unidadeFiltro ? { unidade_id: unidadeFiltro } : {}), status_atual: 'Ativo' },
      include: {
        atribuicoes: { where: { data_devolucao: null }, include: { tecnico: true } }
      }
    });

    const conferidosIds = levantamento.conferencias.map(c => c.bem_id);
    
    const pendentes = bensDaUnidade.filter(b => !conferidosIds.includes(b.id));
    const conferidos = bensDaUnidade.filter(b => conferidosIds.includes(b.id));

    res.json({
      levantamento,
      resumo: {
        total: bensDaUnidade.length,
        conferidos_qtd: conferidos.length,
        pendentes_qtd: pendentes.length
      },
      pendentes,
      conferidos
    });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar dados do levantamento.' });
  }
};



export const biparItemLevantamento = async (req: Request, res: Response) => {
  const { tombamento, unidade_id } = req.body;

  try {
    const levantamento = await prisma.levantamentoPatrimonial.findFirst({ where: { status: 'Aberto' } });
    if (!levantamento) return res.status(400).json({ message: 'Nenhum levantamento em aberto.' });

    const bem = await prisma.bemPatrimonial.findUnique({ where: { tombamento } });
    if (!bem) return res.status(404).json({ message: 'Equipamento não encontrado no sistema.' });

    const jaConferido = await prisma.conferenciaLevantamento.findFirst({
      where: { levantamento_id: levantamento.id, bem_id: bem.id }
    });
    if (jaConferido) return res.status(400).json({ message: 'Este item já foi conferido!' });

    let statusConferencia = 'OK';
    let justificativa = '';
    
    if (bem.unidade_id !== Number(unidade_id)) {
      statusConferencia = 'Inconsistente';
      justificativa = 'Item bipado nesta unidade, mas o sistema indica que ele pertence a outra unidade.';
    }

    const conferencia = await prisma.conferenciaLevantamento.create({
      data: {
        levantamento_id: levantamento.id,
        bem_id: bem.id,
        status_conferido: statusConferencia,
        justificativa
      },
      include: { bem: true }
    });

    res.status(200).json({ message: 'Item conferido com sucesso!', data: conferencia });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao registrar conferência.' });
  }
};


export const finalizarLevantamento = async (req: Request, res: Response) => {
  try {
    const levantamento = await prisma.levantamentoPatrimonial.findFirst({ where: { status: 'Aberto' } });
    if (!levantamento) return res.status(400).json({ message: 'Nenhum levantamento em aberto para finalizar.' });

    await prisma.levantamentoPatrimonial.update({
      where: { id: levantamento.id },
      data: { status: 'Concluido', data_fim: new Date() }
    });

    res.status(200).json({ message: 'Levantamento finalizado e bloqueado com sucesso!' });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao finalizar levantamento.' });
  }
};



export const registrarConferencia = async (req: Request, res: Response) => {
    const { levantamento_id, bem_id, status_conferido, justificativa } = req.body;
    try {
        const conferencia = await prisma.conferenciaLevantamento.create({
            data: { levantamento_id, bem_id, status_conferido, justificativa }
        });
        res.status(201).json(conferencia);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao registrar conferência.' });
    }
};