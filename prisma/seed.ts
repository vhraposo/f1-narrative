import { PrismaClient } from "@prisma/client";
import { syncAiCatalog } from "../apps/api/src/modules/characters/ai-catalog.js";

async function main() {
  const prisma = new PrismaClient();
  try {
    const count = await syncAiCatalog(prisma);
    console.log(`AI catalog synced (${count}).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});