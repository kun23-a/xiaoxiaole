'use strict';

/* ============================================================
 * 消消乐 · 仿《开心消消乐》（HTML5 网页版，零依赖）
 * v3：特效棋子（条纹/爆炸/彩虹+组合技）
 *     障碍物（冰块/果冻）· 多样化目标（分数/收集/清冰/清果冻）
 *     目标完成即过关 · 糖果风 UI
 * ============================================================ */

/* ---------- 常量 ---------- */
const COLS = 8, ROWS = 8, TYPES = 6;          // TYPES = 棋子种类上限
const S = 60;                                  // 格子边长（逻辑像素）
const W = COLS * S, H = ROWS * S;
const EMOJI = ['🍎', '🍊', '🍋', '🍇', '🍉', '🍓'];
const BG_COLORS = ['#ff8a80', '#ffcc80', '#fff176', '#ce93d8', '#80cbc4', '#ef9a9a'];
const PARTICLE_COLORS = ['#ff5252', '#ffab40', '#ffee58', '#ab47bc', '#26a69a', '#ef5350'];
const PRAISE = ['太棒了!', '完美!', '神操作!', '不可思议!'];
const MOVE_BONUS = 50;                         // 剩余步数奖励分/步

/* ---------- DOM ---------- */
const $ = id => document.getElementById(id);
const canvas = $('board');
const ctx = canvas.getContext('2d');
const scoreEl = $('score');
const comboEl = $('combo');
const hintBtn = $('hintBtn');
const shuffleBtn = $('shuffleBtn');
const restartBtn = $('restartBtn');
const soundBtn = $('soundBtn');
const backBtn = $('backBtn');
const levelNumEl = $('levelNum');
const levelNameEl = $('levelName');
const movesEl = $('moves');
const movesLabel = $('movesLabel');
const targetEl = $('target');
const movesBox = $('movesBox');
const targetBox = $('targetBox');
const targetLabel = $('targetLabel');
const targetFill = $('targetFill');
const targetBar = $('targetBar');
const goalsEl = $('goals');
const menuPanel = $('menuPanel');
const gamePanel = $('gamePanel');
const levelGrid = $('levelGrid');
const modeLevelBtn = $('modeLevel');
const modeFreeBtn = $('modeFree');
const freePlayBtn = $('freePlayBtn');
const overlay = $('overlay');
const modalIcon = $('modalIcon');
const modalTitle = $('modalTitle');
const modalStars = $('modalStars');
const modalText = $('modalText');
const modalPrimary = $('modalPrimary');
const modalSecondary = $('modalSecondary');
const modalBack = $('modalBack');

const dpr = Math.max(1, window.devicePixelRatio || 1);
canvas.width = W * dpr;
canvas.height = H * dpr;
ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

/* ---------- 状态 ---------- */
let grid = [];
let particles = [];
let floats = [];
let score = 0;
let combo = 0;
let shake = 0;
let busy = false;
let selected = null;
let hint = null;
let muted = localStorage.getItem('match3-muted') === '1';
let audio = null;
let master = null;
let animating = false;
let activeTypes = TYPES;
let rng = Math.random;                         // 可种子化的随机源
let lastSwap = null;                           // 特效生成位置偏好

// 模式状态机
let mode = 'free';         // 'level' | 'free'
let state = 'menu';        // 'menu' | 'playing' | 'win' | 'lose'
let level = 1;
let levelCfg = null;
let target = 0;
let movesLeft = Infinity;
let progress = { unlocked: 1, stars: {} };

// 目标状态
let collectKind = -1;
let collectRemaining = 0;
let jellyCells = new Set();
let jellyRemaining = 0;
let iceRemaining = 0;

// v4：限时 / 传送门 / 毛球
let timed = false;
let timeLeft = 0;
let furballTimer = 0;
let portals = null;            // [{r,c},{r,c}] 或 null
let furballs = new Map();      // cellKey -> {hp}
let furballObjective = false;
let furballMax = 5;
let furballSpreadEvery = 4;
let spreadCounter = 0;
let lastT = 0;

/* ---------- 工具 ---------- */
const wait = ms => new Promise(res => setTimeout(res, ms));
const randType = () => Math.floor(rng() * activeTypes);
const cellKey = (r, c) => r * COLS + c;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function tileAt(k) {
  const r = Math.floor(k / COLS), c = k % COLS;
  return (grid[r] && grid[r][c]) || null;
}

