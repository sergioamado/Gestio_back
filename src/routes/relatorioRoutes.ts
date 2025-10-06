// src/routes/relatorioRoutes.ts
import { Router } from 'express';
import { getSolicitacoesPorTecnico, getTopItens, getStatsGlobal, getRelatorioDetalhadoPorTecnico  } from '../controllers/relatorioController';
import { authMiddleware, adminOnlyMiddleware, managerOrAdminMiddleware  } from '../middlewares/authMiddleware';

const router = Router();
router.use(authMiddleware);

router.get('/solicitacoes-por-tecnico', getSolicitacoesPorTecnico);
router.get('/top-itens', getTopItens);
router.get('/stats-global', adminOnlyMiddleware, getStatsGlobal);
router.get('/detalhado-por-tecnico', managerOrAdminMiddleware, getRelatorioDetalhadoPorTecnico);

export default router;