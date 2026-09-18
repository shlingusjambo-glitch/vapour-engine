export const DEFAULT_FOCUSABLE_ROLES = ["button", "toggle", "slider"];
const DEFAULTS = {
    crossAxisWeight: 3,
    wrap: false,
    focusableRoles: DEFAULT_FOCUSABLE_ROLES,
};
function center(rect) {
    return [rect.x + rect.width / 2, rect.y + rect.height / 2];
}
/** Nodes that can take focus: visible, enabled, and of a focusable role. */
export function focusableNodes(nodes, options = {}) {
    const roles = new Set(options.focusableRoles ?? DEFAULTS.focusableRoles);
    return nodes.filter((node) => node.visible && node.enabled && roles.has(node.role) && node.rect.width > 0 && node.rect.height > 0);
}
/**
 * The node focus should move to, or `undefined` at the edge.
 *
 * `from` may be `undefined`, which selects a sensible entry point — the
 * top-left focusable node — so a menu opened with a gamepad starts somewhere
 * rather than nowhere.
 */
export function navigate(nodes, from, direction, options = {}) {
    const resolved = { ...DEFAULTS, ...options };
    if (!(resolved.crossAxisWeight >= 0))
        throw new Error("A navigation cross-axis weight must not be negative.");
    const candidates = focusableNodes(nodes, resolved);
    if (candidates.length === 0)
        return undefined;
    const current = from === undefined ? undefined : candidates.find((node) => node.id === from);
    if (!current) {
        // No current focus: enter at the top-left, which is where a reader starts.
        return [...candidates].sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)[0];
    }
    const [cx, cy] = center(current.rect);
    const [alongSign, alongAxis] = direction === "left" ? [-1, 0] : direction === "right" ? [1, 0] : direction === "up" ? [-1, 1] : [1, 1];
    let best;
    let bestScore = Infinity;
    for (const candidate of candidates) {
        if (candidate.id === current.id)
            continue;
        const [x, y] = center(candidate.rect);
        const along = (alongAxis === 0 ? x - cx : y - cy) * alongSign;
        const cross = alongAxis === 0 ? Math.abs(y - cy) : Math.abs(x - cx);
        // Must actually lie in the requested direction.
        if (along <= 0)
            continue;
        const score = along + cross * resolved.crossAxisWeight;
        if (score < bestScore || (score === bestScore && candidate.id < (best?.id ?? ""))) {
            bestScore = score;
            best = candidate;
        }
    }
    if (best || !resolved.wrap)
        return best;
    // Wrapping: re-enter from the opposite edge, keeping the cross-axis position
    // so a wrap feels like continuing rather than jumping to a corner.
    let wrapped;
    let wrappedScore = Infinity;
    for (const candidate of candidates) {
        if (candidate.id === current.id)
            continue;
        const [x, y] = center(candidate.rect);
        const behind = (alongAxis === 0 ? x - cx : y - cy) * alongSign;
        const cross = alongAxis === 0 ? Math.abs(y - cy) : Math.abs(x - cx);
        const score = behind + cross * resolved.crossAxisWeight;
        if (score < wrappedScore) {
            wrappedScore = score;
            wrapped = candidate;
        }
    }
    return wrapped;
}
/**
 * Turns continuous input axes into discrete focus steps.
 *
 * The repeat behaviour is what makes a stick usable for menus: without a
 * threshold and a repeat delay, a held stick moves focus every frame and a
 * player overshoots every time.
 */
export class FocusNavigator {
    #options;
    #focused;
    #heldDirection;
    #heldFor = 0;
    #repeated = false;
    #submitHeld = false;
    #cancelHeld = false;
    constructor(options = {}) {
        this.#options = {
            ...DEFAULTS,
            threshold: options.threshold ?? 0.5,
            repeatDelaySeconds: options.repeatDelaySeconds ?? 0.4,
            repeatIntervalSeconds: options.repeatIntervalSeconds ?? 0.12,
            ...options,
        };
        if (!(this.#options.threshold > 0 && this.#options.threshold <= 1))
            throw new Error("A navigation threshold must lie in (0, 1].");
        if (!(this.#options.repeatDelaySeconds >= 0))
            throw new Error("A navigation repeat delay must not be negative.");
        if (!(this.#options.repeatIntervalSeconds > 0))
            throw new Error("A navigation repeat interval must be positive.");
    }
    get focused() {
        return this.#focused;
    }
    setFocus(id) {
        this.#focused = id;
    }
    /** Advances one frame, returning the events it produced. */
    update(nodes, input, deltaSeconds) {
        if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0)
            throw new Error("Focus navigation requires a finite, non-negative delta.");
        const events = [];
        // Focus can be lost when the UI changes underneath it — a panel closing, a
        // button disabling — so re-enter rather than becoming unresponsive.
        if (this.#focused !== undefined && !focusableNodes(nodes, this.#options).some((node) => node.id === this.#focused)) {
            this.#focused = undefined;
        }
        const direction = this.#directionOf(input);
        if (direction === undefined) {
            this.#heldDirection = undefined;
            this.#heldFor = 0;
            this.#repeated = false;
        }
        else {
            const isNew = direction !== this.#heldDirection;
            if (isNew) {
                this.#heldDirection = direction;
                this.#heldFor = 0;
                this.#repeated = false;
                this.#step(nodes, direction, events);
            }
            else {
                this.#heldFor += deltaSeconds;
                const interval = this.#repeated ? this.#options.repeatIntervalSeconds : this.#options.repeatDelaySeconds;
                if (this.#heldFor >= interval) {
                    this.#heldFor = 0;
                    this.#repeated = true;
                    this.#step(nodes, direction, events);
                }
            }
        }
        // Submit and cancel fire on press, not while held, or a held button would
        // activate a control repeatedly.
        const submit = input.submit ?? false;
        if (submit && !this.#submitHeld)
            events.push({ type: "submit", id: this.#focused });
        this.#submitHeld = submit;
        const cancel = input.cancel ?? false;
        if (cancel && !this.#cancelHeld)
            events.push({ type: "cancel", id: this.#focused });
        this.#cancelHeld = cancel;
        return events;
    }
    #step(nodes, direction, events) {
        const next = navigate(nodes, this.#focused, direction, this.#options);
        if (!next || next.id === this.#focused)
            return;
        this.#focused = next.id;
        events.push({ type: "focus", id: next.id });
    }
    #directionOf(input) {
        const x = input.x ?? 0;
        const y = input.y ?? 0;
        const threshold = this.#options.threshold;
        // The dominant axis wins, so a diagonal push does not move both ways.
        if (Math.abs(x) >= Math.abs(y)) {
            if (x >= threshold)
                return "right";
            if (x <= -threshold)
                return "left";
        }
        if (y >= threshold)
            return "down";
        if (y <= -threshold)
            return "up";
        return undefined;
    }
}
//# sourceMappingURL=navigation.js.map