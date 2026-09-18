/**
 * 常量。
 */

export const MODULE_ID = "pf2e-resistance-adjustment";

/** 注册到 game.pf2e.RuleElements.custom 的 key，物品 system.rules 里写这个值 */
export const RE_KEY = "AdjustResistance";

/** 目标数组：8.5.1 中 actor.system.attributes.resistances */
export const TARGET = "resistances";

/** 默认优先级：内置 IWR RE 为 100（pf2e.mjs:39146），本引擎默认排在其后（200） */
export const DEFAULT_PRIORITY = 200;

export const MODES = Object.freeze({
  /** 在现有值上累加（10 + 5 = 15）；没有该条目时从 0 开始，即凭空获得抗性 */
  ADD: "add",
  /** 数值递减，下限 0；归零 = 删除该条目 */
  SUBTRACT: "subtract",
  /** 直接设为该值，下限 0；设为 0 = 删除该条目 */
  SET: "set",
  /** 至少为该值 */
  MAX: "max",
  /** 删除整条 */
  REMOVE: "remove",
});

export const MODE_CHOICES = Object.freeze([MODES.ADD, MODES.SUBTRACT, MODES.SET, MODES.MAX, MODES.REMOVE]);

export const SETTINGS = Object.freeze({
  ENABLED: "enabled",
});

/** 周期性记忆，挂在 actor.synthetics 上 */
export const CYCLE_MEMORY = Symbol.for("pf2e-resistance-adjustment.cycleMemory");
