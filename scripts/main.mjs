/**
 * 模块入口：注册设置与规则元素，暴露供其它规则元素复用的 API。
 *
 * 注册时机说明：
 *   pf2e 在 `Hooks.once("init")` 里构建 game.pf2e（pf2e.mjs:116248 → jm.onInit() → pf2e.mjs:115483）。
 *   Foundry 先初始化系统再初始化模块，因此模块的 init 回调里 game.pf2e 已就绪。
 */

import { MODULE_ID, RE_KEY, TARGET } from "./const.mjs";
import {
  applyBuckets,
  collectBuckets,
  dryRun,
  engineRulesOf,
  evaluateBucket,
  hasDefinition,
  memoryKeyOf,
  toArray,
  usesEngine,
} from "./engine.mjs";
import {
  LaxArrayField,
  LaxPredicateField,
  LaxStringArrayField,
  ResolvableNumberField,
  laxifyField,
  normalizePredicateInput,
  normalizeStringArray,
  wrapSingleValue,
} from "./fields.mjs";
import { registerRuleElements } from "./rule-element.mjs";
import { isEngineEnabled, registerSettings } from "./settings.mjs";
import { canonicalString, checkIWRInstances, diffSnapshots, snapshot } from "./util.mjs";

Hooks.once("init", () => {
  registerSettings();

  if (!registerRuleElements()) {
    // 仍早于世界数据准备，来得及再试一次
    Hooks.once("setup", () => registerRuleElements());
  }

  /** 复用出口：自己写别的规则元素时可以直接取用 */
  game.pf2eResistanceAdjustment = {
    version: game.modules.get(MODULE_ID)?.version ?? "dev",
    RE_KEY,
    engine: {
      applyBuckets,
      dryRun,
      collectBuckets,
      evaluateBucket,
      engineRulesOf,
      usesEngine,
      memoryKeyOf,
      toArray,
      hasDefinition,
    },
    fields: {
      ResolvableNumberField,
      LaxArrayField,
      LaxStringArrayField,
      LaxPredicateField,
      /** 覆盖继承 schema 的字段要用它（直接包装 field.element 会抛 already has a parent） */
      laxify: laxifyField,
      normalizeStringArray,
      normalizePredicateInput,
      wrapSingleValue,
    },
    util: { snapshot, diffSnapshots, checkIWRInstances, canonicalString },
    defaults: { RE_KEY, TARGET },
  };
});
