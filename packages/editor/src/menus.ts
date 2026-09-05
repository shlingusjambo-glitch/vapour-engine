/**
 * Menu-bar controller.
 *
 * Menus open on click, follow the pointer once one is open (the behaviour every
 * desktop tool has), and close on selection, outside click, or Escape. Items
 * carry `data-action` / `data-create-kind` / `data-bottom-tab`, so the menu owns
 * no command logic — the editor's single action dispatcher does.
 */
export class MenuBar {
  readonly #menus: HTMLElement[];
  #open: HTMLElement | undefined;

  constructor(root: ParentNode, onCommand: (button: HTMLButtonElement) => void) {
    this.#menus = [...root.querySelectorAll<HTMLElement>(".menu")];
    for (const menu of this.#menus) {
      const title = menu.querySelector<HTMLButtonElement>(".menu-title");
      if (title === null) throw new Error("A menu is missing its title button.");
      title.addEventListener("click", (event) => {
        event.stopPropagation();
        this.#toggle(menu);
      });
      title.addEventListener("pointerenter", () => {
        if (this.#open !== undefined && this.#open !== menu) this.#toggle(menu);
      });
      for (const item of menu.querySelectorAll<HTMLButtonElement>(".menu-popup button")) {
        item.addEventListener("click", (event) => {
          event.preventDefault();
          if (item.disabled) return;
          this.closeAll();
          onCommand(item);
        });
      }
    }
    document.addEventListener("click", () => this.closeAll());
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.#open !== undefined) {
        this.closeAll();
        event.stopPropagation();
      }
    });
  }

  /** Greys out commands that cannot run right now instead of letting them fail. */
  setEnabled(predicate: (action: string) => boolean): void {
    for (const menu of this.#menus) {
      for (const item of menu.querySelectorAll<HTMLButtonElement>(".menu-popup button[data-action]")) {
        item.disabled = !predicate(item.dataset.action ?? "");
      }
    }
  }

  closeAll(): void {
    for (const menu of this.#menus) {
      menu.classList.remove("open");
      menu.querySelector(".menu-title")?.setAttribute("aria-expanded", "false");
    }
    this.#open = undefined;
  }

  #toggle(menu: HTMLElement): void {
    const wasOpen = this.#open === menu;
    this.closeAll();
    if (wasOpen) return;
    menu.classList.add("open");
    menu.querySelector(".menu-title")?.setAttribute("aria-expanded", "true");
    this.#open = menu;
  }
}

export type Theme = "dark" | "light";
const THEME_KEY = "vapour.editor.theme";

/** Applies and persists the editor theme. Dark is the default for long
 * sessions; the choice is per-device and never enters project data. */
export function applyTheme(theme: Theme): Theme {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Private-mode storage failures must not break the editor.
  }
  return theme;
}

export function loadTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // Fall through to the default.
  }
  return "dark";
}
