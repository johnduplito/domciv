(function () {

if (document.getElementById('civ-canvas')) return;

// ── INJECT GAME DOM ───────────────────────────────────────────
const canvas = document.createElement('canvas');
canvas.id = 'civ-canvas';
document.body.appendChild(canvas);

const resourceRows = Object.entries(RESOURCE_DEFS).map(([key, def]) =>
  `<div class="civ-stat"><span style="color:${def.color}">${def.label}</span><span id="s-res-${key}">0</span></div>`
).join('\n        ');

const cheatInputRows = Object.entries(RESOURCE_DEFS).map(([key, def]) =>
  `<div class="civ-stat">
    <label style="color:${def.color};font-size:9px">${def.label}</label>
    <input id="cheat-${key}" type="number" min="0" value="0"
      style="width:54px;background:#0a0a1a;color:#ffdd88;border:1px solid #443;font-size:9px;font-family:monospace;padding:1px 3px;border-radius:2px">
  </div>`
).join('\n        ');

const uiEl = document.createElement('div');
uiEl.id = 'civ-ui';
uiEl.innerHTML = `
    <h3>CIVILISATION <button id="civ-toggle">▼</button></h3>
    <div id="civ-body">
        <div class="civ-stat"><span>Population</span><span id="s-pop">1</span></div>
        ${resourceRows}
        <div class="civ-stat"><span>Structures</span><span id="s-str">0</span></div>
        <div class="civ-stat"><span>Mined</span><span id="s-dom">0</span></div>
        <div id="civ-next-label">Next: Campfire</div>
        <div id="civ-progress"><div id="civ-progress-bar" style="width:0%"></div></div>
        <div id="civ-log"></div>
        <button class="civ-btn" id="civ-spawn-btn">[ + Spawn — ${CFG_MANUAL_SPAWN_COST} wood ]</button>
        <button class="civ-btn" id="civ-scan-btn">[ Scan DOM for targets ]</button>
        <button class="civ-btn" id="civ-cheat-btn" style="border-color:#553;color:#aa9933">[ ⚡ cheat resources ]</button>
        <div id="civ-cheat" style="display:none;margin-top:6px;padding-top:6px;border-top:1px solid #332244">
            <div style="font-size:9px;color:#776633;letter-spacing:1px;margin-bottom:4px">SET RESOURCES</div>
            ${cheatInputRows}
        </div>
    </div>
`;
document.body.appendChild(uiEl);

const infoEl = document.createElement('div');
infoEl.id = 'civ-info';
infoEl.style.display = 'none';
infoEl.innerHTML = '<div id="civ-info-title"></div><div id="civ-info-body"></div>';
document.body.appendChild(infoEl);
const infoTitleEl = document.getElementById('civ-info-title');
const infoBodyEl  = document.getElementById('civ-info-body');
const elPop          = document.getElementById('s-pop');
const elStr          = document.getElementById('s-str');
const elDom          = document.getElementById('s-dom');
const elProgressBar  = document.getElementById('civ-progress-bar');
const elNextLabel    = document.getElementById('civ-next-label');
const elRes = Object.fromEntries(Object.keys(RESOURCE_DEFS).map(k => [k, document.getElementById('s-res-' + k)]));

// ── FREEZE PAGE ───────────────────────────────────────────────
(function freezePage() {
  const ceiling = setTimeout(() => {}, 0);
  for (let i = 1; i < ceiling; i++) { clearTimeout(i); clearInterval(i); }

  document.addEventListener('click', (e) => {
    if (e.target.closest('a[href]')) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  document.addEventListener('submit', (e) => {
    e.preventDefault(); e.stopPropagation();
  }, true);

  history.pushState    = () => {};
  history.replaceState = () => {};
})();

// ─────────────────────────────────────────────────────────────

const ctx = canvas.getContext('2d');

function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
resize();
window.addEventListener('resize', resize);

// ── STATE ────────────────────────────────────────────────────
const G = {
  tick:       0,
  res:        Object.fromEntries(Object.keys(RESOURCE_DEFS).map(k => [k, 0])),
  domMined:   0,
  structures: 0,
  creatures:  [],
  buildings:  [],
  piles:      [],
  particles:  [],
  domTargets:   [],
  domTargetEls: new Set(),
  pendingSites: [],
  scanTimer:   0,
  autoTimer:   0,
  nextBuild:   0,
  housingCap:  CFG_CAVE_HOUSING,
  farm:        null,
  selected:    null,
  hungry:      false,
};

const HUT     = { x: 90 };
const HUT_DEF = BUILDS.find(b => b.label === 'hut');

const STATE_LABELS = {
  idle: 'Resting', moving: 'Travelling', wandering: 'Wandering',
  mining: 'Mining', constructing: 'Building', farming: 'Farming', attending: 'Working',
};
const hutY   = () => canvas.height - 90;
const C_BODIES = ['#ff8844','#44ee88','#88aaff','#ffdd44','#ff66aa','#44ddff','#ccff66','#ff9966','#88ffcc'];
const MINE_TAGS = Object.keys(ELEMENT_RESOURCES);

// ── LOGGING ──────────────────────────────────────────────────
function log(msg) {
  const el = document.getElementById('civ-log');
  if (!el) return;
  const d = document.createElement('div');
  d.textContent = '> ' + msg;
  el.insertBefore(d, el.firstChild);
  while (el.children.length > 5) el.removeChild(el.lastChild);
}

// ── UI ────────────────────────────────────────────────────────
function updateUI() {
  elPop.textContent = G.creatures.length + ' / ' + G.housingCap;
  for (const r in RESOURCE_DEFS) elRes[r].textContent = Math.floor(G.res[r]);
  elStr.textContent = G.structures;
  elDom.textContent = G.domMined;

  const progressEl = elProgressBar;
  const labelEl    = elNextLabel;

  // Show normal-queue site first, fall back to hut site, then next planned building
  const activeSite = G.pendingSites.find(s => s.bt.label !== 'hut') || G.pendingSites[0] || null;
  const housingUrgent = !activeSite && G.creatures.length >= G.housingCap - 2;
  const nb = activeSite ? activeSite.bt : housingUrgent ? HUT_DEF : BUILDS[G.nextBuild];

  if (nb) {
    let pct, label;
    if (activeSite && activeSite.readyToBuild) {
      pct   = Math.round(activeSite.progress / activeSite.buildTime * 100);
      label = `Building: ${nb.name}`;
    } else if (activeSite) {
      const costs = Object.entries(nb.cost);
      pct   = Math.round(costs.reduce((min, [r, amt]) => Math.min(min, activeSite.reserve[r] / amt), 1) * 100);
      const needs = costs.filter(([r, amt]) => activeSite.reserve[r] < amt)
        .map(([r, amt]) => `${RESOURCE_DEFS[r].label} ${activeSite.reserve[r]}/${amt}`).join(' · ');
      label = `Gathering: ${nb.name}${needs ? ' — ' + needs : ''}`;
    } else {
      pct   = Math.round(Math.min(...Object.entries(nb.cost).map(([r, amt]) => G.res[r] / amt)) * 100);
      const suffix = housingUrgent ? ' (housing needed!)' : '';
      label = `Next: ${nb.name}${suffix}`;
    }
    if (progressEl) progressEl.style.width = Math.min(pct, 100) + '%';
    if (labelEl) labelEl.textContent = label;
  } else {
    if (progressEl) progressEl.style.width = '100%';
    if (labelEl)    labelEl.textContent = 'All structures built!';
  }
  updateInfoPanel();
}
function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }

// ── INFO PANEL ────────────────────────────────────────────────
function updateInfoPanel() {
  if (!G.selected) { infoEl.style.display = 'none'; return; }
  infoEl.style.display = '';

  if (G.selected.type === 'creature') {
    const c = G.selected.ref;
    const hungerPct  = Math.round(c.hungerTimer / CFG_HUNGER_IDLE_TICKS * 100);
    const carryPct   = Math.round(c.carry / c.carryMax * 100);
    const carryColor = c.carryType ? (RESOURCE_DEFS[c.carryType]?.color ?? '#ffcc44') : '#333355';
    const carryLabel = c.carry > 0
      ? `${c.carry} ${RESOURCE_DEFS[c.carryType]?.label ?? ''} / ${c.carryMax}`
      : `empty / ${c.carryMax}`;
    const hungerColor = hungerPct > 60 ? '#44aa44' : hungerPct > 30 ? '#cc9933' : '#cc4444';
    const equippedLabel = c.equipped ? (RESOURCE_DEFS[c.equipped]?.label ?? c.equipped) : 'None';
    const equippedColor = c.equipped ? (RESOURCE_DEFS[c.equipped]?.color ?? '#aaaaaa') : '#333355';
    infoTitleEl.textContent = c.name;
    infoBodyEl.innerHTML =
      `<div class="civ-stat"><span>State</span><span>${STATE_LABELS[c.state] ?? c.state}</span></div>` +
      `<div class="civ-stat"><span>Equipped</span><span style="color:${equippedColor}">${equippedLabel}</span></div>` +
      `<div class="civ-stat"><span>Carry</span><span>${carryLabel}</span></div>` +
      `<div class="info-bar"><div class="info-bar-fill" style="width:${carryPct}%;background:${carryColor}"></div></div>` +
      `<div class="info-bar-label">Hunger</div>` +
      `<div class="info-bar"><div class="info-bar-fill" style="width:${hungerPct}%;background:${hungerColor}"></div></div>`;

  } else if (G.selected.type === 'building') {
    const b = G.selected.ref;
    infoTitleEl.textContent = b.name ?? b.label;
    let html = '';
    if (b.farmState !== undefined) {
      const pct = b.farmState === 'ready' ? 100
                : b.farmState === 'growing' ? Math.round(b.farmFood / CFG_FARM_YIELD * 100) : 0;
      html += `<div class="civ-stat"><span>Crop</span><span>${b.farmState}</span></div>` +
              `<div class="info-bar"><div class="info-bar-fill" style="width:${pct}%;background:#44bb22"></div></div>`;
    }
    if (b.attend) {
      const inRes  = RESOURCE_DEFS[b.attend.inputRes]?.label ?? b.attend.inputRes;
      const outRes = b.attend.outputChoice
        ? b.attend.outputChoice.map(r => RESOURCE_DEFS[r]?.label ?? r).join(' / ')
        : (RESOURCE_DEFS[b.attend.outputRes]?.label ?? b.attend.outputRes);
      html += `<div class="civ-stat"><span>Status</span><span>${b.attended ? 'Working' : 'Idle'}</span></div>` +
              `<div class="civ-stat"><span>Converts</span><span>${inRes} → ${outRes}</span></div>`;
    }
    if (b.label === 'hut') {
      html += `<div class="civ-stat"><span>Housing</span><span>+${CFG_HUT_HOUSING} capacity</span></div>`;
    }
    if (b.gatherSite) {
      html += `<div class="civ-stat"><span>Type</span><span>Gathering point</span></div>`;
    }
    infoBodyEl.innerHTML = html || `<div class="civ-stat"><span>Type</span><span>Structure</span></div>`;

  } else if (G.selected.type === 'site') {
    const s = G.selected.ref;
    infoTitleEl.textContent = s.bt.name + ' (building)';
    let html = '';
    for (const [res, amt] of Object.entries(s.bt.cost)) {
      const have  = s.reserve[res] ?? 0;
      const pct   = Math.round(Math.min(have / amt, 1) * 100);
      const color = RESOURCE_DEFS[res]?.color ?? '#aaaaaa';
      const label = RESOURCE_DEFS[res]?.label ?? res;
      html += `<div class="civ-stat"><span>${label}</span><span>${have} / ${amt}</span></div>` +
              `<div class="info-bar"><div class="info-bar-fill" style="width:${pct}%;background:${color}"></div></div>`;
    }
    if (s.readyToBuild) {
      const buildPct = Math.round(s.progress / s.buildTime * 100);
      html += `<div class="civ-stat"><span>Construction</span><span>${buildPct}%</span></div>` +
              `<div class="info-bar"><div class="info-bar-fill" style="width:${buildPct}%;background:#ffcc66"></div></div>`;
    }
    infoBodyEl.innerHTML = html;

  } else if (G.selected.type === 'cave') {
    infoTitleEl.textContent = 'Cave';
    infoBodyEl.innerHTML =
      `<div class="civ-stat"><span>Type</span><span>Home base</span></div>` +
      `<div class="civ-stat"><span>Population</span><span>${G.creatures.length} / ${G.housingCap}</span></div>`;
  }
}

// ── DOM SCANNER ───────────────────────────────────────────────
function hasFarm() { return G.farm !== null; }

function scanDOM() {
  const candidates = [];
  MINE_TAGS.forEach(tag => {
    document.querySelectorAll(tag).forEach(el => {
      if (el.closest('#civ-ui') || el.closest('#civ-canvas') || el.closest('#civ-info')) return;
      const rect = el.getBoundingClientRect();
      if (rect.width < 30 || rect.height < 12) return;
      if (rect.top < -50 || rect.bottom > window.innerHeight + 50) return;
      if (G.domTargetEls.has(el)) return;
      if (tag === 'img') {
        const chance = hasFarm() ? CFG_FOOD_CHANCE_WITH_FARM : CFG_FOOD_CHANCE_NO_FARM;
        if (Math.random() > chance) return;
      }
      candidates.push({ el, rect, resource: ELEMENT_RESOURCES[tag] });
    });
  });
  if (candidates.length === 0) return;
  const count = Math.min(candidates.length, 1 + Math.floor(Math.random() * CFG_SCAN_BATCH));
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(Math.random() * candidates.length);
    const { el, rect, resource } = candidates.splice(idx, 1)[0];
    const area  = rect.width * rect.height;
    const maxHp = CFG_NODE_HP_BASE + Math.ceil(area / CFG_NODE_HP_AREA_DIV);
    const value = CFG_NODE_VALUE_BASE + Math.log(1 + area / CFG_NODE_VALUE_AREA_DIV);
    G.domTargets.push({ el, hp: maxHp, maxHp, value, resource });
    G.domTargetEls.add(el);
    el.style.transition = 'opacity 0.3s, outline 0.3s';
  }
}

// ── BUILD CHECK ───────────────────────────────────────────────
function pickDrawFn(bt) {
  if (bt.drawFns && bt.drawFns.length > 0)
    return bt.drawFns[Math.floor(Math.random() * bt.drawFns.length)];
  return bt.drawFn;
}

function queueSite(bt, posIndex) {
  const bx      = HUT.x + 110 + posIndex * 72 + (Math.random() - 0.5) * 90;
  const yOff    = -(50 + Math.floor(Math.random() * 150));
  const reserve = Object.fromEntries(Object.keys(bt.cost).map(k => [k, 0]));
  G.pendingSites.push({ bt: { ...bt, drawFn: pickDrawFn(bt) }, x: bx, yOff,
    progress: 0, buildTime: bt.buildTime, assigned: false, reserve, readyToBuild: false });
}

function checkBuild() {
  // Two independent lanes: housing (emergencyHousing flag) and normal (everything else).
  const housingSite = G.pendingSites.find(s => s.emergencyHousing);
  const normalSite  = G.pendingSites.find(s => !s.emergencyHousing);

  // Housing lane: queue best-affordable housing when near cap and none already planned.
  if (!housingSite && G.creatures.length >= G.housingCap - 2) {
    const best = BUILDS.filter(b => b.housing).slice().reverse()
      .find(b => Object.entries(b.cost).every(([r, amt]) => G.res[r] >= amt));
    const chosen = best ?? HUT_DEF;
    if (chosen) {
      queueSite(chosen, G.buildings.length + G.pendingSites.length);
      G.pendingSites[G.pendingSites.length - 1].emergencyHousing = true;
      // If the normal queue is pointing at this same building, skip it there
      if (G.nextBuild < BUILDS.length && BUILDS[G.nextBuild].label === chosen.label) G.nextBuild++;
      log('Planning ' + chosen.name + ' — housing needed!');
    }
  }

  // Normal lane: queue next building if none already planned
  if (!normalSite && G.nextBuild < BUILDS.length) {
    const bt = BUILDS[G.nextBuild];
    if (bt.label === 'hut') {
      // Basic Hut in normal queue — skip if housing lane already planned one
      if (!housingSite) { queueSite(bt, G.nextBuild); log('Planning ' + bt.name + '...'); }
      G.nextBuild++;
    } else {
      queueSite(bt, G.nextBuild);
      G.nextBuild++;
      log('Planning ' + bt.name + '...');
    }
  }
}

// ── PARTICLES ─────────────────────────────────────────────────
function spawnParticleBurst(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const ang = (Math.PI * 2 * i) / n + Math.random() * 0.4;
    const spd = 1.5 + Math.random() * 2.5;
    G.particles.push({ x, y, vx: Math.cos(ang)*spd, vy: Math.sin(ang)*spd - 1, color, life: 30 + Math.random()*20, maxLife: 50 });
  }
}
function spawnChips(x, y, n) {
  for (let i = 0; i < n; i++) {
    G.particles.push({ x, y, vx: (Math.random()-0.5)*3, vy: -1 - Math.random()*2,
      color: `hsl(${40+Math.random()*30},70%,${50+Math.random()*20}%)`, life: 20+Math.random()*15, maxLife: 35 });
  }
}

function drawPendingSite(site) {
  const sy = hutY() + site.yOff;
  ctx.save();
  // Ghost of future building
  ctx.globalAlpha = 0.2;
  const fn = BUILD_DRAW[site.bt.drawFn];
  if (fn) fn(ctx, site.x, sy, site.bt, G.tick);
  // Dashed outline
  ctx.globalAlpha = 0.6;
  ctx.strokeStyle = '#887744'; ctx.lineWidth = 1;
  ctx.setLineDash([3, 2]);
  ctx.strokeRect(site.x - site.bt.w/2 - 1, sy - site.bt.h - 1, site.bt.w + 2, site.bt.h + 2);
  ctx.setLineDash([]);
  // Scaffolding poles + crossbar
  const lx = site.x - site.bt.w/2, rx = site.x + site.bt.w/2;
  ctx.strokeStyle = '#aa8833'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(lx, sy);                   ctx.lineTo(lx, sy - site.bt.h - 4);
  ctx.moveTo(rx, sy);                   ctx.lineTo(rx, sy - site.bt.h - 4);
  ctx.moveTo(lx, sy - site.bt.h * 0.5); ctx.lineTo(rx, sy - site.bt.h * 0.5);
  ctx.stroke();
  // Progress bar — supply phase or construction phase
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = '#111122';
  ctx.fillRect(site.x - 18, sy - site.bt.h - 12, 36, 5);
  if (site.readyToBuild) {
    const pct = site.progress / site.buildTime;
    ctx.fillStyle = pct > 0.6 ? '#44cc88' : '#5588cc';
    ctx.fillRect(site.x - 18, sy - site.bt.h - 12, 36 * pct, 5);
  } else {
    const costs = Object.entries(site.bt.cost);
    const supplyPct = costs.reduce((min, [r, amt]) => Math.min(min, site.reserve[r] / amt), 1);
    ctx.fillStyle = '#cc9933';
    ctx.fillRect(site.x - 18, sy - site.bt.h - 12, 36 * supplyPct, 5);
  }
  ctx.restore();
}

function getHome() {
  return { x: HUT.x, y: hutY() };
}

// ── CREATURE ─────────────────────────────────────────────────
const NAMES = ['Og','Ug','Zog','Bip','Mop','Rar','Fen','Lux','Dax','Wix','Vex','Gol','Ruk','Fib','Kor','Sel','Nim','Pax','Tav','Qur'];

class Creature {
  constructor(id) {
    this.id        = id;
    this.name      = NAMES[id % NAMES.length];
    this.color     = C_BODIES[id % C_BODIES.length];
    const home     = getHome();
    this.x         = home.x;
    this.y         = home.y;
    this.tx        = this.x;
    this.ty        = this.y;
    this.speed     = CFG_SPEED_MIN + Math.random() * CFG_SPEED_RANGE;
    this.carry     = 0;
    this.carryType = null;
    this.carryMax  = CFG_CARRY_MIN + Math.floor(Math.random() * CFG_CARRY_RANGE);
    this.state     = 'idle';
    this.target    = null;
    this.idleTime  = 30 + Math.random() * 60;
    this.nextAct   = null;
    this.facing    = 1;
    this.bobPhase  = Math.random() * Math.PI * 2;
    this.mineTime      = 0;
    this.constructSite = null;
    this.farmTarget    = null;
    this.farmTime      = 0;
    this.attendTarget  = null;
    this.attendTime    = 0;
    this.equipped      = null; // 'itools' | 'iweapons' | null
    this.starving      = false;
    this.hungerTimer   = CFG_HUNGER_IDLE_TICKS * Math.random(); // stagger initial hunger
  }

  draw() {
    const isMoving = this.state === 'moving' || this.state === 'wandering';
    const bob = Math.sin(G.tick * 0.18 + this.bobPhase) * (isMoving ? 1 : 0.3);
    const px = Math.round(this.x), py = Math.round(this.y + bob), f = this.facing;
    ctx.save();
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath(); ctx.ellipse(px, this.y - 12, 6, 2, 0, 0, Math.PI*2); ctx.fill();
    // waddle — rock around base when moving
    const waddle = isMoving ? Math.sin(G.tick * 0.28 + this.bobPhase) * 0.13 : 0;
    ctx.translate(px, py);
    ctx.rotate(waddle);
    ctx.translate(-px, -py);
    // body
    ctx.fillStyle = this.color;
    ctx.fillRect(px - 5, py - 17, 10, 5); //body
    // head
    ctx.fillStyle = '#ffd0a0';
    ctx.fillRect(px - 5, py - 23, 10, 7); // head
    // eyes
    ctx.fillStyle = '#220000';
    ctx.fillRect(px - 2*f, py - 22, 2, 2);
    ctx.fillRect(px + 1*f, py - 22, 2, 2);
    if (this.state === 'mining') {
      const arm = Math.sin(G.tick * 0.5) * 5;
      ctx.fillStyle = '#aaaaaa'; ctx.fillRect(px + 6*f, py - 16 + arm, 4, 2);
      ctx.fillStyle = '#888888'; ctx.fillRect(px + 9*f, py - 18 + arm, 2, 5);
    }
    if (this.state === 'constructing') {
      const arm = Math.sin(G.tick * 0.35) * 4;
      ctx.fillStyle = '#cc9933'; ctx.fillRect(px + 5*f, py - 17 + arm, 5, 2);
      ctx.fillStyle = '#ddbb44'; ctx.fillRect(px + 9*f, py - 20 + arm, 3, 6);
    }
    if (this.state === 'farming') {
      const arm = Math.abs(Math.sin(G.tick * 0.22)) * 5;
      ctx.fillStyle = '#885522'; ctx.fillRect(px + 4*f, py - 18 + arm, 2, 7); // hoe handle
      ctx.fillStyle = '#667733'; ctx.fillRect(px + 3*f, py - 12 + arm, 4, 2); // hoe blade
    }
    if (this.state === 'attending') {
      // back-and-forth push-saw motion
      const push = Math.sin(G.tick * 0.2) * 3;
      ctx.fillStyle = '#ccbbaa'; ctx.fillRect(px + (5 + push)*f, py - 16, 5, 2); // handle
      ctx.fillStyle = '#aaaaaa'; ctx.fillRect(px + (9 + push)*f, py - 19, 2, 6); // blade
    }
    if (this.carry > 0 && this.carryType) {
      const col = RESOURCE_DEFS[this.carryType]?.color ?? '#ffcc44';
      ctx.fillStyle = col;
      ctx.fillRect(px + 5, py - 20, 7, 6);
      ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 0.5;
      ctx.strokeRect(px + 5, py - 20, 7, 6);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      for (let i = 0; i < Math.min(this.carry, 4); i++)
        ctx.fillRect(px + 6 + (i%2)*3, py - 19 + Math.floor(i/2)*2, 2, 2);
    }
    if (this.equipped) {
      ctx.fillStyle = this.equipped === 'itools' ? '#4488aa' : '#cc5533';
      ctx.fillRect(px - 9, py - 19, 3, 3);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 0.5;
      ctx.strokeRect(px - 9, py - 19, 3, 3);
    }
    ctx.restore();
  }

  moveTo(tx, ty, action) { this.tx = tx; this.ty = ty; this.nextAct = action || null; this.state = 'moving'; }

  update() {
    const dx = this.tx - this.x, dy = this.ty - this.y, d = Math.sqrt(dx*dx + dy*dy);
    if (d > 1.2) {
      this.x += (dx/d) * this.speed; this.y += (dy/d) * this.speed;
      if (Math.abs(dx) > 0.5) this.facing = dx > 0 ? 1 : -1;
    } else {
      this.x = this.tx; this.y = this.ty;
      if (this.state === 'moving' || this.state === 'wandering') {
        const cb = this.nextAct; this.nextAct = null; this.state = 'idle'; this.idleTime = 10 + Math.random()*20;
        if (cb) cb();
      }
    }
  }

  tick() {
    this.update();
    if (this.state === 'mining') { this.mineTime--; if (this.mineTime <= 0) this.finishMine(); return; }
    if (this.state === 'constructing') {
      if (this.constructSite) {
        this.constructSite.progress += this.equipped === 'itools' ? 4/3 : 1;
        if (this.constructSite.progress >= this.constructSite.buildTime) this.finishConstruct();
      } else { this.state = 'idle'; this.idleTime = 5; }
      return;
    }
    if (this.state === 'farming') {
      this.farmTime--;
      if (this.farmTime <= 0) this.finishFarm();
      return;
    }
    if (this.state === 'attending') {
      this.attendTime--;
      if (this.attendTime <= 0) this.finishAttend();
      return;
    }
    this.hungerTimer--;
    if (this.state === 'idle') {
      if (this.hungerTimer <= 0) {
        if (G.res.food >= 1) {
          G.res.food--;
          this.starving = false;
          if (G.hungry) G.hungry = false;
        } else {
          this.starving = true;
          if (!G.hungry) { G.hungry = true; log(this.name + ' is hungry!'); }
        }
        this.hungerTimer = CFG_HUNGER_IDLE_TICKS;
      }
      this.idleTime--;
      if (this.idleTime <= 0) this.decide();
    }
  }

  decide() {
    // Equip tools/weapons from stock when unequipped (priority: itools > iweapons)
    if (!this.equipped) {
      if (G.res.itools > 0)        { G.res.itools--;   this.equipped = 'itools'; }
      else if (G.res.iweapons > 0) { G.res.iweapons--; this.equipped = 'iweapons'; }
    }
    // Starving: eat opportunistically if food appeared, otherwise forage
    if (this.starving) {
      if (G.res.food >= 1) { G.res.food--; this.starving = false; if (G.hungry) G.hungry = false; }
      else { this.goForage(); return; }
    }
    if (this.carry >= this.carryMax) { this.goHome(); return; }
    if (this.carry === 0) {
      if (G.farm && !G.farm.attended && (G.farm.farmState === 'unplanted' || G.farm.farmState === 'ready')) {
        this.goFarm(G.farm); return;
      }
      // Send a worker to fetch input resource and attend a free processing building,
      // but skip processors whose output has hit its stockpile cap.
      const processor = G.buildings.find(b => {
        if (!b.attend || b.attended) return false;
        const { inputRes, inputAmt, outputRes, outputChoice } = b.attend;
        if (G.res[inputRes] < inputAmt) return false;
        if (outputChoice) return outputChoice.some(r => { const cap = RESOURCE_DEFS[r]?.cap; return cap == null || G.res[r] < cap; });
        const cap = RESOURCE_DEFS[outputRes]?.cap;
        return cap == null || G.res[outputRes] < cap;
      });
      if (processor) { this.goFetchForAttend(processor); return; }
      // Deliver to any pending site that needs resources we can supply right now
      for (const s of G.pendingSites) {
        if (s.readyToBuild) continue;
        const needed = Object.entries(s.bt.cost).find(([r, amt]) => s.reserve[r] < amt && G.res[r] > 0);
        if (needed) { this.goDeliverToBuildSite(s, needed[0]); return; }
      }
      // Construct once a site has all its resources
      const buildsite = G.pendingSites.find(s => s.readyToBuild && !s.assigned);
      if (buildsite) { this.goConstruct(buildsite); return; }
    }
    if (G.domTargets.length > 0 && Math.random() < 0.72) this.goMine();
    else if (G.piles.length > 0 && Math.random() < 0.3)  this.goCollectPile();
    else {
      this.state = 'wandering';
      const gatherSites = G.buildings.filter(b => b.gatherSite);
      if (gatherSites.length > 0) {
        const site = gatherSites[Math.floor(Math.random() * gatherSites.length)];
        const sy = hutY() + (site.yOff || 0);
        this.moveTo(
          site.x + (Math.random() - 0.5) * 20,
          sy + (Math.random() - 0.5) * 8,
          () => { this.idleTime = 30 + Math.random() * 60; }
        );
      } else {
        const home = getHome();
        this.moveTo(home.x + (Math.random()-0.3)*160, home.y - Math.random()*40,
          () => { this.idleTime = 20 + Math.random()*40; });
      }
    }
  }

  goMine() {
    const tgt = G.domTargets[Math.floor(Math.random() * G.domTargets.length)];
    if (!tgt) { this.decide(); return; }
    this.target = tgt;
    const rect = tgt.el.getBoundingClientRect();
    this.moveTo(
      rect.left + rect.width  * (0.15 + Math.random()*0.7),
      Math.max(rect.top, 0) + rect.height * (0.2 + Math.random()*0.6),
      () => this.startMine(tgt)
    );
  }

  startMine(tgt) {
    if (!document.body.contains(tgt.el)) {
      G.domTargets = G.domTargets.filter(t => t !== tgt); G.domTargetEls.delete(tgt.el); this.state = 'idle'; this.idleTime = 5; return;
    }
    this.state = 'mining';
    const mineBase = CFG_MINE_MIN + Math.random() * CFG_MINE_RANGE;
    this.mineTime = this.equipped === 'itools' ? mineBase * 0.75 : mineBase;
    //tgt.el.style.outline = '2px dashed rgba(255,200,50,0.8)';
    tgt.el.style.opacity = String(Math.max(0.25, tgt.hp / tgt.maxHp));
  }

  finishMine() {
    const tgt = this.target;
    if (!tgt || !document.body.contains(tgt.el)) {
      if (tgt) { G.domTargets = G.domTargets.filter(t => t !== tgt); G.domTargetEls.delete(tgt.el); }
      this.state = 'idle'; this.idleTime = 5; this.target = null; return;
    }
    tgt.hp--;
    this.carry     = Math.min(this.carry + Math.ceil(tgt.value), this.carryMax);
    this.carryType = tgt.resource;
    G.domMined++;
    spawnChips(this.x, this.y - 14, 3);
    tgt.el.style.opacity = String(Math.max(0.15, tgt.hp / tgt.maxHp));
    if (tgt.hp <= 0) {
      const rect = tgt.el.getBoundingClientRect();
      G.piles.push({ x: rect.left + rect.width/2, y: rect.top + rect.height/2,
        amount: Math.ceil(tgt.value * 2), life: CFG_PILE_LIFE, resource: tgt.resource });
      spawnParticleBurst(rect.left + rect.width/2, rect.top + rect.height/2, '#ffcc44', 12);
      log(`${this.name} mined ${RESOURCE_DEFS[tgt.resource]?.label} from <${tgt.el.tagName.toLowerCase()}>`);
      tgt.el.style.outline = ''; tgt.el.style.opacity = '';
      try { tgt.el.remove(); } catch(e){}
      G.domTargets = G.domTargets.filter(t => t !== tgt); G.domTargetEls.delete(tgt.el); this.target = null;
    }
    this.state = 'idle'; this.idleTime = this.carry >= this.carryMax ? 0 : 15 + Math.random()*20;
  }

  goCollectPile() {
    const compatible = G.piles.filter(p => this.carry === 0 || p.resource === this.carryType);
    const pile = compatible[Math.floor(Math.random() * compatible.length)];
    if (!pile) { this.decide(); return; }
    this.moveTo(pile.x, pile.y, () => {
      const idx = G.piles.indexOf(pile);
      if (idx !== -1) {
        const take = Math.min(pile.amount, this.carryMax - this.carry);
        this.carry += take; this.carryType = pile.resource; pile.amount -= take;
        if (pile.amount <= 0) G.piles.splice(idx, 1);
      }
      this.idleTime = 5;
    });
  }

  goHome() {
    this.state = 'moving';
    const home = getHome();
    this.moveTo(home.x + (Math.random()-0.5)*22, home.y - 4, () => {
      if (this.carryType) G.res[this.carryType] += this.carry;
      this.carry = 0; this.carryType = null;
      checkBuild(); this.idleTime = 20 + Math.random()*30;
    });
  }

  goForage() {
    const home = getHome();
    const fx = home.x + 260 + Math.random() * 160;
    const fy = home.y - Math.random() * 25;
    this.moveTo(fx, fy, () => {
      this.carry     = 2 + Math.floor(Math.random() * 2);
      this.carryType = 'food';
      log(this.name + ' foraged for food.');
      this.goHome();
    });
  }

  goFarm(farm) {
    farm.attended = true;
    this.moveTo(farm.x + (Math.random()-0.5)*8, hutY() + (farm.yOff||0), () => this.startFarm(farm));
  }

  startFarm(farm) {
    if (!G.buildings.includes(farm)) { farm.attended = false; this.state = 'idle'; this.idleTime = 5; return; }
    this.state   = 'farming';
    this.farmTarget = farm;
    this.farmTime   = CFG_FARM_ATTEND_TIME;
  }

  finishFarm() {
    const farm = this.farmTarget;
    this.farmTarget = null;
    farm.attended = false;
    this.state = 'idle'; this.idleTime = 10;
    if (!G.buildings.includes(farm)) return;
    if (farm.farmState === 'unplanted') {
      farm.farmState = 'growing';
      farm.farmFood  = 0;
      log(this.name + ' sowed the fields.');
    } else if (farm.farmState === 'ready') {
      const harvest = Math.min(Math.ceil(farm.farmFood), this.carryMax);
      this.carry = harvest; this.carryType = 'food';
      farm.farmFood  = 0;
      farm.farmState = 'unplanted';
      this.idleTime  = 0;
      log(this.name + ' harvested ' + harvest + ' food!');
    }
  }

  goFetchForAttend(bld) {
    bld.attended = true;
    const { inputRes, inputAmt } = bld.attend;
    const home = getHome();
    this.moveTo(home.x + (Math.random()-0.5)*16, home.y - 4, () => {
      const take = Math.min(inputAmt, Math.floor(G.res[inputRes]));
      if (take > 0) {
        G.res[inputRes] -= take;
        this.carry = take; this.carryType = inputRes;
        this.goToAttend(bld);
      } else {
        bld.attended = false;
        this.state = 'idle'; this.idleTime = 20;
      }
    });
  }

  goDeliverToBuildSite(site, resType) {
    const home = getHome();
    this.moveTo(home.x + (Math.random()-0.5)*16, home.y - 4, () => {
      const stillNeeded = site.bt.cost[resType] - site.reserve[resType];
      const take = Math.min(stillNeeded, Math.floor(G.res[resType]), this.carryMax);
      if (take > 0 && G.pendingSites.includes(site)) {
        G.res[resType] -= take;
        this.carry = take; this.carryType = resType;
        this.goDepositAtSite(site);
      } else {
        this.state = 'idle'; this.idleTime = 20;
      }
    });
  }

  goDepositAtSite(site) {
    if (!G.pendingSites.includes(site)) { this.carry = 0; this.carryType = null; this.state = 'idle'; this.idleTime = 5; return; }
    this.moveTo(site.x + (Math.random()-0.5)*12, hutY() + site.yOff, () => {
      if (!G.pendingSites.includes(site) || !this.carryType) {
        if (this.carryType) { G.res[this.carryType] += this.carry; } // refund if site gone
        this.carry = 0; this.carryType = null; this.state = 'idle'; this.idleTime = 5; return;
      }
      const stillNeeded = site.bt.cost[this.carryType] - site.reserve[this.carryType];
      const deposit = Math.min(this.carry, Math.max(0, stillNeeded));
      const refund  = this.carry - deposit;
      site.reserve[this.carryType] += deposit;
      if (refund > 0) G.res[this.carryType] += refund;
      this.carry = 0; this.carryType = null;
      this.state = 'idle'; this.idleTime = 10;
      if (Object.entries(site.bt.cost).every(([r, amt]) => site.reserve[r] >= amt)) {
        site.readyToBuild = true;
        log(site.bt.name + ' site ready — starting construction!');
      }
    });
  }

  goToAttend(bld) {
    if (!G.buildings.includes(bld)) { bld.attended = false; this.decide(); return; }
    this.moveTo(bld.x + (Math.random()-0.5)*10, hutY() + (bld.yOff || 0), () => this.startAttend(bld));
  }

  startAttend(bld) {
    if (!G.buildings.includes(bld)) { bld.attended = false; this.state = 'idle'; this.idleTime = 5; return; }
    bld.inputStocked = this.carry;
    this.carry = 0; this.carryType = null;
    this.state = 'attending';
    this.attendTarget = bld;
    this.attendTime   = this.equipped === 'itools' ? bld.attend.ticks * 0.75 : bld.attend.ticks;
  }

  finishAttend() {
    const bld = this.attendTarget;
    this.attendTarget = null;
    if (bld) bld.attended = false;
    if (!bld || !G.buildings.includes(bld)) { this.state = 'idle'; this.idleTime = 5; return; }
    const { inputAmt, outputRes, outputChoice, outputAmt } = bld.attend;
    // For outputChoice buildings, pick whichever resource has lower stock (both below cap preferred)
    let chosen = outputRes;
    if (outputChoice) {
      chosen = outputChoice.reduce((best, r) => {
        const capR = RESOURCE_DEFS[r]?.cap ?? Infinity, capB = RESOURCE_DEFS[best]?.cap ?? Infinity;
        const rFull = G.res[r] >= capR, bFull = G.res[best] >= capB;
        if (rFull && !bFull) return best;
        if (!rFull && bFull) return r;
        return G.res[r] <= G.res[best] ? r : best;
      });
    }
    const produced = Math.floor(bld.inputStocked * outputAmt / inputAmt);
    const cap = RESOURCE_DEFS[chosen]?.cap;
    const actual = cap != null ? Math.min(produced, Math.max(0, cap - G.res[chosen])) : produced;
    if (actual > 0) G.res[chosen] += actual;
    bld.inputStocked = 0;
    const def = RESOURCE_DEFS[chosen];
    if (actual > 0) {
      log(`${this.name} produced ${actual} ${def?.label ?? chosen}!`);
      spawnParticleBurst(this.x, this.y - 10, def?.color ?? '#ffcc44', 8);
    }
    this.state = 'idle'; this.idleTime = 20 + Math.random() * 30;
  }

  goConstruct(site) {
    site.assigned = true;
    this.moveTo(site.x + (Math.random()-0.5)*10, hutY() + site.yOff, () => this.startConstruct(site));
  }

  startConstruct(site) {
    if (!G.pendingSites.includes(site)) { this.state = 'idle'; this.idleTime = 5; return; }
    this.state = 'constructing';
    this.constructSite = site;
  }

  finishConstruct() {
    const site = this.constructSite;
    this.constructSite = null;
    this.state = 'idle'; this.idleTime = 20 + Math.random() * 20;
    const idx = G.pendingSites.indexOf(site);
    if (idx === -1) return;
    G.pendingSites.splice(idx, 1);
    const bld = { x: site.x, yOff: site.yOff, w: site.bt.w, h: site.bt.h,
      color: site.bt.color, label: site.bt.label, name: site.bt.name, drawFn: site.bt.drawFn, born: G.tick };
    if (bld.label === 'farm') { bld.farmState = 'unplanted'; bld.farmFood = 0; bld.attended = false; G.farm = bld; }
    if (site.bt.attend)     { bld.attend = site.bt.attend; bld.attended = false; bld.inputStocked = 0; }
    if (site.bt.gatherSite) { bld.gatherSite = true; }
    if (site.bt.housing)    { G.housingCap += site.bt.housing; }
    G.buildings.push(bld);
    G.structures++;
    log('Built a ' + site.bt.name + '!');
    spawnParticleBurst(site.x, hutY() + site.yOff - site.bt.h / 2, site.bt.color, 18);
  }
}

// ── SPAWN ─────────────────────────────────────────────────────
function spawnCreature() {
  const c = new Creature(G.creatures.length);
  G.creatures.push(c);
  if (G.creatures.length === 1) log('Og emerges blinking from the hut...');
  else log(c.name + ' joins the tribe! (' + G.creatures.length + ' total)');
}
spawnCreature();
checkBuild();
setTimeout(scanDOM, 400);

// ── BUILDING DRAW FUNCTIONS ───────────────────────────────────

function drawCampfire(ctx, x, y, b, tick) {
  // Stone ring
  ctx.fillStyle = '#777777';
  for (let i = 0; i < 7; i++) {
    const a = (Math.PI * 2 * i) / 7;
    ctx.fillRect(x + Math.cos(a)*6 - 2, y - 3 + Math.sin(a)*2 - 1, 3, 2);
  }
  // Logs
  ctx.fillStyle = '#7a4a1a';
  ctx.save();
  ctx.translate(x, y - 3);
  ctx.rotate(0.5);  ctx.fillRect(-7, -1, 14, 2);
  ctx.rotate(-1);   ctx.fillRect(-7, -1, 14, 2);
  ctx.restore();
  // Flame — outer
  const fl = Math.sin(tick * 0.18) * 1.5;
  ctx.fillStyle = 'rgba(255,100,10,0.9)';
  ctx.beginPath();
  ctx.moveTo(x - 4, y - 3); ctx.lineTo(x + fl, y - 12 - fl); ctx.lineTo(x + 4, y - 3); ctx.fill();
  // Flame — inner
  ctx.fillStyle = 'rgba(255,220,60,0.85)';
  ctx.beginPath();
  ctx.moveTo(x - 2, y - 3); ctx.lineTo(x + fl*0.4, y - 8); ctx.lineTo(x + 2, y - 3); ctx.fill();
}

function drawFarm(ctx, x, y, b, tick) {
  const l = x - b.w/2;
  const state = b.farmState || 'unplanted';
  // Soil — darker when unplanted
  ctx.fillStyle = state === 'unplanted' ? '#3a2008' : '#4a2e10';
  ctx.fillRect(l, y - b.h, b.w, b.h);
  // Furrow lines when unplanted
  if (state === 'unplanted') {
    ctx.strokeStyle = 'rgba(90,50,15,0.5)'; ctx.lineWidth = 1;
    for (let r = 0; r < 3; r++) {
      ctx.beginPath();
      ctx.moveTo(l + 2, y - b.h + 3 + r * 4); ctx.lineTo(l + b.w - 2, y - b.h + 3 + r * 4);
      ctx.stroke();
    }
  }
  // Crop rows when growing or ready
  if (state === 'growing' || state === 'ready') {
    const progress = state === 'ready' ? 1 : b.farmFood / CFG_FARM_YIELD;
    const cropH = Math.max(1, Math.round(3 * progress));
    for (let r = 0; r < 3; r++) {
      ctx.fillStyle = state === 'ready' ? (r % 2 === 0 ? '#44bb22' : '#55dd33') : '#2a5510';
      ctx.fillRect(l + 2, y - b.h + 4 - cropH + r * 4, b.w - 4, cropH);
    }
  }
  // Fence posts
  ctx.fillStyle = '#8a6030';
  for (let fx = l; fx <= x + b.w/2; fx += 9) ctx.fillRect(fx - 1, y - b.h - 5, 2, b.h + 5);
  // Fence rail
  ctx.fillStyle = '#aa7a3a';
  ctx.fillRect(l, y - b.h - 2, b.w, 2);
  // Scarecrow
  ctx.fillStyle = '#886622';
  ctx.fillRect(x - 1, y - b.h - 10, 2, 10);
  ctx.fillRect(x - 5, y - b.h - 6, 10, 2);
  ctx.fillStyle = '#cc9933';
  ctx.fillRect(x - 2, y - b.h - 13, 5, 4);
}

function drawWell(ctx, x, y, b, tick) {
  // Stone base
  ctx.fillStyle = '#888888';
  ctx.fillRect(x - 7, y - 8, 14, 8);
  ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 0.5;
  ctx.beginPath(); ctx.moveTo(x - 7, y - 4); ctx.lineTo(x + 7, y - 4); ctx.stroke();
  // Top rim
  ctx.fillStyle = '#aaaaaa';
  ctx.fillRect(x - 8, y - 10, 16, 3);
  // Two wooden posts
  ctx.fillStyle = '#7a4a1a';
  ctx.fillRect(x - 8, y - 22, 3, 13);
  ctx.fillRect(x + 5,  y - 22, 3, 13);
  // Crossbeam
  ctx.fillRect(x - 8, y - 24, 16, 3);
  // Rope + swinging bucket
  const swing = Math.sin(tick * 0.04) * 1.5;
  ctx.strokeStyle = '#aa8833'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x + swing, y - 21); ctx.lineTo(x + swing, y - 14); ctx.stroke();
  ctx.fillStyle = '#5a3010';
  ctx.fillRect(x - 2 + swing, y - 14, 5, 4);
  ctx.strokeStyle = '#3a1a00'; ctx.lineWidth = 0.5;
  ctx.strokeRect(x - 2 + swing, y - 14, 5, 4);
  // Water shimmer inside
  const shimmer = 0.35 + 0.15 * Math.sin(tick * 0.07);
  ctx.fillStyle = `rgba(60,120,200,${shimmer})`;
  ctx.fillRect(x - 5, y - 6, 10, 3);
}

