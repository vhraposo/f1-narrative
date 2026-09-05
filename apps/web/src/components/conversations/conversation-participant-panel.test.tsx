import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, type Mock } from "vitest";

import { ApiError } from "@/lib/api";
import type { AiCharacter, Character } from "@/lib/characters";
import type { ConversationParticipant } from "@/lib/conversations";

type AddCallbacks = { onSuccess?: () => void; onError?: (err: unknown) => void };
type RemoveCallbacks = { onSettled?: () => void };

// Fronteira de mock: @/hooks/use-characters e @/hooks/use-conversations.
// ApiError (de @/lib/api) NÃO é mockado (o painel faz instanceof em ApiError).
const mocks = vi.hoisted(() => {
  return {
    own: { data: [] as Character[] },
    ai: { data: [] as AiCharacter[] },
    participants: { data: [] as ConversationParticipant[] },
    add: {
      isPending: false,
      mutate: vi.fn(),
    } as {
      isPending: boolean;
      mutate: Mock<(characterId: string, callbacks?: AddCallbacks) => void>;
    },
    remove: {
      isPending: false,
      mutate: vi.fn(),
    } as {
      isPending: boolean;
      mutate: Mock<(characterId: string, callbacks?: RemoveCallbacks) => void>;
    },
  };
});

vi.mock("@/hooks/use-characters", () => ({
  useCharacters: () => mocks.own,
  useAiCharacters: () => mocks.ai,
}));

vi.mock("@/hooks/use-conversations", () => ({
  useConversationParticipants: () => mocks.participants,
  useAddConversationParticipant: () => mocks.add,
  useRemoveConversationParticipant: () => mocks.remove,
}));

import { ConversationParticipantPanel } from "./conversation-participant-panel";

const CONV_ID = "conv-1";

function userCharacter(id: string, name: string): Character {
  return {
    id,
    name,
    nationality: "BR",
    gender: null,
    birthDate: "1990-01-01T00:00:00.000Z",
    imageUrl: null,
    biography: null,
    dna: {},
    controlledBy: "USER",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function aiCatalogItem(id: string, name: string, nationality?: string): AiCharacter {
  return {
    id,
    name,
    nationality: nationality ?? "IT",
    imageUrl: null,
    controlledBy: "AI",
    userId: null,
  };
}

function aiParticipant(id: string, name: string): ConversationParticipant {
  return {
    id,
    name,
    nationality: "IT",
    imageUrl: null,
    controlledBy: "AI",
    userId: null,
  };
}

function setup(opts?: {
  own?: Character[];
  ai?: AiCharacter[];
  participants?: ConversationParticipant[];
}) {
  mocks.own.data = opts?.own ?? [];
  mocks.ai.data = opts?.ai ?? [];
  mocks.participants.data = opts?.participants ?? [];
  mocks.add.isPending = false;
  mocks.remove.isPending = false;
  mocks.add.mutate.mockReset();
  mocks.remove.mutate.mockReset();

  let addCb: AddCallbacks = {};
  let removeCb: RemoveCallbacks = {};
  mocks.add.mutate.mockImplementation((_id, callbacks) => {
    addCb = callbacks ?? {};
  });
  mocks.remove.mutate.mockImplementation((_id, callbacks) => {
    removeCb = callbacks ?? {};
  });

  const view = render(<ConversationParticipantPanel conversationId={CONV_ID} />);

  return {
    ...view,
    user: userEvent.setup(),
    addSpy: mocks.add.mutate,
    removeSpy: mocks.remove.mutate,
    fireAddSuccess: () => act(() => addCb.onSuccess?.()),
    fireAddError: (err: unknown) => act(() => addCb.onError?.(err)),
    fireRemoveSettled: () => act(() => removeCb.onSettled?.()),
  };
}

describe("ConversationParticipantPanel — catálogo AI (STEP 49)", () => {
  it("J - lista AI Characters oficiais no combo de adicionar", () => {
    setup({
      own: [userCharacter("u-1", "Usuario")],
      ai: [aiCatalogItem("ai-1", "Mia Sorensen")],
    });

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    const option = within(select).getByRole("option", {
      name: /Mia Sorensen/,
    }) as HTMLOptionElement;
    expect(option.value).toBe("ai-1");
    expect(option.text).toContain("IA");
  });

  it("K - adicionar AI chama POST /participants com characterId correto", async () => {
    const h = setup({
      own: [],
      ai: [aiCatalogItem("ai-1", "Mia Sorensen")],
    });

    await h.user.selectOptions(screen.getByRole("combobox"), "ai-1");
    await h.user.click(screen.getByRole("button", { name: "Adicionar" }));

    expect(h.addSpy).toHaveBeenCalledWith("ai-1", expect.anything());
  });

  it("L - AI adicionado passa a aparecer como participante (IA)", async () => {
    const h = setup({
      own: [],
      ai: [aiCatalogItem("ai-1", "Mia Sorensen")],
    });

    await h.user.selectOptions(screen.getByRole("combobox"), "ai-1");
    await h.user.click(screen.getByRole("button", { name: "Adicionar" }));
    h.fireAddSuccess();

    mocks.participants.data = [aiParticipant("ai-1", "Mia Sorensen")];
    h.rerender(<ConversationParticipantPanel conversationId={CONV_ID} />);

    expect(screen.getByText("Mia Sorensen")).toBeTruthy();
    expect(screen.getByText("IA")).toBeTruthy();
  });

  it("L2 - erro 409 mostra mensagem de duplicidade existente", async () => {
    const h = setup({
      own: [userCharacter("u-1", "Usuario")],
      ai: [aiCatalogItem("ai-1", "Mia Sorensen")],
    });

    await h.user.selectOptions(screen.getByRole("combobox"), "u-1");
    await h.user.click(screen.getByRole("button", { name: "Adicionar" }));

    h.fireAddError(new ApiError("Duplicado", 409));

    expect(
      screen.getByRole("alert").textContent,
    ).toContain("Este personagem já participa da conversa.");
  });

  it("N - remover AI atualiza a lista de participantes", async () => {
    const h = setup({
      own: [],
      ai: [aiCatalogItem("ai-1", "Mia Sorensen")],
      participants: [aiParticipant("ai-1", "Mia Sorensen")],
    });

    const row = screen.getByText("Mia Sorensen").closest("li");
    const trash = within(row as HTMLElement).getByRole("button");
    await h.user.click(trash);

    expect(h.removeSpy).toHaveBeenCalledWith("ai-1", expect.anything());

    h.fireRemoveSettled();
    mocks.participants.data = [];
    h.rerender(<ConversationParticipantPanel conversationId={CONV_ID} />);

    expect(screen.getByText("Nenhum participante ainda.")).toBeTruthy();
    // O AI volta a ficar disponível no combo após a remoção.
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(within(select).getByText(/Mia Sorensen/)).toBeTruthy();
  });
});