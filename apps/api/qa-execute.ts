import { executeTurn } from "./src/modules/conversation/conversation-turn.js";
import { createOllamaProviderFromEnv } from "./src/modules/generation/ollama-provider.js";
import { prisma } from "./src/infrastructure/database/prisma.js";

const convId = process.argv[2];
const userId = process.argv[3];
const prompt = process.argv[4] ?? "Luca, o que você acha de mudarmos o horário dos treinos de sexta para o fim de semana?";

const provider = createOllamaProviderFromEnv();
const started = Date.now();
try {
  const res = await executeTurn(prisma, provider, {
    conversationId: convId,
    userId,
    userPrompt: prompt,
  });
  console.log("OK ms=" + (Date.now() - started) + " msgs=" + res.messages.length + " failed=" + JSON.stringify(res.failedSpeakers));
  for (const m of res.messages) {
    console.log("--- " + m.characterId + " :: " + String(m.content).slice(0, 250));
  }
} catch (err) {
  console.log("ERR ms=" + (Date.now() - started));
  console.log("name=" + (err as Error).name);
  console.log("message=" + (err as Error).message);
  console.log("stack=" + (err as Error).stack);
}
await prisma.$disconnect();