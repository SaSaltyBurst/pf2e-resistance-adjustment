/**
 * IWR 调整引擎。
 *
 * 语义模型
 * --------
 *  mode:
 *    add       → 在现有值上累加（10 + 5 = 15）；没有该条目时从 0 开始
 *    subtract  → 数值递减，下限 0；归零 = 删除该条目
 *    set       → 直接设为该值，下限 0；设为 0 = 删除该条目
 *    max       → 至少为该值（等价系统内置 Resistance RE 的“取最高”）
 *    remove    → 完全委托系统（按 type 删除整条）
 *
 * 基准：始终以当前数组里的值为基准（含其它来源，例如内置 Resistance RE、
 * 其它模块、其它 AdjustResistance 规则），不再有 source/current 之分。
 *
 * 幂等性（关键）
 * --------------
 * Foundry 核心要求数据准备可重复执行（client-document.mjs:293），且 reset() 只在
 * 文档创建/更新时发生，所以“entry.value += n”这种写法会随重复 prepareData 漂移。
 * 本引擎的做法：
 *   1) actor.synthetics 里记录每个桶“写入前的值 / 写入后的值”；
 *   2) 下一个周期若发现条目值仍等于“我们写入的值”，先把基准回滚回写入前的值再重算；
 *   3) 分桶（见下）保证同一类型的多条规则只算一次。
 * 于是无论 prepareData 被调用多少次、是否伴随 reset，结果都稳定。
 *
 * 分桶（聚合）
 * ----------
 * 所有 AdjustResistance 规则按 (type + exceptions + doubleVs + definition) 分桶，
 * 每桶一次性算出最终值再写回。这解决了“两条规则各写各的会互相覆盖”的问题：
 * 现有值 10，规则 +5 / -3 ⇒ 12（而不是 15 或 7）。
 * 桶内顺序 = actor.rules 顺序 = priority 顺序。
 *
 * 复用（自己写新规则元素时）
 * ------------------------
 * 引擎不绑定具体 RE 类，也不绑定抗性：key 与目标数组都是参数。
 *   engineRulesOf(actor, "AdjustWeakness")
 *   applyBuckets(actor, { key: "AdjustWeakness", target: "weaknesses" })
 * 只需保证目标数组的元素是系统 IWR 实例（有 test()/label），且规则对象提供
 * mode / value / type / exceptions / doubleVs / definition /
 * test() / resolveValue() / resolveInjectedProperties() / failValidation() / getIWR()。
 * 最省事的做法：继承系统内置的 Resistance / Weakness RE（见 README「自己写规则元素」）。
 */

import { CYCLE_MEMORY, MODES, RE_KEY, TARGET } from "./const.mjs";
import {
  canonicalString,
  diffSnapshots,
  sameSpec,
  snapshot,
  specKey,
  specOfEntry,
  specOfRule,
} from "./util.mjs";

/* 记录上次写入的数组实例，用于诊断“本次 prepareData 是否伴随 reset（新数组）” */
const CYCLE_ARRAY_REF = Symbol.for("pf2e-resistance-adjustment.cycleArrayRef");

/* ------------------------------------------------------------------ *
 * 规则收集
 * ------------------------------------------------------------------ */

/**
 * 只有 remove 委托给系统原生实现（按 type 删整条）；add / subtract / set / max 全部走引擎。
 */
export function usesEngine(rule) {
  if (!rule) return false;
  const mode = rule.mode ?? MODES.ADD;
  if (mode === MODES.REMOVE) return false;
  return [MODES.ADD, MODES.SUBTRACT, MODES.SET, MODES.MAX].includes(mode);
}

/* 规则对象的 type 归一化：string / Set / 数组 → 字符串数组（防御手写数据） */
export function toArray(value) {
  if (value === undefined || value === null || value === "") return [];
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return [...value];
  return [value];
}

/* definition 是否真的有内容（空数组 / null / "" 都算没有） */
export function hasDefinition(rule) {
  const definition = rule?.definition;
  if (definition === undefined || definition === null) return false;
  if (typeof definition === "string") return definition.trim() !== "";
  if (Array.isArray(definition)) return definition.length > 0;
  return true;
}

/* 取某个 key 的全部规则实例（含已 ignored 的不返回）。key 默认是本模块的 AdjustResistance。 */
export function engineRulesOf(actor, key = RE_KEY) {
  const rules = Array.isArray(actor?.rules) ? actor.rules : [];
  return rules.filter((rule) => rule?.key === key && !rule.ignored);
}

function dictionaryOf(rule) {
  try {
    return rule.constructor?.dictionary ?? CONFIG.PF2E?.resistanceTypes ?? {};
  } catch {
    return CONFIG.PF2E?.resistanceTypes ?? {};
  }
}

/**
 * 收集分桶。返回 { buckets, notes }，notes 为面向调试的诊断信息。
 *
 * @param {object} actor
 * @param {Array} rules
 * @param {object} [options]
 * @param {string} [options.target="resistances"] 目标数组：actor.system.attributes[target]
 */