function drawStoneYard(ctx, x, y, b, tick) {
  // Stone-dust clearing
  ctx.fillStyle = '#2e2a26';
  ctx.fillRect(x - b.w/2, y - 3, b.w, 3);

  // Rough input boulder (left)
  ctx.fillStyle = '#777777';
  ctx.beginPath();
  ctx.moveTo(x - 14, y - 2);
  ctx.lineTo(x - 15, y - 9);
  ctx.lineTo(x - 10, y - 16);
  ctx.lineTo(x - 4,  y - 13);
  ctx.lineTo(x - 4,  y - 4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#606060'; // shading
  ctx.beginPath();
  ctx.moveTo(x - 5, y - 4); ctx.lineTo(x - 4, y - 13);
  ctx.lineTo(x - 8, y - 11); ctx.lineTo(x - 9, y - 5);
  ctx.closePath(); ctx.fill();

  // Cut stone block (right, output)
  ctx.fillStyle = '#b8b8b8';
  ctx.fillRect(x + 4, y - 14, 12, 11);
  ctx.fillStyle = '#d8d8d8'; // top face
  ctx.fillRect(x + 4, y - 14, 12, 2);
  ctx.fillStyle = '#909090'; // right shading
  ctx.fillRect(x + 14, y - 14, 2, 11);
  // Chisel score lines
  ctx.strokeStyle = '#999'; ctx.lineWidth = 0.5;
  ctx.beginPath(); ctx.moveTo(x + 5, y - 9); ctx.lineTo(x + 14, y - 9); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + 5, y - 6); ctx.lineTo(x + 14, y - 6); ctx.stroke();

  // Mallet leaning at centre
  ctx.strokeStyle = '#7a4a1a'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x - 1, y - 1); ctx.lineTo(x + 2, y - 15); ctx.stroke();
  ctx.fillStyle = '#555555';
  ctx.fillRect(x, y - 18, 5, 4);

  // Stone chips on ground
  ctx.fillStyle = '#aaaaaa';
  ctx.fillRect(x - 3, y - 2, 2, 1);
  ctx.fillRect(x + 1, y - 3, 3, 1);
  ctx.fillRect(x - 7, y - 2, 2, 1);
}

