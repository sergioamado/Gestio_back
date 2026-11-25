// src/realtime/avisarMudancas.ts
// Atualização automática das telas.
//
// Depois de QUALQUER alteração bem-sucedida na API (POST/PUT/PATCH/DELETE com status < 400),
// o servidor avisa todos os navegadores conectados quais "canais" (áreas do sistema) mudaram,
// pelo evento único `dados_atualizados` { canais: string[] }.
// Cada tela do front escuta os canais que mostra e recarrega sozinha (hook useTempoReal).
//
// Ficar aqui, e não em cada controller, garante que nenhuma rota nova seja esquecida:
// basta a rota estar no mapa abaixo.
//
// O aviso não leva dados, só o nome da área; cada tela busca de novo pela API,
// que continua aplicando as regras de perfil e unidade.
import type { Request, Response, NextFunction } from 'express';
import { getIO } from '../socket';

export const EVENTO_DADOS_ATUALIZADOS = 'dados_atualizados';

export type Canal =
  | 'os'
  | 'estoque'
  | 'impressoras'
  | 'atendimentos'
  | 'suprimentos'
  | 'manutencao'
  | 'patrimonio'
  | 'levantamento'
  | 'servicos'
  | 'producao'
  | 'relatorios_analiticos'
  | 'relatorio_modelos'
  | 'analises'
  | 'usuarios'
  | 'unidades';

// Rotas que usam POST mas só consultam: não geram aviso.
const SO_CONSULTA = [/^\/api\/auth\//, /^\/api\/relatorios\/personalizado\/gerar/, /^\/api\/analise\/query/];

// Prefixo da rota → canais afetados. A primeira regra que casar vale.
const REGRAS: Array<[RegExp, Canal[]]> = [
  // OS mexe no estoque de peças (reserva, devolução, cancelamento) e na produção vinculada.
  [/^\/api\/solicitacoes/, ['os', 'estoque']],
  [/^\/api\/itens/, ['estoque', 'os']],
  [/^\/api\/gestao-impressoras\/impressoras/, ['impressoras']],
  [/^\/api\/gestao-impressoras\/atendimentos/, ['atendimentos', 'impressoras']],
  [/^\/api\/gestao-impressoras\/(estoque|suprimentos)/, ['suprimentos']],
  [/^\/api\/manutencao-eletronica/, ['manutencao']],
  [/^\/api\/patrimonio\/levantamento/, ['levantamento', 'patrimonio']],
  [/^\/api\/patrimonio/, ['patrimonio']],
  [/^\/api\/servicos/, ['servicos']],
  [/^\/api\/producao/, ['producao']],
  [/^\/api\/relatorios-analiticos/, ['relatorios_analiticos']],
  [/^\/api\/relatorios\/personalizado\/modelos/, ['relatorio_modelos']],
  [/^\/api\/analise\/dashboards/, ['analises']],
  [/^\/api\/usuarios/, ['usuarios']],
  [/^\/api\/unidades/, ['unidades']],
];

const METODOS_DE_ALTERACAO = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const canaisDaRota = (metodo: string, url: string): Canal[] => {
  if (!METODOS_DE_ALTERACAO.has(metodo.toUpperCase())) return [];
  const caminho = url.split('?')[0];
  if (SO_CONSULTA.some((r) => r.test(caminho))) return [];
  const regra = REGRAS.find(([r]) => r.test(caminho));
  return regra ? regra[1] : [];
};

/** Avisa manualmente (para mudanças feitas fora de uma requisição, ex.: bot do Telegram). */
export const avisarMudanca = (...canais: Canal[]) => {
  if (!canais.length) return;
  try {
    getIO().emit(EVENTO_DADOS_ATUALIZADOS, { canais });
  } catch {
    /* socket ainda não iniciado: nada a avisar */
  }
};

/** Middleware: registra o aviso para quando a resposta terminar com sucesso. */
export const avisarMudancas = (req: Request, res: Response, next: NextFunction) => {
  const canais = canaisDaRota(req.method, req.originalUrl);
  if (canais.length) {
    res.on('finish', () => {
      if (res.statusCode < 400) avisarMudanca(...canais);
    });
  }
  next();
};
