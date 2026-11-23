// src/routes/servicosRoutes.ts
import { Router } from 'express';
import { getCatalogo, createCatalogoItem, updateCatalogoItem } from '../controllers/servicosController';
import { authMiddleware, managerOrAdminMiddleware } from '../middlewares/authMiddleware';

const router = Router();



// Todas as rotas de serviços requerem que o utilizador esteja logado
router.use(authMiddleware);

// --- ROTAS DO CATÁLOGO DE SERVIÇOS ---
// Qualquer logado (técnicos inclusivé) pode ver o catálogo para escolher um serviço
router.get('/catalogo', getCatalogo);

// Apenas Gestores e Admins podem CRIAR e EDITAR o catálogo de serviços
router.post('/catalogo', managerOrAdminMiddleware , createCatalogoItem);
router.put('/catalogo/:id', managerOrAdminMiddleware, updateCatalogoItem);



export default router;