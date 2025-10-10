// src/server.ts
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/authRoutes';
import itemRoutes from './routes/itemRoutes';
import unidadeRoutes from './routes/unidadeRoutes';
import usuarioRoutes from './routes/usuarioRoutes';
import solicitacaoRoutes from './routes/solicitacaoRoutes';
import relatorioRoutes from './routes/relatorioRoutes';
import manutencaoEletronicaRoutes from './routes/manutencaoEletronicaRoutes';

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares
app.use(cors()); // Permite requisições de diferentes origens (seu frontend React)
app.use(express.json()); // Habilita o parsing de JSON no corpo das requisições

// Rotas da API
app.use('/api/auth', authRoutes);
app.use('/api/itens', itemRoutes);
app.use('/api/usuarios', usuarioRoutes);
app.use('/api/unidades', unidadeRoutes);
app.use('/api/solicitacoes', solicitacaoRoutes);
app.use('/api/relatorios', relatorioRoutes);
app.use('/api/manutencao-eletronica', manutencaoEletronicaRoutes);

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});