// 可种子 PRNG（关卡布局确定性生成）
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleRange(n, r) {
  const arr = [];
  for (let i = 0; i < n; i++) arr.push(i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
  return arr;
}

function makeTile(type, row, col) {
  return { type, r: row, c: col, x: col * S, y: row * S, tx: col * S, ty: row * S, scale: 1, alpha: 1, pop: 0, special: null, frozen: 0 };
}

function roundRect(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ---------- 存档 ---------- */
function loadProgress() {
  try {
    const raw = localStorage.getItem('match3-progress');
    if (raw) {
      const p = JSON.parse(raw);
      if (p && typeof p.unlocked === 'number' && p.unlocked >= 1) {
        progress = { unlocked: p.unlocked, stars: p.stars || {} };
      }
    }
  } catch (e) { /* 存档损坏则使用默认 */ }
}
function saveProgress() {
  localStorage.setItem('match3-progress', JSON.stringify(progress));
}

/* ---------- 棋盘 ---------- */
function initGrid() {
  grid = [];
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let c = 0; c < COLS; c++) row.push(makeTile(-1, r, c));
    grid.push(row);
  }
  // 类型填充（初始无三消）
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      let t = randType();
      while (wouldMatchAt(r, c, t)) t = randType();
      grid[r][c].type = t;
    }
  }
  // 障碍布局（冰块/果冻/毛球/传送门，按关卡种子确定）
  jellyCells = new Set();
  jellyRemaining = 0;
  iceRemaining = 0;
  furballs = new Map();
  portals = null;
  if (levelCfg) {
    if (levelCfg.jelly > 0) {
      const cells = shuffleRange(COLS * ROWS, rng);
      for (let i = 0; i < Math.min(levelCfg.jelly, COLS * ROWS); i++) jellyCells.add(cells[i]);
      jellyRemaining = jellyCells.size;
    }
    if (levelCfg.ice > 0) {
      const cells = shuffleRange(COLS * ROWS, rng);
      let placed = 0;
      for (let i = 0; i < cells.length && placed < levelCfg.ice; i++) {
        const k = cells[i];
        if (jellyCells.has(k)) continue;
        const r = Math.floor(k / COLS), c = k % COLS;
        grid[r][c].frozen = levelCfg.iceLayers || 1;
        placed++;
      }
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) iceRemaining += grid[r][c].frozen || 0;
    }
    // 毛球：占据格子（无棋子），作为重力墙体
    if (levelCfg.furballs > 0) {
      furballObjective = true;
      furballMax = levelCfg.furballMax || 6;
      furballSpreadEvery = levelCfg.furballSpreadEvery || 4;
      const cells = shuffleRange(COLS * ROWS, rng);
      let placed = 0;
      for (let i = 0; i < cells.length && placed < levelCfg.furballs; i++) {
        const k = cells[i];
        if (jellyCells.has(k)) continue;
        const r = Math.floor(k / COLS), c = k % COLS;
        if (grid[r][c].frozen > 0) continue;
        grid[r][c] = null;
        furballs.set(k, { hp: 1 });
        placed++;
      }
    } else {
      furballObjective = false;
    }
    // 传送门：一对格子，不同列；入口（上/左）→ 出口（下/右）
    if (levelCfg.portals) {
      const cells = shuffleRange(COLS * ROWS, rng);
      const picks = [];
      for (let i = 0; i < cells.length && picks.length < 2; i++) {
        const k = cells[i];
        const r = Math.floor(k / COLS), c = k % COLS;
        if (jellyCells.has(k)) continue;
        if (furballs.has(k)) continue;
        if (grid[r][c].frozen > 0) continue;
        if (picks.length === 1 && c === picks[0].c) continue;
        picks.push({ r, c });
      }
      if (picks.length === 2) {
        picks.sort((a, b) => a.r - b.r || a.c - b.c);
        portals = picks;
      }
    }
  } else {
    furballObjective = false;
  }
  spreadCounter = 0;
  // 保证有可行步
  let guard = 0;
  while (!hasMove() && guard++ < 40) reshuffleTypes();
}

function reshuffleTypes() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const t = grid[r][c];
      if (!t) continue;
      let ty = randType(), g = 0;
      while (wouldMatchAt(r, c, ty) && g++ < 30) ty = randType();
      t.type = ty;
    }
  }
}

// 在 (r,c) 放置 type 是否会形成三消
function wouldMatchAt(r, c, type, g = grid) {
  const row = g[r];
  let left = 0;
  for (let cc = c - 1; cc >= 0 && row && row[cc] && row[cc].special !== 'rainbow' && row[cc].type === type; cc--) left++;
  let right = 0;
  for (let cc = c + 1; cc < COLS && row && row[cc] && row[cc].special !== 'rainbow' && row[cc].type === type; cc++) right++;
  let up = 0;
  for (let rr = r - 1; rr >= 0 && g[rr] && g[rr][c] && g[rr][c].special !== 'rainbow' && g[rr][c].type === type; rr--) up++;
  let down = 0;
  for (let rr = r + 1; rr < ROWS && g[rr] && g[rr][c] && g[rr][c].special !== 'rainbow' && g[rr][c].type === type; rr++) down++;
  return left + right >= 2 || up + down >= 2;
}

function swapTiles(r1, c1, r2, c2) {
  const a = grid[r1][c1], b = grid[r2][c2];
  grid[r1][c1] = b;
  grid[r2][c2] = a;
  if (a) { a.r = r2; a.c = c2; a.tx = c2 * S; a.ty = r2 * S; }
  if (b) { b.r = r1; b.c = c1; b.tx = c1 * S; b.ty = r1 * S; }
}

// 下落 + 顶部补新（毛球格为墙，分段压实；传送门传送）
function applyGravity() {
  for (let c = 0; c < COLS; c++) {
    let segTop = ROWS;   // 段上界（不含）
    for (let r = ROWS - 1; r >= -1; r--) {
      const blocked = r >= 0 && furballs.has(cellKey(r, c));
      if (r === -1 || blocked) {
        compactSegment(c, r + 1, segTop - 1);
        segTop = r;
      }
    }
  }
  applyPortals();
}

function compactSegment(c, top, bottom) {
  if (top > bottom) return;
  let write = bottom;
  for (let r = bottom; r >= top; r--) {
    const t = grid[r][c];
    if (t) {
      if (write !== r) {
        grid[write][c] = t;
        grid[r][c] = null;
        t.r = write;
        t.c = c;
        t.ty = write * S;
      }
      write--;
    }
  }
  for (let r = write; r >= top; r--) {
    const t = makeTile(randType(), r, c);
    t.y = -S * (write - r + 1);
    grid[r][c] = t;
  }
}

// 传送门：入口与出口的棋子互相传送（传送电路，两门始终有棋子可换）
function applyPortals() {
  if (!portals) return;
  const pa = portals[0], pb = portals[1];
  const a = grid[pa.r][pa.c], b = grid[pb.r][pb.c];
  if (a && b) {
    grid[pa.r][pa.c] = b; b.r = pa.r; b.c = pa.c; b.tx = pa.c * S; b.ty = pa.r * S;
    grid[pb.r][pb.c] = a; a.r = pb.r; a.c = pb.c; a.tx = pb.c * S; a.ty = pb.r * S;
  } else if (a) {
    grid[pa.r][pa.c] = null;
    grid[pb.r][pb.c] = a; a.r = pb.r; a.c = pb.c; a.tx = pb.c * S; a.ty = pb.r * S;
  }
}

