const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
  await prisma.user.deleteMany({ where: { role: 'STUDENT' } });
  console.log("Deleted students");
  process.exit(0);
}
run();
