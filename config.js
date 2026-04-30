// ── BUILDING PROGRESSION ──────────────────────────────────────
// Buildings are constructed in order. cost is an object of { resourceKey: amount }.
// attend: { inputRes, inputAmt, outputRes, outputAmt, ticks } — marks a building as an attended processor.
const BUILDS = [
  { name: 'Campfire',      drawFn: 'campfire', cost: { wood: 15 },                                       w: 14, h: 8,  color: '#cc4400', label: 'fire',  buildTime: 200 },
  { name: 'Basic Sawmill', drawFn: 'bsawmill', cost: { wood: 30, stone: 10 },           w: 32, h: 26, color: '#8b6535', label: 'b.saw', buildTime: 300,
    attend: { inputRes: 'wood', inputAmt: 4, outputRes: 'planks', outputAmt: 3, ticks: 720 } },
  { name: 'Farm',          drawFn: 'farm',     cost: { wood: 15, planks: 5, stone: 10 }, w: 48, h: 14, color: '#558833', label: 'farm',  buildTime: 350 },
  { name: 'Sawmill',       drawFn: 'sawmill',  cost: { planks: 20, stone: 30, iron: 5 }, w: 32, h: 26, color: '#7a5230', label: 'saw',   buildTime: 450,
    attend: { inputRes: 'wood', inputAmt: 4, outputRes: 'planks', outputAmt: 3, ticks: 180 } },
  { name: 'Hut II',        drawFn: 'hut2',     cost: { planks: 40, stone: 20 },                          w: 28, h: 28, color: '#6b3e1a', label: 'hut',   buildTime: 500 },
  { name: 'Forge',         drawFn: 'forge',    cost: { stone: 50, iron: 20 },                            w: 28, h: 32, color: '#774422', label: 'forge', buildTime: 480 },
  { name: 'Barracks',      drawFn: 'barracks', cost: { planks: 30, stone: 30, iron: 30, gold: 5 },       w: 44, h: 30, color: '#445566', label: 'guard', buildTime: 600 },
  { name: 'Market',        drawFn: 'market',   cost: { planks: 20, stone: 20, iron: 20, gold: 20 },      w: 40, h: 26, color: '#997722', label: 'trade', buildTime: 520 },
  { name: 'Temple',        drawFn: 'temple',   cost: { planks: 50, stone: 50, iron: 30, gold: 30, gems: 10 }, w: 48, h: 58, color: '#bb9922', label: 'temple', buildTime: 900 },
];

// ── RESOURCES ─────────────────────────────────────────────────
// Display label and HUD colour per resource type.
const RESOURCE_DEFS = {
  wood:   { label: 'Wood',   color: '#cc9944' },
  planks: { label: 'Planks', color: '#d4a060' },
  stone:  { label: 'Stone',  color: '#aaaaaa' },
  iron:   { label: 'Iron',   color: '#8899bb' },
  gold:   { label: 'Gold',   color: '#ffcc44' },
  gems:   { label: 'Gems',   color: '#cc66ff' },
  food:   { label: 'Food',   color: '#66bb44' },
};

// ── ELEMENT → RESOURCE MAPPING ────────────────────────────────
// Lowercase tag name → resource type.
// MINE_TAGS is derived from these keys — add a tag here to make it mineable.
const ELEMENT_RESOURCES = {
  // Wood — abundant structural/text elements
  div: 'wood', span: 'wood', p: 'wood',
  // Stone — headings and table cells
  li: 'stone', h2: 'stone', h3: 'stone', h4: 'stone', td: 'stone', th: 'stone',
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

// ── POPULATION ────────────────────────────────────────────────
const CFG_POP_MAX            = 14;
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
// Consumed per tick = population / CFG_FOOD_RATE
// Derivation: avg load = CFG_CARRY_MIN + (CFG_CARRY_RANGE-1)/2 = 5.5 food
//   10 creatures × 30 s × 60 fps = 18 000 creature-ticks
//   5.5 food ÷ 18 000 = 1 food per 3 273 ct → rounded to 3 300
const CFG_FOOD_RATE        = 3300; // ticks per food per creature (consumption)
const CFG_FARM_GROW_TICKS  = 1800; // ticks from sown → ready (~30 s)
const CFG_FARM_ATTEND_TIME = 180;  // ticks a creature spends sowing or harvesting
const CFG_FARM_YIELD       = 8;    // food produced per harvest (fits in one carry)