function drawBasicSawmill(ctx, x, y, b, tick) {
  // Dirt clearing
  ctx.fillStyle = '#2a1808';
  ctx.fillRect(x - b.w/2, y - 3, b.w, 3);

  // Two sawhorses (X stands)
  const standH = 13;
  [-10, 10].forEach(ox => {
    const sx = x + ox;
    ctx.strokeStyle = '#7a4a1a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(sx - 5, y);       ctx.lineTo(sx + 4, y - standH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sx + 5, y);       ctx.lineTo(sx - 4, y - standH); ctx.stroke();
    // cross brace
    ctx.strokeStyle = '#5a3010'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(sx - 3, y - 6); ctx.lineTo(sx + 3, y - 6); ctx.stroke();
  });

  // Log resting on the stands
  const logY = y - standH;
  ctx.fillStyle = '#7a4a1a';
  ctx.fillRect(x - 14, logY - 3, 28, 6);
  // Bark grain
  ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x - 14, logY - 1); ctx.lineTo(x + 14, logY - 1); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - 14, logY + 1); ctx.lineTo(x + 14, logY + 1); ctx.stroke();
  // End faces
  [x - 14, x + 14].forEach(ex => {
    ctx.fillStyle = '#5a3010';
    ctx.beginPath(); ctx.ellipse(ex, logY, 4, 3, 0, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#3a2008'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.ellipse(ex, logY, 2, 1.5, 0, 0, Math.PI*2); ctx.stroke();
  });

  // Sawdust / chips on ground
  ctx.fillStyle = '#a06030';
  ctx.fillRect(x - 5, y - 2, 3, 2);
  ctx.fillRect(x + 2, y - 3, 4, 2);
  ctx.fillRect(x - 1, y - 2, 2, 1);
}

