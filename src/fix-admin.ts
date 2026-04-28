import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function run() {
  const hash = await bcrypt.hash('admin123', 10);
  await prisma.usuarios.upsert({
    where: { username: 'admin' },
    update: { hashed_password: hash },
    create: {
      username: 'admin',
      hashed_password: hash,
      nome_completo: 'Administrador Geral',
      role: 'admin',
      email: 'admin@gestio.com'
    }
  });
  console.log("Admin atualizado com sucesso!");
}

run();