function findMove() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      for (const [dr, dc] of [[0, 1], [1, 0]]) {
        const r2 = r + dr, c2 = c + dc;
        if (r2 >= ROWS || c2 >= COLS) continue;
        const a = grid[r][c], b = grid[r2][c2];
        if (!a || !b) continue;
        // 特效交换永远可行（双特效组合 / 彩虹触发）
        if ((a.special && b.special) || a.special === 'rainbow' || b.special === 'rainbow') {
          return [{ r, c }, { r: r2, c: c2 }];
        }
        grid[r][c] = b; grid[r2][c2] = a;
        const ok = findMatches().size > 0;
        grid[r][c] = a; grid[r2][c2] = b;
        if (ok) return [{ r, c }, { r: r2, c: c2 }];
      }
    }
  }
  return null;
}
function hasMove() {
  return findMove() !== null;
}

/* ---------- 匹配分析（含特效识别） ---------- */
// 返回 { remove:Set, create:[{r,c,kind}], trigger:[tile] }
function analyzeMatches() {
  const hGroups = [], vGroups = [];
  // 行
  for (let r = 0; r < ROWS; r++) {
    let c = 0;
    while (c < COLS) {
      const t = grid[r][c];
      if (!t || t.special === 'rainbow') { c++; continue; }
      let end = c;
      while (end + 1 < COLS) {
        const n = grid[r][end + 1];
        if (!n || n.special === 'rainbow' || n.type !== t.type) break;
        end++;
      }
      const len = end - c + 1;
      if (len >= 3) {
        const cells = [];
        for (let i = c; i <= end; i++) cells.push(cellKey(r, i));
        hGroups.push({ dir: 'h', len, cells });
      }
      c = end + 1;
    }
  }
  // 列
  for (let c = 0; c < COLS; c++) {
    let r = 0;
    while (r < ROWS) {
      const t = grid[r][c];
      if (!t || t.special === 'rainbow') { r++; continue; }
      let end = r;
      while (end + 1 < ROWS) {
        const n = grid[end + 1][c];
        if (!n || n.special === 'rainbow' || n.type !== t.type) break;
        end++;
      }
      const len = end - r + 1;
      if (len >= 3) {
        const cells = [];
        for (let i = r; i <= end; i++) cells.push(cellKey(i, c));
        vGroups.push({ dir: 'v', len, cells });
      }
      r = end + 1;
    }
  }
  const matched = new Set();
  for (const g of hGroups) for (const k of g.cells) matched.add(k);
  for (const g of vGroups) for (const k of g.cells) matched.add(k);

  const create = [];
  const used = new Set();
  const addCreate = (g, kind) => {
    let idx = Math.floor(g.cells.length / 2);
    if (lastSwap) {
      for (let i = 0; i < g.cells.length; i++) {
        const k = g.cells[i];
        if (Math.floor(k / COLS) === lastSwap.r && k % COLS === lastSwap.c) { idx = i; break; }
      }
    }
    const k = g.cells[idx];
    if (used.has(k)) return;
    used.add(k);
    create.push({ r: Math.floor(k / COLS), c: k % COLS, kind });
  };
  // 五连 → 彩虹
  for (const g of hGroups) if (g.len >= 5) addCreate(g, 'rainbow');
  for (const g of vGroups) if (g.len >= 5) addCreate(g, 'rainbow');
  // L/T 交叉（行列同时有）→ 爆炸
  for (const hg of hGroups) {
    for (const vg of vGroups) {
      if (hg.len + vg.len - 1 < 5) continue;
      for (const k of hg.cells) {
        if (vg.cells.includes(k) && !used.has(k)) {
          used.add(k);
          create.push({ r: Math.floor(k / COLS), c: k % COLS, kind: 'bomb' });
          break;
        }
      }
    }
  }
  // 四连 → 条纹
  for (const g of hGroups) if (g.len === 4) addCreate(g, 'h');
  for (const g of vGroups) if (g.len === 4) addCreate(g, 'v');

  // 被匹配的存量特效 → 触发
  const trigger = [];
  for (const k of matched) {
    const t = tileAt(k);
    if (t && t.special) trigger.push(t);
  }
  // 移除集合 = 匹配格 - 新建特效格（特效格保留）
  const remove = new Set();
  for (const k of matched) if (!used.has(k)) remove.add(k);
  return { remove, create, trigger };
}

function findMatches() {
  return analyzeMatches().remove;
}

/* ---------- 特效效果 ---------- */
function addColor(out, type) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const t = grid[r][c];
      if (t && t.type === type && t.special !== 'rainbow') out.add(cellKey(r, c));
    }
  }
}
function addSquare(out, r, c, half) {
  for (let rr = Math.max(0, r - half); rr <= Math.min(ROWS - 1, r + half); rr++) {
    for (let cc = Math.max(0, c - half); cc <= Math.min(COLS - 1, c + half); cc++) out.add(cellKey(rr, cc));
  }
}
function applyEffect(t, out) {
  if (!t) return;
  const kind = t.special || 'h';
  if (kind === 'h') {
    for (let c = 0; c < COLS; c++) out.add(cellKey(t.r, c));
  } else if (kind === 'v') {
    for (let r = 0; r < ROWS; r++) out.add(cellKey(r, t.c));
  } else if (kind === 'bomb') {
    addSquare(out, t.r, t.c, 1);
  } else if (kind === 'rainbow') {
    const targetType = (t.rainbowTarget !== undefined) ? t.rainbowTarget : Math.floor(rng() * activeTypes);
    addColor(out, targetType);
  }
}
function applyCombo(a, b, out) {
  const ka = a.special || 'h', kb = b.special || 'v';
  const ra = ka === 'rainbow', rb = kb === 'rainbow';
  if (ra && rb) {
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) out.add(cellKey(r, c));
    return;
  }
  if (ra || rb) {
    const rbTile = ra ? a : b;
    const other = ra ? b : a;
    addColor(out, other.type);
    const ok = other.special || 'h';
    if (ok === 'h') { for (let c = 0; c < COLS; c++) out.add(cellKey(other.r, c)); }
    else if (ok === 'v') { for (let r = 0; r < ROWS; r++) out.add(cellKey(r, other.c)); }
    else if (ok === 'bomb') addSquare(out, other.r, other.c, 2);
    return;
  }
  if (ka === 'bomb' && kb === 'bomb') {
    addSquare(out, a.r, a.c, 2);
    addSquare(out, b.r, b.c, 2);
  } else if (ka === 'bomb' || kb === 'bomb') {
    const bm = ka === 'bomb' ? a : b;
    for (let rr = bm.r - 1; rr <= bm.r + 1; rr++) {
      const rr2 = clamp(rr, 0, ROWS - 1);
      for (let c = 0; c < COLS; c++) out.add(cellKey(rr2, c));
    }
    for (let cc = bm.c - 1; cc <= bm.c + 1; cc++) {
      const cc2 = clamp(cc, 0, COLS - 1);
      for (let r = 0; r < ROWS; r++) out.add(cellKey(r, cc2));
    }
  } else {
    // 条纹+条纹 → 十字（A 行 + B 列，共 15 格）
    for (let c = 0; c < COLS; c++) out.add(cellKey(a.r, c));
    for (let r = 0; r < ROWS; r++) out.add(cellKey(r, b.c));
  }
}

