import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { THEME_STORAGE_KEY, ThemeProvider, useTheme } from "./theme-provider";

let systemDark = false;
let mediaListeners: Array<(event: MediaQueryListEvent) => void> = [];

function Probe() {
  const { theme, setTheme, resolvedTheme, mounted } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
      <span data-testid="mounted">{String(mounted)}</span>
      <button type="button" onClick={() => setTheme("light")}>
        light
      </button>
      <button type="button" onClick={() => setTheme("dark")}>
        dark
      </button>
      <button type="button" onClick={() => setTheme("system")}>
        system
      </button>
    </div>
  );
}

function renderThemeProvider() {
  return render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>
  );
}

function fireSystemChange(matches: boolean) {
  systemDark = matches;
  for (const listener of [...mediaListeners]) {
    listener({ matches } as MediaQueryListEvent);
  }
}

beforeEach(() => {
  systemDark = false;
  mediaListeners = [];
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn(() => ({
      matches: systemDark,
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener: (
        _type: string,
        listener: (event: MediaQueryListEvent) => void,
      ) => {
        mediaListeners.push(listener);
      },
      removeEventListener: () => {
        mediaListeners = [];
      },
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ThemeProvider", () => {
  it("default é system; sem tema salvo usa a preferência do sistema", () => {
    renderThemeProvider();
    expect(screen.getByTestId("theme").textContent).toBe("system");
    expect(screen.getByTestId("mounted").textContent).toBe("true");
    expect(screen.getByTestId("resolved").textContent).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("light remove a class dark do documentElement", async () => {
    const user = userEvent.setup();
    renderThemeProvider();
    await user.click(screen.getByRole("button", { name: "light" }));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(screen.getByTestId("theme").textContent).toBe("light");
    expect(screen.getByTestId("resolved").textContent).toBe("light");
  });

  it("dark aplica a class dark e persiste a preferência", async () => {
    const user = userEvent.setup();
    renderThemeProvider();
    await user.click(screen.getByRole("button", { name: "dark" }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(screen.getByTestId("theme").textContent).toBe("dark");
    expect(screen.getByTestId("resolved").textContent).toBe("dark");
  });

  it("system segue a preferência do sistema salva", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "system");
    systemDark = true;
    renderThemeProvider();
    expect(screen.getByTestId("theme").textContent).toBe("system");
    expect(screen.getByTestId("resolved").textContent).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("sem tema salvo, a preferência do sistema é refletida", () => {
    systemDark = true;
    renderThemeProvider();
    expect(screen.getByTestId("theme").textContent).toBe("system");
    expect(screen.getByTestId("resolved").textContent).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("preferência persistida é reaplicada após novo mount", async () => {
    const user = userEvent.setup();
    const { unmount } = renderThemeProvider();
    await user.click(screen.getByRole("button", { name: "dark" }));
    unmount();
    renderThemeProvider();
    expect(screen.getByTestId("theme").textContent).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("mudança do sistema afeta somente quando theme é system", async () => {
    const user = userEvent.setup();
    renderThemeProvider();
    fireSystemChange(true);
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    await user.click(screen.getByRole("button", { name: "light" }));
    fireSystemChange(false);
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    await user.click(screen.getByRole("button", { name: "system" }));
    fireSystemChange(true);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("render server-side não lê localStorage nem matchMedia", () => {
    const storageSpy = vi.spyOn(Storage.prototype, "getItem");
    const matchMediaMock = window.matchMedia as unknown as ReturnType<
      typeof vi.fn
    >;
    matchMediaMock.mockClear();

    const markup = renderToStaticMarkup(
      createElement(ThemeProvider, null, createElement(Probe)),
    );

    expect(storageSpy).not.toHaveBeenCalled();
    expect(matchMediaMock).not.toHaveBeenCalled();
    expect(markup).toContain("system");
    expect(markup).toContain("light");
    expect(markup).toContain("false");
  });
});