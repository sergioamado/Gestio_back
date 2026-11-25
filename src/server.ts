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
import impressoraRoutes from './routes/impressoraRoutes';
import notificacaoRoutes from './routes/notificacaoRoutes';
import estatisticasRoutes from './routes/estatisticasRoutes';
import patrimonioRoutes from './routes/patrimonioRoutes'; 
import servicosRoutes from './routes/servicosRoutes';
import analiseRoutes from './routes/analiseRoutes';
import { initSocket } from './socket';
import registroProducaoRoutes from './routes/registroProducaoRoutes'; // Importação da rota de registro de produção
import relatorioAnaliticoRoutes from './routes/relatorioAnaliticoRoutes';
import { avisarMudancas } from './realtime/avisarMudancas';
import http from 'http';
import { authMiddleware, managerOrAdminMiddleware } from './middlewares/authMiddleware';

import path from 'path';
import fs from 'fs';

const app = express();
const PORT = process.env.PORT || 3001;

const server = http.createServer(app);

initSocket(server);

// Middlewares
app.use(cors()); 
app.use(express.json());
// Depois de cada alteração bem-sucedida, avisa as telas abertas para recarregarem (tempo real).
app.use(avisarMudancas);

// Rotas da API
app.use('/api/auth', authRoutes);
app.use('/api/itens', itemRoutes);
app.use('/api/usuarios', usuarioRoutes);
app.use('/api/unidades', unidadeRoutes);
app.use('/api/solicitacoes', solicitacaoRoutes);
app.use('/api/relatorios', relatorioRoutes);
app.use('/api/manutencao-eletronica', manutencaoEletronicaRoutes);
app.use('/api/gestao-impressoras', impressoraRoutes);
app.use('/api/notificacoes', notificacaoRoutes);
app.use('/api/estatisticas', estatisticasRoutes);
app.use('/api/patrimonio', patrimonioRoutes);
app.use('/api/servicos', servicosRoutes);
app.use('/api/analise', analiseRoutes);
app.use('/api/producao', registroProducaoRoutes); 
app.use('/api/relatorios-analiticos', relatorioAnaliticoRoutes);


// Arquivos enviados (fotos de patrimônio): só para usuários logados com acesso ao patrimônio.
app.use('/uploads', authMiddleware, managerOrAdminMiddleware, express.static(path.join(__dirname, '../uploads')));

const uploadDir = './uploads/patrimonio';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

server.listen(PORT, () => {
  console.log(`🚀 Servidor Express e WebSockets rodando na porta ${PORT}`);
});