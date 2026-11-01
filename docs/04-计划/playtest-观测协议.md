 # playtest 观测协议 v1

> 状态：**已实施**（2026-10-29，I6-6.6）。
> 目的：让“这版是不是更好玩了”从感觉变成可对比的数字。
> 记录位置：`src/store/playtest.ts`；导出：开发模式下 `window.__playtest.download()`。

---

## 0. 结论先行

- 只记录**逐局聚合**，不记录每一步操作，不联网、不进存档；
- 五项核心指标：月点击、首战时长、幕完成率、第二局率、朝议采纳率；
- 每名测试者至少 2 局（同剧本不同势力），只看跨人聚合，不看单局；
- 数据落在 `localStorage` 键 `sanguo.playtest.v1`，上限 50 局，可随时 `reset()`。

---

## 1. 指标定义与目标

| 指标 | 定义 | 目标 | 字段 |
| --- | --- | --- | --- |
| 月点击 | 每月大地图决策点击（`COUNTED_ACTIONS`，不含结束回合） | 4–12 次 / 月；>15 说明操作过碎 | `clicks` / `months` |
| 首战时长 | 开局到首次进入战棋的分钟数 | ≤ 10 分钟；>15 说明入口太深 | `first_battle_ms` |
| 幕完成率 | 完成的幕数 ÷ 3 | 第一幕 60–70%；整体 ≥60% | `act_councils` / `max_act` |
| 第二局率 | 第二次及以后开局的局数 ÷ 已结束局数 | ≥ 30% | `summary().secondRunRate` |
| 朝议采纳率 | 一键执行次数 ÷ 打开朝议次数 | ≥ 50%（现代模式） | `council_opened` / `council_adopted` |

辅助字段：`scenario`、`faction`、`ruleset`、`minutes`、`act_choices`（幕间选择与身份）、`result`。

统计口径：

- “局”指一次开局或读档进入游戏；读档视为新局，因为观测的是本次游玩行为；
- 同一局中途退出菜单按 `abandoned` 记，计入“已结束局数”，不计入“完成”；
- 第二局率的分子只算 `result !== 'running'` 之外的已结束局之后的再开局。

---

## 2. 采集流程

1. `npm run dev` 打开游戏，正常玩一局；
2. 结束时（统一 / 败亡 / 回主菜单）打开控制台：
   - `__playtest.summary()` 看本机聚合；
   - `__playtest.download()` 下载 `playtest.csv`；
3. 把 CSV 交给组织者合并；**不上传任何玩家标识**，`session_id` 只是时间戳 + 种子；
4. 换剧本 / 换势力再玩一局，重复导出（历史会累积，同一 CSV 含所有局）。

命令行 / Node 环境没有 `localStorage`，记录器退化为进程内存储，便于自动化与测试。

---

## 3. CSV 结构

```
session_id,scenario,faction,ruleset,started_at,ended_at,minutes,months,clicks,
clicks_per_month,first_battle_ms,council_opened,council_adopted,council_rate,
act_councils,max_act,act_choices,result
```

- `council_rate` = `council_adopted / council_opened`，未打开朝议时为 0；
- `act_choices` 形如 `0:recuperate|1:farming`（幕序号:选择），便于看身份多样性；
- `result` ∈ `victory` / `defeat` / `abandoned` / `running`。

---

## 4. 样本与判定

| 项 | 规则 |
| --- | --- |
| 人数 | ≥ 6 人（至少 2 人没玩过本项目） |
| 局数 | 每人 ≥ 2 局，四剧本覆盖 ≥ 3 个 |
| 设备 | 至少 2 人在 ≤ 1440 宽、1 人在手机尺寸 |
| 判定 | 五项核心指标同时达标 → 通过；任一项不达标 → 写进 I7–I9 的对应条目，不带入 I10 |
| 失效 | 单局时长 < 5 分钟（未真正体验）或中途重启浏览器导致丢数据的局，剔除 |

---

## 5. 未做

- 没有自动上传 / 服务端聚合，合并 CSV 仍靠人工；
- 没有战棋内点击与军令使用次数，只到战斗层级；
- 没有留存曲线（当天 / 次日），需要真正的账号体系才能做。
