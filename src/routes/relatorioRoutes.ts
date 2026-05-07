// src/routes/relatorioRoutes.ts
import { Router } from 'express';
import {
  getRelatorioSolicitacoes,
  getDadosGraficos,
  getRelatorioEstoque,
  getHistoricoPatrimonio
} from '../controllers/relatorioController';
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

export default router;