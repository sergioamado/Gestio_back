// src/relatorios/motor.ts
// Monta o relatório a partir das linhas de uma fonte:
//   - DETALHADO: uma linha por registro, com as colunas escolhidas;
//   - CRUZADO: agrupa por 1 a 3 campos nas linhas e, opcionalmente, cruza com um campo nas colunas.
import { z } from 'zod';
import type { Campo, Fonte, Linha, TipoCampo } from './fontes';

export const LIMITE_REGISTROS = 20000; // máximo lido do banco por relatório
export const LIMITE_LINHAS_DETALHADO = 5000; // máximo de linhas no relatório detalhado
export const LIMITE_COLUNAS_CRUZADAS = 40; // máximo de colunas geradas pelo cruzamento

const OPERADORES = ['igual', 'diferente', 'contem', 'nao_contem', 'maior', 'menor', 'vazio', 'nao_vazio'] as const;
const AGREGACOES = ['contagem', 'soma', 'media', 'minimo', 'maximo'] as const;

export const configSchema = z.object({
  fonte: z.string().min(1),
  tipo: z.enum(['detalhado', 'cruzado']),
  titulo: z.string().trim().max(150).optional(),
  periodo: z
    .object({
      inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
      fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
    })
    .optional(),
  unidade_id: z.number().int().nullable().optional(), // só o admin escolhe
  filtros: z
    .array(z.object({ campo: z.string(), operador: z.enum(OPERADORES), valor: z.string().optional() }))
    .max(20)
    .default([]),
  // detalhado
  colunas: z.array(z.string()).max(40).optional(),
  ordenacao: z.object({ campo: z.string(), direcao: z.enum(['asc', 'desc']) }).nullable().optional(),
  // cruzado
  linhas: z.array(z.string()).max(3).optional(),
  coluna: z.string().nullable().optional(),
  valores: z
    .array(z.object({ campo: z.string(), agregacao: z.enum(AGREGACOES) }))
    .max(10)
    .optional(),
});

export type ConfigRelatorio = z.infer<typeof configSchema>;

export interface ColunaSaida {
  key: string;
  label: string;
  tipo: TipoCampo;
}

export interface ResultadoMotor {
  colunas: ColunaSaida[];
  linhas: Linha[];
  totais: Linha | null;
  total_registros: number;
  avisos: string[];
}

export class ErroConfig extends Error {}

const ROTULO_OPERADOR: Record<(typeof OPERADORES)[number], string> = {
  igual: '=',
  diferente: '≠',
  contem: 'contém',
  nao_contem: 'não contém',
  maior: '>',
  menor: '<',
  vazio: 'está vazio',
  nao_vazio: 'não está vazio',
};
const ROTULO_AGREGACAO: Record<(typeof AGREGACOES)[number], string> = {
  contagem: 'Quantidade',
  soma: 'Soma',
  media: 'Média',
  minimo: 'Mínimo',
  maximo: 'Máximo',
};

const ehNumerico = (t: TipoCampo) => t === 'numero' || t === 'moeda';
/** Pode ser somado / tirado média (exclui números de identificação). */
const ehAgregavel = (c: Campo) => ehNumerico(c.tipo) && c.agregavel !== false;
const vazio = (v: unknown) => v === null || v === undefined || v === '';
const normalizar = (v: unknown) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

const campoOuErro = (fonte: Fonte, key: string): Campo => {
  const c = fonte.campos.find((x) => x.key === key);
  if (!c) throw new ErroConfig(`Campo "${key}" não existe na fonte "${fonte.nome}".`);
  return c;
};

// ---------- filtros ----------
const comparar = (campo: Campo, v: unknown, alvo: string): number => {
  if (ehNumerico(campo.tipo)) return Number(v) - Number(alvo.replace(',', '.'));
  if (campo.tipo === 'data') return String(v ?? '').slice(0, 10).localeCompare(alvo);
  return normalizar(v).localeCompare(normalizar(alvo));
};

const valorBooleano = (alvo: string) => ['sim', 'true', '1', 's'].includes(normalizar(alvo));

const passaFiltro = (campo: Campo, operador: (typeof OPERADORES)[number], valor: string | undefined, linha: Linha) => {
  const v = linha[campo.key];
  if (operador === 'vazio') return vazio(v);
  if (operador === 'nao_vazio') return !vazio(v);
  const alvo = valor ?? '';
  if (campo.tipo === 'booleano') {
    const igual = !!v === valorBooleano(alvo);
    return operador === 'diferente' ? !igual : igual;
  }
  switch (operador) {
    case 'igual':
      return !vazio(v) && comparar(campo, v, alvo) === 0;
    case 'diferente':
      return vazio(v) || comparar(campo, v, alvo) !== 0;
    case 'contem':
      return normalizar(v).includes(normalizar(alvo));
    case 'nao_contem':
      return !normalizar(v).includes(normalizar(alvo));
    case 'maior':
      return !vazio(v) && comparar(campo, v, alvo) > 0;
    case 'menor':
      return !vazio(v) && comparar(campo, v, alvo) < 0;
  }
};

export const descreverFiltros = (fonte: Fonte, cfg: ConfigRelatorio): string[] =>
  cfg.filtros.map((f) => {
    const c = fonte.campos.find((x) => x.key === f.campo);
    const sufixo = f.operador === 'vazio' || f.operador === 'nao_vazio' ? '' : ` "${f.valor ?? ''}"`;
    return `${c?.label ?? f.campo} ${ROTULO_OPERADOR[f.operador]}${sufixo}`;
  });

// ---------- ordenação ----------
const ordenar = (linhas: Linha[], key: string, tipo: TipoCampo, direcao: 'asc' | 'desc') => {
  const fator = direcao === 'asc' ? 1 : -1;
  return [...linhas].sort((a, b) => {
    const va = a[key];
    const vb = b[key];
    if (vazio(va) && vazio(vb)) return 0;
    if (vazio(va)) return 1; // vazios sempre no fim
    if (vazio(vb)) return -1;
    if (ehNumerico(tipo)) return (Number(va) - Number(vb)) * fator;
    return String(va).localeCompare(String(vb), 'pt-BR', { numeric: true }) * fator;
  });
};

// ---------- agregação ----------
const agregar = (linhas: Linha[], campo: string, agregacao: (typeof AGREGACOES)[number]): number | null => {
  if (agregacao === 'contagem') return campo === '*' ? linhas.length : linhas.filter((l) => !vazio(l[campo])).length;
  const nums = linhas.map((l) => l[campo]).filter((v) => !vazio(v)).map(Number).filter((n) => !Number.isNaN(n));
  if (!nums.length) return null;
  switch (agregacao) {
    case 'soma':
      return nums.reduce((a, b) => a + b, 0);
    case 'media':
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    case 'minimo':
      return Math.min(...nums);
    case 'maximo':
      return Math.max(...nums);
  }
};

const chaveGrupo = (v: unknown) => (vazio(v) ? '(vazio)' : String(v));

/** Rótulo legível de um valor usado como cabeçalho de coluna no cruzamento. */
const rotuloValor = (tipo: TipoCampo, v: string) => {
  if (v === '(vazio)') return v;
  if (tipo === 'mes') {
    const [a, m] = v.split('-');
    return `${m}/${a}`;
  }
  if (tipo === 'booleano') return v === 'true' ? 'Sim' : 'Não';
  if (tipo === 'data') return v.slice(0, 10).split('-').reverse().join('/');
  return v;
};

