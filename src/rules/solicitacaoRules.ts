// src/rules/solicitacaoRules.ts
// Regras de negócio da Ordem de Serviço (OS) e das peças. Lógica pura, sem banco:
// o controller só pergunta "pode?" e aplica o efeito no estoque que vier daqui.

export const OS = {
  PENDENTE: 'PENDENTE',
  APROVADA: 'APROVADA', // legado: tratado como PENDENTE
  EM_ATENDIMENTO: 'EM ATENDIMENTO',
  PRONTA_VISTORIA: 'PRONTA PARA VISTORIA',
  CONCLUIDA: 'CONCLUIDA',
  CANCELADA: 'CANCELADA',
} as const;

export const ITEM = {
  PENDENTE: 'Pendente', // "Pendente Almoxarifado"
  ENTREGUE: 'Entregue', // "Disponível para Retirada"
  RECEBIDA: 'Recebida pelo Técnico', // "Em posse do Técnico" (peça de consumo)
  AGUARDANDO_DEVOLUCAO: 'Aguardando Devolução', // peça de teste com o técnico
  DEVOLVIDA: 'Devolvida', // técnico devolveu com defeito
  DEVOLUCAO_ACEITE: 'Devolução Aceite', // almoxarifado recebeu de volta
  CANCELADO: 'Cancelado', // OS cancelada: peça voltou ao estoque
} as const;

export type Ator = 'gerente' | 'tecnico' | 'admin' | 'outro';
type TipoUso = 'TESTE' | 'CONSUMO' | string | null;

export const papelDoAtor = (role: string): Ator => {
  if (role === 'gerente') return 'gerente';
  if (role === 'admin') return 'admin';
  if (role.startsWith('tecnico')) return 'tecnico';
  return 'outro';
};

export const osEncerrada = (status: string) => status === OS.CONCLUIDA || status === OS.CANCELADA;

const OS_ABERTA = [OS.PENDENTE, OS.APROVADA, OS.EM_ATENDIMENTO, OS.PRONTA_VISTORIA];

// Transições de status da OS: [de, para]
const TRANSICOES_OS: Record<'gerente' | 'tecnico', Array<[string[], string]>> = {
  gerente: [
    [[OS.PENDENTE, OS.APROVADA], OS.EM_ATENDIMENTO],
    [[OS.PRONTA_VISTORIA], OS.CONCLUIDA],
    [OS_ABERTA, OS.CANCELADA],
  ],
  tecnico: [[[OS.EM_ATENDIMENTO], OS.PRONTA_VISTORIA]],
};

export const podeMudarStatusOS = (ator: Ator, de: string, para: string): boolean => {
  if (ator !== 'gerente' && ator !== 'tecnico') return false;
  return TRANSICOES_OS[ator].some(([origens, destino]) => destino === para && origens.includes(de));
};

/** Efeito no estoque da peça (tabela `itens`) quando a transição acontece. */
export type EfeitoEstoque = 'nenhum' | 'estoque+' | 'teste+' | 'defeito+';

export interface ResultadoTransicaoItem {
  /** Status que deve ser gravado (pode diferir do pedido, ex.: "Recebi" em TESTE). */
  statusFinal: string;
  efeito: EfeitoEstoque;
}

/**
 * Valida a transição de uma peça. Retorna null se não for permitida.
 * Peças de TESTE que já estavam como "Recebida pelo Técnico" (dados antigos)
 * são tratadas como "Aguardando Devolução".
 */
export const transicaoItem = (
  ator: Ator,
  tipoUso: TipoUso,
  de: string,
  pedido: string,
): ResultadoTransicaoItem | null => {
  const teste = tipoUso === 'TESTE';
  const deNormalizado = teste && de === ITEM.RECEBIDA ? ITEM.AGUARDANDO_DEVOLUCAO : de;

  if (ator === 'gerente') {
    if (deNormalizado === ITEM.PENDENTE && pedido === ITEM.ENTREGUE) return { statusFinal: pedido, efeito: 'nenhum' };
    if (deNormalizado === ITEM.ENTREGUE && pedido === ITEM.PENDENTE) return { statusFinal: pedido, efeito: 'nenhum' };
    if (pedido === ITEM.DEVOLUCAO_ACEITE) {
      // Peça de teste boa volta para a gaveta de testes.
      if (deNormalizado === ITEM.AGUARDANDO_DEVOLUCAO) return { statusFinal: pedido, efeito: 'teste+' };
      // Peça defeituosa: a de consumo já foi contada como defeito quando o técnico devolveu.
      if (deNormalizado === ITEM.DEVOLVIDA) return { statusFinal: pedido, efeito: teste ? 'defeito+' : 'nenhum' };
    }
    return null;
  }

  if (ator === 'tecnico') {
    // "Recebi": consumo fica em posse do técnico; teste já passa a aguardar devolução.
    if (deNormalizado === ITEM.ENTREGUE && (pedido === ITEM.RECEBIDA || pedido === ITEM.AGUARDANDO_DEVOLUCAO)) {
      return { statusFinal: teste ? ITEM.AGUARDANDO_DEVOLUCAO : ITEM.RECEBIDA, efeito: 'nenhum' };
    }
    // "Devolver (defeito)"
    const podeDevolverDe: string[] = [ITEM.ENTREGUE, ITEM.RECEBIDA, ITEM.AGUARDANDO_DEVOLUCAO];
    if (pedido === ITEM.DEVOLVIDA && podeDevolverDe.includes(deNormalizado)) {
      return { statusFinal: pedido, efeito: teste ? 'nenhum' : 'defeito+' };
    }
    return null;
  }

  return null;
};

/** "Funcionou (pedir definitiva)": só para peça de teste que está com o técnico. */
export const podeConverterTeste = (tipoUso: TipoUso, status: string) =>
  tipoUso === 'TESTE' && (status === ITEM.AGUARDANDO_DEVOLUCAO || status === ITEM.RECEBIDA);

/**
 * Cancelamento da OS: o que acontece com cada peça.
 * Retorna null quando a peça já saiu do fluxo (devolução aceite, já cancelada, status antigo)
 * e não deve ser tocada.
 */
export const efeitoCancelamento = (tipoUso: TipoUso, status: string): EfeitoEstoque | null => {
  const teste = tipoUso === 'TESTE';
  const voltaAoEstoque: string[] = [ITEM.PENDENTE, ITEM.ENTREGUE, ITEM.RECEBIDA, ITEM.AGUARDANDO_DEVOLUCAO];
  if (voltaAoEstoque.includes(status)) return teste ? 'teste+' : 'estoque+';
  // Peça com defeito: teste vai para defeito; a de consumo já foi contada quando o técnico devolveu.
  if (status === ITEM.DEVOLVIDA) return teste ? 'defeito+' : 'nenhum';
  return null;
};
