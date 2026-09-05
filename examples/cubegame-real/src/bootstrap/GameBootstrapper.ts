import { EventBus } from '../core/EventBus';
import { InputManager } from '../core/InputManager';

type Tf2MenuMap = {
  dimension: 'tf2_ctf' | 'tf2_cp' | 'tf2_payload' | 'tf2_koth' | 'tf2_test';
  mode: string;
  name: string;
  copy: string;
};

const TF2_MENU_MAPS: Tf2MenuMap[] = [
  {
    dimension: 'tf2_test',
    mode: 'Test Arena',
    name: 'Target Range',
    copy: 'A safe, structural 100x100 floor plate with boundary walls for testing gameplay mechanics.',
  },
  {
    dimension: 'tf2_ctf',
    mode: 'Capture the Flag',
    name: '2Fort',
    copy: 'Twin bases, bridge pressure, sewer flanks, and intelligence rooms.',
  },
  {
    dimension: 'tf2_cp',
    mode: 'Control Points',
    name: 'Gorge',
    copy: 'Industrial attack and defense lanes with staged capture pressure.',
  },
  {
    dimension: 'tf2_payload',
    mode: 'Payload',
    name: 'Goldrush Yard',
    copy: 'Push the bomb cart through timber sheds, cliffs, and final chokepoints.',
  },
  {
    dimension: 'tf2_koth',
    mode: 'King of the Hill',
    name: 'Viaduct',
    copy: 'Fight over a single center point with high ground and flank routes.',
  },
];

export class GameBootstrapper {
  private root: HTMLDivElement;
  private status: HTMLDivElement;
  private dialog: HTMLDivElement;
  private hasJoined = false;

  constructor() {
    this.injectStyles();
    this.root = document.createElement('div');
    this.root.id = 'tf2-menu-root';
    this.root.className = 'tf2-menu';
    this.root.innerHTML = this.renderMenu();
    document.body.appendChild(this.root);

    this.status = this.root.querySelector('#tf2-menu-status') as HTMLDivElement;
    this.dialog = this.root.querySelector('#tf2-menu-dialog') as HTMLDivElement;

    this.root.querySelectorAll<HTMLButtonElement>('[data-join-map]').forEach(button => {
      button.addEventListener('click', () => this.joinTf2Map(button.dataset.joinMap as Tf2MenuMap['dimension']));
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-feature]').forEach(button => {
      button.addEventListener('click', () => this.showComingSoon(String(button.dataset.feature || 'Feature')));
    });
    this.root.querySelector<HTMLButtonElement>('[data-exit]')?.addEventListener('click', () => this.exitGame());
    this.dialog.querySelector<HTMLButtonElement>('[data-close-dialog]')?.addEventListener('click', () => this.hideDialog());

