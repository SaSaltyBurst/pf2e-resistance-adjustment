# PF2e Resistance Adjustment

为 Pathfinder 2e 增加一个新的规则元素 `AdjustResistance`，用来对角色的抗力做数值加减、设值等操作。

## 安装

Foundry 的「附加模块 → 安装模块」里粘贴清单地址：

```
https://github.com/SaSaltyBurst/pf2e-resistance-adjustment/releases/latest/download/module.json
```

也可以手动把本仓库内容放到 `<Foundry 数据目录>/Data/modules/pf2e-resistance-adjustment/`。

## 使用

在规则元素界面使用 AdjustResistance 规则元素即可。例如：

```json
{ "key": "AdjustResistance", "mode": "subtract", "type": ["fire"], "value": 5 }
```

| 字段 | 取值 |
| --- | --- |
| `key` | `"AdjustResistance"` |
| `mode` | `add`（默认） / `subtract` / `set` / `max` / `remove` |
| `value` | 数字或公式 |
| `type` | 字符串数组 |
| `exceptions` / `doubleVs` / `definition` | 同 Resistance |
| `predicate` | 字符串数组 |
| `priority` | 数字（默认 200） |

## 许可

MIT
