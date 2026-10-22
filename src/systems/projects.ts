import { BALANCE } from '../data/tables/balance';
import { PROJECTS, PROJECT_FIELD_LABEL, type ProjectDef } from '../data/tables/projects';
import { done, fail, type OpResult } from '../core/result';
import type { City, CityProject, GameState, MonthFacts, ProjectKind } from '../core/state';
import { edictLeftOf, edictCapOf } from './domestic';
import { log } from './economy';

/**
 * 项目制内政。
 *
 * 与逐次内政的区别：
 * - 开工占用一个营造位与 1 点政令，并消耗主持武将体力；
 * - 之后按月自动推进，不需要玩家重复点击；
 * - 完工一次性提升较大属性，并在城中留下地标。
 *
 * 只有玩家、且只有现代规则会推进工程；经典模式保留原版逐次内政。
 */

/** 当前城内的活动工程（旧存档可能没有该字段） */
export function activeProjects(city: City): CityProject[] {
  return city.projects ?? [];
}

/**
 * 开工前置检查。返回 null 表示可开工；否则返回给玩家看的原因。
 * UI 与系统共用同一套判定，避免“按钮能点但系统拒绝”。
 */
export function projectStartReason(
  s: GameState,
  cityId: string,
  kind: ProjectKind,
  generalId?: string,
): string | null {
  if (s.settings.ruleset === 'classic') return '经典模式使用原版内政，不启用营造';

  const city = s.cities[cityId];
  if (!city) return '城池不存在';
  if (city.ownerId !== s.playerFactionId) return '只能在己方城池营造';

  const def = PROJECTS[kind];
  if (!def) return '未知工程';

  const active = city.projects ?? [];
  const slots = BALANCE.MODERN.PROJECT.slots;
  if (active.length >= slots) {
    return `营造位已满（${active.length}/${slots}），等待现有工程完工`;
  }
  if (active.some((p) => p.kind === kind)) {
    return `该城已有「${def.name}」在建`;
  }

  if (!generalId) return '请选择主持工程的武将';
  const g = s.generals[generalId];
  if (!g || g.status !== 'active') return '主持武将不可用';
  if (g.locationId !== cityId) return '主持武将不在此城';
  if (g.stamina < BALANCE.MODERN.PROJECT.stamina) {
    return `体力不足（需 ${BALANCE.MODERN.PROJECT.stamina}）`;
  }

  const edictCost = BALANCE.MODERN.PROJECT.edictCost;
  if (edictLeftOf(s, cityId) < edictCost) {
    return `本月政令不足（需 ${edictCost}，已用 ${city.domesticUsed ?? 0}/${edictCapOf(s, cityId)}）`;
  }
  if (city.gold < def.gold) return `金钱不足（需 ${def.gold}）`;
  if (city.food < def.food) return `粮草不足（需 ${def.food}）`;

  return null;
}

/** 开工：扣费、扣体力、占政令与营造位，然后等待月结推进 */
export function startProject(
  s: GameState,
  cityId: string,
  kind: ProjectKind,
  generalId: string,
): OpResult {
  const reason = projectStartReason(s, cityId, kind, generalId);
  if (reason) return fail(reason);

  const city = s.cities[cityId]!;
  const g = s.generals[generalId]!;
  const def = PROJECTS[kind]!;
  const staminaCost = BALANCE.MODERN.PROJECT.stamina;
  const edictCost = BALANCE.MODERN.PROJECT.edictCost;

  city.gold -= def.gold;
  city.food -= def.food;
  city.domesticUsed = (city.domesticUsed ?? 0) + edictCost;
  g.stamina -= staminaCost;

  const project: CityProject = {
    kind,
    monthsLeft: def.months,
    totalMonths: def.months,
    startedTurn: s.turn,
    generalId,
  };
  city.projects = [...(city.projects ?? []), project];

  log(
    s,
    'info',
    `${g.name} 在 ${city.name} 开工「${def.name}」：${def.months} 个月后${def.effectLabel}（−${def.gold} 金${
      def.food > 0 ? `，−${def.food} 粮` : ''
    }，体力 −${staminaCost}）`,
  );
  return done(`开始营造「${def.name}」，预计 ${def.months} 个月完工`);
}

/** 应用完工效果，返回实际提升值（属性已满时可能为 0） */
function applyProjectEffect(city: City, def: ProjectDef): number {
  switch (def.field) {
    case 'agriculture': {
      const before = city.agriculture;
      city.agriculture = Math.min(
        BALANCE.STAT_CAP.agriculture,
        before + def.amount,
      );
      return city.agriculture - before;
    }
    case 'commerce': {
      const before = city.commerce;
      city.commerce = Math.min(
        BALANCE.STAT_CAP.commerce,
        before + def.amount,
      );
      return city.commerce - before;
    }
    case 'fortification': {
      const before = city.fortification;
      city.fortification = Math.min(100, before + def.amount);
      return city.fortification - before;
    }
    case 'training': {
      const before = city.training ?? 0;
      city.training = Math.min(
        BALANCE.STAT_CAP.training,
        before + def.amount,
      );
      return city.training - before;
    }
  }
}

/**
 * 月结推进：每个玩家城池的工程剩余月数 −1，归零时结算并留下地标。
 * 失城时工程暂停（不推进、不结算），夺回后继续。
 */
export function runProjects(s: GameState, facts: MonthFacts): void {
  if (s.settings.ruleset === 'classic') return;
  facts.projects ??= [];

  for (const city of Object.values(s.cities)) {
    if (city.ownerId !== s.playerFactionId) continue;
    const projects = city.projects;
    if (!projects?.length) continue;

    const remaining: CityProject[] = [];
    for (const project of projects) {
      project.monthsLeft -= 1;
      if (project.monthsLeft > 0) {
        remaining.push(project);
        continue;
      }

      const def = PROJECTS[project.kind];
      if (!def) continue;

      const actual = applyProjectEffect(city, def);
      city.landmarks ??= [];
      if (!city.landmarks.includes(def.id)) city.landmarks.push(def.id);

      const effectText =
        actual > 0
          ? `${PROJECT_FIELD_LABEL[def.field]} +${actual}`
          : `${PROJECT_FIELD_LABEL[def.field]} 已达上限`;
      facts.projects.push({
        cityName: city.name,
        projectName: def.name,
        effectLabel: effectText,
      });
      log(s, 'good', `${city.name}「${def.name}」完工：${effectText}`);
    }
    city.projects = remaining;
  }
}
