import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  return {
    push: vi.fn(),
    refreshNavigation: vi.fn(),
    refreshSession: vi.fn(),
    signUpEmail: vi.fn(),
    signOut: vi.fn(),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mocks.push,
    refresh: mocks.refreshNavigation,
  }),
}));

vi.mock("@/providers/session-provider", () => ({
  useSession: () => ({ refresh: mocks.refreshSession }),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signUp: { email: mocks.signUpEmail },
    signOut: mocks.signOut,
  },
}));

import { RegisterForm } from "./register-form";

const VALID_INPUT = {
  name: "João da Silva",
  email: "joao@email.com",
  password: "senha-segura-123",
  confirmPassword: "senha-segura-123",
};

function fillValid() {
  return {
    user: null as unknown as ReturnType<typeof userEvent.setup>,
    async run() {
      const u = userEvent.setup();
      await u.type(screen.getByLabelText("Nome"), VALID_INPUT.name);
      await u.type(screen.getByLabelText("E-mail"), VALID_INPUT.email);
      await u.type(screen.getByLabelText("Senha"), VALID_INPUT.password);
      await u.type(
        screen.getByLabelText("Confirmar senha"),
        VALID_INPUT.confirmPassword,
      );
    },
  };
}

const submit = async () => {
  const u = userEvent.setup();
  await u.click(screen.getByRole("button", { name: "Cadastrar" }));
};