export function collectBuckets(actor, rules, { target = TARGET } = {}) {
  const buckets = new Map();
  const notes = [];

  for (const rule of rules) {
    if (rule.ignored || !usesEngine(rule)) continue;

    let amount;
    try {
      amount = Math.floor(Number(rule.resolveValue(rule.value, 0)));
    } catch (error) {
      notes.push({ level: "warn", rule, message: `value 解析异常：${error?.message ?? error}` });
      continue;
    }
    if (!Number.isFinite(amount)) {
      notes.push({ level: "warn", rule, message: "value 不是有效数字" });
      continue;
    }
    if (rule.mode === MODES.SUBTRACT && amount < 0) {
      notes.push({ level: "warn", rule, message: "subtract 模式下 value 为负" });
      continue;
    }

    let passed = true;
    try {
      passed = rule.test();
    } catch (error) {
      passed = false;
      notes.push({ level: "warn", rule, message: `predicate 求值异常：${error?.message ?? error}` });
    }
    if (!passed) {
      notes.push({ level: "verbose", rule, message: "predicate 未通过，跳过" });
      continue;
    }

    const types = toArray(rule.resolveInjectedProperties(toArray(rule.type)));
    if (types.length === 0) {
      notes.push({
        level: "warn",
        rule,
        message: `type 为空，已跳过（请在规则里填写抗性类型，例如 "type": ["acid"]）`,
      });
      continue;
    }
    if (hasDefinition(rule) && !types.includes("custom")) {
      notes.push({
        level: "warn",
        rule,
        message: `definition 只在 type 为 ["custom"] 时有意义，当前 type 是 [${types.join(", ")}]，该字段会被忽略`,
      });
    }

    for (const type of types) {
      const dictionary = dictionaryOf(rule);
      // "custom" 与系统 IWRRuleElement.validateJoint（pf2e.mjs:41524）一致地特殊放行，
      // 且不依赖 CONFIG.PF2E.resistanceTypes 是否恰好包含该键。
      if (type !== "custom" && !(type in dictionary)) {
        notes.push({ level: "warn", rule, message: `未知抗性类型 "${type}"` });
        continue;
      }

      const spec = specOfRule(rule, type);
      const key = specKey(spec);
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { spec, key, target, owner: rule, template: rule, ops: [], items: [] };
        buckets.set(key, bucket);
      }

      bucket.ops.push({ mode: rule.mode ?? MODES.ADD, amount, rule });
      bucket.items.push(rule.item?.name ?? "?");
    }
  }

  return { buckets: [...buckets.values()], notes };
}

/* ------------------------------------------------------------------ *
 * 计算与写入
 * ------------------------------------------------------------------ */

/* 只为诊断/日志：读 actor._source 里该类型的原始值（不参与计算） */
function sourceValueOf(actor, target, spec) {
  const list = actor?._source?.system?.attributes?.[target];
  const match = (Array.isArray(list) ? list : []).find((entry) => sameSpec(specOfEntry(entry), spec)) ?? null;
  return typeof match?.value === "number" ? match.value : null;
}

function cycleMemory(actor) {
  const bag = (actor.synthetics ??= {});
  if (!(bag[CYCLE_MEMORY] instanceof Map)) bag[CYCLE_MEMORY] = new Map();
  return bag[CYCLE_MEMORY];
}

/* 回滚记忆的键要带上目标数组，否则 resistances 与 weaknesses 的同名类型会互相污染 */
export const memoryKeyOf = (bucket) => `${bucket.target ?? TARGET}|${bucket.key}`;

/**
 * 纯计算：给定桶、当前数组与周期记忆，算出该桶的最终值。
 * 基准 = 当前数组里的值（含其它来源的贡献）。
 * 唯一副作用：把“我们上次写入的值”回滚成写入前的值，用于保证重复执行幂等。
 */
export function evaluateBucket(actor, bucket, entries, memory) {
  const current = entries.find((entry) => sameSpec(specOfEntry(entry), bucket.spec)) ?? null;

  let baseFrom = "current";
  const recorded = memory.get(memoryKeyOf(bucket));
  if (recorded && current && Number(current.value) === recorded.written) {
    current.value = recorded.applied; // 回滚掉我们上一次的写入，再重算一遍
    baseFrom = "current(已回滚上次写入)";
  }
  const base = Number(current?.value ?? 0) || 0;

  const steps = [];
  let value = base;
  for (const op of bucket.ops) {
    const from = value;
    switch (op.mode) {
      case MODES.SET:
        value = Math.max(0, op.amount);
        break;
      case MODES.SUBTRACT:
        value = Math.max(0, value - Math.abs(op.amount));
        break;
      case MODES.MAX:
        value = Math.max(0, value, op.amount);
        break;
      default: // add
        value = Math.max(0, value + op.amount);
        break;
    }
    steps.push({ mode: op.mode, amount: op.amount, from, to: value, item: op.rule?.item?.name ?? "?" });
  }

  return {
    spec: bucket.spec,
    key: bucket.key,
    target: bucket.target ?? TARGET,
    items: [...new Set(bucket.items)],
    base,
    baseFrom,
    sourceValue: sourceValueOf(actor, bucket.target, bucket.spec), // 仅诊断信息
    steps,
    value,
    currentValue: current ? Number(current.value) : null,
    exists: current !== null,
  };
}

