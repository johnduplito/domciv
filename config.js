// ── BUILDING PROGRESSION ──────────────────────────────────────
// Buildings are constructed in order. cost is an object of { resourceKey: amount }.
// attend: { inputRes, inputAmt, outputRes, outputAmt, ticks } — marks a building as an attended processor.
const BUILDS = [
  // ── Tier 1 ───────────────────────────────────────────────────
  { name: 'Campfire',      drawFn: 'campfire',   cost: { wood: 15 },                                             w: 14, h: 8,  color: '#cc4400', label: 'fire',  buildTime: 200, gatherSite: true },
  { name: 'Basic Sawmill', drawFn: 'bsawmill',   cost: { wood: 30, stone: 10 },                                  w: 32, h: 26, color: '#8b6535', label: 'b.saw', buildTime: 300,
    attend: { inputRes: 'wood',  inputAmt: 4, outputRes: 'planks',  outputAmt: 3, ticks: 720 } },
  { name: 'Stone Yard',    drawFn: 'stoneyard',  cost: { wood: 10, stone: 10 },                                  w: 36, h: 20, color: '#888888', label: 'yard',  buildTime: 300,
    attend: { inputRes: 'stone', inputAmt: 4, outputRes: 'sblocks', outputAmt: 3, ticks: 720 } },
  { name: 'Hut',        drawFns: ['hut1','hut2','hut3'], cost: { wood : 20, stone: 5, food: 10 },                    w: 28, h: 28, color: '#6b3e1a', label: 'hut',   buildTime: 500, housing: 2 },
  
  // ── Tier 2+ ──────────────────────────────────────────────────
  { name: 'Farm',          drawFn: 'farm',       cost: { wood: 15, planks: 5, stone: 8, sblocks: 2 },            w: 48, h: 14, color: '#558833', label: 'farm',  buildTime: 350 },
  { name: 'Wood House',        drawFns: ['whouse1','whouse2','whouse3'], cost: { planks : 20, stone: 10, food: 20 },                    w: 28, h: 28, color: '#6b3e1a', label: 'house', buildTime: 500, housing: 4 },  
  { name: 'Sawmill',       drawFn: 'sawmill',    cost: { planks: 20, stone: 24, sblocks: 6, iron: 5 },           w: 32, h: 26, color: '#7a5230', label: 'saw',   buildTime: 450,
    attend: { inputRes: 'wood',  inputAmt: 4, outputRes: 'planks',  outputAmt: 3, ticks: 180 } },  
  { name: 'Forge',         drawFn: 'forge',      cost: { stone: 40, sblocks: 5, iron: 20 },                     w: 28, h: 32, color: '#774422', label: 'forge', buildTime: 480, 
    attend: { inputRes: 'iron',  inputAmt: 4, outputRes: 'iingots',  outputAmt: 2, ticks: 280 } },  
  { name: 'Well',          drawFn: 'well',       cost: { stone: 20, sblocks: 8 },                                w: 16, h: 24, color: '#888888', label: 'well',  buildTime: 300, gatherSite: true },
  { name: 'Blacksmith',   drawFn: 'blacksmith', cost: { stone: 20, sblocks: 6, planks: 10, iingots: 8 },       w: 34, h: 30, color: '#4a4a5a', label: 'smith', buildTime: 500,
    attend: { inputRes: 'iingots', inputAmt: 4, outputChoice: ['itools', 'iweapons'], outputAmt: 2, ticks: 350 } },
  { name: 'Barracks',      drawFn: 'barracks',   cost: { planks: 30, stone: 24, sblocks: 6, iron: 30, gold: 5 }, w: 44, h: 30, color: '#445566', label: 'guard', buildTime: 600 },
  { name: 'Market',        drawFn: 'market',     cost: { planks: 20, stone: 16, sblocks: 4, iron: 20, gold: 20 }, w: 40, h: 26, color: '#997722', label: 'trade', buildTime: 520, gatherSite: true },
  { name: 'Temple',        drawFn: 'temple',     cost: { planks: 50, stone: 40, sblocks: 10, iron: 30, gold: 30, gems: 10 }, w: 48, h: 58, color: '#bb9922', label: 'temple', buildTime: 900 },
];

