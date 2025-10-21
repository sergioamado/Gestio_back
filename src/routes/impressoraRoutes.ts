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
    addEstoqueSuprimentos
} from '../controllers/impressoraController';
import { authMiddleware, adminOnlyMiddleware } from '../middlewares/authMiddleware';

const router = Router();
router.use(authMiddleware);

// Rotas para Impressoras
router.get('/impressoras', getAllImpressoras);
router.post('/impressoras', createImpressora);

// --- ROTAS FALTANTES ADICIONADAS AQUI ---
router.put('/impressoras/:id', updateImpressora);
router.delete('/impressoras/:id', deleteImpressora);

// Rotas para Controle de Suprimentos
router.get('/suprimentos', getControleSuprimentos);
router.post('/suprimentos', createControleSuprimentos);

// Rotas para Estoque de Suprimentos
router.get('/estoque', getEstoqueSuprimentos);
router.put('/estoque', adminOnlyMiddleware, addEstoqueSuprimentos);

// Rotas para Atendimentos
router.get('/atendimentos', getAtendimentos);
router.post('/atendimentos', createAtendimento);


export default router;