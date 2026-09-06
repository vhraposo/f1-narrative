import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Controller, useForm } from "react-hook-form";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  Select,
  SelectContent,
  SelectTrigger,
} from "./select";

const OPTIONS = [
  { value: "", label: "Todos" },
  { value: "RACE", label: "Corrida" },
  { value: "RACE_INCIDENT", label: "Incidente de corrida" },
  { value: "NEWS", label: "Notícia" },
];

function ControlledSelect({
  onChange,
}: {
  onChange?: (value: string) => void;
}) {
  const [value, setValue] = useState("");
  function handleChange(nextValue: string) {
    setValue(nextValue);
    onChange?.(nextValue);
  }
  return (
    <Select value={value} onValueChange={handleChange} options={OPTIONS}>
      <SelectTrigger aria-label="Filtrar tipo" />
      <SelectContent />
    </Select>
  );
}

async function openSelect(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /filtrar/i }));
}

describe("Select", () => {
  it("renderiza o valor selecionado e abre o dropdown no clique", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ControlledSelect onChange={onChange} />);

    const trigger = screen.getByRole("button", { name: /filtrar/i });
    expect(trigger.textContent).toContain("Todos");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    await openSelect(user);

    expect(screen.getByRole("option", { name: "Corrida" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Notícia" })).toBeTruthy();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    await user.click(screen.getByRole("option", { name: "Incidente de corrida" }));

    expect(onChange).toHaveBeenCalledWith("RACE_INCIDENT");
    expect(screen.queryByRole("option")).toBeNull();
    expect(trigger.textContent).toContain("Incidente de corrida");
    expect(document.activeElement).toBe(trigger);
  });

  it("navega com seta e seleciona com Enter", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ControlledSelect onChange={onChange} />);

    await openSelect(user);
    await user.keyboard("{ArrowDown}{Enter}");

    expect(onChange).toHaveBeenCalledWith("RACE");
    expect(screen.queryByRole("option")).toBeNull();
    expect(
      screen.getByRole("button", { name: /filtrar/i }).textContent,
    ).toContain("Corrida");
  });

  it("fecha com Escape e devolve o foco ao trigger", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ControlledSelect onChange={onChange} />);

    const trigger = screen.getByRole("button", { name: /filtrar/i });
    await openSelect(user);
    expect(screen.getByRole("option", { name: "Corrida" })).toBeTruthy();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("option")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });

  it("fecha ao clicar fora", async () => {
    const user = userEvent.setup();
    render(<ControlledSelect />);

    await openSelect(user);
    expect(screen.getByRole("option", { name: "Corrida" })).toBeTruthy();

    await user.click(document.body);

    expect(screen.queryByRole("option")).toBeNull();
  });

  it("marca o item selecionado e o reflete no trigger", async () => {
    const user = userEvent.setup();
    render(<ControlledSelect />);

    await openSelect(user);
    await user.click(screen.getByRole("option", { name: "Notícia" }));

    await openSelect(user);

    expect(
      screen
        .getByRole("option", { name: "Notícia" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen
        .getByRole("option", { name: "Corrida" })
        .getAttribute("aria-selected"),
    ).toBe("false");
  });

  it("mostra o placeholder quando não há seleção correspondente", () => {
    render(
      <Select
        value=""
        onValueChange={vi.fn()}
        options={OPTIONS.slice(1)}
        placeholder="Selecione um tipo"
      >
        <SelectTrigger aria-label="Filtrar tipo" />
        <SelectContent />
      </Select>,
    );

    expect(
      screen.getByRole("button", { name: /filtrar/i }).textContent,
    ).toContain("Selecione um tipo");
  });

  it("integra com react-hook-form via Controller", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    function RhfProbe() {
      const { control, handleSubmit } = useForm<{ type: string }>({
        defaultValues: { type: "" },
      });
      return (
        <form
          onSubmit={handleSubmit((values) => onSubmit(values.type))}
          aria-label="form"
        >
          <Controller
            control={control}
            name="type"
            render={({ field }) => (
              <Select
                value={field.value}
                onValueChange={field.onChange}
                options={OPTIONS}
              >
                <SelectTrigger aria-label="Filtrar tipo" />
                <SelectContent />
              </Select>
            )}
          />
          <button type="submit">Enviar</button>
        </form>
      );
    }

    render(<RhfProbe />);

    await openSelect(user);
    await user.click(screen.getByRole("option", { name: "Corrida" }));
    await user.click(screen.getByRole("button", { name: "Enviar" }));

    expect(onSubmit).toHaveBeenCalledWith("RACE");
  });
});