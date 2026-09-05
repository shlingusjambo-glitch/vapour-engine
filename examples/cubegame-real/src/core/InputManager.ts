import { EventBus } from './EventBus';
import { PlatformRuntime } from './PlatformRuntime';
import {
  InputSystem,
  PointerLockController,
  type InputActionDefinition,
  type InputBinding,
} from '@vapour/engine';

export type InputAction =
  | 'moveForward'
  | 'moveBackward'
  | 'moveLeft'
  | 'moveRight'
  | 'jump'
  | 'sprint'
  | 'crouch'
  | 'inventory'
  | 'drop'
  | 'chat'
  | 'pause'
  | 'attack'
  | 'place'
  | 'pickBlock'
  | 'zoom';

export class InputManager {
  private static input: InputSystem | null = null;
  private static pointerLock: PointerLockController | null = null;
  private static pointerLocked: boolean = false;
  private static activeElement: HTMLElement | null = null;
  private static ctrlWSneakActive: boolean = false;
  private static captureBinding: { action: InputAction; done: () => void } | null = null;
  private static secretPhraseBuffer: string = '';
  private static secretPhraseCooldownUntil = 0;

  private static readonly bindingStorageKey = 'cubegame.inputBindings.v3';
  private static readonly actionLabels: Record<InputAction, string> = {
    moveForward: 'Forward',
    moveBackward: 'Back',
    moveLeft: 'Left',
    moveRight: 'Right',
    jump: 'Jump',
    sprint: 'Sprint',
    crouch: 'Crouch',
    inventory: 'Inventory',
    drop: 'Drop Item',
    chat: 'Chat',
    pause: 'Pause',
    attack: 'Attack / Break',
    place: 'Place / Use',
    pickBlock: 'Pick Block',
    zoom: 'Zoom',
  };
  private static readonly defaultBindings: Record<InputAction, string[]> = {
    moveForward: ['w', 'keyw', 'arrowup'],
    moveBackward: ['s', 'keys', 'arrowdown'],
    moveLeft: ['a', 'keya', 'arrowleft'],
    moveRight: ['d', 'keyd', 'arrowright'],
    jump: [' ', 'space'],
    sprint: ['shift', 'shiftleft', 'shiftright'],
    crouch: ['control', 'ctrl', 'controlleft', 'controlright'],
    inventory: ['e', 'keye'],
    drop: ['q', 'keyq'],
    chat: ['enter'],
    pause: ['escape'],
    attack: ['mouse0'],
    place: ['mouse2'],
    pickBlock: ['mouse1'],
    zoom: ['c', 'keyc'],
  };
  private static bindings: Record<InputAction, string[]> = { ...InputManager.defaultBindings };

  public static isUIActive: boolean = false;
  
  // Track cumulative horizontal mouse movement for camera rotation
  private static cumulativeMouseX: number = 0;

  // Mobile mode variables
  private static mobileMode: boolean = false;
  public static mobileMoveX: number = 0;
  public static mobileMoveY: number = 0;
  private static mobileMoveForward: boolean = false;
  private static mobileMoveBackward: boolean = false;
  private static mobileMoveLeft: boolean = false;
  private static mobileMoveRight: boolean = false;
  public static mobileJump: boolean = false;
  public static mobileSneak: boolean = false;
  public static mobileLeftMouseDown: boolean = false;
  public static mobileRightMouseDown: boolean = false;
  private static mobileGameplayVisible: boolean = false;
  private static mobileVisibilityTimer: number | null = null;

  public static init(element: HTMLElement): void {
    this.activeElement = element;
    this.loadKeyBindings();
    this.input?.detach();
    this.input = new InputSystem(this.createActionDefinitions());
    this.input.attach(window);
    this.pointerLock?.detach();
    this.pointerLock = new PointerLockController(element, {
      onChange: (locked) => {
        this.pointerLocked = locked;
        if (!locked) this.input?.resetDeviceState();
        EventBus.emit('pointerlockchange', locked);
      },
      onError: () => {
        EventBus.emit('network:chat', '[Input] Pointer lock failed. Click the game canvas again, or use the Electron/Chromium desktop build.');
      },
    });
    this.pointerLock.attach();

    EventBus.on('mobile:gameplayControls', (visible: boolean) => {
      this.mobileGameplayVisible = Boolean(visible);
      this.updateMobileControlsVisibility();
    });

    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    window.addEventListener('mousedown', (e) => this.onMouseDown(e));
    window.addEventListener('mouseup', (e) => this.onMouseUp(e));
    window.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    element.addEventListener('contextmenu', (e) => e.preventDefault());
    element.addEventListener('pointerdown', () => this.lockPointer());
    element.tabIndex = 0;
    element.style.cursor = 'crosshair';

    // Chat open/close: release pointer lock so keyboard reaches the input field
    EventBus.on('chat:active', (active: boolean) => {
      this.isUIActive = active;
      if (active) {
        // Release pointer lock so OS delivers keystrokes to the <input>
        if (document.pointerLockElement) {
          document.exitPointerLock();
        }
        // In Electron/file:// context the input may need an explicit focus pump
        const chatInput = document.getElementById('chat-input') as HTMLInputElement | null;
        if (chatInput) {
          chatInput.removeAttribute('disabled');
          chatInput.style.pointerEvents = 'auto';
          requestAnimationFrame(() => {
            chatInput.focus();
            chatInput.click();
          });
        }
      }
    });

    this.initMobileListeners();
  }

