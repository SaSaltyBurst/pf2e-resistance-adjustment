/**
 * 可复用的数据字段与字段工具。
 */

const { fields } = foundry.data;

/** 允许 number / "5" / "@actor.level" / "{item|level}" 的数值字段 */
export class ResolvableNumberField extends fields.DataField {
  _validateType(value) {
    if (!["string", "number"].includes(typeof value)) return false;
  }

  _cast(value) {
    return value;
  }

  _cleanType(value) {
    if (typeof value === "number" || value === null || value === undefined) return value;
    const text = String(value).trim();
    if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
    return text || 0; // 公式串（@actor.level 等）原样保留，交给 RuleElement#resolveValue
  }

  _toInput(config) {
    const factory = foundry.applications?.fields?.createTextInput;
    if (typeof factory === "function") return factory(config);
    return super._toInput(config);
  }
}

/* ------------------------------------------------------------------ *
 * 归一化函数（也可单独复用）
 * ------------------------------------------------------------------ */

/** 字符串 / 字符串数组 / Set → 字符串数组（去首尾空白、去空项） */
export function normalizeStringArray(value) {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : value instanceof Set ? [...value] : [value];
  return list
    .map((entry) => (typeof entry === "string" ? entry : String(entry ?? "")))
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

/**
 * 谓词输入 → null | 数组。
 * 空值统一成 null 而不是 []：[] 是 truthy，会让系统的 validateJoint
 * （definition 只能在 type:["custom"] 时出现）误报，甚至让整条规则失效。
 */
export function normalizePredicateInput(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") {
    const text = value.trim();
    return text === "" ? null : [text];
  }
  if (Array.isArray(value)) return value.length === 0 ? null : value;
  if (value instanceof Set) return value.size === 0 ? null : [...value];
  return [value];
}

/** 单值 / 数组 / Set → 数组（元素类型与校验交给字段自己的 element） */
export function wrapSingleValue(value) {
  if (value === undefined || value === null) return value;
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return [...value];
  return [value];
}

/* ------------------------------------------------------------------ *
 * 就地改造已有字段（覆盖继承 schema 时用这个）
 * ------------------------------------------------------------------ */

/**
 * 就地把一个已存在的字段改成宽容版：只改属性与 _cast，不碰它的 element，
 * 因此不会触发 "The element DataField already has a parent"。
 *
 * @param {object} field       已存在的 DataField（通常来自 super.defineSchema() 或本类的工厂方法）
 * @param {object} [options]
 * @param {Function} [options.cast]     覆盖 _cast（输入归一化）
 * @param {number} [options.min]        覆盖 ArrayField 的最小长度
 * @param {boolean} [options.nullable]  覆盖是否允许 null
 * @param {*} [options.initial]         覆盖默认值
 * @returns {object} 同一个字段实例（便于链式书写）
 */
export function laxifyField(field, { cast = null, min = null, nullable = null, initial = undefined } = {}) {
  if (!field || typeof field !== "object") return field;
  if (typeof cast === "function") field._cast = cast;
  if (min !== null && "min" in field) field.min = min;
  if (nullable !== null && "nullable" in field) field.nullable = nullable;
  if (initial !== undefined && "initial" in field) field.initial = initial;
  return field;
}

/* ------------------------------------------------------------------ *
 * 从零创建的宽容字段（element 由本类自己 new，不会有 parent 冲突）
 * ------------------------------------------------------------------ */

/** 字符串 / 字符串数组；允许空数组（不设 min） */
export class LaxStringArrayField extends fields.ArrayField {
  constructor(options = {}) {
    super(new fields.StringField({ required: false, blank: true }), options);
  }

  _cast(value) {
    return normalizeStringArray(value);
  }
}

/** 单值也接受的数组字段（元素类型仍按 element 校验） */
export class LaxArrayField extends fields.ArrayField {
  _cast(value) {
    return wrapSingleValue(value);
  }
}

/** 谓词定义字段：缺省 / 空串 / 空数组 → null，单值字符串 → ["..."] */
export class LaxPredicateField extends fields.ArrayField {
  constructor(options = {}) {
    super(new fields.DataField({}), { nullable: true, required: false, initial: null, ...options });
  }

  _cast(value) {
    return normalizePredicateInput(value);
  }
}
