import {
  normalizeComponentData,
  setComponentField,
  type ComponentRecord,
  type ComponentSchema,
  type ComponentSchemaRegistry,
  type FieldSchema,
  type SceneEntityData,
} from "@vapour/engine";

export interface InspectorHost {
  /** Applies an edited component payload. `gestureKey` groups a continuous
   * drag or hold into one undo entry. */
  setComponentData(entityId: string, typeName: string, data: unknown, gestureKey: string): void;
  removeComponent(entityId: string, typeName: string): void;
  endGesture(): void;
  reportError(message: string): void;
}

/**
 * Renders every non-Transform component from its schema.
 *
 * There is no per-component panel code anywhere in the editor: a component
 * gains a working inspector by being registered, which is also how plugin
 * components get one. Transform keeps a dedicated section because it is
 * mandatory and shows Euler degrees over quaternion storage.
 */
export class ComponentInspector {
  readonly #container: HTMLElement;
  readonly #registry: ComponentSchemaRegistry;
  readonly #host: InspectorHost;

  constructor(container: HTMLElement, registry: ComponentSchemaRegistry, host: InspectorHost) {
    this.#container = container;
    this.#registry = registry;
    this.#host = host;
  }

  render(entity: SceneEntityData | undefined): void {
    this.#container.replaceChildren();
    if (entity === undefined) return;
    for (const component of entity.components) {
      if (component.typeName === "vapour.Transform") continue;
      this.#container.append(this.#renderComponent(entity.id, component));
    }
  }

  #renderComponent(entityId: string, component: ComponentRecord): HTMLElement {
    const schema = this.#registry.get(component.typeName);
    const section = document.createElement("section");
    section.className = "component";
    section.dataset.component = component.typeName;

    const header = document.createElement("header");
    const icon = document.createElement("span");
    icon.className = "component-icon";
    icon.textContent = schema?.icon ?? "◇";
    const title = document.createElement("h3");
    title.textContent = schema?.label ?? component.typeName;
    header.append(icon, title);

    if (schema?.removable !== false) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "component-remove";
      remove.textContent = "✕";
      remove.title = `Remove ${schema?.label ?? component.typeName}`;
      remove.addEventListener("click", () => this.#host.removeComponent(entityId, component.typeName));
      header.append(remove);
    }
    section.append(header);

    if (schema === undefined) {
      // An unknown component is real scene data, usually from a plugin that is
      // not loaded. Say so plainly and leave the data untouched rather than
      // dropping it or pretending it is editable.
      const note = document.createElement("p");
      note.className = "component-summary";
      note.textContent = `No schema is registered for '${component.typeName}'. Its data is preserved on save but cannot be edited here.`;
      section.append(note);
      return section;
    }

    const body = document.createElement("div");
    body.className = "component-body";
    let data: Record<string, unknown>;
    try {
      data = normalizeComponentData(schema, component.data);
    } catch (error) {
      const note = document.createElement("p");
      note.className = "component-summary";
      note.textContent = messageOf(error);
      section.append(note);
      return section;
    }
    for (const field of schema.fields) body.append(this.#renderField(entityId, schema, field, data));
    section.append(body);
    return section;
  }

  #renderField(entityId: string, schema: ComponentSchema, field: FieldSchema, data: Record<string, unknown>): HTMLElement {
    const row = document.createElement("div");
    row.className = field.kind === "vector3" || field.kind === "vector2" ? "vector-row" : "field-row";
    const label = document.createElement("label");
    label.textContent = field.label;
    row.append(label);

    const commit = (value: unknown, gesture: string): void => {
      try {
        this.#host.setComponentData(entityId, schema.typeName, setComponentField(schema, data, field.key, value), gesture);
      } catch (error) {
        this.#host.reportError(messageOf(error));
      }
    };
    const gestureKey = `${entityId}:${schema.typeName}:${field.key}`;

