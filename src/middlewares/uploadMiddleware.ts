// src/middlewares/uploadMiddleware.ts
import multer from 'multer';
import fs from 'fs';

const uploadDir = 'uploads/';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/\s+/g, '_');
    cb(null, `${Date.now()}-${safeName}`);
  }
});

const fileFilter = (req: any, file: any, cb: any) => {
  // Agora aceitamos Imagens, PDFs, CSVs e Planilhas Excel
  const allowedMimes = [
    'image/jpeg', 'image/png', 'image/jpg',
    'application/pdf',
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ];

  const isCSV = file.originalname.toLowerCase().endsWith('.csv');

  if (allowedMimes.includes(file.mimetype) || isCSV) {
    cb(null, true);
  } else {
    cb(new Error('Formato não suportado. Envie PDF, CSV, Excel ou imagens.'), false);
  }
};

const upload = multer({ storage, fileFilter });

export default upload;