    EventBus.on('tf2menu:status', (message: string) => this.setStatus(String(message || 'Ready.')));
    EventBus.on('tf2menu:joined', () => this.hide());
    EventBus.on('tf2menu:error', (message: string) => this.showError(String(message || 'TF2 startup failed.')));
  }

  public show(): void {
    this.root.classList.add('visible');
    InputManager.isUIActive = true;
    InputManager.unlockPointer();
  }

  public hide(): void {
    this.root.classList.remove('visible');
    InputManager.isUIActive = false;
  }

  public setStatus(message: string): void {
    this.status.textContent = message;
  }

  public showError(message: string): void {
    this.hasJoined = false;
    this.root.querySelectorAll<HTMLButtonElement>('[data-join-map]').forEach(button => {
      button.disabled = false;
    });
    this.status.textContent = message;
    this.root.classList.add('error', 'visible');
    InputManager.isUIActive = true;
    InputManager.unlockPointer();
  }

  private joinTf2Map(dimension?: Tf2MenuMap['dimension']): void {
    if (this.hasJoined || !dimension) return;
    this.hasJoined = true;
    this.root.classList.remove('error');
    this.root.querySelectorAll<HTMLButtonElement>('[data-join-map]').forEach(button => {
      button.disabled = true;
    });
    const map = TF2_MENU_MAPS.find(entry => entry.dimension === dimension);
    this.setStatus(`Loading ${map?.name || 'TF2 map'}.`);
    EventBus.emit('game:joinTf2Map', { dimension });
  }

  private showComingSoon(feature: string): void {
    this.dialog.querySelector<HTMLElement>('[data-dialog-title]')!.textContent = feature;
    this.dialog.querySelector<HTMLElement>('[data-dialog-copy]')!.textContent = `${feature} is wired as a menu control, but this pass is focused on getting maps, spawning, viewmodels, and shooting solid first.`;
    this.dialog.classList.add('visible');
  }

  private hideDialog(): void {
    this.dialog.classList.remove('visible');
  }

  private exitGame(): void {
    this.setStatus('Exit requested.');
    try {
      window.close();
    } catch {
      this.setStatus('Close this window to exit.');
    }
  }

  private renderMenu(): string {
    const mapButtons = TF2_MENU_MAPS.map(map => [
      `<button class="tf2-menu-card" data-join-map="${map.dimension}" type="button">`,
      `<span>${map.mode}</span>`,
      `<strong>${map.name}</strong>`,
      `<em>${map.copy}</em>`,
      '</button>',
    ].join('')).join('');

    return [
      '<div class="tf2-menu-bg" aria-hidden="true">',
      '<div class="tf2-menu-base red"></div>',
      '<div class="tf2-menu-base blue"></div>',
      '<div class="tf2-menu-bridge"></div>',
      '<div class="tf2-menu-character">',
      '<div class="tf2-menu-head"></div>',
      '<div class="tf2-menu-body"></div>',
      '<div class="tf2-menu-arm left"></div>',
      '<div class="tf2-menu-arm right"></div>',
      '<div class="tf2-menu-weapon"></div>',
      '<div class="tf2-menu-leg left"></div>',
      '<div class="tf2-menu-leg right"></div>',
      '</div>',
      '</div>',
      '<main class="tf2-menu-shell">',
      '<section class="tf2-menu-left">',
      '<div class="tf2-menu-logo">Team Fortress 2</div>',
      '<div class="tf2-menu-profile">',
      '<strong>Mercenary</strong>',
      '<span>Level 44</span>',
      '<i>Ready for casual play</i>',
      '</div>',
      '<div class="tf2-menu-news">',
      '<strong>Featured</strong>',
      '<span>Solid 2Fort and Gorge-inspired arenas, class loadouts, viewmodels, muzzle flashes, and weapon sounds.</span>',
      '</div>',
      '<div class="tf2-menu-actions">',
      '<button type="button" data-feature="Items">Items</button>',
      '<button type="button" data-feature="Shop">Shop</button>',
      '<button type="button" data-feature="Options">Options</button>',
      '<button type="button" data-exit>Exit</button>',
      '</div>',
      '</section>',
      '<section class="tf2-menu-play">',
      '<header>',
      '<strong>Casual</strong>',
      '<span>Map Selection</span>',
      '</header>',
      `<div class="tf2-menu-grid">${mapButtons}</div>`,
      '<div class="tf2-menu-footer">',
      '<button class="tf2-menu-start" data-join-map="tf2_ctf" type="button">Start Search</button>',
      '<div id="tf2-menu-status">Ready.</div>',
      '</div>',
      '</section>',
      '</main>',
      '<div id="tf2-menu-dialog" class="tf2-menu-dialog" role="dialog" aria-modal="true">',
      '<div>',
      '<strong data-dialog-title>Feature</strong>',
      '<span data-dialog-copy>Coming soon.</span>',
      '<button data-close-dialog type="button">Close</button>',
      '</div>',
      '</div>',
    ].join('');
  }

  private injectStyles(): void {
    if (document.getElementById('tf2-menu-styles')) return;
    const style = document.createElement('style');
    style.id = 'tf2-menu-styles';
    style.textContent = [
      '.tf2-menu{position:fixed;inset:0;z-index:9000;display:none;overflow:hidden;background:#26211f;color:#efe4cf;font-family:Inter,Segoe UI,Arial,sans-serif;}',
      '.tf2-menu.visible{display:block;}',
      '.tf2-menu-bg{position:absolute;inset:0;background:linear-gradient(180deg,#403932 0%,#2a2623 58%,#1c1917 100%);}',
      '.tf2-menu-bg:before{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(81,38,32,.52),rgba(39,63,86,.48));opacity:.52;}',
      '.tf2-menu-base{position:absolute;bottom:15%;width:31%;height:42%;border:5px solid rgba(30,24,21,.74);box-shadow:0 28px 80px rgba(0,0,0,.46);}',
      '.tf2-menu-base.red{left:6%;background:linear-gradient(135deg,#8a3c30,#503025);}',
      '.tf2-menu-base.blue{right:6%;background:linear-gradient(135deg,#345f79,#24384a);}',
      '.tf2-menu-bridge{position:absolute;left:24%;right:24%;bottom:35%;height:7%;background:#6a4d34;border-top:5px solid #2b221c;border-bottom:5px solid #2b221c;box-shadow:0 18px 32px rgba(0,0,0,.34);}',
      '.tf2-menu-character{position:absolute;right:22%;bottom:13%;width:220px;height:440px;filter:drop-shadow(0 32px 28px rgba(0,0,0,.42));}',
      '.tf2-menu-head{position:absolute;left:74px;top:28px;width:76px;height:76px;border-radius:42px 42px 34px 34px;background:#f0bd85;border:7px solid #2b2521;}',
      '.tf2-menu-body{position:absolute;left:52px;top:110px;width:114px;height:170px;background:#b5483a;border:7px solid #2b2521;transform:skewX(-4deg);}',
      '.tf2-menu-arm{position:absolute;top:130px;width:44px;height:166px;background:#f0bd85;border:6px solid #2b2521;transform-origin:top center;}',
      '.tf2-menu-arm.left{left:25px;transform:rotate(23deg);}',
      '.tf2-menu-arm.right{right:18px;transform:rotate(-45deg);}',
      '.tf2-menu-weapon{position:absolute;left:78px;top:155px;width:150px;height:34px;background:#27231f;border:5px solid #15120f;transform:rotate(19deg);}',
      '.tf2-menu-leg{position:absolute;top:278px;width:46px;height:150px;background:#332923;border:6px solid #181411;}',
      '.tf2-menu-leg.left{left:58px;transform:rotate(8deg);}',
      '.tf2-menu-leg.right{right:56px;transform:rotate(-12deg);}',
      '.tf2-menu-shell{position:relative;z-index:1;display:grid;grid-template-columns:minmax(260px,360px) minmax(420px,760px);gap:28px;height:100%;padding:28px 42px;align-items:center;}',
      '.tf2-menu-left{display:grid;gap:12px;align-content:start;}',
      '.tf2-menu-logo{font-family:Impact,Arial Black,sans-serif;font-size:48px;line-height:.9;text-transform:uppercase;color:#f0d4a2;text-shadow:4px 4px 0 #211b17;}',
      '.tf2-menu-profile,.tf2-menu-news{border:3px solid #1d1916;background:rgba(31,28,25,.88);box-shadow:0 10px 22px rgba(0,0,0,.28);padding:12px;}',
      '.tf2-menu-profile strong,.tf2-menu-news strong{display:block;font-size:18px;color:#f0d4a2;}',
      '.tf2-menu-profile span,.tf2-menu-profile i,.tf2-menu-news span{display:block;margin-top:5px;color:rgba(239,228,207,.78);font-size:13px;font-style:normal;line-height:1.35;}',
      '.tf2-menu-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;}',
      '.tf2-menu-actions button{height:38px;border:2px solid #2a241f;background:#7b6a56;color:#fff4df;font-weight:900;text-transform:uppercase;cursor:pointer;}',
      '.tf2-menu-actions button:hover,.tf2-menu-card:hover,.tf2-menu-start:hover{filter:brightness(1.1);}',
      '.tf2-menu-play{align-self:center;border:5px solid #1d1916;background:rgba(45,39,34,.94);box-shadow:0 28px 80px rgba(0,0,0,.42);padding:16px;}',
      '.tf2-menu-play header{display:flex;justify-content:space-between;align-items:end;margin-bottom:12px;border-bottom:3px solid rgba(239,228,207,.16);padding-bottom:10px;}',
      '.tf2-menu-play header strong{font-size:30px;text-transform:uppercase;color:#b7aa95;}',
      '.tf2-menu-play header span{font-size:34px;text-transform:uppercase;font-weight:950;color:#fff3d8;}',
      '.tf2-menu-grid{display:grid;gap:8px;}',
      '.tf2-menu-card{display:grid;grid-template-columns:150px 1fr;gap:4px 14px;min-height:86px;padding:12px 14px;border:2px solid #221d19;background:linear-gradient(90deg,rgba(133,58,48,.82),rgba(37,64,83,.80));color:#fff2db;text-align:left;cursor:pointer;}',
      '.tf2-menu-card span{grid-row:1 / span 2;align-self:center;font-size:14px;font-weight:950;text-transform:uppercase;color:#f1d5a7;}',
      '.tf2-menu-card strong{font-size:27px;line-height:1;text-transform:uppercase;}',
      '.tf2-menu-card em{font-size:13px;line-height:1.32;color:rgba(255,242,219,.75);font-style:normal;}',
      '.tf2-menu-card:disabled,.tf2-menu-start:disabled{opacity:.56;cursor:default;}',
      '.tf2-menu-footer{display:grid;grid-template-columns:1fr auto;gap:14px;align-items:center;margin-top:16px;}',
      '.tf2-menu-start{height:54px;border:3px solid #263316;background:#668b2f;color:#f7f3dc;font-size:28px;font-weight:950;text-transform:uppercase;cursor:pointer;}',
      '#tf2-menu-status{min-width:150px;color:rgba(239,228,207,.72);font-size:13px;text-align:right;}',
      '.tf2-menu.error #tf2-menu-status{color:#ffb4a3;}',
      '.tf2-menu-dialog{position:absolute;inset:0;z-index:3;display:none;align-items:center;justify-content:center;background:rgba(12,10,9,.58);}',
      '.tf2-menu-dialog.visible{display:flex;}',
      '.tf2-menu-dialog>div{width:min(420px,calc(100vw - 32px));border:3px solid #211b17;background:#302a25;padding:18px;box-shadow:0 22px 70px rgba(0,0,0,.52);}',
      '.tf2-menu-dialog strong,.tf2-menu-dialog span{display:block;}',
      '.tf2-menu-dialog strong{font-size:22px;color:#f0d4a2;}',
      '.tf2-menu-dialog span{margin-top:8px;font-size:14px;line-height:1.4;color:rgba(239,228,207,.8);}',
      '.tf2-menu-dialog button{margin-top:16px;height:38px;width:120px;border:2px solid #1f1a17;background:#7b6a56;color:#fff4df;font-weight:900;cursor:pointer;}',
      '@media (max-width:900px){.tf2-menu-shell{grid-template-columns:1fr;padding:18px;overflow:auto;align-items:start}.tf2-menu-character{display:none}.tf2-menu-card{grid-template-columns:1fr}.tf2-menu-card span{grid-row:auto}.tf2-menu-footer{grid-template-columns:1fr}.tf2-menu-logo{font-size:40px}#tf2-menu-status{text-align:left}}',
    ].join('');
    document.head.appendChild(style);
  }
}
