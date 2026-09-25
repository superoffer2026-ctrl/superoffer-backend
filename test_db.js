const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
  const users = await prisma.user.findMany({ where: { role: 'STUDENT' } });
  console.log(users.map(u => ({ id: u.id, email: u.email, phone: u.phone })));
  process.exit(0);
}
run();