// ---------- principal ----------
export const executar = (fonte: Fonte, cfg: ConfigRelatorio, dados: Linha[]): ResultadoMotor => {
  const avisos: string[] = [];
  if (dados.length >= LIMITE_REGISTROS) {
    avisos.push(`A consulta atingiu o limite de ${LIMITE_REGISTROS.toLocaleString('pt-BR')} registros. Use filtros ou um período menor.`);
  }

  // Filtros
  const filtros = cfg.filtros.map((f) => ({ ...f, c: campoOuErro(fonte, f.campo) }));
  const filtradas = dados.filter((l) => filtros.every((f) => passaFiltro(f.c, f.operador, f.valor, l)));

  if (cfg.tipo === 'detalhado') {
    const keys = cfg.colunas?.length ? cfg.colunas : fonte.campos.map((c) => c.key);
    const camposEscolhidos = keys.map((k) => campoOuErro(fonte, k));
    const colunas = camposEscolhidos.map(({ key, label, tipo }) => ({ key, label, tipo }));

    let linhas = filtradas;
    if (cfg.ordenacao) {
      const c = campoOuErro(fonte, cfg.ordenacao.campo);
      linhas = ordenar(linhas, c.key, c.tipo, cfg.ordenacao.direcao);
    }
    if (linhas.length > LIMITE_LINHAS_DETALHADO) {
      avisos.push(
        `Mostrando as primeiras ${LIMITE_LINHAS_DETALHADO.toLocaleString('pt-BR')} de ${linhas.length.toLocaleString('pt-BR')} linhas. Use filtros ou o relatório cruzado.`,
      );
    }
    const totais: Linha = {};
    let temTotal = false;
    for (const c of camposEscolhidos) {
      if (ehAgregavel(c)) {
        totais[c.key] = agregar(linhas, c.key, 'soma');
        temTotal = true;
      }
    }
    return {
      colunas,
      linhas: linhas.slice(0, LIMITE_LINHAS_DETALHADO).map((l) => Object.fromEntries(keys.map((k) => [k, l[k] ?? null]))),
      totais: temTotal ? totais : null,
      total_registros: filtradas.length,
      avisos,
    };
  }

  // ----- CRUZADO -----
  const dims = (cfg.linhas ?? []).map((k) => campoOuErro(fonte, k));
  if (!dims.length) throw new ErroConfig('Escolha pelo menos um campo para as linhas do relatório cruzado.');
  const valores = cfg.valores?.length ? cfg.valores : [{ campo: '*', agregacao: 'contagem' as const }];
  const metricas = valores.map((v) => {
    if (v.campo === '*') {
      if (v.agregacao !== 'contagem') throw new ErroConfig('"Todos os registros" só pode ser contado.');
      return { ...v, label: 'Quantidade de Registros', tipo: 'numero' as TipoCampo };
    }
    const c = campoOuErro(fonte, v.campo);
    if (v.agregacao !== 'contagem' && !ehAgregavel(c)) {
      throw new ErroConfig(`"${c.label}" não é um valor somável: só é possível contar.`);
    }
    return {
      ...v,
      label: `${ROTULO_AGREGACAO[v.agregacao]} de ${c.label}`,
      tipo: (v.agregacao === 'contagem' ? 'numero' : c.tipo) as TipoCampo,
    };
  });
  const colDim = cfg.coluna ? campoOuErro(fonte, cfg.coluna) : null;
  if (colDim && metricas.length > 1) {
    avisos.push('Com campo nas colunas, apenas o primeiro valor é usado.');
  }

  // Agrupa
  const grupos = new Map<string, { chave: Linha; linhas: Linha[] }>();
  for (const l of filtradas) {
    const partes = dims.map((d) => chaveGrupo(l[d.key]));
    const id = partes.join('\u0000');
    let g = grupos.get(id);
    if (!g) {
      g = { chave: Object.fromEntries(dims.map((d, i) => [d.key, partes[i]])), linhas: [] };
      grupos.set(id, g);
    }
    g.linhas.push(l);
  }

  const colunas: ColunaSaida[] = dims.map(({ key, label, tipo }) => ({ key, label, tipo }));
  let saida: Linha[];
  let totais: Linha;

  if (colDim) {
    const m = metricas[0];
    let valoresColuna = Array.from(new Set(filtradas.map((l) => chaveGrupo(l[colDim.key]))));
    valoresColuna = ordenar(
      valoresColuna.map((v) => ({ v })),
      'v',
      colDim.tipo,
      'asc',
    ).map((x) => String(x.v));
    if (valoresColuna.length > LIMITE_COLUNAS_CRUZADAS) {
      avisos.push(
        `"${colDim.label}" tem ${valoresColuna.length} valores; mostrando os ${LIMITE_COLUNAS_CRUZADAS} primeiros como colunas.`,
      );
      valoresColuna = valoresColuna.slice(0, LIMITE_COLUNAS_CRUZADAS);
    }
    valoresColuna.forEach((v, i) => colunas.push({ key: `c${i}`, label: rotuloValor(colDim.tipo, v), tipo: m.tipo }));
    colunas.push({ key: 'total', label: `Total (${m.label})`, tipo: m.tipo });

    saida = Array.from(grupos.values()).map((g) => {
      const linha: Linha = { ...g.chave };
      valoresColuna.forEach((v, i) => {
        linha[`c${i}`] = agregar(g.linhas.filter((l) => chaveGrupo(l[colDim.key]) === v), m.campo, m.agregacao);
      });
      linha.total = agregar(g.linhas, m.campo, m.agregacao);
      return linha;
    });
    totais = {};
    valoresColuna.forEach((v, i) => {
      totais[`c${i}`] = agregar(filtradas.filter((l) => chaveGrupo(l[colDim.key]) === v), m.campo, m.agregacao);
    });
    totais.total = agregar(filtradas, m.campo, m.agregacao);
  } else {
    metricas.forEach((m, i) => colunas.push({ key: `v${i}`, label: m.label, tipo: m.tipo }));
    saida = Array.from(grupos.values()).map((g) => {
      const linha: Linha = { ...g.chave };
      metricas.forEach((m, i) => (linha[`v${i}`] = agregar(g.linhas, m.campo, m.agregacao)));
      return linha;
    });
    totais = {};
    metricas.forEach((m, i) => (totais[`v${i}`] = agregar(filtradas, m.campo, m.agregacao)));
  }

  // Ordenação: pela coluna escolhida (dimensão ou valor) ou, por padrão, pelas dimensões.
  if (cfg.ordenacao && colunas.some((c) => c.key === cfg.ordenacao!.campo)) {
    const c = colunas.find((x) => x.key === cfg.ordenacao!.campo)!;
    saida = ordenar(saida, c.key, c.tipo, cfg.ordenacao.direcao);
  } else {
    for (const d of [...dims].reverse()) saida = ordenar(saida, d.key, d.tipo, 'asc');
  }

  return { colunas, linhas: saida, totais, total_registros: filtradas.length, avisos };
};
