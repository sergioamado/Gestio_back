// src/controllers/patrimonioController.ts
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import { z } from 'zod';
const pdfParse = require('pdf-parse');

const prisma = new PrismaClient();

// Schema para transferência de bens
const transferenciaSchema = z.object({
  bem_ids: z.array(z.number().int()),
  origem_unidade_id: z.number().int(),
  destino_unidade_id: z.number().int(),
  observacao: z.string().optional(),
});

// Listar Bens com filtros (Localização, Descrição, Tombamento, Marca)
export const getAllBens = async (req: Request, res: Response) => {
  try {
    const { search, unidade_id, status_atual, page = 1, limit = 10 } = req.query;
    const where: any = {};

    if (search) {
      where.OR = [
        { descricao: { contains: String(search), mode: 'insensitive' } },
        { tombamento: { contains: String(search) } },
        { numero_serie: { contains: String(search) } } 
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
          // A MÁGICA: Puxa quem está com o equipamento agora (onde devolução é nula)
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
      // Se houver uma atribuição ativa, envia o nome do técnico
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
    console.error("Erro em getAllBens:", error);
    res.status(500).json({ message: 'Erro ao buscar bens patrimoniais.' });
  }
};

// Lógica de Movimentação (Transferência entre Unidades)
export const transferirBens = async (req: Request, res: Response) => {
  try {
    const { bem_ids, origem_unidade_id, destino_unidade_id, observacao } = transferenciaSchema.parse(req.body);

    const resultado = await prisma.$transaction(async (tx) => {
      const movimentacoes = await Promise.all(
        bem_ids.map(bem_id => 
          tx.movimentacaoBem.create({
            data: {
              bem_id,
              origem_unidade_id,
              destino_unidade_id,
              tipo: 'TRANSFERENCIA', 
              subtipo: observacao,  
              data_envio: new Date(),
            }
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

export const importarDadosSipac = async (req: Request, res: Response) => {
  // 1. Verifica se o middleware Multer deixou o ficheiro passar
  if (!req.file) {
    return res.status(400).json({ message: 'O servidor recusou o ficheiro. Verifique se é um PDF válido.' });
  }

  try {
    // 2. Tenta descobrir a unidade, se não achar, pega a primeira unidade cadastrada no sistema
    let unidadeIdImportacao = req.body.unidade_id ? Number(req.body.unidade_id) : null; 
    if (!unidadeIdImportacao) {
        const fallbackUnidade = await prisma.unidades_organizacionais.findFirst();
        if (!fallbackUnidade) {
            fs.unlinkSync(req.file.path); // Limpa o arquivo
            return res.status(400).json({ message: 'Nenhuma Unidade cadastrada no sistema. Cadastre um Setor antes de importar.' });
        }
        unidadeIdImportacao = fallbackUnidade.id;
    }

    const filePath = req.file.path;
    const dataBuffer = fs.readFileSync(filePath);
    const pdfData = await pdfParse(dataBuffer);

    // 3. Limpeza agressiva: transforma tudo numa linha contínua e remove espaços duplos
    let textoLimpo = pdfData.text.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();

    let novos = 0;
    let atualizados = 0;
    let erros = 0;

    // 4. A NOVA REGEX: Encontra qualquer bloco de 9 a 12 números juntos (Ignorando se tem texto colado neles)
    const regexTombamento = /([0-9]{9,12})/g;
    const partes = textoLimpo.split(regexTombamento);

    if (partes.length < 3) {
        fs.unlinkSync(filePath);
        return res.status(400).json({ 
            message: 'Nenhum tombamento de 10 dígitos foi encontrado no PDF. O ficheiro está vazio ou num formato diferente.' 
        });
    }

    // 5. Itera sobre os pedaços separados.
    for (let i = 1; i < partes.length; i += 2) {
      const tombamento = partes[i];
      let descricao = "";

      const textoAnterior = partes[i - 1]?.trim() || "";
      const textoProximo = partes[i + 1]?.trim() || "";

      // Filtro para apagar o "lixo" do cabeçalho e rodapé do SIPAC
      const limparLixo = (txt: string) => {
          return txt
            .replace(/UFS SIPAC.*?Contratos/gi, '')
            .replace(/JOAO NYLSON.*?LEVAN.*?(ANUAL|PATRIMONIAL)/gi, '')
            .replace(/Tombamento\s+Descrição\s+Marca/gi, '')
            .replace(/BENS NÃO INFORMADOS NO LEVANTAMENTO.*?Marca/gi, '')
            .replace(/Emitido em.*?Página \d+\/\d+/gi, '')
            .replace(/SIPAC Telafonts.*?dba1244/gi, '') // Lixo do rodapé
            .trim();
      };

      const anteriorLimpo = limparLixo(textoAnterior);
      const proximoLimpo = limparLixo(textoProximo);

      // Descobre se a descrição ficou presa antes ou depois do número
      if (proximoLimpo.length > anteriorLimpo.length) {
          descricao = proximoLimpo;
          partes[i + 1] = ""; // Apaga o texto usado para não misturar com o próximo equipamento
      } else {
          descricao = anteriorLimpo;
      }

      // Corta em 200 caracteres para garantir que não estoura o limite do Banco de Dados
      descricao = descricao.substring(0, 200).trim();
      if (!descricao) descricao = "Descrição não identificada";

      try {
        const bemExistente = await prisma.bemPatrimonial.findUnique({
          where: { tombamento }
        });

        if (bemExistente) {
          await prisma.bemPatrimonial.update({
            where: { tombamento },
            data: { descricao }
          });
          atualizados++;
        } else {
          await prisma.bemPatrimonial.create({
            data: {
              tombamento,
              descricao,
              localizacao_fisica: 'Importado do SIPAC',
              status_atual: 'Ativo',
              unidade_id: unidadeIdImportacao
            }
          });
          novos++;
        }
      } catch (err) {
        console.error(`Erro ao importar o tombamento ${tombamento}:`, err);
        erros++;
      }
    }

    fs.unlinkSync(filePath); // Limpa o ficheiro PDF da pasta do servidor

    res.status(200).json({ 
      message: 'Importação concluída com sucesso!',
      detalhes: {
        total_bens_encontrados: (partes.length - 1) / 2,
        novos_registos: novos,
        atualizados: atualizados,
        erros: erros
      }
    });

  } catch (error) {
    console.error("Erro fatal na extração do PDF:", error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ message: 'Erro interno ao tentar ler o PDF do SIPAC.' });
  }
};

// Gerar Lista de Bens Encontrados (Levantamento Patrimonial)
export const registrarConferencia = async (req: Request, res: Response) => {
    const { levantamento_id, bem_id, status_conferido, justificativa } = req.body;
    
    try {
        const conferencia = await prisma.conferenciaLevantamento.create({
            data: {
                levantamento_id,
                bem_id,
                status_conferido, 
                justificativa,    
            }
        });
        res.status(201).json(conferencia);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao registrar conferência.' });
    }
};

// Upload de Foto
export const uploadFoto = async (req: Request, res: Response) => {
  const { id } = req.params;
  
  if (!req.file) {
    return res.status(400).json({ message: 'Nenhum ficheiro enviado.' });
  }

  const caminhoRelativo = req.file.path.replace(/\\/g, '/'); 

  try {
    await prisma.bemPatrimonial.update({
      where: { id: Number(id) },
      data: { foto_url: caminhoRelativo }
    });
    res.json({ message: 'Foto atualizada!', url: caminhoRelativo });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao guardar caminho da foto.' });
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
      data: {
        bem_id: Number(bem_id),
        tecnico_id: Number(tecnico_id),
        observacoes
      }
    });

    res.status(201).json({ message: "Bem atribuído ao técnico com sucesso!", data: novaAtribuicao });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erro ao registrar a atribuição do bem." });
  }
};

export const devolverBem = async (req: Request, res: Response) => {
  const { bem_id } = req.body;

  try {
    // Dá "baixa" na devolução marcando a data e hora atuais
    await prisma.atribuicaoTecnico.updateMany({
      where: { bem_id: Number(bem_id), data_devolucao: null },
      data: { data_devolucao: new Date() }
    });

    res.status(200).json({ message: "Equipamento devolvido ao inventário geral." });
  } catch (error) {
    res.status(500).json({ message: "Erro ao registrar a devolução." });
  }
};