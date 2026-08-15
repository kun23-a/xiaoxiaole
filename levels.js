'use strict';
/* ============================================================
 * 消消乐 · 关卡配置（12 手工关 + 13 关起程序生成）
 * v4 机制：
 *   scoreTarget 分数（星级与过关）
 *   collect {kind,count} 收集棋子
 *   jelly 果冻格    ice 冰块层（iceLayers 层数）
 *   timed/timeLimit 限时（秒，替代步数）
 *   portals 传送门
 *   furballs 毛球起始数 / furballMax 上限 / furballSpreadEvery 蔓延间隔
 * 布局（冰块/果冻/毛球/传送门位置）由 game.js 按关卡种子确定性生成
 * ============================================================ */
(function () {

  const HAND = [
    { n: 1,  name: '青茅山',   moves: 18, types: 5, scoreTarget: 500,  collect: null,              jelly: 0,  ice: 0 },
    { n: 2,  name: '古月山寨', moves: 20, types: 5, scoreTarget: 700,  collect: { kind: 1, count: 8 },  jelly: 0,  ice: 0 },
    { n: 3,  name: '南疆迷雾', moves: 20, types: 5, scoreTarget: 600,  collect: null,              jelly: 6,  ice: 0 },
    { n: 4,  name: '北原王庭', moves: 22, types: 6, scoreTarget: 900,  collect: { kind: 3, count: 10 }, jelly: 0,  ice: 0 },
    { n: 5,  name: '西漠黄沙', moves: 22, types: 6, scoreTarget: 800,  collect: null,              jelly: 0,  ice: 8,  iceLayers: 1 },
    { n: 6,  name: '东海追剿', timed: true, timeLimit: 60, types: 6, scoreTarget: 1000, collect: null, jelly: 6,  ice: 0 },
    { n: 7,  name: '中州天骄', moves: 24, types: 6, scoreTarget: 1100, collect: { kind: 4, count: 12 }, jelly: 0,  ice: 0 },
    { n: 8,  name: '逆流河',   moves: 26, types: 6, scoreTarget: 1200, collect: null,              jelly: 10, ice: 0, portals: true },
    { n: 9,  name: '琅琊福地', moves: 26, types: 6, scoreTarget: 1300, collect: { kind: 5, count: 14 }, jelly: 0,  ice: 0 },
    { n: 10, name: '疯魔窟',   moves: 28, types: 6, scoreTarget: 1400, collect: null,              jelly: 0,  ice: 14, iceLayers: 2 },
    { n: 11, name: '天庭之战', moves: 28, types: 6, scoreTarget: 1600, collect: null,              jelly: 0,  ice: 4,  furballs: 2, furballMax: 5, furballSpreadEvery: 4 },
    { n: 12, name: '至尊仙窍', timed: true, timeLimit: 75, types: 6, scoreTarget: 1500, collect: null, jelly: 8, ice: 0, portals: true, furballs: 1, furballMax: 4, furballSpreadEvery: 5 }
  ];

  const HAND_COUNT = HAND.length;
  const NAME_POOL = ['盗天梦境', '五域风云', '大时代', '春秋蝉', '人祖传', '命运棋局', '升炼之路', '天外之魔', '元境之争', '永生的答案'];

  // 获取第 n 关配置（n>12 程序生成，机制轮换）
  function getLevel(n) {
    if (n <= HAND_COUNT) return HAND[n - 1];
    const scoreTarget = Math.round(500 * Math.pow(1.16, n - 1) / 10) * 10;
    const base = {
      n,
      name: NAME_POOL[(n - 13) % NAME_POOL.length],
      types: 6,
      scoreTarget,
      collect: null,
      jelly: 0,
      ice: 0,
      iceLayers: n > 20 ? 2 : 1
    };
    const cycle = (n - 13) % 4;
    const moves = Math.min(34, 18 + Math.floor((n - 1) / 3));
    if (cycle === 0) {
      // 限时关
      base.timed = true;
      base.timeLimit = Math.min(120, 45 + Math.floor((n - 13) / 3) * 5);
      base.jelly = Math.min(12, 3 + Math.floor(n / 4));
    } else if (cycle === 1) {
      // 传送门关
      base.moves = moves;
      base.portals = true;
      base.jelly = Math.min(14, 3 + Math.floor(n / 4));
    } else if (cycle === 2) {
      // 毛球关
      base.moves = moves;
      base.furballs = Math.min(3, 1 + Math.floor((n - 13) / 6));
      base.furballMax = 6;
      base.furballSpreadEvery = 4;
      base.ice = Math.min(12, 2 + Math.floor(n / 5));
    } else {
      // 收集+冰
      base.moves = moves;
      const kinds = [1, 3, 4, 5, 2];
      base.collect = { kind: kinds[n % kinds.length], count: Math.min(24, 8 + Math.floor(n / 2)) };
      base.ice = Math.min(10, 2 + Math.floor(n / 6));
    }
    base.generated = true;
    return base;
  }

  // 星级：1★ 达标 / 1.3× 2★ / 1.8× 3★（按最终得分含奖励）
  function starsFor(level, score) {
    if (score < level.scoreTarget) return 0;
    if (score >= level.scoreTarget * 1.8) return 3;
    if (score >= level.scoreTarget * 1.3) return 2;
    return 1;
  }

  globalThis.LEVELS = HAND;
  globalThis.getLevel = getLevel;
  globalThis.starsFor = starsFor;
  globalThis.HAND_LEVELS = HAND_COUNT;

})();
