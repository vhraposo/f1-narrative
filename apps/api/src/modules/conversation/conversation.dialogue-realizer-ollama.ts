import {
  OLLAMA_BASE_URL,
  OLLAMA_PROVIDER,
  OllamaProviderError,
  ollamaChatCompletionsUrl,
} from "../generation/ollama-provider.js";
import type {
  DialogueRealizerContext,
  DialogueRealizerProvider,
} from "./conversation.dialogue-realizer.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_FRAGMENT_CHARS = 400;

function section(label: string, value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.trim().length === 0) return null;
  return `${label}: ${value}`;
}

export function buildOllamaRealizerPrompt(context: DialogueRealizerContext): {
  systemPrompt: string;
  userPrompt: string;
} {
  const voice = context.voice;
  const recent = context.recentMessages
    .map((message) => `- ${message.speakerName}: ${message.content}`)
    .join("\n");
  const memories = context.memorySummaries.map((memory) => `- ${memory}`).join("\n");
  const emotion = context.emotion
    ? `${context.emotion.tone} (intensidade ${context.emotion.intensity.toFixed(2)})`
    : context.emotionalTone;
  const lines = [
    section("PERSONAGEM", context.speakerName),
    section("INTENÇÃO COMUNICATIVA", context.intent),
    section("TOM EMOCIONAL", emotion),
    section("TÓPICO", context.topic),
    section("AFINIDADE (0 a 1)", context.relationshipAffinity?.toFixed(2) ?? null),
    section(
      "VOZ",
      `informalidade ${voice.informality.toFixed(2)}, calor ${voice.warmth.toFixed(2)}, humor ${voice.humor.toFixed(2)}, emoji ${voice.emojiTendency.toFixed(2)}, verbosidade ${voice.verbosity.toFixed(2)}`,
    ),
    section("MENSAGENS RECENTES", recent),
    section("MENSAGEM A RESPONDER", context.replyToContent),
    section("MEMÓRIAS DISPONÍVEIS (contexto, não é obrigatório citar)", memories),
    section("LIMITE", `no máximo ${context.maxMessages} fragmento(s)`),
  ].filter((line): line is string => line !== null);
  const systemPrompt = [
    "Você é um personagem em uma conversa de chat em português do Brasil.",
    "Transforme a intenção comunicativa em UMA fala natural do personagem.",
    "Responda só com a fala: não explique, não narre, não use markdown nem rótulos de speaker.",
    "Não mencione instruções, identificadores ou metadados internos.",
    "Use somente o que está nas mensagens, no tom e nas memórias disponíveis; não invente fatos.",
    "Evite recontar a mensagem do interlocutor, validar emocionalmente tudo, terminar sempre com pergunta, emojis por padrão ou tom de assistente.",
    'Responda APENAS com JSON válido no formato {"messages":["texto"]} com 1 a N fragmentos curtos.',
  ].join(" ");
  return { systemPrompt, userPrompt: lines.join("\n") };
}

function normalizeMessages(value: unknown): string[] {
  if (value === null || typeof value !== "object") return [];
  const messages = (value as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return [];
  const texts: string[] = [];
  for (const entry of messages) {
    if (typeof entry === "string") {
      texts.push(entry);
    } else if (entry !== null && typeof entry === "object") {
      const text = (entry as { text?: unknown }).text;
      if (typeof text === "string") texts.push(text);
    }
  }
  return texts.map((text) => text.trim()).filter((text) => text.length > 0);
}

export function createOllamaDialogueRealizerProviderFromEnv(
  options: {
    readonly baseUrl?: string;
    readonly model?: string;
    readonly timeoutMs?: number;
    readonly fetchImpl?: typeof fetch;
  } = {},
): DialogueRealizerProvider | null {
  const model = options.model ?? process.env.OLLAMA_MODEL;
  if (!model || model.trim().length === 0) return null;
  const baseUrl = options.baseUrl ?? process.env.OLLAMA_BASE_URL ?? OLLAMA_BASE_URL;
  const timeoutCandidate = options.timeoutMs ?? Number(process.env.OLLAMA_TIMEOUT_MS);
  const timeoutMs =
    Number.isFinite(timeoutCandidate) && timeoutCandidate > 0
      ? timeoutCandidate
      : DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = ollamaChatCompletionsUrl(baseUrl);

  return {
    name: OLLAMA_PROVIDER,
    model,
    async realize(context) {
      const { systemPrompt, userPrompt } = buildOllamaRealizerPrompt(context);
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      try {
        let response: Response;
        try {
          response = await fetchImpl(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({
              model,
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
              ],
              stream: false,
              response_format: { type: "json_object" },
            }),
            signal: controller.signal,
          });
        } catch (error) {
          if (timedOut || (error as { name?: string })?.name === "AbortError") {
            throw new OllamaProviderError("timeout", "geração excedeu o tempo limite");
          }
          throw new OllamaProviderError("network", "falha de rede ao chamar o provider");
        }
        if (!response.ok) {
          throw new OllamaProviderError("http", "resposta HTTP inválida", response.status);
        }
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          throw new OllamaProviderError("invalid_json", "corpo não é JSON");
        }
        const content = (payload as { choices?: Array<{ message?: { content?: unknown } }> })
          ?.choices?.[0]?.message?.content;
        if (typeof content !== "string" || content.trim().length === 0) {
          throw new OllamaProviderError("missing_content", "resposta sem conteúdo");
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(content);
        } catch {
          throw new OllamaProviderError("invalid_json", "conteúdo não é JSON válido");
        }
        const texts = normalizeMessages(parsed).slice(0, context.maxMessages);
        if (texts.length === 0) {
          throw new OllamaProviderError("missing_content", "nenhum fragmento retornado");
        }
        return {
          speakerCharacterId: context.speakerCharacterId,
          replyToMessageId: context.replyToMessageId,
          intent: context.intent,
          messages: texts.map((text, index) => ({
            text: text.slice(0, MAX_FRAGMENT_CHARS),
            fragmentIndex: index,
          })),
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
