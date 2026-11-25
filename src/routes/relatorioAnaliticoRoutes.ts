// src/routes/relatorioAnaliticoRoutes.ts
import { Router } from 'express';
import {
  listar, obter, criar, atualizar, excluir, cargoSugerido, assinar, devolver, anular, duplicar, verificar,
} from '../controllers/relatorioAnaliticoController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();
router.use(authMiddleware); // permissões por perfil são checadas no controller

router.get('/', listar);
router.get('/cargo-sugerido', cargoSugerido);
router.get('/verificar/:codigo', verificar);
router.get('/:id', obter);
router.post('/', criar);
router.put('/:id', atualizar);
router.delete('/:id', excluir);
router.post('/:id/assinar', assinar);
router.post('/:id/devolver', devolver);
router.post('/:id/anular', anular);
router.post('/:id/duplicar', duplicar);

export default router;
