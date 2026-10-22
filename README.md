# 三国霸业

一款以《三国演义》为背景的回合制策略 Web 游戏：大地图经营、武将养成、外交策反，以及 12×8 的方格战棋战斗。

## 技术栈

- **React 19** + **TypeScript 5**（严格模式）
- **Vite 5** 开发与构建
- **Vitest** 单元测试
- **Canvas 2D** 绘制大地图与战场
- **IndexedDB** 存档，**zod** 配表校验

## 快速开始

```bash
npm install
npm run dev
```

浏览器打开终端提示的本地地址即可。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动开发服务器 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm test` | 运行全部单元测试 |
| `npm run test:watch` | 监听模式运行测试 |
| `npm run build` | 类型检查 + 生产构建 |
| `npm run verify` | 本地完整校验（类型 + 测试 + 构建） |

## 目录结构

```
src/
├── core/            # 状态模型、reducer、随机数、公共 selector/result
├── data/
│   ├── schema.ts    # zod 配表校验
│   └── tables/      # 数值、城池、武将、道具、计策、兵种、剧本
├── save/            # IndexedDB 存档与旧存档迁移
├── store/           # 游戏全局 store（useSyncExternalStore）
├── systems/         # 规则层：内政、经济、外交、俘虏、AI、战斗
│   └── battle/      # 战棋拆分模块（grid/combat/tactics/ai/setup/turn/resolve/auto）
├── render/          # Canvas 渲染
├── ui/              # React 界面
└── styles/          # 全局样式
tests/               # Vitest 测试
docs/                # 设计文档
```

## 架构约定

1. **唯一状态入口**：所有玩家操作都经过 `core/reducer.ts` 的 `reduce()`。
2. **draft 模式**：`reduce()` 先 `structuredClone`，各 system 直接修改草稿；成功才替换原状态，失败保持原引用。
3. **数值真值源**：平衡数值集中在 `src/data/tables/balance.ts`。改数值优先只改这里，不要把常量散落回系统层。
4. **战棋模块边界**：
   - `grid` 只负责坐标、地形、移动/攻击范围；
   - `combat` 负责伤害与普攻/突击；
   - `tactics` 负责计策；
   - `ai` 只做决策并调用上面三者；
   - `resolve` 负责战后结算与游戏结束判定。
5. **存档兼容**：新增字段时，在 `src/save/migrate.ts` 补默认值，并增加迁移测试。

## 测试

```bash
npm test
```

测试覆盖 GDD 精确样例、内政/经济流水线、外交、俘虏、战棋伤害与结算、AI 行为、配表校验、存档往返与迁移、UI 冒烟。

## 存档

- 自动存档槽位：`auto`
- 手动存档：多个槽位，存于浏览器 IndexedDB
- 存档版本号为 `SAVE_VERSION`（`src/save/db.ts`）；版本不匹配会拒绝读取，字段缺失由 `migrateSave()` 补齐。
