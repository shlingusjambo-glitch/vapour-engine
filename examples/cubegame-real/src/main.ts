import { Game } from './game/Game';
import { AudioManager } from './audio/AudioManager';
import { InputManager } from './core/InputManager';
import { EventBus } from './core/EventBus';
import { PlatformRuntime } from './core/PlatformRuntime';
import { GameBootstrapper } from './bootstrap/GameBootstrapper';

const hideSplash = () => {
  const splash = document.getElementById('vapour-engine-splash');
  if (!splash || splash.dataset.hidden === 'true') return;

  splash.dataset.hidden = 'true';
  splash.style.transition = 'opacity 0.75s cubic-bezier(0.25, 1, 0.5, 1)';
  splash.style.opacity = '0';
  setTimeout(() => {
    splash.style.display = 'none';
  }, 800);
};

const showBootStatus = (message: string) => {
  const splash = document.getElementById('vapour-engine-splash');
  if (!splash) return;

  let status = document.getElementById('vapour-boot-status');
  if (!status) {
    status = document.createElement('div');
    status.id = 'vapour-boot-status';
    status.style.cssText = [
      'margin-top:24px',
      'max-width:min(620px,calc(100vw - 40px))',
      'font-family:VT323,monospace',
      'font-size:18px',
      'line-height:1.35',
      'color:#f0f0ff',
      'text-align:center',
      'opacity:0.88'
    ].join(';');
    splash.appendChild(status);
  }
  status.textContent = message;
};

let bootFailureReported = false;

const showBootFailure = (message: string) => {
  bootFailureReported = true;
  // Inline watchdogs in index.html run independently of this module. Persist the
  // terminal state on window so they cannot replace a useful renderer error with
  // a generic "still loading" message a few seconds later.
  (window as any).cubeGameBootFailed = true;
  showBootStatus(message);
  const splash = document.getElementById('vapour-engine-splash') as HTMLElement | null;
  if (splash) {
    splash.style.display = 'flex';
    splash.style.opacity = '1';
    splash.style.pointerEvents = 'auto';
    splash.dataset.hidden = 'false';
  }
  const mainMenu = document.getElementById('main-menu-screen') as HTMLElement | null;
  const hud = document.getElementById('hud-overlay') as HTMLElement | null;
  const chat = document.getElementById('chat-overlay') as HTMLElement | null;
  if (mainMenu) mainMenu.style.display = 'none';
  if (hud) hud.style.display = 'none';
  if (chat) chat.style.display = 'none';
};

let bootstrapStarted = false;