/* ---------- 粒子 / 飘字 ---------- */
function spawnParticles(t) {
  const col = PARTICLE_COLORS[t.type] || '#ffffff';
  const cx = t.x + S / 2, cy = t.y + S / 2;
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 1.5 + Math.random() * 3.5;
    particles.push({
      x: cx, y: cy,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.8,
      life: 1, decay: 0.012 + Math.random() * 0.012,
      size: 2.5 + Math.random() * 4, color: col
    });
  }
}

function addFloat(x, y, text) {
  floats.push({ x, y, text, life: 1 });
}

/* ---------- 音频 ---------- */
function ensureAudio() {
  if (!audio) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audio = new AC();
    master = audio.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(audio.destination);
  }
  if (audio.state === 'suspended') audio.resume();
}

function tone(freq, dur, type, vol, delay) {
  if (!audio || muted) return;
  const t = audio.currentTime + (delay || 0);
  const o = audio.createOscillator();
  const g = audio.createGain();
  o.type = type || 'sine';
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol || 0.15, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.03);
}
const playSwap = () => tone(320, 0.07, 'triangle', 0.07);
const playNoMatch = () => tone(150, 0.16, 'sawtooth', 0.05);
function playPop(mult) {
  const base = 400 + (mult - 1) * 90;
  tone(base, 0.12, 'sine', 0.16);
  tone(base * 1.5, 0.1, 'triangle', 0.09, 0.035);
}
function playShuffle() {
  for (let i = 0; i < 6; i++) tone(300 + i * 70, 0.06, 'triangle', 0.06, i * 0.045);
}
function playWin() {
  const seq = [523, 659, 784, 1047];
  seq.forEach((f, i) => tone(f, 0.18, 'triangle', 0.16, i * 0.12));
}
function playLose() {
  [392, 330, 262].forEach((f, i) => tone(f, 0.22, 'sine', 0.12, i * 0.16));
}

/* ---------- 核心结算 ---------- */
function settle() {
  return new Promise(res => {
    const loop = () => (animating ? requestAnimationFrame(loop) : res());
    loop();
  });
}

async function resolve(opts) {
  opts = opts || {};
  let mult = 1;
  let first = true;
  while (true) {
    const A = analyzeMatches();
    const popCells = new Set();
    if (first) {
      if (opts.combo) {
        applyCombo(opts.combo[0], opts.combo[1], popCells);
      } else if (opts.rainbowTarget !== undefined) {
        addColor(popCells, opts.rainbowTarget);
      } else if (opts.tap) {
        for (const t of opts.tap) if (t) applyEffect(t, popCells);
      }
    }
    first = false;
    for (const t of A.trigger) applyEffect(t, popCells);
    for (const k of A.remove) popCells.add(k);

    if (!A.create.length && !A.trigger.length && popCells.size === 0) break;

    // 弹跳动画 + 粒子（冻结格只震不弹）
    let pts = 0, cx = 0, cy = 0, n = 0;
    for (const k of popCells) {
      const t = tileAt(k);
      if (!t) continue;
      if (t.frozen > 0) { t.scale = 1.4; continue; }
      pts += 10;
      cx += t.x + S / 2; cy += t.y + S / 2; n++;
      t.pop = 1;
      spawnParticles(t);
    }
    const gained = pts * mult;
    score += gained;
    if (n > 0) addFloat(cx / n, cy / n, '+' + gained);
    if (mult >= 3) addFloat(W / 2, H / 2 - 70, PRAISE[Math.min(PRAISE.length - 1, mult - 3)]);
    if (cellsLen(popCells) >= 4) shake = Math.min(12, 3 + cellsLen(popCells) * 1.2);
    playPop(mult);
    await wait(200);

    // 毛球：自身被特效清除 → 直接消灭；相邻消除 → 掉血
    for (const k of [...furballs.keys()]) {
      const fb = furballs.get(k);
      if (!fb || fb.hp <= 0) continue;
      if (popCells.has(k)) {
        destroyFurball(k);
        continue;
      }
      const kr = Math.floor(k / COLS), kc = k % COLS;
      let adjacent = false;
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const ar = kr + dr, ac = kc + dc;
        if (ar >= 0 && ar < ROWS && ac >= 0 && ac < COLS && popCells.has(cellKey(ar, ac))) {
          adjacent = true;
          break;
        }
      }
      if (adjacent) {
        fb.hp--;
        if (fb.hp <= 0) {
          destroyFurball(k);
        } else {
          addFloat(kc * S + S / 2, kr * S + S / 2, '🦔 -1');
        }
      }
    }
    // 目标统计 + 移除（冻结格破冰保留）
    for (const k of popCells) {
      const t = tileAt(k);
      if (!t) continue;
      if (t.frozen > 0) {
        t.frozen--;
        iceRemaining = Math.max(0, iceRemaining - 1);
        t.scale = 1.4;
        continue;
      }
      if (jellyCells.has(k)) {
        jellyCells.delete(k);
        jellyRemaining = Math.max(0, jellyRemaining - 1);
      }
      if (collectKind >= 0 && t.type === collectKind && t.special !== 'rainbow') {
        collectRemaining = Math.max(0, collectRemaining - 1);
      }
      grid[t.r][t.c] = null;
    }
    // 新建特效（格子若被效果清除则跳过）
    for (const s of A.create) {
      const t = tileAt(cellKey(s.r, s.c));
      if (t) {
        t.special = s.kind;
        t.scale = 1.5;
        t.pop = 0;
      }
    }
    applyGravity();
    await settle();
    mult++;
  }
  combo = 0;
}

