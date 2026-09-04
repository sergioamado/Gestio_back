// src/routes/analyticsRoutes.ts
import { Router } from 'express';
import { getCatalog, runQuery, saveDashboard, getDashboards } from '../controllers/analiseController';
import { authMiddleware} from '../middlewares/authMiddleware';

const router = Router();

// Endpoint para listar os datasets disponíveis
router.get('/catalog', authMiddleware, getCatalog);

// O coração do sistema: endpoint que processa as queries (Via POST pois enviaremos um JSON complexo)
router.post('/query', authMiddleware, runQuery);

// Endpoints para salvar e ler layouts
router.post('/dashboards', authMiddleware, saveDashboard);
router.get('/dashboards', authMiddleware, getDashboards);

export default router;