// src/middlewares/uploadMiddleware.ts
import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Garante que a pasta uploads existe
const uploadDir = 'uploads/';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Retira os espaços do nome original para evitar bugs
    const safeName = file.originalname.replace(/\s+/g, '_');
    cb(null, `${Date.now()}-${safeName}`);
  }
});

const fileFilter = (req: any, file: any, cb: any) => {
  if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    cb(new Error('Formato não suportado. Apenas imagens e PDFs são permitidos.'), false);
  }
};

const upload = multer({ storage, fileFilter });

export default upload;