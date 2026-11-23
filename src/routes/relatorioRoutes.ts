// src/routes/relatorioRoutes.ts
import { Router } from 'express';
import {
  getRelatorioSolicitacoes,
  getDadosGraficos,
  getRelatorioEstoque,
  getHistoricoPatrimonio,
  getDashboardProducao
} from '../controllers/relatorioController';
import {
  listarFontes,
  gerarRelatorio,
  listarModelos,
  criarModelo,
  atualizarModelo,
  excluirModelo,
} from '../controllers/relatorioPersonalizadoController';
import { authMiddleware, managerOrAdminMiddleware } from '../middlewares/authMiddleware';

const router = Router();

// Proteção dupla: Exige login E perfil de gestão
router.use(authMiddleware);
router.use(managerOrAdminMiddleware);

// Rota de relatórios customizados (Tabelas e Excel)
router.get('/solicitacoes', getRelatorioSolicitacoes);

// Rota de painéis e gráficos visuais (Dashboard Avançado)
router.get('/graficos', getDadosGraficos);

// Rota de inventário e estoque
router.get('/estoque', getRelatorioEstoque);

// Rota de auditoria (quem moveu o quê e para onde)
router.get('/patrimonio/historico', getHistoricoPatrimonio);
// rota para novo dashboard de produção de serviços
router.get('/producao-dashboard', getDashboardProducao);

// Construtor de relatórios personalizados (detalhado/cruzado) e modelos salvos
router.get('/personalizado/fontes', listarFontes);
router.post('/personalizado/gerar', gerarRelatorio);
router.get('/personalizado/modelos', listarModelos);
router.post('/personalizado/modelos', criarModelo);
router.put('/personalizado/modelos/:id', atualizarModelo);
router.delete('/personalizado/modelos/:id', excluirModelo);

export default router;