  public static lockPointer(): void {
    if (this.mobileMode) return; // Disable pointer lock on mobile
    if (!this.activeElement || this.pointerLocked || this.isUIActive) return;

    try { this.activeElement.focus({ preventScroll: true }); } catch { this.activeElement.focus?.(); }
    void this.pointerLock?.lock();
  }

  public static unlockPointer(): void {
    void this.pointerLock?.unlock();
  }

  public static isPointerLocked(): boolean {
    return this.pointerLocked;
  }

  public static isLeftMouseDown(): boolean {
    if (this.isUIActive) return false;
    return this.input?.action('attack').pressed ?? this.mobileLeftMouseDown;
  }

  public static isRightMouseDown(): boolean {
    if (this.isUIActive) return false;
    return this.input?.action('place').pressed ?? this.mobileRightMouseDown;
  }

  public static isKeyDown(key: string): boolean {
    if (this.isUIActive) return false;
    if (this.mobileMode) {
      const k = key.toLowerCase();
      if (k === 'w') return this.isActionDown('moveForward');
      if (k === 's') return this.isActionDown('moveBackward');
      if (k === 'd') return this.isActionDown('moveRight');
      if (k === 'a') return this.isActionDown('moveLeft');
      if (k === ' ' || k === 'space') return this.mobileJump;
      if (k === 'shift') return this.mobileSneak;
      if (k === 'control' || k === 'ctrl') return false;
    }
    const action = this.actionForLegacyKey(key);
    return action === null ? false : this.isActionDown(action);
  }

  public static isActionDown(action: InputAction): boolean {
    if (this.isUIActive) return false;
    return this.input?.action(action).pressed ?? false;
  }

  /** Resolves physical, gamepad, and mobile inputs once at frame start. */
  public static update(): void {
    if (this.input === null) return;
    this.input.setVirtualAction('moveForward', this.mobileMoveForward || this.mobileMoveY > 0.15 ? 1 : 0);
    this.input.setVirtualAction('moveBackward', this.mobileMoveBackward || this.mobileMoveY < -0.15 ? 1 : 0);
    this.input.setVirtualAction('moveRight', this.mobileMoveRight || this.mobileMoveX > 0.15 ? 1 : 0);
    this.input.setVirtualAction('moveLeft', this.mobileMoveLeft || this.mobileMoveX < -0.15 ? 1 : 0);
    this.input.setVirtualAction('jump', this.mobileJump ? 1 : 0);
    this.input.setVirtualAction('crouch', this.mobileSneak || this.ctrlWSneakActive ? 1 : 0);
    this.input.setVirtualAction('sprint', (this.mobileMoveForward && !this.mobileSneak) || this.mobileMoveY > 0.82 ? 1 : 0);
    this.input.setVirtualAction('attack', this.mobileLeftMouseDown ? 1 : 0);
    this.input.setVirtualAction('place', this.mobileRightMouseDown ? 1 : 0);
    this.input.setVirtualAction('moveForward', this.ctrlWSneakActive ? 1 : (this.mobileMoveForward || this.mobileMoveY > 0.15 ? 1 : 0));
    this.input.update(typeof navigator === 'undefined' ? [] : Array.from(navigator.getGamepads?.() ?? []));
  }

  public static getActionLabel(action: InputAction): string {
    return this.actionLabels[action];
  }

  public static getPrimaryBinding(action: InputAction): string {
    return this.getBindings(action)[0] || '';
  }