// ── RESOURCES ─────────────────────────────────────────────────
// Display label and HUD colour per resource type.
const RESOURCE_DEFS = {
    // ── Tier 1 ───────────────────────────────────────────────────
  wood:    { label: 'Wood',         color: '#cc9944', cap:40 },
  food:    { label: 'Food',         color: '#66bb44', cap:50 },
  stone:   { label: 'Stone',        color: '#aaaaaa', cap:30 },
  iron:    { label: 'Iron',         color: '#8899bb', cap:20 },
    // ── Tier 2+ ───────────────────────────────────────────────────
  planks:  { label: 'Planks',       color: '#d4a060', cap: 30 },
  sblocks: { label: 'Stone Blocks', color: '#cccccc', cap: 20 },
  iingots: { label: 'Iron Ingots',  color: '#6677aa', cap: 30 },
  itools:  { label: 'Iron Tools',   color: '#4488aa', cap: 5  },
  iweapons:{ label: 'Iron Weapons', color: '#cc5533', cap: 5  },
  gold:    { label: 'Gold',         color: '#ffcc44' },
  gems:    { label: 'Gems',         color: '#cc66ff' },
  
};

// ── ELEMENT → RESOURCE MAPPING ────────────────────────────────
// Lowercase tag name → resource type.
// MINE_TAGS is derived from these keys — add a tag here to make it mineable.
const ELEMENT_RESOURCES = {
  // Wood — abundant structural/text elements
  div: 'wood', span: 'wood', p: 'wood',
  // Stone — headings and table cells
  li: 'stone', h2: 'stone', h3: 'stone', h4: 'stone', td: 'stone', th: 'stone', button: 'stone',
  // Iron — interactive / important elements
  a: 'iron', button: 'iron', h1: 'iron', blockquote: 'iron',
  // Gold — semantic landmark elements (usually 1–5 per page)
  section: 'gold', article: 'gold', nav: 'gold', aside: 'gold', form: 'gold',
  // Gems — media and special elements (rare, often absent)
  table: 'gems', figure: 'gems', video: 'gems', audio: 'gems',
  svg: 'gems', canvas: 'gems', iframe: 'gems', code: 'gems', pre: 'gems',
  // Food — images (luxury; mined rarely once Farm is built)
  img: 'food',
};

// ── HOUSING ───────────────────────────────────────────────────
const CFG_CAVE_HOUSING       = 5;   // initial cave capacity
const CFG_HUT_HOUSING        = 2;   // capacity added per hut built

// ── POPULATION ────────────────────────────────────────────────
const CFG_AUTOSPAWN_COST     = 25;   // deducted in wood
const CFG_AUTOSPAWN_INTERVAL = 500;  // ticks between auto-spawn checks
const CFG_MANUAL_SPAWN_COST  = 10;   // deducted in wood

// ── DOM SCANNING ──────────────────────────────────────────────
const CFG_SCAN_INTERVAL          = 200;
const CFG_SCAN_BATCH             = 2;    // max new targets per scan
const CFG_FOOD_CHANCE_NO_FARM    = 1.0;  // img mine probability before Farm
const CFG_FOOD_CHANCE_WITH_FARM  = 0.12; // img mine probability after Farm built

// ── RESOURCE NODE STATS ───────────────────────────────────────
// hp    = HP_BASE    + ceil(area / HP_AREA_DIV)
// value = VALUE_BASE + log(1 + area / VALUE_AREA_DIV)
const CFG_NODE_HP_BASE        = 2;
const CFG_NODE_HP_AREA_DIV    = 6000;
const CFG_NODE_VALUE_BASE     = 1;
const CFG_NODE_VALUE_AREA_DIV = 800;

// ── CREATURE STATS ────────────────────────────────────────────
// speed    = SPEED_MIN + random() * SPEED_RANGE
// carryMax = CARRY_MIN + floor(random() * CARRY_RANGE)
// mineTime = MINE_MIN  + random() * MINE_RANGE  (ticks)
const CFG_SPEED_MIN   = 1.1;
const CFG_SPEED_RANGE = 0.8;
const CFG_CARRY_MIN   = 4;
const CFG_CARRY_RANGE = 4;
const CFG_MINE_MIN    = 40;
const CFG_MINE_RANGE  = 20;

// ── PILE LIFETIME ─────────────────────────────────────────────
const CFG_PILE_LIFE = 300;  // ticks before a dropped resource pile disappears

// ── FOOD & HUNGER ─────────────────────────────────────────────
// Each creature carries a personal hunger timer that counts down every tick.
// When it expires the creature eats 1 food on its next idle pause.
// At 60 fps: 3300 ticks ≈ 55 s between eating events — same total rate as
// the old continuous drain, but now visible and tied to rest.
const CFG_HUNGER_IDLE_TICKS = 3300; // ticks between eating events per creature
const CFG_FARM_GROW_TICKS   = 1800; // ticks from sown → ready (~30 s)
const CFG_FARM_ATTEND_TIME  = 180;  // ticks a creature spends sowing or harvesting
const CFG_FARM_YIELD        = 8;    // food produced per harvest (fits in one carry)
