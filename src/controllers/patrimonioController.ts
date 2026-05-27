// src/controllers/patrimonioController.ts
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import { z } from 'zod';
const xlsx = require('xlsx');
const pdfParse = require('pdf-parse');

const prisma = new PrismaClient();

// Schemas de Validação (Zod)
const transferenciaSchema = z.object({
  bem_ids: z.array(z.number().int()),
  origem_unidade_id: z.number().int(),
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

// Criar um Bem Manualmente
export const createBem = async (req: Request, res: Response) => {
  try {
    const data = bemPatrimonialSchema.parse(req.body);
    
    // Verifica se já existe um bem com esse tombamento
    const existente = await prisma.bemPatrimonial.findUnique({
      where: { tombamento: data.tombamento }
    });

    if (existente) {
      return res.status(400).json({ message: 'Já existe um equipamento com este número de tombamento.' });
    }

    const novoBem = await prisma.bemPatrimonial.create({ data });
    res.status(201).json({ message: 'Bem registado com sucesso!', data: novoBem });
  } catch (error) {
    res.status(400).json({ message: 'Dados inválidos.', details: error });
  }
};

// Atualizar um Bem Manualmente
export const updateBem = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const data = bemPatrimonialSchema.parse(req.body);
    const updatedBem = await prisma.bemPatrimonial.update({
      where: { id: Number(id) },
      data
    });
    res.json({ message: 'Bem atualizado com sucesso!', data: updatedBem });
  } catch (error) {
    res.status(400).json({ message: 'Erro ao atualizar. Verifique os dados.', details: error });
  }
};

// Deletar um Bem (Caso tenha sido importado errado)
export const deleteBem = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await prisma.bemPatrimonial.delete({
      where: { id: Number(id) },
    });
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ message: 'Erro ao deletar bem. Pode estar em uso num termo de cautela ou movimentação.' });
  }
};