function drawSawmill(ctx, x, y, b, tick) {
  // Walls
  ctx.fillStyle = '#7a5230';
  ctx.fillRect(x - b.w/2, y - b.h, b.w, b.h);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(x + b.w/2 - 5, y - b.h, 5, b.h);
  // Roof
  ctx.fillStyle = '#5a3818';
  ctx.beginPath();
  ctx.moveTo(x - b.w/2 - 3, y - b.h);
  ctx.lineTo(x, y - b.h - 10); ctx.lineTo(x + b.w/2 + 3, y - b.h); ctx.fill();
  // Door
  ctx.fillStyle = '#2a1408';
  ctx.fillRect(x - 4, y - 10, 8, 10);
  // Rotating saw blade
  const sawX = x + b.w/2 - 4, sawY = y - b.h/2 - 2;
  ctx.save();
  ctx.translate(sawX, sawY);
  ctx.rotate(tick * 0.1);
  ctx.strokeStyle = '#cccccc'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#aaaaaa';
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI * 2 * i) / 8;
    ctx.fillRect(Math.cos(a)*4.5 - 1, Math.sin(a)*4.5 - 1, 2, 2);
  }
  ctx.restore();
  // Log pile
  ctx.fillStyle = '#6b3e1a';
  for (let li = 0; li < 3; li++) {
    ctx.beginPath();
    ctx.ellipse(x - b.w/2 + 5 + li*2, y - 3 - li*2, 4, 2.5, 0, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#5a3010';
    ctx.beginPath();
    ctx.ellipse(x - b.w/2 + 5 + li*2, y - 3 - li*2, 2, 1.5, 0, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#6b3e1a';
  }
}

function drawWhouse1(ctx, x, y, b, tick) {
  // Round wattle-and-daub hut with conical thatched roof
  ctx.fillStyle = '#1e0e04';
  ctx.fillRect(x - b.w/2 - 2, y - 2, b.w + 4, 5); // foundation
  // Oval walls
  ctx.fillStyle = '#7a5a30';
  ctx.beginPath();
  ctx.ellipse(x, y - b.h * 0.4, b.w/2, b.h * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
  // Side shading
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.ellipse(x + b.w * 0.15, y - b.h * 0.4, b.w * 0.28, b.h * 0.38, 0, 0, Math.PI * 2);
  ctx.fill();
  // Conical thatched roof
  ctx.fillStyle = '#4a3008';
  ctx.beginPath();
  ctx.moveTo(x - b.w/2 - 2, y - b.h * 0.42);
  ctx.lineTo(x, y - b.h);
  ctx.lineTo(x + b.w/2 + 2, y - b.h * 0.42);
  ctx.fill();
  // Thatch layer lines
  ctx.strokeStyle = '#3a2008'; ctx.lineWidth = 1;
  for (let t = 1; t < 4; t++) {
    const ty = y - b.h * 0.42 - (b.h * 0.58 / 4) * t;
    const tw = (b.w/2 + 2) * (1 - t / 4);
    ctx.beginPath(); ctx.moveTo(x - tw, ty); ctx.lineTo(x + tw, ty); ctx.stroke();
  }
  // Door arch
  ctx.fillStyle = '#110806';
  ctx.beginPath(); ctx.arc(x, y - 7, 5, Math.PI, 0); ctx.fill();
  ctx.fillRect(x - 5, y - 7, 10, 7);
  const glow = 0.15 + 0.08 * Math.sin(tick * 0.11);
  ctx.fillStyle = `rgba(255,140,30,${glow})`;
  ctx.fillRect(x - 4, y - 6, 8, 6);
}

function drawWhouse3(ctx, x, y, b, tick) {
  // Longhouse — log walls with slanted lean-to roof
  ctx.fillStyle = '#1a0c04';
  ctx.fillRect(x - b.w/2 - 2, y - 2, b.w + 4, 5); // foundation
  // Log walls
  ctx.fillStyle = '#5a3010';
  ctx.fillRect(x - b.w/2, y - b.h, b.w, b.h);
  // Log grain lines
  ctx.strokeStyle = '#3a2008'; ctx.lineWidth = 1;
  for (let l = 5; l < b.h; l += 6) {
    ctx.beginPath(); ctx.moveTo(x - b.w/2, y - l); ctx.lineTo(x + b.w/2, y - l); ctx.stroke();
  }
  // Side shading
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fillRect(x + b.w/2 - 4, y - b.h, 4, b.h);
  // Slanted asymmetric roof
  ctx.fillStyle = '#3a2808';
  ctx.beginPath();
  ctx.moveTo(x - b.w/2 - 3, y - b.h);
  ctx.lineTo(x - b.w/2 - 3, y - b.h - 10);
  ctx.lineTo(x + b.w/2 + 3, y - b.h - 3);
  ctx.lineTo(x + b.w/2 + 3, y - b.h);
  ctx.fill();
  // Roof edge board
  ctx.fillStyle = '#5a3a14';
  ctx.fillRect(x - b.w/2 - 3, y - b.h - 11, b.w + 6, 2);
  // Door
  ctx.fillStyle = '#110806';
  ctx.fillRect(x - 4, y - 11, 8, 11);
  const glow = 0.18 + 0.10 * Math.sin(tick * 0.13);
  ctx.fillStyle = `rgba(255,140,30,${glow})`;
  ctx.fillRect(x - 3, y - 10, 6, 9);
  // Window
  ctx.fillStyle = '#110806';
  ctx.fillRect(x - b.w/2 + 5, y - b.h + 8, 6, 4);
  ctx.fillStyle = `rgba(255,180,60,0.35)`;
  ctx.fillRect(x - b.w/2 + 6, y - b.h + 9, 4, 2);
}

function drawWhouse2(ctx, x, y, b, tick) {
  ctx.fillStyle = '#1e0e04';
  ctx.fillRect(x - b.w/2 - 2, y - 2, b.w + 4, 5);        // foundation
  ctx.fillStyle = '#5a2e10';
  ctx.fillRect(x - b.w/2, y - b.h, b.w, b.h);             // walls
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fillRect(x + b.w/2 - 4, y - b.h, 4, b.h);           // shading
  // Roof
  ctx.fillStyle = '#7a4a1a';
  ctx.beginPath();
  ctx.moveTo(x - b.w/2 - 4, y - b.h);
  ctx.lineTo(x, y - b.h - b.w*0.55);
  ctx.lineTo(x + b.w/2 + 4, y - b.h); ctx.fill();
  ctx.fillStyle = '#5a3a0a';
  ctx.fillRect(x - 1, y - b.h - b.w*0.55, 2, b.w*0.55);  // ridge
  // Door + glow
  ctx.fillStyle = '#110806'; ctx.fillRect(x - 5, y - 12, 10, 12);
  const glow = 0.2 + 0.1 * Math.sin(tick * 0.11);
  ctx.fillStyle = `rgba(255,140,30,${glow})`; ctx.fillRect(x - 4, y - 11, 8, 10);
  // Window
  ctx.fillStyle = '#110806'; ctx.fillRect(x - b.w/2 + 4, y - b.h + 6, 5, 4);
  ctx.fillStyle = `rgba(255,180,60,0.4)`; ctx.fillRect(x - b.w/2 + 5, y - b.h + 7, 3, 2);
}

function drawForge(ctx, x, y, b, tick) {
  // Dark stone walls
  ctx.fillStyle = '#332211';
  ctx.fillRect(x - b.w/2, y - b.h, b.w, b.h);
  // Stone rows
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 0.5;
  for (let row = 4; row < b.h; row += 5) {
    ctx.beginPath(); ctx.moveTo(x - b.w/2, y - b.h + row); ctx.lineTo(x + b.w/2, y - b.h + row); ctx.stroke();
  }
  // Chimney
  ctx.fillStyle = '#221a0e';
  ctx.fillRect(x + 6, y - b.h - 14, 8, 16);
  // Chimney glow/smoke
  const cg = 0.35 + 0.25 * Math.sin(tick * 0.14);
  ctx.fillStyle = `rgba(255,90,10,${cg})`;
  ctx.beginPath(); ctx.arc(x + 10, y - b.h - 11, 4, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = `rgba(180,150,120,${cg * 0.5})`;
  ctx.beginPath(); ctx.arc(x + 10 + Math.sin(tick*0.05)*2, y - b.h - 18, 3, 0, Math.PI*2); ctx.fill();
  // Arched doorway
  ctx.fillStyle = '#110806';
  ctx.fillRect(x - 6, y - 14, 12, 14);
  ctx.beginPath(); ctx.arc(x, y - 14, 6, Math.PI, 0); ctx.fill();
  // Forge glow inside — brighter when attended
  const glowBase = b.attended ? 0.8 + 0.15 * Math.sin(tick * 0.18) : 0.55 + 0.35 * Math.sin(tick * 0.09);
  ctx.fillStyle = `rgba(255,150,30,${glowBase})`;
  ctx.fillRect(x - 4, y - 13, 9, 12);
  ctx.beginPath(); ctx.arc(x + 0.5, y - 13, 4, Math.PI, 0); ctx.fill();
  // Anvil silhouette
  ctx.fillStyle = '#555555';
  ctx.fillRect(x - 5, y - 18, 10, 3);
  ctx.fillRect(x - 3, y - 21, 6, 3);
  // Attended: hammer striking + sparks
  if (b.attended) {
    const phase = (tick % 30) / 30;
    const hammerUp = phase < 0.4;
    const hammerY  = hammerUp ? y - 32 : y - 23;
    // Hammer handle
    ctx.fillStyle = '#8b5e2a';
    ctx.fillRect(x + 1, hammerY, 2, 10);
    // Hammer head
    ctx.fillStyle = '#888888';
    ctx.fillRect(x - 2, hammerY - 4, 8, 4);
    // Sparks on impact frame
    if (!hammerUp && phase < 0.55) {
      ctx.fillStyle = '#ffdd44';
      [[-5, -4], [6, -5], [-3, -7], [5, -3], [-6, -7]].forEach(([sx, sy]) => {
        ctx.beginPath(); ctx.arc(x + sx, y - 18 + sy, 1, 0, Math.PI*2); ctx.fill();
      });
    }
  }
}

function drawBarracks(ctx, x, y, b, tick) {
  ctx.fillStyle = '#3a4a55';
  ctx.fillRect(x - b.w/2, y - b.h, b.w, b.h);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(x + b.w/2 - 4, y - b.h, 4, b.h);
  // Crenellations
  ctx.fillStyle = '#4a5a66';
  for (let mx = x - b.w/2; mx < x + b.w/2 - 4; mx += 10) ctx.fillRect(mx, y - b.h - 5, 6, 5);
  // Arrow slits
  ctx.fillStyle = '#223344';
  ctx.fillRect(x - b.w/2 + 6, y - b.h + 6, 3, 7);
  ctx.fillRect(x + b.w/2 - 9, y - b.h + 6, 3, 7);
  // Gate
  ctx.fillStyle = '#1a2a33';
  ctx.fillRect(x - 7, y - 14, 14, 14);
  ctx.beginPath(); ctx.arc(x, y - 14, 7, Math.PI, 0); ctx.fill();
  // Flagpole + waving pennant
  ctx.strokeStyle = '#556677'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x, y - b.h - 5); ctx.lineTo(x, y - b.h - 18); ctx.stroke();
  const w = Math.sin(tick * 0.09) * 2;
  ctx.fillStyle = '#cc3333';
  ctx.beginPath();
  ctx.moveTo(x, y - b.h - 18); ctx.lineTo(x + 10 + w, y - b.h - 14); ctx.lineTo(x, y - b.h - 10); ctx.fill();
}

function drawMarket(ctx, x, y, b, tick) {
  // Walls
  ctx.fillStyle = '#7a6030';
  ctx.fillRect(x - b.w/2, y - b.h, b.w, b.h);
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.fillRect(x + b.w/2 - 4, y - b.h, 4, b.h);
  // Striped canopy
  const sw = 6;
  for (let si = 0; si * sw < b.w; si++) {
    ctx.fillStyle = si % 2 === 0 ? '#cc9933' : '#aa7722';
    const lx = x - b.w/2 + si * sw;
    ctx.beginPath();
    ctx.moveTo(lx, y - b.h); ctx.lineTo(Math.min(lx + sw, x + b.w/2), y - b.h);
    ctx.lineTo(Math.min(lx + sw, x + b.w/2) + 3, y - b.h + 9); ctx.lineTo(lx + 3, y - b.h + 9);
    ctx.fill();
  }
  // Goods on display
  const goods = ['#cc4444','#44aacc','#66cc33','#ffcc22'];
  for (let g = 0; g < 4; g++) {
    ctx.fillStyle = goods[g];
    ctx.fillRect(x - b.w/2 + 4 + g * 9, y - b.h + 13, 6, 5);
  }
  // Open doorway
  ctx.fillStyle = '#3a2808';
  ctx.fillRect(x - 5, y - 12, 10, 12);
}

function drawTemple(ctx, x, y, b, tick) {
  // Stepped base (3 tiers)
  for (let s = 0; s < 3; s++) {
    const sw = b.w - s * 10, sh = 8;
    ctx.fillStyle = `hsl(42,55%,${28 + s * 7}%)`;
    ctx.fillRect(x - sw/2, y - (s+1)*sh, sw, sh);
  }
  const baseTop = y - 24;
  const bodyH   = b.h - 24;
  // Main body
  ctx.fillStyle = '#aa8822';
  ctx.fillRect(x - b.w/2 + 10, baseTop - bodyH, b.w - 20, bodyH);
  // Columns
  ctx.fillStyle = '#ddbb55';
  [-b.w/2+12, -b.w/2+20, b.w/2-20, b.w/2-12].forEach(cx => {
    ctx.fillRect(x + cx - 2, baseTop - bodyH, 4, bodyH);
  });
  // Entablature (top beam)
  ctx.fillStyle = '#ccaa33';
  ctx.fillRect(x - b.w/2 + 9, baseTop - bodyH, b.w - 18, 4);
  // Pointed roof
  ctx.fillStyle = '#ffcc44';
  ctx.beginPath();
  ctx.moveTo(x - b.w/2 + 8, baseTop - bodyH);
  ctx.lineTo(x, baseTop - bodyH - 16);
  ctx.lineTo(x + b.w/2 - 8, baseTop - bodyH); ctx.fill();
  // Glowing apex
  const glow = 0.5 + 0.35 * Math.sin(tick * 0.06);
  ctx.fillStyle = `rgba(255,230,100,${glow})`;
  ctx.beginPath(); ctx.arc(x, baseTop - bodyH - 16, 4, 0, Math.PI*2); ctx.fill();
  // Door
  ctx.fillStyle = '#3a2800';
  ctx.fillRect(x - 5, y - 24, 10, 14);
  ctx.beginPath(); ctx.arc(x, y - 24, 5, Math.PI, 0); ctx.fill();
}

function drawHut1(ctx, x, y, b, tick) {
  // Mud-daub hut — rectangular walls, simple gabled roof, arched door
  ctx.fillStyle = '#1a0e06';
  ctx.fillRect(x - b.w/2 - 1, y - 2, b.w + 2, 4); // foundation
  ctx.fillStyle = '#7a5830';
  ctx.fillRect(x - b.w/2, y - b.h * 0.55, b.w, b.h * 0.55); // walls
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(x + b.w/2 - 4, y - b.h * 0.55, 4, b.h * 0.55); // side shade
  // Gabled roof
  ctx.fillStyle = '#3e2808';
  ctx.beginPath();
  ctx.moveTo(x - b.w/2 - 2, y - b.h * 0.55);
  ctx.lineTo(x, y - b.h);
  ctx.lineTo(x + b.w/2 + 2, y - b.h * 0.55);
  ctx.fill();
  // Door
  ctx.fillStyle = '#110806';
  ctx.fillRect(x - 4, y - 9, 8, 9);
  ctx.beginPath(); ctx.arc(x, y - 9, 4, Math.PI, 0); ctx.fill();
  const glow = 0.14 + 0.08 * Math.sin(tick * 0.10);
  ctx.fillStyle = `rgba(255,140,30,${glow})`;
  ctx.fillRect(x - 3, y - 8, 6, 8);
}

function drawHut2(ctx, x, y, b, tick) {
  // Round wattle hut with short conical thatched roof
  ctx.fillStyle = '#1a0e06';
  ctx.fillRect(x - b.w/2 - 1, y - 2, b.w + 2, 4); // foundation
  // Oval walls
  ctx.fillStyle = '#6b4e28';
  ctx.beginPath();
  ctx.ellipse(x, y - b.h * 0.32, b.w/2, b.h * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.beginPath();
  ctx.ellipse(x + b.w * 0.18, y - b.h * 0.32, b.w * 0.22, b.h * 0.30, 0, 0, Math.PI * 2);
  ctx.fill();
  // Conical thatch
  ctx.fillStyle = '#4a3008';
  ctx.beginPath();
  ctx.moveTo(x - b.w/2 - 2, y - b.h * 0.34);
  ctx.lineTo(x, y - b.h);
  ctx.lineTo(x + b.w/2 + 2, y - b.h * 0.34);
  ctx.fill();
  // Thatch lines
  ctx.strokeStyle = '#332208'; ctx.lineWidth = 1;
  for (let t = 1; t < 3; t++) {
    const ty = y - b.h * 0.34 - (b.h * 0.66 / 3) * t;
    const tw = (b.w/2 + 2) * (1 - t / 3);
    ctx.beginPath(); ctx.moveTo(x - tw, ty); ctx.lineTo(x + tw, ty); ctx.stroke();
  }
  // Door
  ctx.fillStyle = '#110806';
  ctx.beginPath(); ctx.arc(x, y - 7, 4, Math.PI, 0); ctx.fill();
  ctx.fillRect(x - 4, y - 7, 8, 7);
  const glow = 0.13 + 0.08 * Math.sin(tick * 0.12);
  ctx.fillStyle = `rgba(255,140,30,${glow})`;
  ctx.fillRect(x - 3, y - 6, 6, 6);
}

function drawHut3(ctx, x, y, b, tick) {
  // Log-cabin hut — horizontal log walls, shallow pitched roof, small window
  ctx.fillStyle = '#1a0e06';
  ctx.fillRect(x - b.w/2 - 1, y - 2, b.w + 2, 4); // foundation
  ctx.fillStyle = '#5a3410';
  ctx.fillRect(x - b.w/2, y - b.h * 0.52, b.w, b.h * 0.52); // walls
  // Log lines
  ctx.strokeStyle = '#3a2008'; ctx.lineWidth = 1;
  for (let l = 4; l < b.h * 0.52; l += 5) {
    ctx.beginPath(); ctx.moveTo(x - b.w/2, y - l); ctx.lineTo(x + b.w/2, y - l); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(x + b.w/2 - 4, y - b.h * 0.52, 4, b.h * 0.52); // side shade
  // Low gabled roof
  ctx.fillStyle = '#332210';
  ctx.beginPath();
  ctx.moveTo(x - b.w/2 - 3, y - b.h * 0.52);
  ctx.lineTo(x, y - b.h);
  ctx.lineTo(x + b.w/2 + 3, y - b.h * 0.52);
  ctx.fill();
  // Door
  ctx.fillStyle = '#110806';
  ctx.fillRect(x - 4, y - 9, 8, 9);
  const glow = 0.14 + 0.08 * Math.sin(tick * 0.09);
  ctx.fillStyle = `rgba(255,140,30,${glow})`;
  ctx.fillRect(x - 3, y - 8, 6, 8);
  // Small window
  ctx.fillStyle = '#110806';
  ctx.fillRect(x + 5, y - b.h * 0.52 + 7, 5, 4);
  ctx.fillStyle = 'rgba(255,180,60,0.35)';
  ctx.fillRect(x + 6, y - b.h * 0.52 + 8, 3, 2);
}

function drawBlacksmith(ctx, x, y, b, tick) {
  // Stone walls
  ctx.fillStyle = '#3a3630';
  ctx.fillRect(x - b.w/2, y - b.h, b.w, b.h);
  ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = 0.5;
  for (let row = 5; row < b.h; row += 5) {
    ctx.beginPath(); ctx.moveTo(x - b.w/2, y - b.h + row); ctx.lineTo(x + b.w/2, y - b.h + row); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fillRect(x + b.w/2 - 4, y - b.h, 4, b.h);
  // Pitched roof
  ctx.fillStyle = '#252018';
  ctx.beginPath();
  ctx.moveTo(x - b.w/2 - 2, y - b.h); ctx.lineTo(x, y - b.h - 9); ctx.lineTo(x + b.w/2 + 2, y - b.h); ctx.fill();
  // Chimney
  ctx.fillStyle = '#201c16';
  ctx.fillRect(x - 9, y - b.h - 13, 6, 15);
  const cg = 0.3 + 0.22 * Math.sin(tick * 0.13);
  ctx.fillStyle = `rgba(255,85,10,${cg})`;
  ctx.beginPath(); ctx.arc(x - 6, y - b.h - 11, 3, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = `rgba(150,120,90,${cg * 0.5})`;
  ctx.beginPath(); ctx.arc(x - 6 + Math.sin(tick*0.06)*2, y - b.h - 17, 3, 0, Math.PI*2); ctx.fill();
  // Doorway
  ctx.fillStyle = '#110806';
  ctx.fillRect(x - 4, y - 11, 8, 11);
  // Anvil outside (right side)
  const ax = x + 9;
  ctx.fillStyle = '#666666';
  ctx.fillRect(ax - 5, y - 9, 10, 3);   // top face
  ctx.fillStyle = '#4a4a4a';
  ctx.fillRect(ax - 3, y - 6, 6, 4);    // base
  ctx.fillStyle = '#777777';
  ctx.fillRect(ax + 4, y - 11, 3, 3);   // horn
  // Hammer leaning on anvil
  ctx.strokeStyle = '#8b5e2a'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(ax - 6, y); ctx.lineTo(ax - 4, y - 10); ctx.stroke();
  ctx.fillStyle = '#777777'; ctx.fillRect(ax - 7, y - 13, 5, 3);
  // Attended: sparks from anvil
  if (b.attended) {
    const phase = (tick % 22) / 22;
    if (phase < 0.35) {
      ctx.fillStyle = '#ffee44';
      [[1,-2],[4,-4],[7,-1],[3,-5],[6,-3]].forEach(([sx, sy]) => {
        ctx.beginPath(); ctx.arc(ax + sx - 2, y - 9 + sy, 0.8, 0, Math.PI*2); ctx.fill();
      });
    }
  }
}

const BUILD_DRAW = { campfire: drawCampfire, farm: drawFarm, well: drawWell, stoneyard: drawStoneYard, bsawmill: drawBasicSawmill, sawmill: drawSawmill,
  hut1: drawHut1, hut2: drawHut2, hut3: drawHut3, whouse1: drawWhouse1, whouse2: drawWhouse2, whouse3: drawWhouse3, forge: drawForge, barracks: drawBarracks, market: drawMarket, temple: drawTemple, blacksmith: drawBlacksmith };
  
// ── DRAW HELPERS ──────────────────────────────────────────────

function drawCave(x, y) {
  ctx.save();
  // Base shadow
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(x - 36, y - 2, 72, 5);
  // Rock face — left and right columns
  ctx.fillStyle = '#3e3830';
  ctx.fillRect(x - 34, y - 40, 20, 40);
  ctx.fillRect(x + 14, y - 40, 20, 40);
  // Lintel (top connecting piece)
  ctx.fillRect(x - 34, y - 40, 68, 10);
  // Jagged rock peaks
  ctx.fillStyle = '#332e28';
  ctx.fillRect(x - 34, y - 50, 14, 14);
  ctx.fillRect(x - 18, y - 56, 10, 20);
  ctx.fillRect(x -  6, y - 52, 12, 16);
  ctx.fillRect(x + 10, y - 58, 10, 22);
  ctx.fillRect(x + 22, y - 48, 12, 12);
  // Darker tips
  ctx.fillStyle = '#28231e';
  ctx.fillRect(x - 17, y - 60, 6,  8);
  ctx.fillRect(x + 11, y - 63, 6, 10);
  ctx.fillRect(x -  5, y - 55, 5,  6);
  // Cave mouth — dark arch
  ctx.fillStyle = '#0c0907';
  ctx.fillRect(x - 13, y - 36, 26, 36);
  ctx.beginPath(); ctx.arc(x, y - 36, 13, Math.PI, 0); ctx.fill();
  // Firelight glow inside
  const glow = 0.3 + 0.14 * Math.sin(G.tick * 0.09);
  ctx.fillStyle = `rgba(255,130,25,${glow})`;
  ctx.fillRect(x - 10, y - 33, 20, 31);
  ctx.beginPath(); ctx.arc(x, y - 33, 10, Math.PI, 0); ctx.fill();
  // Rock crack details
  ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x - 26, y - 38); ctx.lineTo(x - 22, y - 26); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + 20, y - 35); ctx.lineTo(x + 24, y - 22); ctx.stroke();
  // Stalactites above opening
  ctx.fillStyle = '#2e2924';
  ctx.beginPath(); ctx.moveTo(x - 9, y - 49); ctx.lineTo(x - 6, y - 40); ctx.lineTo(x - 3, y - 49); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x + 3, y - 49); ctx.lineTo(x + 7, y - 41); ctx.lineTo(x + 10, y - 49); ctx.fill();
  // Scatter rocks at base
  ctx.fillStyle = '#4a4540';
  ctx.fillRect(x - 38, y - 5, 6, 3);
  ctx.fillRect(x + 30, y - 4, 5, 3);
  ctx.fillRect(x - 42, y - 2, 4, 2);
  ctx.restore();
}

function drawBuilding(b) {
  ctx.save();
  ctx.globalAlpha = Math.min(1, (G.tick - b.born) / 60);
  const by = hutY() + (b.yOff || 0);
  const fn = BUILD_DRAW[b.drawFn];
  if (fn) fn(ctx, b.x, by, b, G.tick);
  ctx.fillStyle = 'rgba(200,200,255,0.6)';
  ctx.font = '8px Courier New'; ctx.textAlign = 'center';
  ctx.fillText(b.label, b.x, by + 10);
  ctx.restore();
}

function drawPile(p) {
  ctx.globalAlpha = Math.min(1, p.life / 40);
  const color = RESOURCE_DEFS[p.resource]?.color ?? '#ffcc44';
  for (let i = 0; i < Math.min(p.amount, 9); i++) {
    ctx.fillStyle = color;
    ctx.fillRect(p.x - 10 + (i%3)*7, p.y - Math.floor(i/3)*5, 6, 4);
  }
}

function drawParticle(p) {
  ctx.globalAlpha = p.life / p.maxLife; ctx.fillStyle = p.color;
  const sz = 2 + (p.life / p.maxLife) * 2;
  ctx.fillRect(p.x - sz/2, p.y - sz/2, sz, sz);
}

function drawGround() {
  ctx.save();
  const gy = hutY() + 6;
  ctx.strokeStyle = 'rgba(80,60,40,0.3)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(canvas.width, gy); ctx.stroke();
  ctx.fillStyle = 'rgba(60,40,20,0.15)';
  for (let gx = 20; gx < Math.min(canvas.width, HUT.x + G.buildings.length*80 + 100); gx += 18)
    ctx.fillRect(gx, gy + 2, 3, 2);
  ctx.restore();
}

// ── LOOP ─────────────────────────────────────────────────
function loop() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  G.tick++;
  if (G.scanTimer < CFG_SCAN_INTERVAL) G.scanTimer++; else { scanDOM(); G.scanTimer = 0; }
  if (G.farm && G.farm.farmState === 'growing') {
    G.farm.farmFood += CFG_FARM_YIELD / CFG_FARM_GROW_TICKS;
    if (G.farm.farmFood >= CFG_FARM_YIELD) {
      G.farm.farmFood  = CFG_FARM_YIELD;
      G.farm.farmState = 'ready';
      log('Crops are ready to harvest!');
    }
  }
  const canSpawn = G.res.wood >= CFG_AUTOSPAWN_COST && G.creatures.length < G.housingCap
                && (!G.farm || G.res.food > 0);
  if (G.autoTimer >= CFG_AUTOSPAWN_INTERVAL) {
    if (canSpawn) { G.res.wood -= CFG_AUTOSPAWN_COST; spawnCreature(); G.autoTimer = 0; }
  } else {
    G.autoTimer++;
  }
  drawGround();
  for (let i = G.piles.length - 1; i >= 0; i--) {
    const p = G.piles[i]; p.life--;
    if (p.life <= 0) { G.piles.splice(i, 1); } else { drawPile(p); }
  }
  for (let i = G.particles.length - 1; i >= 0; i--) {
    const p = G.particles[i]; p.x += p.vx; p.y += p.vy; p.vy += 0.1; p.life--;
    if (p.life <= 0) { G.particles.splice(i, 1); } else { drawParticle(p); }
  }
  ctx.globalAlpha = 1;
  G.pendingSites.forEach(s => drawPendingSite(s));
  drawCave(HUT.x, hutY());
  G.buildings.forEach(b => drawBuilding(b));
  G.creatures.forEach(c => { c.tick(); c.draw(); });
  drawSelection();
  if (G.tick % 6 === 0) updateUI();
  requestAnimationFrame(loop);
}
loop();
log('A civilisation stirs...');

// ── SELECTION ─────────────────────────────────────────────────
function drawSelection() {
  if (!G.selected) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,120,0.85)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 2]);
  if (G.selected.type === 'creature') {
    const c = G.selected.ref;
    ctx.beginPath(); ctx.arc(c.x, c.y - 14, 13, 0, Math.PI * 2); ctx.stroke();
  } else if (G.selected.type === 'site') {
    const s = G.selected.ref;
    if (!G.pendingSites.includes(s)) { G.selected = null; ctx.restore(); return; }
    const sy = hutY() + (s.yOff || 0);
    ctx.strokeRect(s.x - s.bt.w/2 - 3, sy - s.bt.h - 3, s.bt.w + 6, s.bt.h + 6);
  } else if (G.selected.type === 'building') {
    const b = G.selected.ref;
    const by = hutY() + (b.yOff || 0);
    ctx.strokeRect(b.x - b.w/2 - 3, by - b.h - 3, b.w + 6, b.h + 6);
  } else if (G.selected.type === 'cave') {
    ctx.strokeRect(HUT.x - 37, hutY() - 65, 74, 68);
  }
  ctx.setLineDash([]);
  ctx.restore();
}

