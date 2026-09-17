export const TURN_CONTEXT_VERSION = "turn-context.v1";

export interface TurnReply {
  speakerCharacterId: string;
  speakerName: string;
  senderType: "AI_CHARACTER";
  content: string;
}

export interface TurnContext {
  userMessage: string;
  userCharacterId: string;
  userCharacterName: string;
  previousReplies: readonly TurnReply[];
}

export function createTurnContext(args: {
  userMessage: string;
  userCharacterId: string;
  userCharacterName: string;
  previousReplies?: readonly TurnReply[];
}): TurnContext {
  return {
    userMessage: args.userMessage,
    userCharacterId: args.userCharacterId,
    userCharacterName: args.userCharacterName,
    previousReplies: args.previousReplies ?? [],
  };
}

export function appendTurnReply(turn: TurnContext, reply: TurnReply): TurnContext {
  return {
    ...turn,
    previousReplies: [...turn.previousReplies, reply],
  };
}