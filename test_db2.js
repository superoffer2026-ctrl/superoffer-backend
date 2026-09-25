const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
  const schemas = await prisma.formSchema.findMany();
  console.log("schemas:", schemas.length);
  process.exit(0);
}
run();
