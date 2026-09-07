import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ConversationParticipant, Message } from "@/lib/conversations";

import { MessageBubble } from "./message-bubble";

function author(id: string, name: string, imageUrl: string | null = null): ConversationParticipant {
  return {
    id,
    name,
    nationality: "BR",
    imageUrl,
    controlledBy: "AI",
    userId: null,
  };
}

function message(
  id: string,
  senderType: Message["senderType"],
  content: string,
  characterId: string | null = null,
): Message {
  return {
    id,
    conversationId: "c1",
    senderType,
    characterId,
    content,
    createdAt: "2026-09-05T20:00:00.000Z",
  };
}

describe("MessageBubble", () => {
  it("USER_CHARACTER: conteúdo e identidade de remetente", () => {
    const { container } = render(
      <ul>
        <MessageBubble
          message={message("m1", "USER_CHARACTER", "Minha fala", "u1")}
          author={null}
        />
      </ul>,
    );
    expect(screen.getByText("Minha fala")).toBeDefined();
    expect(container.querySelector("li")?.className).toContain("justify-end");
  });

  it("AI_CHARACTER: avatar + nome à esquerda", () => {
    const ai = author("ai1", "Kiminawa");
    const { container } = render(
      <ul>
        <MessageBubble
          message={message("m2", "AI_CHARACTER", "Resposta da IA", "ai1")}
          author={ai}
        />
      </ul>,
    );
    expect(screen.getByText("Resposta da IA")).toBeDefined();
    expect(screen.getByText("Kiminawa")).toBeDefined();
    expect(container.querySelector("li")?.className).toContain("items-end");
  });

  it("SYSTEM: tratamento separado (centralizado, não é participante)", () => {
    const { container } = render(
      <ul>
        <MessageBubble
          message={message("m3", "SYSTEM", "O evento começou.", null)}
          author={null}
        />
      </ul>,
    );
    expect(screen.getByText("O evento começou.")).toBeDefined();
    expect(container.querySelector("li")?.className).toContain("justify-center");
  });

  it("usa senderType real (USER não vira AI por controlledBy)", () => {
    const userAuthor = author("u1", "Usuario", null);
    userAuthor.controlledBy = "USER";
    render(
      <ul>
        <MessageBubble
          message={message("m4", "USER_CHARACTER", "Olá", "u1")}
          author={userAuthor}
        />
      </ul>,
    );
    expect(screen.getByText("Olá")).toBeDefined();
    expect(screen.queryByText("Usuario")).toBeNull();
  });
});