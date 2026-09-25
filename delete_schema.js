const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
  await prisma.formSchema.deleteMany({});
  console.log("Deleted schemas");
  process.exit(0);
}
run();