// Importação Massiva via PDF (SIPAC)
export const importarDadosSipac = async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ message: 'O servidor recusou o ficheiro. Verifique se é um PDF ou CSV válido.' });
  }

  const unidadeIdImportacao = req.body.unidade_id ? Number(req.body.unidade_id) : null; 
  if (!unidadeIdImportacao) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); 
      return res.status(400).json({ message: 'Para importar os dados, é obrigatório informar a Unidade de destino.' });
  }

  const filePath = req.file.path;
  const isPDF = filePath.toLowerCase().endsWith('.pdf');

  try {
    let novos = 0;
    let atualizados = 0;
    let erros = 0;
    let totalEncontrados = 0;

    //  PROCESSAMENTO DE PDF
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
            await prisma.bemPatrimonial.update({ where: { tombamento }, data: { descricao, unidade_id: unidadeIdImportacao } });
            atualizados++;
          } else {
            await prisma.bemPatrimonial.create({
              data: { tombamento, descricao, localizacao_fisica: 'Importado do SIPAC (PDF)', status_atual: 'Ativo', unidade_id: unidadeIdImportacao }
            });
            novos++;
          }
        } catch (err) { erros++; }
      }
    } 
    //  PROCESSAMENTO DE CSV / EXCEL
    else {
      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rawData = xlsx.utils.sheet_to_json(sheet, { defval: "" });

      if (rawData.length === 0) throw new Error("A planilha está vazia.");

      for (const row of rawData as any[]) {
        // Tenta achar as colunas independentemente de como o SIPAC exporta o cabeçalho
        const tombamento = (row['Tombamento'] || row['tombamento'] || row['TOMBAMENTO'] || row['codigo'] || '')?.toString().trim();
        let descricao = (row['Denominação'] || row['Descrição'] || row['descricao'] || row['DESCRICAO'] || row['nome'] || '')?.toString().trim();

        if (!tombamento || tombamento.length < 5) continue; // Ignora linhas em branco
        
        descricao = descricao.substring(0, 200) || "Descrição não identificada";
        totalEncontrados++;

        try {
          const bemExistente = await prisma.bemPatrimonial.findUnique({ where: { tombamento } });
          if (bemExistente) {
            await prisma.bemPatrimonial.update({ where: { tombamento }, data: { descricao, unidade_id: unidadeIdImportacao } });
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

    // Limpa o arquivo nos dois casos
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath); 

    if (novos === 0 && atualizados === 0 && erros === 0) {
       return res.status(400).json({ message: 'Nenhum equipamento foi processado. O arquivo pode estar vazio ou as colunas (Tombamento/Descrição) não foram identificadas.' });
    }

    res.status(200).json({ 
      message: 'Sincronização concluída com sucesso!',
      detalhes: {
        total_bens_encontrados: totalEncontrados,
        novos_registos: novos,
        atualizados: atualizados,
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
    const { search, unidade_id, status_atual, page = 1, limit = 10 } = req.query;
    const where: any = {};

    if (search) {
      where.OR = [
        { descricao: { contains: String(search), mode: 'insensitive' } },
        { tombamento: { contains: String(search) } }
      ];
    }
    if (unidade_id) where.unidade_id = Number(unidade_id);
    if (status_atual) where.status_atual = String(status_atual);

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
    res.status(500).json({ message: 'Erro ao buscar bens patrimoniais.' });
  }
};

export const transferirBens = async (req: Request, res: Response) => {
  try {
    const { bem_ids, origem_unidade_id, destino_unidade_id, observacao } = transferenciaSchema.parse(req.body);
    const resultado = await prisma.$transaction(async (tx) => {
      const movimentacoes = await Promise.all(
        bem_ids.map(bem_id => 
          tx.movimentacaoBem.create({
            data: { bem_id, origem_unidade_id, destino_unidade_id, tipo: 'TRANSFERENCIA', subtipo: observacao, data_envio: new Date() }
          })
        )
      );
      await tx.bemPatrimonial.updateMany({
        where: { id: { in: bem_ids } },
        data: { unidade_id: destino_unidade_id }
      });
      return movimentacoes;
    });
    res.status(201).json({ message: 'Movimentação registrada com sucesso.', resultado });
  } catch (error: any) {
    res.status(400).json({ message: error.message || 'Erro ao processar transferência.' });
  }
};

export const uploadFoto = async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!req.file) return res.status(400).json({ message: 'Nenhum arquivo enviado.' });
  const caminhoRelativo = req.file.path.replace(/\\/g, '/'); 
  try {
    await prisma.bemPatrimonial.update({ where: { id: Number(id) }, data: { foto_url: caminhoRelativo } });
    res.json({ message: 'Foto atualizada!', url: caminhoRelativo });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao guardar caminho da foto.' });
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

export const atribuirBem = async (req: Request, res: Response) => {
  const { bem_id, tecnico_id, observacoes } = req.body;
  try {
    await prisma.atribuicaoTecnico.updateMany({
      where: { bem_id: Number(bem_id), data_devolucao: null },
      data: { data_devolucao: new Date() }
    });
    const novaAtribuicao = await prisma.atribuicaoTecnico.create({
      data: { bem_id: Number(bem_id), tecnico_id: Number(tecnico_id), observacoes }
    });
    res.status(201).json({ message: "Bem atribuído com sucesso!", data: novaAtribuicao });
  } catch (error) {
    res.status(500).json({ message: "Erro ao registrar a atribuição do bem." });
  }
};

export const devolverBem = async (req: Request, res: Response) => {
  const { bem_id } = req.body;
  try {
    await prisma.atribuicaoTecnico.updateMany({
      where: { bem_id: Number(bem_id), data_devolucao: null },
      data: { data_devolucao: new Date() }
    });
    res.status(200).json({ message: "Equipamento devolvido ao inventário geral." });
  } catch (error) {
    res.status(500).json({ message: "Erro ao registrar a devolução." });
  }
};

export const getHistoricoBem = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const movimentacoes = await prisma.movimentacaoBem.findMany({
      where: { bem_id: Number(id) },
      include: {
        unidade_origem: { select: { nome: true } },
        unidade_destino: { select: { nome: true } }
      },
      orderBy: { data_envio: 'desc' }
    });

    res.status(200).json(movimentacoes);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar o histórico de movimentações.' });
  }
};

export const iniciarLevantamento = async (req: Request, res: Response) => {
  try {
    // Verifica se já existe um levantamento em aberto
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

    // Busca todos os bens que deveriam estar nesta unidade
    const bensDaUnidade = await prisma.bemPatrimonial.findMany({
      where: { unidade_id: Number(unidade_id), status_atual: 'Ativo' },
      include: {
        atribuicoes: { where: { data_devolucao: null }, include: { tecnico: true } }
      }
    });

    // Filtra quais já foram conferidos neste levantamento
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

    // Procura o bem no banco pelo tombamento digitado/bipado
    const bem = await prisma.bemPatrimonial.findUnique({ where: { tombamento } });
    if (!bem) return res.status(404).json({ message: 'Equipamento não encontrado no sistema.' });

    // Verifica se o bem já foi bipado neste levantamento
    const jaConferido = await prisma.conferenciaLevantamento.findFirst({
      where: { levantamento_id: levantamento.id, bem_id: bem.id }
    });
    if (jaConferido) return res.status(400).json({ message: 'Este item já foi conferido!' });

    // Verifica se o bem pertence a outra unidade (Alerta de Inconsistência)
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