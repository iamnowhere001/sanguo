import { describe, expect, it } from 'vitest';
import { SOUNDS } from '../src/audio/manifest';
import { AMBIENCE_IDS, BGM_IDS, ONE_SHOT_IDS } from '../src/audio/types';
import { recipeIds } from '../src/audio/synth';
import { clampSettings } from '../src/audio/settings';
import {
  HEAVY_HIT_RATIO,
  cuesForAction,
  playerCityGain,
  sceneFor,
} from '../src/audio/director';
import { audio } from '../src/audio';
import { createGame } from '../src/data/tables/scenarios';
import type { Action, ActionResult } from '../src/core/reducer';

const OK: ActionResult = { ok: true, message: '' };

function cueIds(action: Action, result: ActionResult = OK, extra: Partial<Parameters<typeof cuesForAction>[0]> = {}) {
  return cuesForAction({ action, result, phaseBefore: 'battle', ...extra }).map((c) => c.id);
}

describe('音效参数表', () => {
  it('每个 id 都有定义，且 id 与键一致', () => {
    for (const id of [...BGM_IDS, ...AMBIENCE_IDS, ...ONE_SHOT_IDS]) {
      const def = SOUNDS[id];
      expect(def, `缺少音效定义：${id}`).toBeTruthy();
      expect(def.id).toBe(id);
    }
  });

  it('只有 BGM 与环境音允许循环', () => {
    for (const id of BGM_IDS) expect(SOUNDS[id].loop).toBe(true);
    for (const id of AMBIENCE_IDS) expect(SOUNDS[id].loop).toBe(true);
    for (const id of ONE_SHOT_IDS) expect(SOUNDS[id].loop ?? false).toBe(false);
  });

  it('增益在 (0,1]，循环轨都配了淡入淡出', () => {
    for (const def of Object.values(SOUNDS)) {
      expect(def.gain).toBeGreaterThan(0);
      expect(def.gain).toBeLessThanOrEqual(1);
      if (def.loop) {
        expect(def.fadeIn, `${def.id} 缺少淡入`).toBeGreaterThan(0);
        expect(def.fadeOut, `${def.id} 缺少淡出`).toBeGreaterThan(0);
      }
    }
  });

  it('每条一次性音效都有合成配方', () => {
    const withRecipe = new Set(recipeIds());
    for (const id of ONE_SHOT_IDS) {
      expect(withRecipe.has(id), `缺少配方：${id}`).toBe(true);
    }
  });
});

describe('声音导演', () => {
  const unitsBefore = {
    a: { unitClass: 'archer' as const, maxTroops: 1000 },
    c: { unitClass: 'cavalry' as const, maxTroops: 1000 },
    d: { unitClass: 'infantry' as const, maxTroops: 1000 },
  };

  it('普攻按兵种出声：弓兵 / 骑兵 / 步兵各不相同', () => {
    expect(cueIds({ t: 'BATTLE_ATTACK', attackerId: 'a', targetId: 'd' }, { ...OK, damage: 10 }, { unitsBefore })).toContain('attack.arrow');
    expect(cueIds({ t: 'BATTLE_ATTACK', attackerId: 'c', targetId: 'd' }, { ...OK, damage: 10 }, { unitsBefore })).toContain('attack.cavalry');
    expect(cueIds({ t: 'BATTLE_ATTACK', attackerId: 'd', targetId: 'a' }, { ...OK, damage: 10 }, { unitsBefore })).toContain('attack.melee');
  });

  it('伤害占满编 25% 以上追加重击层，击溃再叠溃散音', () => {
    const heavy = HEAVY_HIT_RATIO * 1000 + 1;
    expect(cueIds({ t: 'BATTLE_ATTACK', attackerId: 'd', targetId: 'a' }, { ...OK, damage: heavy }, { unitsBefore })).toContain('hit.heavy');
    expect(cueIds({ t: 'BATTLE_ATTACK', attackerId: 'd', targetId: 'a' }, { ...OK, damage: 10 }, { unitsBefore })).not.toContain('hit.heavy');

    const ids = cueIds(
      { t: 'BATTLE_ATTACK', attackerId: 'd', targetId: 'a' },
      { ...OK, damage: heavy, routed: true },
      { unitsBefore },
    );
    expect(ids).toContain('combat.rout');
  });

  it('移动音按兵种切换，待机与撤销各有专音', () => {
    expect(cueIds({ t: 'BATTLE_MOVE', unitId: 'c', x: 1, y: 1 }, OK, { unitsBefore })).toEqual([
      'unit.moveCavalry',
    ]);
    expect(cueIds({ t: 'BATTLE_WAIT', unitId: 'd' })).toEqual(['unit.wait']);
    expect(cueIds({ t: 'BATTLE_UNDO_MOVE', unitId: 'd' })).toEqual(['unit.undo']);
  });

  it('计策命中与落空分开，突击有独立重音', () => {
    expect(
      cueIds({ t: 'BATTLE_TACTIC', unitId: 'd', tacticId: 'fire', targetId: 'a' }, { ...OK, success: true }),
    ).toEqual(['tactic.fire']);
    expect(
      cueIds({ t: 'BATTLE_TACTIC', unitId: 'd', tacticId: 'fire', targetId: 'a' }, { ...OK, success: false }),
    ).toEqual(['tactic.fail']);
    expect(cueIds({ t: 'BATTLE_CHARGE', attackerId: 'd', targetId: 'a' })).toContain('combat.charge');
  });

  it('敌军回合不在 dispatch 里发声：鼓点由界面先播，避免延迟', () => {
    expect(cueIds({ t: 'BATTLE_END_TURN' })).toEqual([]);
  });

  it('失败的指令不出声（由提示音统一兜底）', () => {
    expect(cueIds({ t: 'BATTLE_MOVE', unitId: 'd', x: 1, y: 1 }, { ok: false, message: '非法移动' })).toEqual([]);
  });

  it('月结、出征、统一各有专属提示音', () => {
    expect(cueIds({ t: 'END_TURN' }, OK, { phaseBefore: 'map' })).toEqual(['stinger.turn']);
    expect(
      cueIds(
        { t: 'DEPLOY', fromCityId: 'jiangxia', targetCityId: 'xiangyang', generalIds: ['liubei'] },
        OK,
        { phaseBefore: 'map' },
      ),
    ).toEqual(['stinger.deploy']);
    expect(cueIds({ t: 'UNIFY' }, OK, { phaseBefore: 'map' })).toEqual(['stinger.unify']);
  });
});

