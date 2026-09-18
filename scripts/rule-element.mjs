/**
 * AdjustResistance 规则元素本体。
 *
 * 继承系统的内置 Resistance RE（game.pf2e.RuleElements.builtin.Resistance，pf2e.mjs:41570），
 * 复用 type / exceptions / doubleVs / definition / predicate / label 全套 schema，
 *
 * 三处与内置 schema 的差异（都是为了对手写规则更宽容）：
 *  1) type 去掉 min:1 并规范化字符串 → 缺 type 不再报 "cannot have fewer than 1 elements" 而整条失效
 *  2) definition / exceptions / doubleVs 改用可接受单值的字段（系统用的是 StrictArrayField，单值会报 must be an Array）
 *  3) validateJoint 的硬约束降级为不抛错（例如 definition 与 custom 类型的搭配），
 *     避免半填写的规则被直接判为 invalid；语义问题由 engine.collectBuckets 跳过。
 *
 * 注意：IWRRuleElement 的 #isValidValue 是**私有方法**，子类里无法引用（会 SyntaxError），
 * 所以校验在 engine.mjs 的 collectBuckets 里重写。
 */

import { DEFAULT_PRIORITY, MODES, MODE_CHOICES, RE_KEY, TARGET } from "./const.mjs";
import { applyBuckets, engineRulesOf, usesEngine } from "./engine.mjs";
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
import { isEngineEnabled } from "./settings.mjs";

// 兼容/复用：字段类与工具实际定义在 fields.mjs，这里再导出一次
export {
  LaxArrayField,
  LaxPredicateField,
  LaxStringArrayField,
  ResolvableNumberField,
  laxifyField,
  normalizePredicateInput,
  normalizeStringArray,
  wrapSingleValue,
};

let registeredClass = null;

/**
 * 注册规则元素。返回是否成功。
 * 必须在任何 actor 数据准备之前执行（init / setup 阶段），否则物品上的
 * AdjustResistance 会报 "Unrecognized rule element"（pf2e.mjs:45230）。
 */
export function registerRuleElements() {
  if (registeredClass) return true;

  const Registry = game.pf2e?.RuleElements;
  const Base = Registry?.builtin?.Resistance;

  if (typeof Base !== "function" || !Registry?.custom) return false;

  class AdjustResistanceRuleElement extends Base {
    static KEY = RE_KEY;

    /** 目标数组：actor.system.attributes[TARGET] */
    static TARGET = TARGET;

    /**
     * false = 不生成 schema 表单，改用默认表单的纯 JSON 文本框（与内置 Resistance/Weakness/Immunity 一致）。
     * 依据 systems/pf2e/templates/items/rules/default.hbs：autogenerate 为假时只渲染
     * `<textarea name="system.rules.{{index}}">{{json rule}}</textarea>`。
     * 改成 true 会在 Rules 页签里生成一堆 schema 输入框（SchemaField 驱动）。
     */
    static autogenForms = false;

    static defineSchema() {
      const fields = foundry.data.fields;
      const schema = super.defineSchema();

      // 默认排在内置 IWR RE（priority 100，pf2e.mjs:39146）之后结算
      schema.priority = new fields.NumberField({
        required: true,
        nullable: false,
        integer: true,
        initial: DEFAULT_PRIORITY,
      });

      schema.mode = new fields.StringField({
        required: true,
        choices: [...MODE_CHOICES],
        initial: MODES.ADD,
      });

      schema.value = new ResolvableNumberField({ required: true, nullable: false, initial: 0 });

      // ---- 与内置 schema 的宽容化差异（见文件头注释）----
      //    必须用 laxifyField() 就地改造**继承来的**字段实例，不能 new LaxXxxField(field.element)：
      //    包装已有的 element 会抛 "The element DataField already has a parent"
      //    （Foundry ArrayField 构造时的 _validateElementType 校验），而且要到实例化 DataModel
      //    （渲染物品表 / 准备角色数据）时才暴露。

      // type: 去掉 min:1，允许字符串或字符串数组；空数组不再触发校验失败
      laxifyField(schema.type, { min: 0, cast: normalizeStringArray });

      // definition: 允许字符串 / 数组 / 空；空值规范化为 null（避免 truthy 的 [] 触发 validateJoint）
      laxifyField(schema.definition, { cast: normalizePredicateInput, nullable: true });

      // exceptions / doubleVs: 用系统自己的工厂新建一份（element 由工厂内部 new，归属正确），
      // 再就地补上"单值 → 数组"的归一化，元素类型与 choices 校验完全保留。
      schema.exceptions = laxifyField(this.createExceptionsField(this.dictionary), { cast: wrapSingleValue });
      schema.doubleVs = laxifyField(this.createExceptionsField(this.dictionary), { cast: wrapSingleValue });

      return schema;
    }

    /**
     * 系统的联合校验对手写规则过于严格（例如 definition 只在 type:["custom"] 时允许、
     * mode:"remove" 不允许带 exceptions）。这里降级为不抛错：规则照常实例化，
     * 语义问题由引擎在结算时跳过，不会因为一个字段没填就整条失效。
     */
    static validateJoint(source) {
      try {
        super.validateJoint(source);
      } catch {
        // 忽略联合校验失败（不打印任何输出）
      }
    }

    afterPrepareData() {
      try {
        // add / subtract / set / max 走本引擎；remove 委托系统原生实现
        if (!usesEngine(this)) return super.afterPrepareData();
        if (!isEngineEnabled()) return;

        // 每个周期只由“第一条引擎规则”统一结算所有桶。
        // 所有权只看 actor.rules 顺序（= priority 序），与实时 predicate 无关，因此判定稳定。
        const rules = engineRulesOf(this.actor, AdjustResistanceRuleElement.KEY);
        if (rules.find((rule) => usesEngine(rule)) !== this) return;

        applyBuckets(this.actor, {
          write: true,
          rules,
          key: AdjustResistanceRuleElement.KEY,
          target: AdjustResistanceRuleElement.TARGET,
        });
      } catch {
        // pf2e.mjs:31979 遍历 rules 调 afterPrepareData 时**没有 try/catch**，
        // 我们抛出的异常会中断整个 actor 的数据准备，所以必须在此兜住（并保持静默）。
      }
    }
  }

  Registry.custom[RE_KEY] = AdjustResistanceRuleElement;
  registeredClass = AdjustResistanceRuleElement;

  return true;
}

export function getRegisteredClass() {
  return registeredClass;
}
