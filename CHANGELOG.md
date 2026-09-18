# Changelog

## 1.0.0

首个发布版本。

- 新增规则元素 `AdjustResistance`（Rules 页签里的显示名：调整抗性），对角色抗性做数值调整：
  - `add`：在当前抗性上累加（10 + 5 = 15）；没有该条目时从 0 开始
  - `subtract`：递减，下限 0；归零时删除该条目
  - `set`：设为指定值；设为 0 时删除该条目
  - `max`：至少为指定值（等价于系统内置 `Resistance` RE 的“取最高”）
  - `remove`：删除整条（委托系统原生实现）
- 同类型（`type` + `exceptions` + `doubleVs` + `definition` 相同）的多条规则**聚合结算**，不会互相覆盖。
- 以角色**当前抗性值**为基准计算，可与其它来源（内置 `Resistance` RE、其它模块）叠加；重复数据准备结果稳定（幂等）。
- 对手写规则宽容：缺 `type`、`type`/`definition`/`exceptions` 写单值、`definition` 与 `custom` 类型搭配不当，都不会让整条规则失效。
- 支持 `predicate` 条件、`priority` 排序、`@actor.level` 之类的公式值。
- 模块通过 `game.pf2eResistanceAdjustment` 暴露复用出口（引擎、字段、工具），便于扩展弱点等同类规则元素。
