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
    updateAtendimento
} from '../controllers/impressoraController';
import { authMiddleware, impressoraOuAdminMiddleware } from '../middlewares/authMiddleware';

const router = Router();
router.use(authMiddleware);

// Rotas para Impressoras
router.get('/impressoras', impressoraOuAdminMiddleware, getAllImpressoras);
router.post('/impressoras', impressoraOuAdminMiddleware, createImpressora);
router.put('/impressoras/:id', impressoraOuAdminMiddleware, updateImpressora);
router.delete('/impressoras/:id', impressoraOuAdminMiddleware, deleteImpressora);

// Rotas para Controle de Suprimentos
router.get('/suprimentos', impressoraOuAdminMiddleware, getControleSuprimentos);
router.post('/suprimentos',impressoraOuAdminMiddleware,  createControleSuprimentos);

// Rotas para Estoque de Suprimentos
router.get('/estoque', impressoraOuAdminMiddleware, getEstoqueSuprimentos);
router.put('/estoque', impressoraOuAdminMiddleware, addEstoqueSuprimentos);

// Rotas para Atendimentos
router.get('/atendimentos', impressoraOuAdminMiddleware, getAtendimentos);
router.post('/atendimentos', impressoraOuAdminMiddleware,  createAtendimento);
router.put('/atendimentos/:id', impressoraOuAdminMiddleware,  updateAtendimento);


export default router;