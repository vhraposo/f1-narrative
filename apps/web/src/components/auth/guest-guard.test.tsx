import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Fronteira de mock: next/navigation (router) e a sessao fornecida pelo
// SessionProvider. O componente real nao faz rede: so consome o contexto.
const mocks = vi.hoisted(() => {
  return {
    replace: vi.fn(),
    session: {
      isPending: false,
      isAuthenticated: false,
    },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock("@/providers/session-provider", () => ({
  useSession: () => mocks.session,
}));

import { GuestGuard } from "./guest-guard";

describe("GuestGuard", () => {
  it("1 - isPending=true: nenhum redirect e splash de loading renderizado", () => {
    mocks.session.isPending = true;
    mocks.session.isAuthenticated = false;
    mocks.replace.mockClear();

    render(
      <GuestGuard>
        <p>form de login</p>
      </GuestGuard>,
    );

    expect(mocks.replace).not.toHaveBeenCalled();
    expect(screen.queryByText("form de login")).toBeNull();
    expect(document.querySelector(".animate-spin")).not.toBeNull();
  });

  it("2 - isAuthenticated=true: router.replace('/app') e children nao ficam como conteudo da rota", () => {
    mocks.session.isPending = false;
    mocks.session.isAuthenticated = true;
    mocks.replace.mockClear();

    render(
      <GuestGuard>
        <p>form de login</p>
      </GuestGuard>,
    );

    expect(mocks.replace).toHaveBeenCalledTimes(1);
    expect(mocks.replace).toHaveBeenCalledWith("/app");
    expect(screen.queryByText("form de login")).toBeNull();
  });

  it("3 - isAuthenticated=false: nenhum redirect e children renderizados", () => {
    mocks.session.isPending = false;
    mocks.session.isAuthenticated = false;
    mocks.replace.mockClear();

    render(
      <GuestGuard>
        <p>form de login</p>
      </GuestGuard>,
    );

    expect(mocks.replace).not.toHaveBeenCalled();
    expect(screen.getByText("form de login")).toBeTruthy();
  });
});