function cellsLen(set) {
  return set.size;
}

async function autoShuffle() {
  playShuffle();
  addFloat(W / 2, H / 2 - 40, '🔄 自动洗牌');
  await wait(150);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const t = grid[r][c];
      if (!t) continue;
      t.type = randType();
      t.scale = 0;
      t.alpha = 0;
    }
  }
  await wait(80);
  await resolve({});
}

/* ---------- v4：限时 / 毛球 ---------- */
function updateTimer(dt) {
  if (mode !== 'level' || !timed || state !== 'playing') return;
  timeLeft -= dt;
  if (furballObjective) {
    furballTimer += dt;
    if (furballTimer >= furballSpreadEvery * 4) {
      furballTimer = 0;
      spreadFurballs();
    }
  }
  if (timeLeft <= 0) {
    timeLeft = 0;
  }
  // 限时关：目标完成即过关；时间耗尽判负
  if (objectivesMet()) {
    winLevel();
  } else if (timeLeft <= 0) {
    loseLevel();
  }
}

function spreadFurballs() {
  if (!furballObjective || furballs.size === 0) return;
  const keys = [...furballs.keys()];
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = keys[i]; keys[i] = keys[j]; keys[j] = tmp;
  }
  for (const k of keys) {
    if (furballs.size >= furballMax) break;
    const kr = Math.floor(k / COLS), kc = k % COLS;
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (let i = dirs.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = dirs[i]; dirs[i] = dirs[j]; dirs[j] = tmp;
    }
    for (const [dr, dc] of dirs) {
      const ar = kr + dr, ac = kc + dc;
      if (ar < 0 || ar >= ROWS || ac < 0 || ac >= COLS) continue;
      const kk = cellKey(ar, ac);
      if (furballs.has(kk) || jellyCells.has(kk)) continue;
      if (portals && (kk === cellKey(portals[0].r, portals[0].c) || kk === cellKey(portals[1].r, portals[1].c))) continue;
      if (!grid[ar][ac]) continue;
      grid[ar][ac] = null;
      furballs.set(kk, { hp: 1 });
      addFloat(ac * S + S / 2, ar * S + S / 2, '🦔');
      playShuffle();
      break;
    }
  }
}

function destroyFurball(k) {
  const r = Math.floor(k / COLS), c = k % COLS;
  furballs.delete(k);
  addFloat(c * S + S / 2, r * S + S / 2, '🦔 消灭!');
  for (let i = 0; i < 10; i++) {
    particles.push({
      x: c * S + S / 2, y: r * S + S / 2,
      vx: (Math.random() - 0.5) * 6, vy: (Math.random() - 0.5) * 6 - 1,
      life: 1, decay: 0.02, size: 4, color: '#b0b0c0'
    });
  }
  playPop(1);
}

/* ---------- 目标 ---------- */
function objectivesMet() {
  if (mode !== 'level') return false;
  if (furballObjective && furballs.size > 0) return false;
  return score >= target && collectRemaining <= 0 && jellyRemaining <= 0 && iceRemaining <= 0;
}

/* ---------- 模式流程 ---------- */
function startLevel(n) {
  levelCfg = getLevel(n);
  level = n;
  mode = 'level';
  activeTypes = levelCfg.types;
  timed = !!levelCfg.timed;
  timeLeft = levelCfg.timed ? levelCfg.timeLimit : 0;
  furballTimer = 0;
  movesLeft = levelCfg.moves || Infinity;
  target = levelCfg.scoreTarget;
  score = 0;
  combo = 0;
  collectKind = levelCfg.collect ? levelCfg.collect.kind : -1;
  collectRemaining = levelCfg.collect ? levelCfg.collect.count : 0;
  rng = mulberry32(n * 7919 + 13);
  lastSwap = null;
  particles = [];
  floats = [];
  selected = null;
  hint = null;
  busy = false;
  state = 'playing';
  initGrid();
  showGame();
  updateHUD();
}

function startFree() {
  levelCfg = null;
  mode = 'free';
  level = 0;
  target = 0;
  movesLeft = Infinity;
  activeTypes = TYPES;
  score = 0;
  combo = 0;
  collectKind = -1;
  collectRemaining = 0;
  timed = false;
  timeLeft = 0;
  furballTimer = 0;
  spreadCounter = 0;
  rng = Math.random;
  lastSwap = null;
  particles = [];
  floats = [];
  selected = null;
  hint = null;
  busy = false;
  state = 'playing';
  initGrid();
  showGame();
  updateHUD();
}

async function afterResolve() {
  if (mode === 'level' && state === 'playing') {
    // 毛球蔓延：非限时按步数，限时按时间（updateTimer 内）
    if (!timed && furballObjective) {
      spreadCounter++;
      if (spreadCounter >= furballSpreadEvery) {
        spreadCounter = 0;
        spreadFurballs();
      }
    }
    if (objectivesMet()) { winLevel(); return; }
    if (!timed && movesLeft <= 0) { loseLevel(); return; }
  }
  if (!hasMove()) await autoShuffle();
}

