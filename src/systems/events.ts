import { BALANCE } from '../data/tables/balance';
import { EVENTS, EVENT_IDS, type EventId } from '../data/tables/events';
import { chance, draw, randInt } from '../core/rng';
import { done, fail, type OpResult } from '../core/result';
import type { City, GameState } from '../core/state';
import { citiesOf, effIntellect } from '../core/state';
import { garrisonCapOf } from './formulas';
import { log } from './economy';

function cityTroops(state: GameState, cityId: string): number {
  return Object.values(state.generals)
    .filter((g) => g.status === 'active' && g.locationId === cityId && !g.armyId)
    .reduce((sum, g) => sum + g.troops, 0);
}

function addTroops(state: GameState, city: City, rate: number): number {
  const room = Math.max(0, garrisonCapOf(city.size) - cityTroops(state, city.id));
  const candidates = Object.values(state.generals).filter(
    (g) => g.status === 'active' && g.locationId === city.id && !g.armyId && !g.isRuler,
  );
  if (candidates.length === 0 || room <= 0) return 0;
  let remaining = Math.min(room, Math.floor(cityTroops(state, city.id) * rate));
  const total = remaining;
  // 按当前兵力比例分配，避免全加到一个 0 兵文官身上
  const weight = candidates.reduce((sum, g) => sum + g.troops, 0) || candidates.length;
  for (const g of candidates) {
    if (remaining <= 0) break;
    const share =
      weight > 0 && candidates.some((x) => x.troops > 0)
        ? Math.max(1, Math.floor((total * Math.max(1, g.troops)) / weight))
        : Math.max(1, Math.floor(total / candidates.length));
    const add = Math.min(remaining, share);
    g.troops += add;
    remaining -= add;
  }
  return total - remaining;
}

/**
 * 月结后尝试安排一个事件。
 *
 * 只在现代规则触发；同一时间最多一个待处理事件。
 * 事件放在 AI 队列结束后由 App 弹出，避免打断月报阅读。
 */
export function maybeScheduleEvent(state: GameState): boolean {
  if (state.settings.ruleset === 'classic') return false;
  if (state.pendingEvent) return false;
  if (state.turn < 2) return false;

  const cities = citiesOf(state, state.playerFactionId);
  if (cities.length === 0) return false;

  const hit = draw(state, 'events', (rng) =>
    chance(rng, BALANCE.MODERN.EVENT_CHANCE),
  );
  if (!hit) return false;

  const eventId = draw(state, 'events', (rng) =>
    randInt(rng, 0, EVENT_IDS.length - 1),
  );
  const cityIndex = draw(state, 'events', (rng) =>
    randInt(rng, 0, cities.length - 1),
  );
  const event = EVENT_IDS[eventId] ?? 'caravan';
  const city = cities[cityIndex] ?? cities[0]!;

  state.pendingEvent = { eventId: event, cityId: city.id, turn: state.turn };
  state.log.push({
    turn: state.turn,
    kind: 'warn',
    text: `${city.name} 传来消息：${EVENTS[event].title}`,
  });
  return true;
}

export interface PendingEventView {
  eventId: EventId;
  city: City;
  title: string;
  eyebrow: string;
  description: string;
  options: (typeof EVENTS)[EventId]['options'];
}

export function pendingEventView(state: GameState): PendingEventView | null {
  const p = state.pendingEvent;
  if (!p) return null;
  const event = EVENTS[p.eventId as EventId];
  const city = state.cities[p.cityId];
  if (!event || !city) return null;
  return {
    eventId: event.id,
    city,
    title: event.title,
    eyebrow: event.eyebrow,
    description: event.description.replaceAll('{city}', city.name),
    options: event.options,
  };
}

/**
 * 结算事件选项。
 *
 * 效果直接写在事件分支里，但每个分支都只做一次资源 / 属性修正，
 * 不引入新的临时状态，读档后不会留下“半结算”事件。
 */
