/**
 * 战棋系统公共入口。
 *
 * 原先 1353 行的单文件按职责拆分：
 * - grid      战场几何、移动与攻击范围
 * - combat    伤害、普攻/突击、经验
 * - tactics   计策判定与结算
 * - ai        战术 AI
 * - autopilot 战斗中托管（随时可接管）
 * - setup     开战与无守军占领
 * - turn      回合开始与天数推进
 * - siege     攻城：城墙耐久磨损与城破
 * - resolve   胜负判定与战后结算
 * - auto      AI 对 AI 自动战斗
 */
export * from './grid';
export * from './battlefield';
export * from './mapSlice';

export * from './combat';
export * from './tactics';
export * from './ai';
export * from './focus';
export * from './autopilot';
export * from './setup';
export * from './objectives';
export * from './turn';
export * from './siege';
export * from './resolve';
export * from './auto';
export * from './delegate';
