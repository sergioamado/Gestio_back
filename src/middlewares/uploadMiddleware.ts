// src/middlewares/uploadMiddleware.ts
import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Configuração de onde e como os ficheiros serão guardados
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Define a pasta de destino baseada no tipo de ficheiro ou rota
    let uploadPath = 'uploads/';
    
    if (file.fieldname === 'foto') {
      uploadPath += 'patrimonio/fotos';
    } else if (file.fieldname === 'planilha' || file.fieldname === 'arquivo') {
      uploadPath += 'patrimonio/importacoes';
    }

    // Cria a pasta recursivamente se não existir
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    // Gera um nome único: timestamp + nome original limpo
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
  }
});

// Filtro de segurança para tipos de ficheiros
const fileFilter = (req: any, file: Express.Multer.File, cb: any) => {
  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.pdf', '.xlsx', '.csv'];
  const ext = path.extname(file.originalname).toLowerCase();

  if (allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Tipo de ficheiro não suportado. Envie apenas imagens, PDFs ou tabelas.'));
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // Limite de 5MB por ficheiro
  }
});

export default upload;