async function trySwap(r1, c1, r2, c2) {
  busy = true;
  selected = null;
  hint = null;
  const t1 = grid[r1][c1], t2 = grid[r2][c2];
  if (!t1 || !t2) { busy = false; return; }
  const s1 = t1.special, s2 = t2.special;
  lastSwap = { r: r2, c: c2 };
  playSwap();

  // 特效交换（双特效组合 / 彩虹触发）
  if ((s1 && s2) || s1 === 'rainbow' || s2 === 'rainbow') {
    swapTiles(r1, c1, r2, c2);
    await settle();
    if (mode === 'level') movesLeft--;
    if (s1 && s2) {
      await resolve({ combo: [grid[r1][c1], grid[r2][c2]] });
    } else {
      const other = s1 === 'rainbow' ? t2 : t1;
      await resolve({ rainbowTarget: other.type });
    }
    updateHUD();
    await afterResolve();
    busy = false;
    return;
  }

  // 普通交换
  swapTiles(r1, c1, r2, c2);
  await settle();
  const A = analyzeMatches();
  if (!A.remove.size && !A.trigger.length && !A.create.length) {
    await wait(120);
    swapTiles(r1, c1, r2, c2);
    await settle();
    playNoMatch();
    busy = false;
    return;
  }
  if (mode === 'level') movesLeft--;
  await resolve({});
  updateHUD();
  await afterResolve();
  busy = false;
}

async function tapActivate(r, c) {
  const t = grid[r][c];
  if (!t || !t.special || t.special === 'rainbow' || t.frozen > 0) return;
  busy = true;
  selected = null;
  hint = null;
  playPop(1);
  await resolve({ tap: [t] });
  updateHUD();
  await afterResolve();
  busy = false;
}

function winLevel() {
  state = 'win';
  const cfg = getLevel(level);
  const bonus = Math.max(0, timed ? Math.ceil(timeLeft) * 20 : movesLeft * MOVE_BONUS);
  score += bonus;
  const st = starsFor(cfg, score);
  if (st > (progress.stars[level] || 0)) progress.stars[level] = st;
  if (level >= progress.unlocked) progress.unlocked = level + 1;
  saveProgress();
  playWin();
  showOverlay('win', st, cfg, bonus);
}

function loseLevel() {
  state = 'lose';
  playLose();
  showOverlay('lose', 0, getLevel(level), 0);
}

function showOverlay(type, st, cfg, bonus) {
  modalStars.innerHTML = '';
  if (type === 'win') {
    modalIcon.textContent = '🎉';
    modalTitle.textContent = '过关！';
    const objText = goalSummary();
    modalText.textContent = objText + (bonus > 0 ? ' · 剩余步数奖励 +' + bonus : '') + ' · 得分 ' + score;
    for (let i = 0; i < 3; i++) {
      const s = document.createElement('span');
      s.className = 'star' + (i < st ? ' on' : '');
      s.textContent = '★';
      s.style.animationDelay = (0.25 + i * 0.2) + 's';
      modalStars.appendChild(s);
    }
    modalPrimary.textContent = '下一关 ▶';
    modalPrimary.onclick = () => startLevel(level + 1);
    modalSecondary.textContent = '重玩';
    modalSecondary.onclick = () => startLevel(level);
    modalBack.textContent = '选关';
    modalBack.onclick = showMenu;
    modalBack.hidden = false;
    confetti();
  } else {
    modalIcon.textContent = '😢';
    modalTitle.textContent = '差一点点';
    modalText.textContent = '第 ' + level + ' 关 · ' + goalSummary();
    for (let i = 0; i < 3; i++) {
      const s = document.createElement('span');
      s.className = 'star';
      s.textContent = '★';
      modalStars.appendChild(s);
    }
    modalPrimary.textContent = '再试一次';
    modalPrimary.onclick = () => startLevel(level);
    modalSecondary.textContent = '回选关';
    modalSecondary.onclick = showMenu;
    modalBack.hidden = true;
  }
  overlay.classList.remove('hidden');
}

function goalSummary() {
  const parts = [];
  parts.push('得分 ' + score + '/' + target);
  if (collectKind >= 0) parts.push('收集 ' + collectRemaining);
  if (jellyRemaining > 0) parts.push('果冻 ' + jellyRemaining);
  if (iceRemaining > 0) parts.push('冰块 ' + iceRemaining);
  return parts.join(' · ');
}

function confetti() {
  const emojis = ['🎉', '✨', '⭐', '🎊', '💫'];
  for (let i = 0; i < 36; i++) {
    const c = document.createElement('span');
    c.className = 'confetti';
    c.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    c.style.left = Math.random() * 100 + 'vw';
    c.style.animationDelay = Math.random() * 0.6 + 's';
    c.style.fontSize = (14 + Math.random() * 18) + 'px';
    overlay.appendChild(c);
    setTimeout(() => c.remove(), 3200);
  }
}

function showGame() {
  menuPanel.classList.add('hidden');
  gamePanel.classList.remove('hidden');
  overlay.classList.add('hidden');
  if (mode === 'level') {
    movesBox.classList.remove('hidden');
    targetBar.classList.remove('hidden');
    goalsEl.classList.remove('hidden');
    levelNumEl.textContent = level;
    levelNameEl.textContent = '第 ' + level + ' 关 · ' + getLevel(level).name + (timed ? ' · ⏱ 限时' : '');
    targetLabel.textContent = '目标';
  } else {
    movesBox.classList.add('hidden');
    targetBar.classList.add('hidden');
    goalsEl.classList.add('hidden');
    levelNumEl.textContent = '休闲';
    levelNameEl.textContent = '休闲模式 · 无尽解压';
    targetLabel.textContent = '最高分';
  }
}

function showMenu() {
  state = 'menu';
  gamePanel.classList.add('hidden');
  overlay.classList.add('hidden');
  menuPanel.classList.remove('hidden');
  buildLevelGrid();
}