  public static getBindingsSnapshot(): Record<InputAction, string[]> {
    return {
      moveForward: [...this.getBindings('moveForward')],
      moveBackward: [...this.getBindings('moveBackward')],
      moveLeft: [...this.getBindings('moveLeft')],
      moveRight: [...this.getBindings('moveRight')],
      jump: [...this.getBindings('jump')],
      sprint: [...this.getBindings('sprint')],
      crouch: [...this.getBindings('crouch')],
      inventory: [...this.getBindings('inventory')],
      drop: [...this.getBindings('drop')],
      chat: [...this.getBindings('chat')],
      pause: [...this.getBindings('pause')],
      attack: [...this.getBindings('attack')],
      place: [...this.getBindings('place')],
      pickBlock: [...this.getBindings('pickBlock')],
      zoom: [...this.getBindings('zoom')],
    };
  }

  public static setPrimaryBinding(action: InputAction, key: string): void {
    const normalized = this.normalizeBindingKey(key);
    if (!normalized) return;
    const defaults = this.defaultBindings[action] || [];
    const next = [normalized, ...defaults.filter(value => value !== normalized)];
    this.bindings[action] = next;
    this.syncActionBindings(action);
    this.saveKeyBindings();
    EventBus.emit('input:bindingsChanged', this.getBindingsSnapshot());
  }

  public static resetKeyBindings(): void {
    this.bindings = this.cloneBindings(this.defaultBindings);
    this.syncAllActionBindings();
    this.saveKeyBindings();
    EventBus.emit('input:bindingsChanged', this.getBindingsSnapshot());
  }

  public static flipSprintCrouch(): void {
    const sprint = [...this.getBindings('sprint')];
    const crouch = [...this.getBindings('crouch')];
    this.bindings.sprint = crouch;
    this.bindings.crouch = sprint;
    this.syncActionBindings('sprint');
    this.syncActionBindings('crouch');
    this.saveKeyBindings();
    EventBus.emit('input:bindingsChanged', this.getBindingsSnapshot());
  }

  public static captureNextBinding(action: InputAction, done: () => void): void {
    this.captureBinding = { action, done };
  }

  public static getMouseDelta(): { x: number; y: number } {
    return {
      x: this.input?.action('lookX').value ?? 0,
      y: this.input?.action('lookY').value ?? 0,
    };
  }

  public static getCumulativeMouseX(): number {
    const val = this.input?.action('lookX').value ?? this.cumulativeMouseX;
    this.cumulativeMouseX = 0;
    return val;
  }

  private static onKeyDown(e: KeyboardEvent): void {
    const key = e.key.toLowerCase();
    const code = e.code.toLowerCase();
    this.captureSecretPhraseKey(e);
    const activeTag = document.activeElement?.tagName;
    const isTyping = activeTag === 'INPUT' ||
      activeTag === 'TEXTAREA' ||
      (document.activeElement instanceof HTMLElement && document.activeElement.isContentEditable);

    if (this.captureBinding) {
      e.preventDefault();
      e.stopPropagation();
      if (key !== 'escape') {
        this.setPrimaryBinding(this.captureBinding.action, code || key);
      }
      const done = this.captureBinding.done;
      this.captureBinding = null;
      done();
      return;
    }

    if (isTyping) {
      const activeElement = document.activeElement as HTMLElement | null;
      const isChatInput = activeElement?.id === 'chat-input';

      // Only the in-game chat input should let Enter reach the global chat
      // submit path. Auth fields, server-link fields, and modals have their own
      // local Enter handlers, so letting the global input mapper see Enter can
      // accidentally open/close gameplay UI or trigger a stale Pause binding.
      if (isChatInput && this.eventMatchesAction(e, 'chat')) {
        e.preventDefault();
        e.stopPropagation();
        EventBus.emit('press:enter');
      }
      return;
    }

    if (key === 'f3') {
      e.preventDefault();
      EventBus.emit('debug:toggleF3');
      return;
    }

    if (key === 'f5') {
      e.preventDefault();
      e.stopPropagation();
      EventBus.emit('camera:cycleView');
      return;
    }

    if (key === 'w' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.stopPropagation();
      this.ctrlWSneakActive = true;

      if (!PlatformRuntime.isNativeHost()) {
        console.info('Ctrl+W is mapped to crouch+forward in-game. Some browsers may still reserve it as a tab shortcut.');
      }
      return;
    }

    if (this.isGameControlKey(key, code)) {
      e.preventDefault();
    }
    
    // Toggle inventory (E) or escape UI/Pause
    if (this.eventMatchesAction(e, 'inventory')) {
      e.preventDefault();
      EventBus.emit('toggle:inventory');
    } else if (this.eventMatchesAction(e, 'pause') && key !== 'enter') {
      e.preventDefault();
      EventBus.emit('toggle:pause');
    } else if (this.eventMatchesAction(e, 'chat')) {
      e.preventDefault();
      EventBus.emit('press:enter');
    } else if (this.eventMatchesAction(e, 'drop')) {
      e.preventDefault();
      EventBus.emit('inventory:drop');
    }

    // Hotbar selector 1-9
    if (e.key >= '1' && e.key <= '9') {
      const index = parseInt(e.key) - 1;
      EventBus.emit('hotbar:select', index);
    }
  }

