# COSUP+ · Back-end (Gestio_back)

API REST do COSUP+: Node.js, Express 5, Prisma 6 (PostgreSQL), Socket.IO e o bot do Telegram (@CosupBot).

A documentação completa do sistema fica no repositório do front (`Gestio_front`):

- `README.md`: visão geral, perfis, como rodar e regras principais;
- `docs/01-requisitos.md`: requisitos funcionais, não funcionais e inversos;
- `docs/02-casos-de-uso.md`: diagramas e descrição dos casos de uso;
- `docs/03-diagrama-de-classes.md` e `docs/04-diagrama-er.md`: modelo de dados;
- `docs/05-arquitetura.md`: arquitetura, segurança, rotas da API e eventos do socket;
- `docs/06-diagramas-de-fluxo.md` e `docs/07-diagramas-de-sequencia.md`;
- `docs/08-tutorial.md`: tutorial de uso.

## Rodando

```bash
npm install
# crie o .env (veja abaixo)
npx prisma migrate deploy   # aplica as migrações
npx prisma generate
npx tsx seed.ts             # opcional: dados iniciais
npm run dev                 # http://localhost:3001
```

| Variável | Para que serve |
| --- | --- |
| `DATABASE_URL` | Conexão com o PostgreSQL |
| `SHADOW_DATABASE_URL` | Banco auxiliar do `prisma migrate dev` (só em desenvolvimento) |
| `JWT_SECRET` | Segredo dos tokens de login (longo e aleatório) |
| `TELEGRAM_BOT_TOKEN` | Token do bot. Sem ele, o sistema roda sem Telegram. |
| `TELEGRAM_BOT_USERNAME` | Nome do bot sem @ (ex.: `CosupBot`) |
| `PORT` | Porta da API (padrão 3001) |

> Só uma instância do back pode usar o mesmo bot. Com duas, o Telegram responde com erro 409.

## Scripts

| Script | O que faz |
| --- | --- |
| `npm run dev` | Desenvolvimento com recarga automática (ts-node-dev) |
| `npm run build` | Compila para `dist/` |
| `npm start` | Roda o build (`node dist/server.js`) |
| `npm run lint` / `npm run format` | ESLint e Prettier |

## Prisma

| Comando | Uso |
| --- | --- |
| `npx prisma migrate dev --name <nome>` | Cria uma migração nova (desenvolvimento) |
| `npx prisma migrate deploy` | Aplica as migrações pendentes (produção) |
| `npx prisma generate` | Atualiza o cliente após mudar o schema |
| `npx prisma studio` | Abre o banco no navegador |
| `npx prisma migrate reset` | **Apaga** o banco e recria do zero (só em desenvolvimento) |

## Estrutura

```
src/
  server.ts          Express, CORS, rotas /api/*, Socket.IO, /uploads
  socket.ts          Socket.IO com autenticação JWT no handshake
  middlewares/       autenticação, checagem de perfil, upload (multer)
  routes/            uma rota por módulo
  controllers/       regras de cada módulo
  rules/             regras puras da OS e das peças
  relatorios/        fontes e motor do Montar Relatório
  security/          bloqueio progressivo de login
prisma/
  schema.prisma      modelo de dados
  migrations/        histórico de migrações
```
