import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "./confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./dialog";

function UncontrolledDialog() {
  return (
    <Dialog>
      <DialogTrigger>Abrir</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Detalhes da temporada</DialogTitle>
          <DialogDescription>Resumo geral do campeonato.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button type="button">Salvar</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmProbe({
  onConfirm,
  isPending = false,
  error = null,
}: {
  onConfirm: () => void;
  isPending?: boolean;
  error?: string | null;
}) {
  const [open, setOpen] = useState(true);
  return (
    <ConfirmDialog
      open={open}
      onClose={() => setOpen(false)}
      title="Excluir personagem"
      description="Deseja excluir esta personagem?"
      onConfirm={onConfirm}
      isPending={isPending}
      error={error}
    />
  );
}

describe("Dialog", () => {
  it("não renderiza o conteúdo enquanto fechado", () => {
    render(<UncontrolledDialog />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("abre pelo gatilho e expõe ARIA (labelledby/describedby) corretos", async () => {
    const user = userEvent.setup();
    render(<UncontrolledDialog />);

    await user.click(screen.getByRole("button", { name: "Abrir" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const title = screen.getByText("Detalhes da temporada");
    expect(dialog.getAttribute("aria-labelledby")).toBe(title.id);
    const description = screen.getByText("Resumo geral do campeonato.");
    expect(dialog.getAttribute("aria-describedby")).toBe(description.id);
  });

  it("foca o primeiro elemento focável ao abrir", async () => {
    const user = userEvent.setup();
    render(<UncontrolledDialog />);

    await user.click(screen.getByRole("button", { name: "Abrir" }));

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Fechar" }),
    );
  });

  it("fecha com Escape e devolve o foco ao gatilho", async () => {
    const user = userEvent.setup();
    render(<UncontrolledDialog />);

    const trigger = screen.getByRole("button", { name: "Abrir" });
    await user.click(trigger);
    expect(screen.getByRole("dialog")).toBeTruthy();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("fecha pelo botão de fechar e restaura o foco", async () => {
    const user = userEvent.setup();
    render(<UncontrolledDialog />);

    const trigger = screen.getByRole("button", { name: "Abrir" });
    await user.click(trigger);

    await user.click(screen.getByRole("button", { name: "Fechar" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("fecha ao clicar no overlay", async () => {
    const user = userEvent.setup();
    render(<UncontrolledDialog />);

    await user.click(screen.getByRole("button", { name: "Abrir" }));
    expect(screen.getByRole("dialog")).toBeTruthy();

    await user.click(screen.getByTestId("dialog-overlay"));

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("mantém o foco dentro do diálogo ao navegar com Tab", async () => {
    const user = userEvent.setup();
    render(<UncontrolledDialog />);

    await user.click(screen.getByRole("button", { name: "Abrir" }));

    const close = screen.getByRole("button", { name: "Fechar" });
    const save = screen.getByRole("button", { name: "Salvar" });

    save.focus();
    await user.keyboard("{Tab}");
    expect(document.activeElement).toBe(close);

    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(document.activeElement).toBe(save);
  });
});

describe("ConfirmDialog", () => {
  it("inicia com foco no botão de cancelar", () => {
    render(<ConfirmProbe onConfirm={vi.fn()} />);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Cancelar" }),
    );
  });

  it("confirma a ação ao clicar em Confirmar", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ConfirmProbe onConfirm={onConfirm} />);

    await user.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("fecha ao clicar em Cancelar", async () => {
    const user = userEvent.setup();
    render(<ConfirmProbe onConfirm={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("em pendência desabilita ações e ignora fechamento", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ConfirmProbe onConfirm={onConfirm} isPending />);

    const cancel = screen.getByRole("button", { name: "Cancelar" });
    const confirm = screen.getByRole("button", {
      name: /Confirmar/,
    });
    expect(cancel.hasAttribute("disabled")).toBe(true);
    expect(confirm.hasAttribute("disabled")).toBe(true);

    await user.keyboard("{Escape}");
    await user.click(screen.getByTestId("dialog-overlay"));

    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("exibe o erro quando informado", () => {
    render(
      <ConfirmProbe onConfirm={vi.fn()} error="Não foi possível remover." />,
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "Não foi possível remover.",
    );
  });
});