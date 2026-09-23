import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import type { AiCharacter, Character } from "@/lib/characters";
import { renderWithClient } from "@/test/render-with-client";

import { CharacterControlPanel } from "./character-control-panel";

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    get: apiMock.get,
    post: apiMock.post,
  };
});

const USER_CHAR: Character = {
  id: "uc1",
  name: "Alicya Kucharski",
  nationality: "Brasileira",
  gender: "Feminino",
  birthDate: "1995-09-05T00:00:00.000Z",
  imageUrl: null,
  biography: null,
  dna: {},
  controlledBy: "USER",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const AI_1: AiCharacter = {
  id: "c-ai-1",
  name: "Luca Moretti",
  nationality: "Italiana",
  imageUrl: null,
  controlledBy: "AI",
  userId: null,
};

const AI_2: AiCharacter = {
  id: "c-ai-2",
  name: "Mia Sorensen",
  nationality: "Sueca",
  imageUrl: null,
  controlledBy: "AI",
  userId: null,
};

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  apiMock.get.mockImplementation((url: string) => {
    if (url === "/api/characters") {
      return Promise.resolve({ characters: [USER_CHAR] });
    }
    if (url === "/api/characters/ai") {
      return Promise.resolve({ characters: [AI_1, AI_2] });
    }
    return Promise.reject(new Error(`no mock for ${url}`));
  });
});

describe("CharacterControlPanel", () => {
  it("mostra o personagem atualmente controlado", async () => {
    renderWithClient(<CharacterControlPanel />);
    expect(await screen.findByText(USER_CHAR.name)).toBeTruthy();
  });

  it("lista personagens de IA assumíveis", async () => {
    renderWithClient(<CharacterControlPanel />);
    await screen.findAllByRole("button");
    expect(screen.getByText(AI_1.name)).toBeTruthy();
    expect(screen.getByText(AI_2.name)).toBeTruthy();
  });

  it("troca o controle ao clicar em assumir", async () => {
    const user = userEvent.setup();
    apiMock.post.mockResolvedValueOnce({
      character: { ...AI_1, controlledBy: "USER" },
      releasedCount: 1,
    });
    renderWithClient(<CharacterControlPanel />);
    const buttons = await screen.findAllByRole("button");
    await user.click(buttons[0]);
    expect(apiMock.post).toHaveBeenCalledWith(
      `/api/characters/${AI_1.id}/switch-control`,
      {},
    );
    expect(
      await screen.findByText(/Agora você controla Luca Moretti/i),
    ).toBeTruthy();
  });

  it("mantém o erro 409 visível quando o personagem não é assumível", async () => {
    const user = userEvent.setup();
    apiMock.post.mockRejectedValueOnce(
      new ApiError("Este personagem é controlado por outro usuário", 409),
    );
    renderWithClient(<CharacterControlPanel />);
    const buttons = await screen.findAllByRole("button");
    await user.click(buttons[0]);
    expect(
      await screen.findByText(/controlado por outro usuário/i),
    ).toBeTruthy();
  });
});