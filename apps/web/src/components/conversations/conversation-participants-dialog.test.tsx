import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationParticipantsDialog } from "@/components/conversations/conversation-participants-dialog";
import { ApiError } from "@/lib/api";
import { renderWithClient } from "@/test/render-with-client";

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    get: apiMock.get,
    post: apiMock.post,
    patch: apiMock.patch,
    put: apiMock.put,
    remove: apiMock.remove,
  };
});

const currentParticipants = [
  { id: "user-1", name: "Alicya", controlledBy: "USER", nationality: "BRA" },
  { id: "ai-1", name: "Andrea Kimi Antonelli", controlledBy: "AI", nationality: "ITA" },
];

const ownCharacters = [
  { id: "user-1", name: "Alicya", controlledBy: "USER", nationality: "BRA" },
  { id: "user-2", name: "Segundo Personagem", controlledBy: "USER", nationality: "BRA" },
];

const aiCharacters = [
  { id: "ai-1", name: "Andrea Kimi Antonelli", controlledBy: "AI", nationality: "ITA" },
  { id: "ai-2", name: "Max Verstappen", controlledBy: "AI", nationality: "NED" },
];

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  apiMock.remove.mockReset();
  apiMock.get.mockImplementation(async (path: string) => {
    if (path === "/api/conversations/c1/participants")
      return { participants: currentParticipants };
    if (path === "/api/characters") return { characters: ownCharacters };
    if (path === "/api/characters/ai") return { characters: aiCharacters };
    throw new ApiError("Não encontrado", 404);
  });
  apiMock.post.mockImplementation(async () => ({
    conversation: { id: "c1", title: "Driver Group", type: "GROUP", participants: [] },
  }));
  apiMock.remove.mockImplementation(async () => undefined);
});

describe("ConversationParticipantsDialog", () => {
  it("1) lista participantes atuais e não oferece duplicatas para adicionar", async () => {
    renderWithClient(
      <ConversationParticipantsDialog conversationId="c1" open onClose={() => undefined} />,
    );
    expect(await screen.findByText("No grupo (2)")).toBeDefined();
    expect(screen.getByText("Andrea Kimi Antonelli")).toBeDefined();
    expect(screen.queryByRole("button", { name: /Adicionar Andrea Kimi Antonelli/i })).toBeNull();
    expect(await screen.findByRole("button", { name: /Max Verstappen/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /Segundo Personagem/ })).toBeDefined();
  });

  it("2) selecionar e confirmar adiciona o personagem via API", async () => {
    const user = userEvent.setup();
    renderWithClient(
      <ConversationParticipantsDialog conversationId="c1" open onClose={() => undefined} />,
    );
    const option = await screen.findByRole("button", { name: /Max Verstappen/ });
    await user.click(option);
    await waitFor(() => expect(screen.getByText("1 selecionado")).toBeDefined());
    await user.click(screen.getByRole("button", { name: "Adicionar" }));
    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith(
        "/api/conversations/c1/participants",
        { characterId: "ai-2" },
      ),
    );
  });

  it("3) remover participante usa o endpoint de remoção", async () => {
    const user = userEvent.setup();
    renderWithClient(
      <ConversationParticipantsDialog conversationId="c1" open onClose={() => undefined} />,
    );
    await user.click(await screen.findByRole("button", { name: "Remover Max Verstappen".replace("Max Verstappen", "Andrea Kimi Antonelli") }));
    await waitFor(() =>
      expect(apiMock.remove).toHaveBeenCalledWith(
        "/api/conversations/c1/participants/ai-1",
      ),
    );
  });
});
