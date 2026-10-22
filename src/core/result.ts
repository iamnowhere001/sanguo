/**
 * 系统操作的统一返回值。
 *
 * 约定：`ok` 表示状态是否真的被修改；`message` 是可直接展示给玩家的反馈。
 * 各系统可以在此基础上扩展字段（成功率、伤害等），但不要重复定义 ok/message。
 */
export interface OpResult {
  ok: boolean;
  message: string;
}

export const fail = (message: string): OpResult => ({ ok: false, message });
export const done = (message: string): OpResult => ({ ok: true, message });
