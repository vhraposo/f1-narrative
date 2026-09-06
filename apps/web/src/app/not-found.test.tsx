import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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

import NotFound from "./not-found";

describe("NotFound", () => {
  it("1 - isPending=true: nenhum redirect e loading exibido", () => {
    mocks.session.isPending = true;
    mocks.session.isAuthenticated = false;
    mocks.replace.mockClear();

    render(<NotFound />);

    expect(mocks.replace).not.toHaveBeenCalled();
    expect(document.querySelector(".animate-spin")).not.toBeNull();
  });

  it("2 - autenticado: router.replace('/app') exatamente uma vez", () => {
    mocks.session.isPending = false;
    mocks.session.isAuthenticated = true;
    mocks.replace.mockClear();

    render(<NotFound />);

    expect(mocks.replace).toHaveBeenCalledTimes(1);
    expect(mocks.replace).toHaveBeenCalledWith("/app");
  });

  it("3 - não autenticado: router.replace('/login') exatamente uma vez", () => {
    mocks.session.isPending = false;
    mocks.session.isAuthenticated = false;
    mocks.replace.mockClear();

    render(<NotFound />);

    expect(mocks.replace).toHaveBeenCalledTimes(1);
    expect(mocks.replace).toHaveBeenCalledWith("/login");
  });
});