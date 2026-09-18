/**
 * 工具：稳定比较、IWR 条目快照与差量。
 *
 * 注意：Foundry v14 核心**没有** foundry.utils.deepEqual
 * （已在 resources/app/common/utils/*.mjs 全量搜索确认），
 * 因此这里自己实现 canonical()，避免依赖不存在的 API。
 */

/** 递归排序对象键，得到稳定可比较的结构（数组保持顺序） */
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonical(value[key]);
    return out;
  }
  return value === undefined ? null : value;
}

export const canonicalString = (value) => JSON.stringify(canonical(value));

export const sameValue = (a, b) => canonicalString(a) === canonicalString(b);

/**
 * IWR 条目的“身份”，与内置 IWRRuleElement.getIWR 的匹配条件一致（pf2e.mjs:41593）：
 * type + exceptions + doubleVs + definition
 */
export function specOfEntry(entry) {
  return {
    type: entry?.type ?? null,
    exceptions: entry?.exceptions ?? [],
    doubleVs: entry?.doubleVs ?? [],
    definition: entry?.definition ?? null,
  };
}

export function specOfRule(rule, type) {
  return {
    type,
    exceptions: rule?.exceptions ?? [],
    doubleVs: rule?.doubleVs ?? [],
    definition: rule?.definition ?? null,
  };
}

export const specKey = (spec) => canonicalString(spec);

export const sameSpec = (a, b) => canonicalString(a) === canonicalString(b);

/** 安全取本地化标签（普通对象没有这些 getter，不能直接读） */
export function labelOf(entry) {
  try {
    if (typeof entry?.label === "string") return entry.label;
  } catch {
    /* 普通对象没有 getter，忽略 */
  }
  try {
    if (typeof entry?.applicationLabel === "string") return entry.applicationLabel;
  } catch {
    /* 同上 */
  }
  return String(entry?.type ?? "?");
}

export function sourceOf(entry) {
  try {
    return entry?.source ?? null;
  } catch {
    return null;
  }
}

/** 条目数组 → 可打印/可比较的纯对象快照 */
export function snapshot(entries) {
  return (entries ?? []).map((entry) => ({
    key: specKey(specOfEntry(entry)),
    type: entry?.type ?? null,
    value: typeof entry?.value === "number" ? entry.value : null,
    exceptions: canonical(entry?.exceptions ?? []),
    doubleVs: canonical(entry?.doubleVs ?? []),
    definition: canonical(entry?.definition ?? null),
    source: sourceOf(entry),
    isIWRInstance: typeof entry?.test === "function",
    label: labelOf(entry),
  }));
}

/** 快照差量 → 人类可读的行（用于 info 级别“只在变化时输出”） */
export function diffSnapshots(before, after) {
  const beforeMap = new Map(before.map((s) => [s.key, s]));
  const afterMap = new Map(after.map((s) => [s.key, s]));
  const lines = [];

  for (const [key, prev] of beforeMap) {
    const next = afterMap.get(key);
    if (!next) {
      lines.push(`− 移除 ${prev.label}（原值 ${prev.value}）`);
    } else if (prev.value !== next.value) {
      lines.push(`± ${next.label}：${prev.value} → ${next.value}`);
    } else if (!sameValue([prev.exceptions, prev.doubleVs, prev.definition, prev.source], [next.exceptions, next.doubleVs, next.definition, next.source])) {
      lines.push(`~ ${next.label}：元数据变化（source/例外/双倍）`);
    }
  }
  for (const [key, next] of afterMap) {
    if (!beforeMap.has(key)) lines.push(`＋ 新增 ${next.label}（值 ${next.value}）`);
  }
  return lines;
}

/** 数组元素是否都是 IWR 实例（有 test()）——检测“普通对象混进数组”的致命错误 */
export function checkIWRInstances(entries) {
  const bad = [];
  (entries ?? []).forEach((entry, index) => {
    if (typeof entry?.test !== "function") bad.push({ index, entry });
  });
  return bad;
}
