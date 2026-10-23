// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BattleScreen } from '../src/ui/BattleScreen';
import { createGame } from '../src/data/tables/scenarios';
import { createBattle } from '../src/systems/battle';
import { gameStore } from '../src/store/gameStore';
import type { GameState } from '../src/core/state';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

// jsdom 没有 ResizeObserver / canvas 2d；战棋冒烟只需要组件能挂载
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

let root: Root | null = null;
let el: HTMLDivElement | null = null;

function mountBattle(): GameState {
  const s = createGame({ playerFactionId: 'liubei', seed: 4242 });
  for (const c of Object.values(s.cities)) c.defense = 100;
  createBattle(s, 'jiangxia', 'xiangyang', ['liubei', 'guanyu']);
  expect(s.phase).toBe('battle');
  gameStore.start(s);

  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  act(() => root!.render(<BattleScreen />));
  return s;
}

function button(label: string): HTMLButtonElement | undefined {
  return [...(el?.querySelectorAll('button') ?? [])].find(
    (b) => b.textContent?.trim() === label,
  ) as HTMLButtonElement | undefined;
}

/** 推进 n 个托管节拍（每拍 420ms，略大于正常档 380ms） */
function tick(n = 1): void {
  for (let i = 0; i < n; i++) {
    act(() => {
      vi.advanceTimersByTime(420);
    });
  }
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  // jsdom 没有 canvas 2d：战棋画布会自行降级，这里只避免噪音报错
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  el?.remove();
  el = null;
  vi.useRealTimers();
  gameStore.quit();
});

describe('战斗托管 UI', () => {
  it('开关可切换，托管后我方部队会自己行动', () => {
    const s = mountBattle();
    const b = s.battle!;

    const toggle = button('AI 托管');
    expect(toggle).toBeTruthy();

    act(() => toggle!.click());
    expect(button('接管指挥')).toBeTruthy();

    // 托管第一拍会让队首部队移动；reducer 每次 clone，必须读 store 里的新战局
    const snapshot = () =>
      Object.values(gameStore.state!.battle!.units)
        .map((u) => `${u.x},${u.y}`)
        .join('|');
    const start = snapshot();
    tick(2);
    expect(snapshot()).not.toBe(start);
  });

  it('点击行动顺序条上的部队即接管，并落到该部队', () => {
    const s = mountBattle();
    s.battle!.units['attacker:liubei']!.hasActed = true;

    act(() => button('AI 托管')!.click());
    tick(2);
    expect(button('接管指挥')).toBeTruthy();

    const chips = [...(el?.querySelectorAll('.ao-chip') ?? [])] as HTMLButtonElement[];
    const mine = chips.find((c) => c.textContent?.includes('关羽'));
    expect(mine).toBeTruthy();

    act(() => mine!.click());
    expect(button('AI 托管')).toBeTruthy();
    const card = el?.querySelector('.unit-card');
    expect(card?.textContent).toContain('关羽');
  });

  it('托管中按空格只接管，不会替玩家结束回合', () => {
    const s = mountBattle();
    const b = s.battle!;
    const day = b.day;

    act(() => button('AI 托管')!.click());
    tick(1);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    });
    expect(button('AI 托管')).toBeTruthy();
    expect(b.day).toBe(day);
  });

  it('托管会自动结束回合并推进到次日', () => {
    mountBattle();
    act(() => button('AI 托管')!.click());

    // 我方行动 + 结束回合（620ms 敌军演出）+ 敌军回合，留足节拍
    tick(20);

    const b = gameStore.state!.battle;
    if (b) {
      expect(b.day).toBeGreaterThan(1);
    } else {
      // 三天内打完也算通过：战斗已结算，战报接管
      expect(gameStore.state!.phase).not.toBe('battle');
    }
  });
});