/* 用系统的内置构造路径创建真正的 Resistance 实例；失败返回 null（调用方会恢复原条目） */
function createEntry(actor, bucket, value, entries) {
  const template = bucket.template;

  // 主路径：复用内置 ResistanceRuleElement.getIWR()（pf2e.mjs:41589）——
  // 这是系统内唯一会 new Resistance({...}) 的地方。
  const previousType = template.type;
  template.type = [bucket.spec.type];
  try {
    const created = template.getIWR(value);
    if (Array.isArray(created) && created.length > 0) return created[0];
  } catch {
    // 落到回退路径
  } finally {
    template.type = previousType;
  }

  // 回退路径：从数组里已有实例取构造器（IWR/Resistance 类未导出给模块）
  const ctor = entries.find((entry) => entry && typeof entry.test === "function")?.constructor;
  if (typeof ctor !== "function") return null;
  try {
    return new ctor({
      type: bucket.spec.type,
      value,
      exceptions: foundry.utils.deepClone(bucket.spec.exceptions ?? []),
      doubleVs: foundry.utils.deepClone(bucket.spec.doubleVs ?? []),
      definition: bucket.spec.definition ?? null,
      source: template.item?.name ?? null,
      customLabel: bucket.spec.type === "custom" ? template.label : null,
    });
  } catch {
    return null;
  }
}

/* 写回一个桶。返回是否成功（失败时会把原条目恢复回去，避免把角色的抗性弄丢）。 */
function writeBucket(actor, entries, plan) {
  // 1) 摘掉所有匹配条目（含需要归零删除的情况），但先留一份备份
  const removed = [];
  for (let i = entries.length - 1; i >= 0; i--) {
    if (sameSpec(specOfEntry(entries[i]), plan.spec)) removed.push(...entries.splice(i, 1));
  }

  // 2) value > 0 才写回。注意系统内置 RE 在 value <= 0 时是“空操作”，
  //    且不会删除旧条目（pf2e.mjs:41590），所以删条必须由我们自己 splice。
  if (plan.value > 0) {
    const created = createEntry(actor, { spec: plan.spec, template: plan.template, key: plan.key }, plan.value, entries);
    if (created) {
      entries.push(created);
      return true;
    }
    if (removed.length > 0) entries.push(...removed); // 构造失败 → 原样恢复
    return false;
  }
  return true; // 归零删除：已经 splice 完毕即为成功
}

/**
 * 引擎入口。
 * @param {Actor} actor
 * @param {object} [options]
 * @param {boolean} [options.write=true]   false = 干跑（只计算不写入），供调试/自检使用
 * @param {Array}   [options.rules]        指定规则集合，默认取 actor.rules 中 key 对应的全部规则
 * @param {string}  [options.key=RE_KEY]   规则元素的 key（自己写新 RE 时传入自己的 key）
 * @param {string}  [options.target=TARGET] 目标数组：actor.system.attributes[target]
 * @returns {{plans:Array, before:Array, after:Array, diff:Array, notes:Array}}
 */
export function applyBuckets(actor, { write = true, rules = null, key = RE_KEY, target = TARGET } = {}) {
  const entries = actor?.system?.attributes?.[target];
  if (!Array.isArray(entries)) {
    return { plans: [], before: [], after: [], diff: [], notes: [], skipped: "no-target-array" };
  }

  const engineRules = (rules ?? engineRulesOf(actor, key)).filter((rule) => !rule.ignored);
  if (engineRules.length === 0) return { plans: [], before: snapshot(entries), after: snapshot(entries), diff: [], notes: [] };

  const memory = cycleMemory(actor);
  const { buckets, notes } = collectBuckets(actor, engineRules, { target });
  if (buckets.length === 0) return { plans: [], before: snapshot(entries), after: snapshot(entries), diff: [], notes };

  const before = snapshot(entries);

  // 诊断用：记录数组实例，便于判断本次数据准备是否伴随 reset
  const bag = (actor.synthetics ??= {});
  const sameArrayInstance = bag[CYCLE_ARRAY_REF] === entries;
  bag[CYCLE_ARRAY_REF] = entries;

  const plans = buckets.map((bucket) => ({
    ...evaluateBucket(actor, bucket, entries, memory),
    template: bucket.template,
  }));

  if (write) {
    for (const plan of plans) {
      const ok = writeBucket(actor, entries, plan);
      // 只有写入成功才更新回滚记忆，否则下一轮会基于错误状态计算
      if (ok) memory.set(memoryKeyOf(plan), { applied: plan.base, written: plan.value });
      else plan.writeFailed = true;
    }
  }

  const after = snapshot(entries);
  return { plans, before, after, diff: diffSnapshots(before, after), notes, sameArrayInstance };
}

/** 干跑：不写回（不改动数组），但仍会执行“回滚上次写入”那一步 */
export function dryRun(actor, options = {}) {
  return applyBuckets(actor, { ...options, write: false });
}

export { canonicalString, snapshot, diffSnapshots };