    switch (field.kind) {
      case "number": {
        const input = numberInput(Number(data[field.key]), field.step, field.min, field.max);
        input.setAttribute("aria-label", `${schema.label} ${field.label}`);
        input.addEventListener("input", () => { if (input.value !== "") commit(Number(input.value), gestureKey); });
        input.addEventListener("change", () => this.#host.endGesture());
        input.addEventListener("blur", () => this.#host.endGesture());
        row.append(input);
        break;
      }
      case "text": {
        const input = document.createElement("input");
        input.type = "text";
        input.value = String(data[field.key]);
        if (field.placeholder !== undefined) input.placeholder = field.placeholder;
        input.setAttribute("aria-label", `${schema.label} ${field.label}`);
        input.addEventListener("input", () => commit(input.value, gestureKey));
        input.addEventListener("change", () => this.#host.endGesture());
        input.addEventListener("blur", () => this.#host.endGesture());
        row.append(input);
        break;
      }
      case "vector2":
      case "vector3": {
        const values = data[field.key] as number[];
        const axes = field.kind === "vector2" ? [0, 1] : [0, 1, 2];
        for (const axis of axes) {
          const input = numberInput(values[axis]!, field.step);
          input.setAttribute("aria-label", `${schema.label} ${field.label} ${"XYZ"[axis]!}`);
          input.addEventListener("input", () => {
            if (input.value === "") return;
            const next = [...(data[field.key] as number[])];
            next[axis] = Number(input.value);
            commit(next, `${gestureKey}:${String(axis)}`);
          });
          input.addEventListener("change", () => this.#host.endGesture());
          row.append(input);
        }
        break;
      }
      case "color":
      case "colorAlpha": {
        const channels = data[field.key] as number[];
        const wrapper = document.createElement("div");
        wrapper.className = "color-row";
        const picker = document.createElement("input");
        picker.type = "color";
        picker.value = linearToHex(channels);
        picker.setAttribute("aria-label", `${schema.label} ${field.label}`);
        picker.addEventListener("input", () => {
          const linear = hexToLinear(picker.value);
          commit(field.kind === "colorAlpha" ? [...linear, channels[3] ?? 1] : linear, gestureKey);
        });
        picker.addEventListener("change", () => this.#host.endGesture());
        wrapper.append(picker);
        if (field.kind === "colorAlpha") {
          const alpha = numberInput(channels[3] ?? 1, 0.05, 0, 1);
          alpha.title = "Alpha";
          alpha.setAttribute("aria-label", `${schema.label} ${field.label} alpha`);
          alpha.addEventListener("input", () => {
            if (alpha.value === "") return;
            commit([channels[0]!, channels[1]!, channels[2]!, Number(alpha.value)], `${gestureKey}:alpha`);
          });
          alpha.addEventListener("change", () => this.#host.endGesture());
          wrapper.append(alpha);
        }
        row.append(wrapper);
        break;
      }
      case "boolean": {
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = data[field.key] === true;
        input.setAttribute("aria-label", `${schema.label} ${field.label}`);
        input.addEventListener("change", () => { commit(input.checked, gestureKey); this.#host.endGesture(); });
        row.append(input);
        break;
      }
      case "enum": {
        const select = document.createElement("select");
        select.setAttribute("aria-label", `${schema.label} ${field.label}`);
        for (const option of field.options) {
          const element = document.createElement("option");
          element.value = option.value;
          element.textContent = option.label;
          select.append(element);
        }
        select.value = String(data[field.key]);
        select.addEventListener("change", () => { commit(select.value, gestureKey); this.#host.endGesture(); });
        row.append(select);
        break;
      }
    }
    return row;
  }
}

function numberInput(value: number, step?: number, min?: number, max?: number): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "number";
  input.value = String(value);
  if (step !== undefined) input.step = String(step);
  if (min !== undefined) input.min = String(min);
  if (max !== undefined) input.max = String(max);
  return input;
}

/** Materials store linear colour; the browser's colour picker speaks sRGB, so
 * the two are converted rather than silently mismatched. */
export function linearToHex(channels: readonly number[]): string {
  const encode = (value: number): string => {
    const clamped = Math.min(1, Math.max(0, value));
    const srgb = clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
    return Math.round(srgb * 255).toString(16).padStart(2, "0");
  };
  return `#${encode(channels[0] ?? 0)}${encode(channels[1] ?? 0)}${encode(channels[2] ?? 0)}`;
}

export function hexToLinear(hex: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (match === null) throw new Error(`'${hex}' is not a six-digit hex colour.`);
  const decode = (offset: number): number => {
    const srgb = Number.parseInt(match[1]!.slice(offset, offset + 2), 16) / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return [round(decode(0)), round(decode(2)), round(decode(4))];
}

function round(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
