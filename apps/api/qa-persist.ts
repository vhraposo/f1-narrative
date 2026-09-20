import { assembleGenerationBundle } from "./src/modules/generation/generation.assembly.js";
import { createOllamaProviderFromEnv } from "./src/modules/generation/ollama-provider.js";
import { persistGeneratedMessage } from "./src/modules/generation/generation-persist.js";
import { prisma } from "./src/infrastructure/database/prisma.js";

const convId = process.argv[2];
const userId = process.argv[3];

const provider = createOllamaProviderFromEnv();
const bundle = await assembleGenerationBundle(
  prisma,
  {
    conversationId: convId,
    userId,
    userPrompt: "Luca, o que você acha de mudarmos o horário dos treinos de sexta para o fim de semana?",
    targetCharacterId: "00000000-0000-4000-8000-000000000001",
  },
  provider,
);
console.log("bundle mode=" + bundle.meta.mode + " text=" + String(bundle.text ?? "").slice(0, 120));
try {
  const decision = await persistGeneratedMessage(prisma, bundle, userId);
  console.log("persist=" + JSON.stringify(decision, null, 2).slice(0, 400));
} catch (err) {
  console.log("PERSIST THREW");
  console.log("name=" + (err as Error).name);
  console.log("message=" + JSON.stringify((err as Error).message).slice(0, 800));
  console.log("stack=" + (err as Error).stack);
}
await prisma.$disconnect();