  private static captureSecretPhraseKey(e: KeyboardEvent): void {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key.length !== 1) return;

    const char = e.key.toLowerCase();
    if (!/^[a-z]$/.test(char)) return;

    this.secretPhraseBuffer = (this.secretPhraseBuffer + char).slice(-24);
    const now = performance.now();
    if (now < this.secretPhraseCooldownUntil) return;

    if (this.secretPhraseBuffer.endsWith('backrooms')) {
      this.secretPhraseCooldownUntil = now + 2500;
      this.secretPhraseBuffer = '';
      EventBus.emit('command:backrooms');
    }
  }

  private static onKeyUp(e: KeyboardEvent): void {
    const key = e.key.toLowerCase();
    const code = e.code.toLowerCase();
    if (this.ctrlWSneakActive && (key === 'w' || key === 'control' || key === 'ctrl' || key === 'meta' || code === 'keyw')) {
      this.ctrlWSneakActive = false;
    }
  }

  private static isGameControlKey(key: string, code: string): boolean {
    const normalizedKey = this.normalizeBindingKey(key);
    const normalizedCode = this.normalizeBindingKey(code);
    const bindingKeys = Object.values(this.bindings).flat();
    return bindingKeys.includes(normalizedKey) ||
      bindingKeys.includes(normalizedCode) ||
      key.startsWith('arrow') ||
      code === 'space';
  }

  private static onMouseMove(e: MouseEvent): void {
    if (this.pointerLocked) {
      // Track cumulative horizontal movement for camera rotation
      this.cumulativeMouseX += e.movementX;
    }
  }

  private static onMouseDown(e: MouseEvent): void {
    const mouseKey = `mouse${e.button}`;

    if (this.captureBinding) {
      e.preventDefault();
      e.stopPropagation();
      this.setPrimaryBinding(this.captureBinding.action, mouseKey);
      const done = this.captureBinding.done;
      this.captureBinding = null;
      done();
      return;
    }

    if (this.mobileMode) return; // Ignore on mobile
    if (!this.pointerLocked && !this.isUIActive) {
      this.lockPointer();
    }

    if (this.isUIActive) return;

    if (this.getBindings('attack').includes(mouseKey)) {
      EventBus.emit('mouse:leftClick');
    }
    if (this.getBindings('place').includes(mouseKey)) {
      EventBus.emit('mouse:rightClick');
    }
    if (this.getBindings('pickBlock').includes(mouseKey)) {
      EventBus.emit('mouse:middleClick');
    }
  }

  private static onMouseUp(e: MouseEvent): void {
    if (this.isUIActive) {
      return;
    }

    const mouseKey = `mouse${e.button}`;
    if (this.getBindings('attack').includes(mouseKey)) {
      EventBus.emit('mouse:leftRelease');
    }
    if (this.getBindings('place').includes(mouseKey)) {
      EventBus.emit('mouse:rightRelease');
    }
  }

  private static onWheel(e: WheelEvent): void {
    if (this.isUIActive) return;

    e.preventDefault();
    // Increased scroll threshold to reduce sensitivity (was 1, now 30)
    if (Math.abs(e.deltaY) < 30) return;
    EventBus.emit('hotbar:scroll', e.deltaY > 0 ? 1 : -1);
  }

  public static isMobileMode(): boolean {
    return this.mobileMode;
  }

  private static initMobileListeners(): void {
    const toggleBtn = document.getElementById('mobile-toggle-btn');
    const controls = document.getElementById('mobile-controls');
    if (!toggleBtn || !controls) return;

    this.mobileMode = this.shouldUseMobileControls();
    this.mobileGameplayVisible = false;
    toggleBtn.style.display = 'none';
    document.body.classList.toggle('force-mobile-controls', this.mobileMode);
    document.body.classList.toggle('mobile-controls-capable', this.mobileMode);
    this.updateMobileControlsVisibility();
    if (this.mobileMode) {
      this.unlockPointer();
      try { document.documentElement.style.touchAction = 'none'; } catch { /* ignore */ }
      try { document.body.style.touchAction = 'none'; } catch { /* ignore */ }
      if (this.mobileVisibilityTimer === null) {
        this.mobileVisibilityTimer = window.setInterval(() => this.updateMobileControlsVisibility(), 120);
      }
    }
    EventBus.emit('mobile:modeChanged', this.mobileMode);

    const setPressedClass = (id: string, pressed: boolean) => {
      const element = document.getElementById(id);
      if (element) element.classList.toggle('pressed', pressed);
    };

    const bindHold = (id: string, startAction: () => void, endAction: () => void) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      let activePointer: number | null = null;
      const start = (ev: Event) => {
        if (!this.mobileMode) return;
        ev.stopPropagation();
        ev.preventDefault();
        const pointer = ev as PointerEvent;
        if ('pointerId' in pointer) {
          activePointer = pointer.pointerId;
          try { (btn as HTMLElement).setPointerCapture(pointer.pointerId); } catch { /* ignore */ }
        }
        setPressedClass(id, true);
        startAction();
      };
      const end = (ev: Event) => {
        if (!this.mobileMode) return;
        ev.stopPropagation();
        ev.preventDefault();
        const pointer = ev as PointerEvent;
        if ('pointerId' in pointer && activePointer !== null && pointer.pointerId !== activePointer) return;
        if ('pointerId' in pointer) {
          try { (btn as HTMLElement).releasePointerCapture(pointer.pointerId); } catch { /* ignore */ }
        }
        activePointer = null;
        setPressedClass(id, false);
        endAction();
      };
      if ('PointerEvent' in window) {
        btn.addEventListener('pointerdown', start, { passive: false });
        btn.addEventListener('pointerup', end, { passive: false });
        btn.addEventListener('pointercancel', end, { passive: false });
        btn.addEventListener('pointerleave', end, { passive: false });
      } else {
        // Fallback for very old WebKit versions.
        btn.addEventListener('touchstart', start, { passive: false });
        btn.addEventListener('touchend', end, { passive: false });
        btn.addEventListener('touchcancel', end, { passive: false });
        btn.addEventListener('mousedown', start);
        btn.addEventListener('mouseup', end);
      }
    };

    const applyMobileMoveVector = (xRaw: number, yRaw: number) => {
      const deadZone = 0.18;
      const x = Math.abs(xRaw) < deadZone ? 0 : Math.max(-1, Math.min(1, xRaw));
      const y = Math.abs(yRaw) < deadZone ? 0 : Math.max(-1, Math.min(1, yRaw));
      this.mobileMoveX = x;
      this.mobileMoveY = y;
      this.mobileMoveForward = y > deadZone;
      this.mobileMoveBackward = y < -deadZone;
      this.mobileMoveRight = x > deadZone;
      this.mobileMoveLeft = x < -deadZone;
      setPressedClass('mobile-btn-forward', this.mobileMoveForward);
      setPressedClass('mobile-btn-backward', this.mobileMoveBackward);
      setPressedClass('mobile-btn-left', this.mobileMoveLeft);
      setPressedClass('mobile-btn-right', this.mobileMoveRight);
    };

    const clearMobileMoveVector = () => applyMobileMoveVector(0, 0);

    // Mobile D-pad behaves like Minecraft PE: press anywhere on the pad, then
    // drag across it to change direction without lifting your thumb.
    const dpad = document.getElementById('mobile-dpad') as HTMLElement | null;
    if (dpad) {
      let activeDpadPointer: number | null = null;
      const updateDpadVector = (ev: PointerEvent) => {
        const rect = dpad.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const centerX = rect.left + rect.width * 0.5;
        const centerY = rect.top + rect.height * 0.5;
        const radius = Math.max(36, Math.min(rect.width, rect.height) * 0.36);
        let x = (ev.clientX - centerX) / radius;
        let y = (centerY - ev.clientY) / radius;
        const mag = Math.hypot(x, y);
        if (mag > 1) {
          x /= mag;
          y /= mag;
        }
        applyMobileMoveVector(x, y);
      };
      const startDpad = (ev: PointerEvent) => {
        if (!this.mobileMode || ev.pointerType === 'mouse') return;
        if (ev.target instanceof Element && ev.target.closest('#mobile-btn-sneak')) return;
        activeDpadPointer = ev.pointerId;
        try { dpad.setPointerCapture(ev.pointerId); } catch { /* older WebKit may ignore capture */ }
        updateDpadVector(ev);
        ev.stopPropagation();
        ev.preventDefault();
      };
      const moveDpad = (ev: PointerEvent) => {
        if (!this.mobileMode || activeDpadPointer !== ev.pointerId) return;
        updateDpadVector(ev);
        ev.stopPropagation();
        ev.preventDefault();
      };
      const endDpad = (ev: PointerEvent) => {
        if (activeDpadPointer !== ev.pointerId) return;
        try { dpad.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
        activeDpadPointer = null;
        clearMobileMoveVector();
        ev.stopPropagation();
        ev.preventDefault();
      };
      dpad.addEventListener('pointerdown', startDpad, { passive: false });
      dpad.addEventListener('pointermove', moveDpad, { passive: false });
      dpad.addEventListener('pointerup', endDpad, { passive: false });
      dpad.addEventListener('pointercancel', endDpad, { passive: false });
      dpad.addEventListener('lostpointercapture', () => clearMobileMoveVector());
    }

    bindHold('mobile-btn-attack',
      () => { this.mobileLeftMouseDown = true; EventBus.emit('mouse:leftClick'); },
      () => { this.mobileLeftMouseDown = false; EventBus.emit('mouse:leftRelease'); }
    );
    bindHold('mobile-btn-place',
      () => { this.mobileRightMouseDown = true; EventBus.emit('mouse:rightClick'); },
      () => { this.mobileRightMouseDown = false; EventBus.emit('mouse:rightRelease'); }
    );
    bindHold('mobile-btn-jump',
      () => { this.mobileJump = true; },
      () => { this.mobileJump = false; }
    );
    bindHold('mobile-btn-sneak',
      () => { this.mobileSneak = true; },
      () => { this.mobileSneak = false; }
    );
    bindHold('mobile-btn-inventory',
      () => { EventBus.emit('toggle:inventory'); },
      () => {}
    );
    bindHold('mobile-btn-prev',
      () => { EventBus.emit('hotbar:scroll', -1); },
      () => {}
    );
    bindHold('mobile-btn-next',
      () => { EventBus.emit('hotbar:scroll', 1); },
      () => {}
    );
    bindHold('mobile-btn-chat',
      () => { EventBus.emit('press:enter'); },
      () => {}
    );
    bindHold('mobile-btn-pause',
      () => { EventBus.emit('toggle:pause'); },
      () => {}
    );

    // Touch look swiping: only use touches that begin outside the D-pad/action controls.
    let lookPointerId: number | null = null;
    let lastTouchX = 0;
    let lastTouchY = 0;

    const isInsideMobileControl = (target: EventTarget | null): boolean => {
      return target instanceof Element && Boolean(target.closest('#mobile-dpad, #mobile-action-stack, #mobile-top-buttons'));
    };

    window.addEventListener('pointerdown', (e) => {
      if (!this.mobileMode || this.isUIActive || lookPointerId !== null) return;
      if (isInsideMobileControl(e.target)) return;
      if (e.pointerType === 'mouse') return;
      lookPointerId = e.pointerId;
      lastTouchX = e.clientX;
      lastTouchY = e.clientY;
      e.preventDefault();
    }, { passive: false });

    window.addEventListener('pointermove', (e) => {
      if (!this.mobileMode || this.isUIActive || lookPointerId !== e.pointerId) return;
      const dx = e.clientX - lastTouchX;
      const dy = e.clientY - lastTouchY;
      this.input?.addPointerDelta(dx * 1.75, dy * 1.75);
      lastTouchX = e.clientX;
      lastTouchY = e.clientY;
      e.preventDefault();
    }, { passive: false });

    const endLook = (e: PointerEvent) => {
      if (lookPointerId === e.pointerId) lookPointerId = null;
    };
    window.addEventListener('pointerup', endLook);
    window.addEventListener('pointercancel', endLook);

    // Prevent Safari/WebKit viewport gestures from stealing game touches while controls are active.
    window.addEventListener('touchmove', (e) => {
      if (!this.mobileMode || this.isUIActive) return;
      e.preventDefault();
    }, { passive: false });
  }

  private static eventMatchesAction(e: KeyboardEvent, action: InputAction): boolean {
    if (this.mobileMode) return false;
    const key = this.normalizeBindingKey(e.key);
    const code = this.normalizeBindingKey(e.code);
    return this.getBindings(action).includes(key) || this.getBindings(action).includes(code);
  }

  private static getBindings(action: InputAction): string[] {
    return this.bindings[action] || this.defaultBindings[action] || [];
  }

  private static createActionDefinitions(): InputActionDefinition[] {
    const definitions: InputActionDefinition[] = (Object.keys(this.defaultBindings) as InputAction[]).map((action) => ({
      name: action,
      kind: 'button' as const,
      bindings: this.engineBindings(action),
    }));
    definitions.push(
      { name: 'lookX', kind: 'delta', bindings: [{ device: 'pointer', axis: 'x' }] },
      { name: 'lookY', kind: 'delta', bindings: [{ device: 'pointer', axis: 'y' }] },
    );
    return definitions;
  }

  private static syncAllActionBindings(): void {
    for (const action of Object.keys(this.defaultBindings) as InputAction[]) this.syncActionBindings(action);
  }

  private static syncActionBindings(action: InputAction): void {
    this.input?.setBindings(action, this.engineBindings(action));
  }

  private static engineBindings(action: InputAction): InputBinding[] {
    const bindings: InputBinding[] = [];
    const seen = new Set<string>();
    for (const key of this.getBindings(action)) {
      const mouse = /^mouse(\d+)$/.exec(key);
      if (mouse !== null) {
        const button = Number(mouse[1]);
        const identity = `pointer:${String(button)}`;
        if (!seen.has(identity)) bindings.push({ device: 'pointer', button });
        seen.add(identity);
        continue;
      }
      const code = this.browserCode(key);
      if (code !== null && !seen.has(`keyboard:${code}`)) {
        bindings.push({ device: 'keyboard', code });
        seen.add(`keyboard:${code}`);
      }
    }
    const gamepad = this.gamepadBinding(action);
    if (gamepad !== null) bindings.push(gamepad);
    return bindings;
  }

  private static gamepadBinding(action: InputAction): InputBinding | null {
    if (action === 'moveForward') return { device: 'gamepad', gamepad: 0, control: 'axis', index: 1, scale: -1, deadZone: 0.18 };
    if (action === 'moveBackward') return { device: 'gamepad', gamepad: 0, control: 'axis', index: 1, scale: 1, deadZone: 0.18 };
    if (action === 'moveLeft') return { device: 'gamepad', gamepad: 0, control: 'axis', index: 0, scale: -1, deadZone: 0.18 };
    if (action === 'moveRight') return { device: 'gamepad', gamepad: 0, control: 'axis', index: 0, scale: 1, deadZone: 0.18 };
    const buttons: Partial<Record<InputAction, number>> = {
      jump: 0, inventory: 3, sprint: 10, crouch: 11, attack: 7, place: 6, pause: 9,
    };
    const index = buttons[action];
    return index === undefined ? null : { device: 'gamepad', gamepad: 0, control: 'button', index };
  }

  private static browserCode(key: string): string | null {
    const normalized = this.normalizeBindingKey(key);
    if (normalized === ' ' || normalized === 'space') return 'Space';
    if (/^key[a-z]$/.test(normalized)) return `Key${normalized.slice(3).toUpperCase()}`;
    if (/^[a-z]$/.test(normalized)) return `Key${normalized.toUpperCase()}`;
    if (/^digit[0-9]$/.test(normalized)) return `Digit${normalized.slice(5)}`;
    if (/^[0-9]$/.test(normalized)) return `Digit${normalized}`;
    const known: Record<string, string> = {
      arrowup: 'ArrowUp', arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight',
      shift: 'ShiftLeft', shiftleft: 'ShiftLeft', shiftright: 'ShiftRight',
      control: 'ControlLeft', ctrl: 'ControlLeft', controlleft: 'ControlLeft', controlright: 'ControlRight',
      enter: 'Enter', numpadenter: 'NumpadEnter', escape: 'Escape', tab: 'Tab',
    };
    return known[normalized] ?? (normalized === '' ? null : key);
  }

  private static actionForLegacyKey(key: string): InputAction | null {
    const normalized = this.normalizeBindingKey(key);
    for (const action of Object.keys(this.defaultBindings) as InputAction[]) {
      if (this.getBindings(action).includes(normalized)) return action;
    }
    return null;
  }

  private static normalizeBindingKey(key: string): string {
    const normalized = String(key || '').trim().toLowerCase();
    if (normalized === 'spacebar') return 'space';
    if (normalized === 'control') return 'control';
    if (normalized === 'ctrl') return 'ctrl';
    if (normalized === ' ') return ' ';
    return normalized;
  }

  private static cloneBindings(source: Record<InputAction, string[]>): Record<InputAction, string[]> {
    return {
      moveForward: [...source.moveForward],
      moveBackward: [...source.moveBackward],
      moveLeft: [...source.moveLeft],
      moveRight: [...source.moveRight],
      jump: [...source.jump],
      sprint: [...source.sprint],
      crouch: [...source.crouch],
      inventory: [...source.inventory],
      drop: [...source.drop],
      chat: [...source.chat],
      pause: [...source.pause],
      attack: [...source.attack],
      place: [...source.place],
      pickBlock: [...source.pickBlock],
      zoom: [...source.zoom],
    };
  }

  private static loadKeyBindings(): void {
    this.bindings = this.cloneBindings(this.defaultBindings);
    try {
      const raw = localStorage.getItem(this.bindingStorageKey);
      if (!raw) return;
      const saved = JSON.parse(raw);
      for (const action of Object.keys(this.defaultBindings) as InputAction[]) {
        if (Array.isArray(saved?.[action]) && saved[action].length > 0) {
          this.bindings[action] = saved[action]
            .map((key: unknown) => this.normalizeBindingKey(String(key)))
            .filter(Boolean)
            .slice(0, 4);
        }
      }

      // A previous broken desktop build could save Enter as Pause. Keep Enter
      // reserved for chat/forms so pressing it can never open the pause menu.
      this.bindings.pause = this.bindings.pause
        .filter(key => key !== 'enter' && key !== 'numpadenter');
      if (this.bindings.pause.length === 0) {
        this.bindings.pause = [...this.defaultBindings.pause];
      }
      this.saveKeyBindings();
      return;
    } catch {
      this.bindings = this.cloneBindings(this.defaultBindings);
    }
  }

  private static saveKeyBindings(): void {
    try {
      localStorage.setItem(this.bindingStorageKey, JSON.stringify(this.bindings));
    } catch {
      // localStorage can be unavailable in privacy modes.
    }
  }

  private static updateMobileControlsVisibility(): void {
    const controls = document.getElementById('mobile-controls') as HTMLElement | null;
    const toggleBtn = document.getElementById('mobile-toggle-btn') as HTMLElement | null;
    const visible = this.mobileMode && this.mobileGameplayVisible && !this.isUIActive;

    if (toggleBtn) toggleBtn.style.display = 'none';
    if (controls) {
      controls.style.display = visible ? 'block' : 'none';
      controls.setAttribute('aria-hidden', visible ? 'false' : 'true');
    }

    document.body.classList.toggle('mobile-controls-active', visible);
    document.body.classList.toggle('mobile-controls-hidden-for-ui', this.mobileMode && !visible);

    if (!visible) {
      this.mobileMoveX = 0;
      this.mobileMoveY = 0;
      this.mobileMoveForward = false;
      this.mobileMoveBackward = false;
      this.mobileMoveLeft = false;
      this.mobileMoveRight = false;
      this.mobileJump = false;
      this.mobileSneak = false;
      this.mobileLeftMouseDown = false;
      this.mobileRightMouseDown = false;
      ['mobile-btn-forward', 'mobile-btn-backward', 'mobile-btn-left', 'mobile-btn-right', 'mobile-btn-jump', 'mobile-btn-sneak', 'mobile-btn-attack', 'mobile-btn-place'].forEach((id) => {
        document.getElementById(id)?.classList.remove('pressed');
      });
    }
  }

  private static shouldUseMobileControls(): boolean {
    const nav = navigator as Navigator & { maxTouchPoints?: number };
    const ua = navigator.userAgent || '';
    const nativePlatform = String((window as any).CubeGameNative?.platform || '').toLowerCase();
    const nativeWantsMobile = Boolean((window as any).CubeGameNative?.mobileControls);
    const urlWantsMobile = new URLSearchParams(window.location.search).get('mobile') === '1';
    const hasCoarsePointer = window.matchMedia?.('(hover: none), (pointer: coarse)').matches ?? false;
    const iOSLike = /iphone|ipad|ipod/i.test(ua) || (nativePlatform === 'ios') || nativeWantsMobile || urlWantsMobile;
    const androidLike = /android/i.test(ua);
    return iOSLike || androidLike || ((nav.maxTouchPoints || 0) > 0 && hasCoarsePointer);
  }
}