/* ---------- HUD ---------- */
function updateHUD() {
  scoreEl.textContent = score;
  if (mode === 'level') {
    movesEl.textContent = timed ? Math.ceil(timeLeft) : movesLeft;
    movesLabel.textContent = timed ? '时间' : '步数';
    targetEl.textContent = target;
    const pct = clamp(Math.round(score / target * 100), 0, 100);
    targetFill.style.width = pct + '%';
    targetFill.classList.toggle('done', score >= target);
    // 目标面板
    const chips = [];
    chips.push({ icon: '🎯', label: String(target), done: score >= target });
    if (collectKind >= 0) chips.push({ icon: EMOJI[collectKind] || '🍬', label: String(collectRemaining), done: collectRemaining <= 0 });
    if (jellyRemaining > 0 || levelCfg.jelly > 0) chips.push({ icon: '🍮', label: String(jellyRemaining), done: jellyRemaining <= 0 });
    if (iceRemaining > 0 || levelCfg.ice > 0) chips.push({ icon: '🧊', label: String(iceRemaining), done: iceRemaining <= 0 });
    if (furballObjective) chips.push({ icon: '🦔', label: String(furballs.size), done: furballs.size === 0 });
    goalsEl.innerHTML = chips.map(c => '<span class="chip' + (c.done ? ' done' : '') + '">' + c.icon + ' <b>' + c.label + '</b></span>').join('');
  } else {
    let best = parseInt(localStorage.getItem('match3-best') || '0', 10);
    if (score > best) {
      best = score;
      localStorage.setItem('match3-best', String(best));
    }
    targetEl.textContent = best;
  }
  if (combo > 1) {
    comboEl.textContent = '连击 x' + combo;
    comboEl.style.opacity = 1;
  } else {
    comboEl.style.opacity = 0;
  }
}

/* ---------- 菜单 ---------- */
function buildLevelGrid() {
  levelGrid.innerHTML = '';
  const showMax = Math.max(progress.unlocked + 2, 1);
  for (let n = 1; n <= showMax; n++) {
    const btn = document.createElement('button');
    btn.className = 'levelCard';
    const st = progress.stars[n] || 0;
    if (n <= progress.unlocked) {
      btn.innerHTML = '<span class="lv">' + n + '</span><span class="stars">' + '★'.repeat(st) + '☆'.repeat(3 - st) + '</span>';
      btn.onclick = () => startLevel(n);
    } else {
      btn.classList.add('locked');
      btn.innerHTML = '🔒';
    }
    levelGrid.appendChild(btn);
  }
}

/* ---------- 输入 ---------- */
function cellFromEvent(e) {
  const rect = canvas.getBoundingClientRect();
  const px = (e.clientX - rect.left) * (W / rect.width);
  const py = (e.clientY - rect.top) * (H / rect.height);
  const c = Math.floor(px / S), r = Math.floor(py / S);
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null;
  return { r, c };
}
const isAdjacent = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;

canvas.addEventListener('pointerdown', e => {
  e.preventDefault();
  ensureAudio();
  if (busy || state !== 'playing') return;
  const p = cellFromEvent(e);
  if (!p) return;
  const t = grid[p.r][p.c];
  // 点击特效直接触发（条纹/爆炸，彩虹需交换）
  if (t && t.special && t.special !== 'rainbow' && !t.frozen) {
    tapActivate(p.r, p.c);
    return;
  }
  if (selected && isAdjacent(selected, p)) {
    trySwap(selected.r, selected.c, p.r, p.c);
  } else {
    selected = p;
    hint = null;
  }
}, { passive: false });

canvas.addEventListener('pointermove', e => {
  if (busy || !selected || state !== 'playing') return;
  if (e.pointerType === 'mouse' && !(e.buttons & 1)) return;
  const p = cellFromEvent(e);
  if (p && isAdjacent(selected, p)) {
    trySwap(selected.r, selected.c, p.r, p.c);
  }
});

/* ---------- 按钮 ---------- */
hintBtn.addEventListener('click', () => {
  if (busy || state !== 'playing') return;
  ensureAudio();
  const mv = findMove();
  if (mv) {
    hint = mv;
    playSwap();
    setTimeout(() => { if (hint === mv) hint = null; }, 2500);
  } else {
    addFloat(W / 2, H / 2, '没有可行步数');
  }
});

shuffleBtn.addEventListener('click', async () => {
  if (busy || state !== 'playing') return;
  busy = true;
  await autoShuffle();
  busy = false;
});

restartBtn.addEventListener('click', () => {
  if (state !== 'playing') return;
  if (mode === 'level') startLevel(level); else startFree();
});

backBtn.addEventListener('click', showMenu);

soundBtn.addEventListener('click', () => {
  muted = !muted;
  soundBtn.textContent = muted ? '🔇' : '🔊';
  localStorage.setItem('match3-muted', muted ? '1' : '0');
  if (master) master.gain.value = muted ? 0 : 1;
});

modeLevelBtn.addEventListener('click', () => {
  modeLevelBtn.classList.add('active');
  modeFreeBtn.classList.remove('active');
  levelGrid.classList.remove('hidden');
  freePlayBtn.classList.add('hidden');
});

modeFreeBtn.addEventListener('click', () => {
  modeFreeBtn.classList.add('active');
  modeLevelBtn.classList.remove('active');
  levelGrid.classList.add('hidden');
  freePlayBtn.classList.remove('hidden');
});

freePlayBtn.addEventListener('click', startFree);

/* ---------- 渲染 ---------- */
function update() {
  animating = false;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const t = grid[r][c];
      if (!t) continue;
      const dx = t.tx - t.x, dy = t.ty - t.y;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        t.x += dx * 0.28;
        t.y += dy * 0.28;
        animating = true;
      } else {
        t.x = t.tx;
        t.y = t.ty;
      }
      if (t.pop > 0) { t.pop -= 0.08; if (t.pop < 0) t.pop = 0; }
      t.scale += (1 - t.scale) * 0.22;
      t.alpha += (1 - t.alpha) * 0.22;
      if (Math.abs(1 - t.scale) > 0.01 || Math.abs(1 - t.alpha) > 0.01) animating = true;
    }
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.vy += 0.18;
    p.vx *= 0.985;
    p.x += p.vx;
    p.y += p.vy;
    p.life -= p.decay;
    if (p.life <= 0) particles.splice(i, 1);
  }
  for (let i = floats.length - 1; i >= 0; i--) {
    const f = floats[i];
    f.y -= 0.8;
    f.life -= 0.02;
    if (f.life <= 0) floats.splice(i, 1);
  }
  if (shake > 0) {
    shake *= 0.88;
    if (shake < 0.3) shake = 0;
  }
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp((n >> 16) + amt, 0, 255);
  const g = clamp(((n >> 8) & 0xff) + amt, 0, 255);
  const b = clamp((n & 0xff) + amt, 0, 255);
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