document.addEventListener('click', e => {
  if (e.target.closest('#civ-ui') || e.target.closest('#civ-info')) return;
  const mx = e.clientX, my = e.clientY;

  // Creatures — nearest within 18px of body centre
  let hit = null, bestDist = 18;
  for (const c of G.creatures) {
    const d = Math.hypot(c.x - mx, (c.y - 14) - my);
    if (d < bestDist) { hit = c; bestDist = d; }
  }
  if (hit) { G.selected = { type: 'creature', ref: hit }; return; }

  // Pending build sites — bounding box (check before buildings, sites sit on same footprint)
  const hy = hutY();
  for (const s of G.pendingSites) {
    const sy = hy + (s.yOff || 0);
    if (mx >= s.x - s.bt.w/2 && mx <= s.x + s.bt.w/2 && my >= sy - s.bt.h && my <= sy) {
      G.selected = { type: 'site', ref: s }; return;
    }
  }

  // Buildings — bounding box
  for (const b of G.buildings) {
    const by = hy + (b.yOff || 0);
    if (mx >= b.x - b.w/2 && mx <= b.x + b.w/2 && my >= by - b.h && my <= by) {
      G.selected = { type: 'building', ref: b }; return;
    }
  }

  // Cave
  if (mx >= HUT.x - 36 && mx <= HUT.x + 36 && my >= hy - 65 && my <= hy) {
    G.selected = { type: 'cave' }; return;
  }

  G.selected = null;
});

