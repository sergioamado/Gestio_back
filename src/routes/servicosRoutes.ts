// src/routes/servicosRoutes.ts
import { Router } from 'express';
import { getCatalogo, createCatalogoItem, updateCatalogoItem, registrarProducao, getHistoricoProducao, deleteProducao } from '../controllers/servicosController';
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

// --- ROTAS DE PRODUÇÃO (QUEM FEZ O QUÊ) ---
// Qualquer técnico pode registar a sua produção
router.post('/producao', registrarProducao);
// Todos podem ver o histórico (os técnicos veem o próprio, os gestores veem o de todos, a lógica já está no controller)
router.get('/producao', getHistoricoProducao);
//delete produção (apenas gestor/admin)
router.delete('/producao/:id', managerOrAdminMiddleware, deleteProducao);

export default router;