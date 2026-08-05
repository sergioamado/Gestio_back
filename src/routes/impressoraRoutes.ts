// src/routes/impressoraRoutes.ts
import { Router } from 'express';
import {
    getAllImpressoras,
    createImpressora,
    updateImpressora, 
    deleteImpressora, 
    getControleSuprimentos,
    createControleSuprimentos,
    getAtendimentos,
    createAtendimento,
    getEstoqueSuprimentos,
    addEstoqueSuprimentos,
    updateAtendimento,
    getHistoricoEntradas,
    corrigirEstoque,
    reportarErroEstoque
} from '../controllers/impressoraController';
import { authMiddleware, impressoraOuAdminMiddlewareOuManager } from '../middlewares/authMiddleware';

const router = Router();
router.use(authMiddleware);

router.get('/suprimentos/historico', impressoraOuAdminMiddlewareOuManager , getHistoricoEntradas);
router.post('/suprimentos/corrigir', impressoraOuAdminMiddlewareOuManager , corrigirEstoque);
router.post('/suprimentos/reportar-erro', impressoraOuAdminMiddlewareOuManager , reportarErroEstoque);
// Rotas para Controle de Suprimentos
router.get('/suprimentos', impressoraOuAdminMiddlewareOuManager , getControleSuprimentos);
router.post('/suprimentos',impressoraOuAdminMiddlewareOuManager ,  createControleSuprimentos);


// Rotas para Impressoras
router.get('/impressoras', impressoraOuAdminMiddlewareOuManager , getAllImpressoras);
router.post('/impressoras', impressoraOuAdminMiddlewareOuManager , createImpressora);
router.put('/impressoras/:id', impressoraOuAdminMiddlewareOuManager , updateImpressora);
router.delete('/impressoras/:id', impressoraOuAdminMiddlewareOuManager , deleteImpressora);


// Rotas para Estoque de Suprimentos
router.get('/estoque', impressoraOuAdminMiddlewareOuManager , getEstoqueSuprimentos);
router.put('/estoque', impressoraOuAdminMiddlewareOuManager , addEstoqueSuprimentos);

// Rotas para Atendimentos
router.get('/atendimentos', impressoraOuAdminMiddlewareOuManager , getAtendimentos);
router.post('/atendimentos', impressoraOuAdminMiddlewareOuManager ,  createAtendimento);
router.put('/atendimentos/:id', impressoraOuAdminMiddlewareOuManager ,  updateAtendimento);




export default router;