describe("RegisterForm", () => {
  beforeEach(() => {
    mocks.signUpEmail.mockReset();
    mocks.signOut.mockReset();
    mocks.push.mockReset();
    mocks.refreshNavigation.mockReset();
    mocks.refreshSession.mockReset();
    mocks.signUpEmail.mockResolvedValue({ data: undefined, error: null });
    mocks.signOut.mockResolvedValue({ data: undefined, error: null });
  });

  it("1 - nome vazio: inválido, sessão não submetida", async () => {
    render(<RegisterForm />);
    await submit();

    expect(screen.getByText("Nome é obrigatório.")).toBeTruthy();
    expect(mocks.signUpEmail).not.toHaveBeenCalled();
  });

  it("2 - email vazio: inválido, sessão não submetida", async () => {
    render(<RegisterForm />);
    const u = userEvent.setup();
    await u.type(screen.getByLabelText("Nome"), VALID_INPUT.name);
    await u.type(screen.getByLabelText("Senha"), VALID_INPUT.password);
    await u.type(
      screen.getByLabelText("Confirmar senha"),
      VALID_INPUT.confirmPassword,
    );
    await submit();

    expect(screen.getByText("Informe um e-mail válido.")).toBeTruthy();
    expect(mocks.signUpEmail).not.toHaveBeenCalled();
  });

  it("3 - email malformado: inválido, sessão não submetida", async () => {
    render(<RegisterForm />);
    const u = userEvent.setup();
    await u.type(screen.getByLabelText("Nome"), VALID_INPUT.name);
    await u.type(screen.getByLabelText("E-mail"), "joao@invalido");
    await u.type(screen.getByLabelText("Senha"), VALID_INPUT.password);
    await u.type(
      screen.getByLabelText("Confirmar senha"),
      VALID_INPUT.confirmPassword,
    );
    await submit();

    expect(screen.getByText("Informe um e-mail válido.")).toBeTruthy();
    expect(mocks.signUpEmail).not.toHaveBeenCalled();
  });

  it("4 - senha vazia: inválido, sessão não submetida", async () => {
    render(<RegisterForm />);
    const u = userEvent.setup();
    await u.type(screen.getByLabelText("Nome"), VALID_INPUT.name);
    await u.type(screen.getByLabelText("E-mail"), VALID_INPUT.email);
    await u.type(
      screen.getByLabelText("Confirmar senha"),
      VALID_INPUT.confirmPassword,
    );
    await submit();

    expect(
      screen.getByText("A senha deve ter pelo menos 8 caracteres."),
    ).toBeTruthy();
    expect(mocks.signUpEmail).not.toHaveBeenCalled();
  });

  it("5 - senha curta (<8): inválido, sessão não submetida", async () => {
    render(<RegisterForm />);
    const u = userEvent.setup();
    await u.type(screen.getByLabelText("Nome"), VALID_INPUT.name);
    await u.type(screen.getByLabelText("E-mail"), VALID_INPUT.email);
    await u.type(screen.getByLabelText("Senha"), "curta");
    await u.type(screen.getByLabelText("Confirmar senha"), "curta");
    await submit();

    expect(
      screen.getByText("A senha deve ter pelo menos 8 caracteres."),
    ).toBeTruthy();
    expect(mocks.signUpEmail).not.toHaveBeenCalled();
  });

  it("6 - confirmação vazia: inválido, sessão não submetida", async () => {
    render(<RegisterForm />);
    const u = userEvent.setup();
    await u.type(screen.getByLabelText("Nome"), VALID_INPUT.name);
    await u.type(screen.getByLabelText("E-mail"), VALID_INPUT.email);
    await u.type(screen.getByLabelText("Senha"), VALID_INPUT.password);
    await submit();

    expect(screen.getByText("Confirme a senha.")).toBeTruthy();
    expect(mocks.signUpEmail).not.toHaveBeenCalled();
  });

  it("7 - confirmação diferente: inválido, sessão não submetida", async () => {
    render(<RegisterForm />);
    const u = userEvent.setup();
    await u.type(screen.getByLabelText("Nome"), VALID_INPUT.name);
    await u.type(screen.getByLabelText("E-mail"), VALID_INPUT.email);
    await u.type(screen.getByLabelText("Senha"), VALID_INPUT.password);
    await u.type(
      screen.getByLabelText("Confirmar senha"),
      "outra-senha-diferente",
    );
    await submit();

    expect(screen.getByText("As senhas não coincidem.")).toBeTruthy();
    expect(mocks.signUpEmail).not.toHaveBeenCalled();
  });

  it("8/10 - dados válidos: submit permitido; Better-Auth chamado com o esperado", async () => {
    render(<RegisterForm />);
    const f = fillValid();
    await f.run();
    await submit();

    expect(mocks.signUpEmail).toHaveBeenCalledTimes(1);
    expect(mocks.signUpEmail).toHaveBeenCalledWith({
      name: VALID_INPUT.name,
      email: VALID_INPUT.email,
      password: VALID_INPUT.password,
    });
  });

  it("9 - submit inválido não chama Better-Auth", async () => {
    render(<RegisterForm />);
    const u = userEvent.setup();
    await u.type(screen.getByLabelText("Nome"), VALID_INPUT.name);
    await u.type(screen.getByLabelText("E-mail"), "email-invalido");
    await u.type(screen.getByLabelText("Senha"), "123");
    await u.type(screen.getByLabelText("Confirmar senha"), "456");
    await submit();

    expect(mocks.signUpEmail).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("11 - loading impede submissão duplicada", async () => {
    let resolveSignup!: (value: unknown) => void;
    mocks.signUpEmail.mockImplementation(
      () => new Promise((resolve) => (resolveSignup = resolve)),
    );

    render(<RegisterForm />);
    const f = fillValid();
    await f.run();
    await submit();

    const button = screen.getByRole("button", {
      name: "Cadastrando...",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(mocks.signUpEmail).toHaveBeenCalledTimes(1);

    const u = userEvent.setup();
    await u.click(button);
    expect(mocks.signUpEmail).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSignup({ data: undefined, error: null });
    });
  });

  it("12 - erro do backend exibido de forma compreensível", async () => {
    mocks.signUpEmail.mockResolvedValue({
      data: undefined,
      error: { message: "Este e-mail já está em uso." },
    });

    render(<RegisterForm />);
    const f = fillValid();
    await f.run();
    await submit();

    expect(screen.getByRole("alert").textContent).toContain(
      "Este e-mail já está em uso.",
    );
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("13 - sucesso: signOut, sessão refreshada e redirect para /login", async () => {
    render(<RegisterForm />);
    const f = fillValid();
    await f.run();
    await submit();

    expect(mocks.signUpEmail).toHaveBeenCalledTimes(1);
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(mocks.refreshSession).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledWith("/login");
    expect(mocks.push).not.toHaveBeenCalledWith("/app");
  });

  it("espacos em texto: valores trimados enviados ao backend", async () => {
    render(<RegisterForm />);
    const u = userEvent.setup();
    await u.type(screen.getByLabelText("Nome"), "  João da Silva  ");
    await u.type(screen.getByLabelText("E-mail"), "  joao@email.com  ");
    await u.type(screen.getByLabelText("Senha"), VALID_INPUT.password);
    await u.type(
      screen.getByLabelText("Confirmar senha"),
      VALID_INPUT.confirmPassword,
    );
    await submit();

    expect(mocks.signUpEmail).toHaveBeenCalledTimes(1);
    expect(mocks.signUpEmail).toHaveBeenCalledWith({
      name: "João da Silva",
      email: "joao@email.com",
      password: VALID_INPUT.password,
    });
  });
});