const bootstrap = async () => {
  if (bootstrapStarted) return;
  bootstrapStarted = true;
  (window as any).cubeGameBootStage = 'bootstrap-started';
  console.log('Bootstrapping CubeGame...');
  PlatformRuntime.getInfo();
  PlatformRuntime.updateDebugPanel();

  const splashWatchdog = window.setTimeout(() => {
    showBootStatus('Still loading CubeGame code. The native menu will not be shown until the TypeScript app is ready.');
  }, 6500);

  try {
    // Initialize procedural audio synthesizer triggers
    (window as any).cubeGameBootStage = 'audio-init';
    AudioManager.init();

    // Instantiate the game engine
    (window as any).cubeGameBootStage = 'game-constructor';
    const game = new Game();
    (window as any).game = game;
    (window as any).cubeGameBootStage = 'game-start';
    await game.start();
    (window as any).cubeGameBootStage = 'game-start-complete';
    const gameBootstrapper = new GameBootstrapper();
    (window as any).gameBootstrapper = gameBootstrapper;

    // Bind Resume Button to hide Pause Screen and grab Pointer Lock
    // Enable audio context and play Vapour Engine boot chime on first interaction
    const playIntroSound = () => {
      try {
        const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioCtxClass();
        
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const osc3 = ctx.createOscillator();
        const gainNode = ctx.createGain();

        osc1.type = 'sawtooth';
        osc1.frequency.setValueAtTime(65.41, ctx.currentTime); // C2 low bass sweep
        osc1.frequency.exponentialRampToValueAtTime(130.81, ctx.currentTime + 1.8);

        osc2.type = 'square';
        osc2.frequency.setValueAtTime(98.0, ctx.currentTime); // G2 fifth
        osc2.frequency.exponentialRampToValueAtTime(196.0, ctx.currentTime + 1.8);

        osc3.type = 'triangle';
        osc3.frequency.setValueAtTime(130.81, ctx.currentTime + 0.3); // C3 chime
        osc3.frequency.exponentialRampToValueAtTime(261.63, ctx.currentTime + 1.8);

        gainNode.gain.setValueAtTime(0, ctx.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.25, ctx.currentTime + 0.25);
        gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 2.2);

        osc1.connect(gainNode);
        osc2.connect(gainNode);
        osc3.connect(gainNode);
        gainNode.connect(ctx.destination);

        osc1.start();
        osc2.start();
        osc3.start();

        osc1.stop(ctx.currentTime + 2.3);
        osc2.stop(ctx.currentTime + 2.3);
        osc3.stop(ctx.currentTime + 2.3);
      } catch (e) {
        console.warn('Boot sound failed:', e);
      }
    };

    let introSoundPlayed = false;
    const enableAudio = () => {
      (AudioManager as any).resumeContext();
      if (!introSoundPlayed) {
        introSoundPlayed = true;
        playIntroSound();
      }
      window.removeEventListener('click', enableAudio);
      window.removeEventListener('keydown', enableAudio);
      window.removeEventListener('pointerdown', enableAudio);
      window.removeEventListener('touchstart', enableAudio);
      window.removeEventListener('cubegame-native-first-touch', enableAudio as EventListener);
    };
    window.addEventListener('click', enableAudio);
    window.addEventListener('keydown', enableAudio);
    window.addEventListener('pointerdown', enableAudio, { passive: true });
    window.addEventListener('touchstart', enableAudio, { passive: true });
    window.addEventListener('cubegame-native-first-touch', enableAudio as EventListener);

    // Esc key toggle handler: show/hide overlay
    EventBus.on('pointerlockchange', (locked: boolean) => {
      const overlays = Array.from(document.querySelectorAll('.screen-overlay')) as HTMLElement[];
      const isAnyUIOpen = overlays.some(el => el.id !== 'pause-screen' && el.style.display === 'flex');

      if (isAnyUIOpen) {
        InputManager.isUIActive = true;
        return;
      }

      if (!locked) {
        // If pointer is unlocked (by Esc or tabbing out), show the pause menu
        const pauseScreen = document.getElementById('pause-screen')!;
        pauseScreen.style.display = 'flex';
        InputManager.isUIActive = true;
      } else {
        const pauseScreen = document.getElementById('pause-screen')!;
        pauseScreen.style.display = 'none';
        InputManager.isUIActive = false;
      }
    });

    (window as any).cubeGameAppReady = true;
    document.body.classList.add('cubegame-app-ready');
    console.log('Boot completed successfully.');
  } catch (err) {
    console.error('Boot failed:', err);
    showBootFailure(`Startup failed during ${(window as any).cubeGameBootStage || 'boot'}: ${err instanceof Error ? err.message : String(err)}`);
    InputManager.isUIActive = true;
  } finally {
    window.clearTimeout(splashWatchdog);
    if ((window as any).cubeGameAppReady === true) {
      window.setTimeout(hideSplash, 900);
    } else if (!bootFailureReported) {
      showBootFailure(`CubeGame failed before the native UI finished binding. Last boot stage: ${(window as any).cubeGameBootStage || 'unknown'}. Rebuild with rm -rf dist build/mac && make mac, then reopen the newly built app.`);
    }
  }
};

window.addEventListener('error', (event) => {
  if ((window as any).cubeGameAppReady === true) return;
  showBootFailure(`Startup script error during ${(window as any).cubeGameBootStage || 'boot'}: ${event.message || 'unknown error'}`);
});

window.addEventListener('unhandledrejection', (event) => {
  if ((window as any).cubeGameAppReady === true) return;
  const reason = event.reason instanceof Error ? event.reason.message : String(event.reason || 'unknown rejection');
  showBootFailure(`Startup promise failed during ${(window as any).cubeGameBootStage || 'boot'}: ${reason}`);
});

const startBootstrapWhenDomExists = () => {
  // Do not wait for window.load. Native/Electron desktop builds can stall that
  // event on slow remote fonts, dev-server leftovers, or blocked subresources;
  // all CubeGame needs for startup is parsed DOM nodes.
  void bootstrap();
};

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  startBootstrapWhenDomExists();
} else {
  document.addEventListener('DOMContentLoaded', startBootstrapWhenDomExists, { once: true });
}

window.setTimeout(() => {
  if (!bootstrapStarted && (window as any).cubeGameAppReady !== true) {
    showBootFailure('CubeGame JavaScript did not start after DOMContentLoaded. The desktop package is stale or the bundle failed to load. Run rm -rf dist build/mac && npm install && make mac.');
  }
}, 4000);
