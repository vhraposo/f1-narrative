import { assembleGenerationBundle } from "./src/modules/generation/generation.assembly.js";
import { createOllamaProviderFromEnv } from "./src/modules/generation/ollama-provider.js";
import { prisma } from "./src/infrastructure/database/prisma.js";

const convId = process.argv[2];
const target = process.argv[3];
const userId = process.argv[4];

const provider = createOllamaProviderFromEnv();
const started = Date.now();
try {
  const bundle = await assembleGenerationBundle(
    prisma,
    {
      conversationId: convId,
      userId,
      userPrompt: "Luca, o que você acha de mudarmos o horário dos treinos de sexta para o fim de semana?",
      targetCharacterId: target,
    },
    provider,
  );
  console.log("OK ms=" + (Date.now() - started) + " mode=" + bundle.meta.mode + " key=" + bundle.generationKey);
  console.log("text=" + String(bundle.text ?? "").slice(0, 300));
} catch (err) {
  console.log("ERR ms=" + (Date.now() - started));
  console.log("name=" + (err as Error).name);
  console.log("message=" + (err as Error).message);
  console.log("stack=" + (err as Error).stack);
}
await prisma.$disconnect();