// seed.ts
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const password = 'admin123';
  const saltRounds = 10;
  const hashed_password = await bcrypt.hash(password, saltRounds);

  await prisma.usuarios.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      hashed_password: hashed_password,
      nome_completo: 'Administrador Geral',
      role: 'admin',
      email: 'admin@gestio.com',
      unidade_id: null, // Admin não precisa de unidade
    },
  });

  console.log('✅ Usuário administrador criado com sucesso!');
  console.log('Username: admin');
  console.log('Senha: admin123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });