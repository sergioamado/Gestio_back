// src/routes/analyticsRoutes.ts
import { Router } from 'express';
import { getCatalog, runQuery, saveDashboard, getDashboards } from '../controllers/analiseController';
import { authMiddleware, managerOrAdminMiddleware } from '../middlewares/authMiddleware';

const router = Router();

// Análises/BI: somente admin e gerente (mesma regra do front).
router.use(authMiddleware, managerOrAdminMiddleware);

// Endpoint para listar os datasets disponíveis
router.get('/catalog', getCatalog);

// O coração do sistema: endpoint que processa as queries (Via POST pois enviaremos um JSON complexo)
router.post('/query', runQuery);

// Endpoints para salvar e ler layouts
router.post('/dashboards', saveDashboard);
router.get('/dashboards', getDashboards);

export default router;