export function resolveEvent(state: GameState, optionId: string): OpResult {
  const p = state.pendingEvent;
  if (!p) return fail('当前没有待处理事件');
  const event = EVENTS[p.eventId as EventId];
  const city = state.cities[p.cityId];
  if (!event || !city) {
    delete state.pendingEvent;
    return fail('事件目标已失效');
  }
  if (!event.options.some((o) => o.id === optionId)) return fail('无效的事件选项');

  let message = '';
  switch (event.id) {
    case 'locust': {
      if (optionId === 'open') {
        const loss = Math.floor(city.food * 0.2);
        city.food = Math.max(0, city.food - loss);
        city.loyalty = Math.min(100, city.loyalty + 6);
        message = `开仓赈灾：${city.name} 粮 −${loss}，民忠 +6`;
      } else if (optionId === 'requisition') {
        city.loyalty = Math.max(0, city.loyalty - 10);
        city.defense = Math.min(100, city.defense + 2);
        message = `强征余粮：${city.name} 民忠 −10，防灾 +2`;
      } else {
        if (city.gold < 300) return fail('金钱不足（邻州购粮需 300 金）');
        city.gold -= 300;
        city.food = Math.min(BALANCE.FOOD_CAP, city.food + 600);
        message = `邻州购粮：${city.name} 金 −300，粮 +600`;
      }
      break;
    }
    case 'caravan': {
      if (optionId === 'escort') {
        city.gold = Math.min(BALANCE.GOLD_CAP, city.gold + 600);
        city.loyalty = Math.min(100, city.loyalty + 2);
        message = `护送商队：${city.name} 金 +600，民忠 +2`;
      } else if (optionId === 'tax') {
        city.gold = Math.min(BALANCE.GOLD_CAP, city.gold + 400);
        city.commerce = Math.max(0, city.commerce - 3);
        city.loyalty = Math.max(0, city.loyalty - 4);
        message = `课以重税：${city.name} 金 +400，商业 −3，民忠 −4`;
      } else {
        city.commerce = Math.max(0, city.commerce - 2);
        city.loyalty = Math.max(0, city.loyalty - 2);
        message = `闭门不纳：${city.name} 商业 −2，民忠 −2`;
      }
      break;
    }
    case 'refugees': {
      if (optionId === 'settle') {
        const loss = Math.floor(city.food * 0.15);
        city.food = Math.max(0, city.food - loss);
        const pop = Math.floor(city.population * 0.08);
        city.population += pop;
        city.loyalty = Math.min(100, city.loyalty + 5);
        message = `安置流民：${city.name} 粮 −${loss}，人口 +${pop}，民忠 +5`;
      } else if (optionId === 'conscript') {
        const loss = Math.floor(city.food * 0.1);
        city.food = Math.max(0, city.food - loss);
        const added = addTroops(state, city, 0.08);
        city.loyalty = Math.max(0, city.loyalty - 5);
        message = `就地征兵：${city.name} 兵力 +${added}，粮 −${loss}，民忠 −5`;
      } else {
        city.loyalty = Math.max(0, city.loyalty - 8);
        city.defense = Math.min(100, city.defense + 3);
        message = `驱逐流民：${city.name} 民忠 −8，防灾 +3`;
      }
      break;
    }
    case 'scholar': {
      if (optionId === 'patron') {
        if (city.gold < 400) return fail('金钱不足（礼聘需 400 金）');
        city.gold -= 400;
        city.agriculture = Math.min(999, city.agriculture + 8);
        city.commerce = Math.min(999, city.commerce + 8);
        city.loyalty = Math.min(100, city.loyalty + 2);
        message = `礼聘名士：${city.name} 农业 +8，商业 +8，民忠 +2`;
      } else if (optionId === 'test') {
        const rulerId = state.factions[state.playerFactionId]?.rulerId;
        const ruler = rulerId ? state.generals[rulerId] : undefined;
        const intellect = ruler ? effIntellect(state, ruler) : 0;
        if (intellect >= 70) {
          city.gold = Math.min(BALANCE.GOLD_CAP, city.gold + 500);
          message = `策问成功（智力 ${intellect}）：${city.name} 金 +500`;
        } else {
          const cost = Math.min(200, city.gold);
          city.gold -= cost;
          message = `策问失败（智力 ${intellect}）：${city.name} 金 −${cost}`;
        }
      } else {
        city.loyalty = Math.min(100, city.loyalty + 1);
        message = `婉言谢绝：${city.name} 民忠 +1`;
      }
      break;
    }
  }

  delete state.pendingEvent;
  log(state, 'good', message);
  return done(message);
}