describe('场景音频推导', () => {
  it('主菜单只放 BGM，不放环境音', () => {
    expect(sceneFor('menu', null)).toEqual({ bgm: 'bgm.menu', ambience: null, weather: null });
  });

  it('大地图为经营曲 + 原野底噪', () => {
    const state = createGame({ playerFactionId: 'liubei', aiEnabled: false });
    expect(sceneFor('game', state)).toEqual({
      bgm: 'bgm.map',
      ambience: 'amb.map',
      weather: null,
    });
  });

  it('战棋切换战斗曲，雨天叠雨声', () => {
    const state = createGame({ playerFactionId: 'liubei', aiEnabled: false });
    state.phase = 'battle';
    state.battle = {
      fromCityId: 'jiangxia',
      targetCityId: 'xiangyang',
      attackerFactionId: 'liubei',
      defenderFactionId: 'liubiao',
      playerSide: 'attacker',
      playerInvolved: true,
      grid: [],
      units: {},
      side: 'attacker',
      day: 1,
      weather: 'rain',
      status: 'ongoing',
      log: [],
      rng: state.streams.battle,
    };
    expect(sceneFor('game', state)).toEqual({
      bgm: 'bgm.battle',
      ambience: 'amb.battle',
      weather: 'amb.rain',
    });
  });
});

describe('音量设置', () => {
  it('越界与非法输入被收敛到 0–1 / 默认值', () => {
    expect(clampSettings({ master: 2, music: -3, sfx: Number.NaN }).master).toBe(1);
    expect(clampSettings({ master: 2, music: -3, sfx: Number.NaN }).music).toBe(0);
    expect(clampSettings({ master: 2, music: -3, sfx: Number.NaN }).sfx).toBe(0.85);
    expect(clampSettings(null).muted).toBe(false);
  });

  it('无音频环境下调用不抛错（Node / 隐私模式）', () => {
    expect(() => {
      audio.play('ui.click');
      audio.enterScene({ bgm: 'bgm.map', ambience: 'amb.map', weather: null });
      audio.setDuckHeld(true);
      audio.setDuckHeld(false);
      audio.setSettings({ master: 0.5 });
      audio.stopAllLoops();
    }).not.toThrow();
    expect(audio.isRunning()).toBe(false);
  });
});

describe('城池易主判定', () => {
  it('只统计玩家新增的城池', () => {
    const before = createGame({ playerFactionId: 'liubei', aiEnabled: false });
    const after = structuredClone(before);
    const target = Object.values(after.cities).find((c) => c.ownerId !== 'liubei');
    expect(target).toBeTruthy();
    target!.ownerId = 'liubei';
    expect(playerCityGain(before, after)).toBe(1);
    expect(playerCityGain(after, before)).toBe(0);
  });
});