function drawTile(t) {
  const cx = t.x + S / 2, cy = t.y + S / 2;
  let sc = t.scale, al = t.alpha;
  if (t.pop > 0) {
    sc *= 1 + Math.sin(t.pop * Math.PI) * 0.55;
    al *= t.pop;
  }
  if (al <= 0.02) return;
  ctx.save();
  ctx.globalAlpha = clamp(al, 0, 1);
  ctx.translate(cx, cy);
  ctx.scale(sc, sc);
  ctx.translate(-cx, -cy);
  // 渐变底
  const g = ctx.createLinearGradient(t.x, t.y, t.x, t.y + S);
  g.addColorStop(0, BG_COLORS[t.type]);
  g.addColorStop(1, shade(BG_COLORS[t.type], -18));
  roundRect(t.x + 3, t.y + 3, S - 6, S - 6, 14);
  ctx.fillStyle = g;
  ctx.fill();
  roundRect(t.x + 8, t.y + 8, S - 16, S - 14, 9);
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fill();
  ctx.font = '34px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(EMOJI[t.type], cx, cy + 2);
  // 特效标识
  if (t.special === 'h' || t.special === 'v') {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    if (t.special === 'h') {
      roundRect(t.x + 8, cy - 3.5, S - 16, 7, 4);
    } else {
      roundRect(cx - 3.5, t.y + 8, 7, S - 16, 4);
    }
    ctx.fill();
  } else if (t.special === 'bomb') {
    ctx.fillStyle = '#2c2c3f';
    ctx.beginPath();
    ctx.arc(cx, cy, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '16px sans-serif';
    ctx.fillText('★', cx, cy + 1);
  } else if (t.special === 'rainbow') {
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(cx, cy, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '20px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
    ctx.fillText('🌈', cx, cy + 1);
  }
  // 冰块覆盖
  if (t.frozen > 0) {
    roundRect(t.x + 2, t.y + 2, S - 4, S - 4, 12);
    ctx.fillStyle = 'rgba(150,220,255,' + (t.frozen > 1 ? 0.55 : 0.35) + ')';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 2;
    ctx.stroke();
    roundRect(t.x + 10, t.y + 10, S - 20, S - 26, 6);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fill();
  }
  ctx.restore();
}

function drawHighlights() {
  if (selected) {
    const t = grid[selected.r][selected.c];
    if (t) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 180);
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.7 + pulse * 0.3) + ')';
      ctx.lineWidth = 3;
      roundRect(t.x + 2, t.y + 2, S - 4, S - 4, 12);
      ctx.stroke();
    }
  }
  if (hint) {
    for (const h of hint) {
      const t = grid[h.r][h.c];
      if (!t) continue;
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 150);
      ctx.strokeStyle = 'rgba(255,213,74,' + (0.5 + pulse * 0.5) + ')';
      ctx.lineWidth = 3.5;
      roundRect(t.x + 2, t.y + 2, S - 4, S - 4, 12);
      ctx.stroke();
    }
  }
}

function render() {
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
  roundRect(0, 0, W, H, 18);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fill();
  // 果冻底层
  for (const k of jellyCells) {
    const r = Math.floor(k / COLS), c = k % COLS;
    roundRect(c * S + 2, r * S + 2, S - 4, S - 4, 12);
    ctx.fillStyle = 'rgba(140,230,180,0.35)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  // 传送门底层
  if (portals) {
    for (const p of portals) {
      const px = p.c * S, py = p.r * S;
      const pg = ctx.createLinearGradient(px, py, px + S, py + S);
      pg.addColorStop(0, 'rgba(124,77,255,0.55)');
      pg.addColorStop(1, 'rgba(0,229,255,0.55)');
      roundRect(px + 2, py + 2, S - 4, S - 4, 12);
      ctx.fillStyle = pg;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.font = '20px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillText('🌀', px + S / 2, py + S / 2);
    }
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let i = 1; i < COLS; i++) {
    ctx.beginPath(); ctx.moveTo(i * S, 0); ctx.lineTo(i * S, H); ctx.stroke();
  }
  for (let i = 1; i < ROWS; i++) {
    ctx.beginPath(); ctx.moveTo(0, i * S); ctx.lineTo(W, i * S); ctx.stroke();
  }
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const t = grid[r][c];
      if (t) drawTile(t);
    }
  }
  drawHighlights();
  // 毛球覆盖（占据格子）
  for (const [k, fb] of furballs) {
    const r = Math.floor(k / COLS), c = k % COLS;
    const cx = c * S + S / 2, cy = r * S + S / 2;
    ctx.fillStyle = 'rgba(60,60,80,0.85)';
    ctx.beginPath();
    ctx.arc(cx, cy, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '24px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🦔', cx, cy + 1);
    if (fb.hp > 1) {
      ctx.font = '12px sans-serif';
      ctx.fillStyle = '#ffd54a';
      ctx.fillText('✕' + fb.hp, cx, cy + 22);
    }
  }
  ctx.globalAlpha = 1;
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  for (const f of floats) {
    ctx.globalAlpha = Math.max(0, Math.min(1, f.life));
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 4;
    ctx.strokeText(f.text, f.x, f.y);
    ctx.fillStyle = '#fff';
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function frame(now) {
  const dt = Math.min(0.1, lastT ? (now - lastT) / 1000 : 0);
  lastT = now;
  updateTimer(dt);
  update();
  render();
  updateHUD();
  requestAnimationFrame(frame);
}

/* ---------- 启动 ---------- */
loadProgress();
soundBtn.textContent = muted ? '🔇' : '🔊';
initGrid();
requestAnimationFrame(frame);
showMenu();
