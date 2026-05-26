// src/routes/patrimonioRoutes.ts
import { Router } from 'express';
import {
  getAllBens,
  createBem,       
  updateBem,       
  deleteBem,       
  importarDadosSipac,
  transferirBens,
  atribuirBem,
  devolverBem,
  registrarConferencia,
  uploadFoto
} from '../controllers/patrimonioController';
import { authMiddleware, managerOrAdminMiddleware } from '../middlewares/authMiddleware';
import upload from '../middlewares/uploadMiddleware';

const router = Router();

// Protege todas as rotas exigindo token válido
router.use(authMiddleware);

// Restringe o acesso apenas para admin e gerente
router.use(managerOrAdminMiddleware);

//  Alimentação e CRUD 
router.get('/', getAllBens);
router.post('/', createBem);                                         
router.put('/:id', updateBem);                                       
router.delete('/:id', deleteBem);                                    
router.post('/importar', upload.single('planilha'), importarDadosSipac); 
router.post('/:id/foto', upload.single('foto'), uploadFoto);

// Movimentações
router.post('/transferencia', transferirBens);

//  Cautela (Atribuição)
router.post('/atribuir', atribuirBem);
router.post('/devolver', devolverBem);

//  Levantamento Anual (Auditoria)
router.post('/conferencia', registrarConferencia);

export default router;