// ── BUTTONS ───────────────────────────────────────────────────
document.getElementById('civ-spawn-btn').addEventListener('click', () => {
  if (G.creatures.length >= G.housingCap) { log('No room! Build more huts first.'); return; }
  if (G.res.wood >= CFG_MANUAL_SPAWN_COST) { G.res.wood -= CFG_MANUAL_SPAWN_COST; spawnCreature(); }
  else log(`Need ${CFG_MANUAL_SPAWN_COST} wood!`);
});

document.getElementById('civ-scan-btn').addEventListener('click', () => { scanDOM(); log('Scanning for new targets...'); });

document.getElementById('civ-toggle').addEventListener('click', () => {
  const body = document.getElementById('civ-body'), btn = document.getElementById('civ-toggle');
  if (body.style.display === 'none') { body.style.display = ''; btn.textContent = '▼'; }
  else { body.style.display = 'none'; btn.textContent = '▲'; }
});

// ── CHEAT PANEL ───────────────────────────────────────────────
document.getElementById('civ-cheat-btn').addEventListener('click', () => {
  const panel = document.getElementById('civ-cheat');
  const opening = panel.style.display === 'none';
  panel.style.display = opening ? '' : 'none';
  if (opening) {
    Object.keys(RESOURCE_DEFS).forEach(key => {
      const input = document.getElementById('cheat-' + key);
      if (input) input.value = Math.floor(G.res[key]);
    });
  }
});

Object.keys(RESOURCE_DEFS).forEach(key => {
  const input = document.getElementById('cheat-' + key);
  if (!input) return;
  input.addEventListener('input', () => {
    const v = parseInt(input.value);
    if (!isNaN(v) && v >= 0) G.res[key] = v;
  });
  // Prevent the page-freeze click listener from swallowing clicks inside inputs
  input.addEventListener('click', e => e.stopPropagation());
});

})();
