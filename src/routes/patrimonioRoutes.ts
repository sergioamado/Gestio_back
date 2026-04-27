import { Router } from 'express';
import multer from 'multer';
import { importarSipac, conferirTombamento } from '../controllers/patimonioController';
import { authMiddleware, adminOnlyMiddleware } from '../middlewares/authMiddleware';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(authMiddleware);

// Apenas Admin e Gerente podem importar
router.post('/importar', adminOnlyMiddleware, upload.single('file'), importarSipac);
router.post('/conferir', conferirTombamento);

export default router;