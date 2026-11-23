// src/security/loginThrottle.ts
// Bloqueio progressivo de login, por nome de usuário:
//   a cada 3 senhas erradas seguidas, o login fica bloqueado;
//   1º bloqueio = 10 s, depois 20 s, 40 s, 80 s... dobrando até o máximo de 24 h.
// Login com sucesso zera o contador. Sem nenhuma falha por 24 h, o histórico é esquecido.
//
// Observação: o estado fica em memória. Reiniciar o servidor zera os bloqueios, e com
// mais de uma instância do backend cada uma teria o seu contador.

const TENTATIVAS_POR_RODADA = 3;
const BLOQUEIO_INICIAL_MS = 10_000;
const BLOQUEIO_MAXIMO_MS = 24 * 60 * 60 * 1000;
const ESQUECER_APOS_MS = 24 * 60 * 60 * 1000;

interface Registro {
  falhas: number; // falhas na rodada atual (0..2)
  bloqueios: number; // quantos bloqueios já aconteceram
  bloqueadoAte: number; // timestamp (ms); 0 = livre
  ultimaFalha: number;
}

const registros = new Map<string, Registro>();

const chave = (username: string) => username.trim().toLowerCase();

const duracaoBloqueio = (numeroDoBloqueio: number) =>
  Math.min(BLOQUEIO_INICIAL_MS * 2 ** (numeroDoBloqueio - 1), BLOQUEIO_MAXIMO_MS);

export const formatarEspera = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s} segundo${s === 1 ? '' : 's'}`;
  const m = Math.ceil(s / 60);
  if (m < 60) return `${m} minuto${m === 1 ? '' : 's'}`;
  const h = Math.ceil(m / 60);
  return `${h} hora${h === 1 ? '' : 's'}`;
};

/** Retorna quantos ms faltam de bloqueio (0 se pode tentar). */
export const tempoBloqueado = (username: string, agora = Date.now()): number => {
  const r = registros.get(chave(username));
  if (!r) return 0;
  return Math.max(0, r.bloqueadoAte - agora);
};

/** Registra uma senha errada. Retorna a duração do bloqueio iniciado agora (0 se nenhum). */
export const registrarFalha = (username: string, agora = Date.now()): number => {
  const k = chave(username);
  let r = registros.get(k);
  if (!r || agora - r.ultimaFalha > ESQUECER_APOS_MS) {
    r = { falhas: 0, bloqueios: 0, bloqueadoAte: 0, ultimaFalha: agora };
    registros.set(k, r);
  }
  r.ultimaFalha = agora;
  r.falhas++;
  if (r.falhas >= TENTATIVAS_POR_RODADA) {
    r.falhas = 0;
    r.bloqueios++;
    const duracao = duracaoBloqueio(r.bloqueios);
    r.bloqueadoAte = agora + duracao;
    return duracao;
  }
  return 0;
};

export const registrarSucesso = (username: string) => {
  registros.delete(chave(username));
};

// Limpeza periódica para o mapa não crescer sem limite (ex.: tentativas com nomes aleatórios).
setInterval(() => {
  const agora = Date.now();
  for (const [k, r] of registros) {
    if (r.bloqueadoAte < agora && agora - r.ultimaFalha > ESQUECER_APOS_MS) registros.delete(k);
  }
}, 60 * 60 * 1000).unref();
