import type { LogKind } from '../../core/state';

export type EventId = 'locust' | 'caravan' | 'refugees' | 'scholar';

export interface EventOptionDef {
  id: string;
  label: string;
  hint: string;
  tone?: LogKind;
}

export interface EventDef {
  id: EventId;
  title: string;
  eyebrow: string;
  description: string;
  options: EventOptionDef[];
}

/**
 * 月度事件表：每个事件 2–3 个选项，选项之间是资源 / 民忠 / 人口的取舍。
 * 文本不写死城名，UI 用目标城替换 `{city}`。
 */
export const EVENTS: Record<EventId, EventDef> = {
  locust: {
    id: 'locust',
    title: '蝗灾过境',
    eyebrow: '天灾',
    description: '{city} 城外蝗虫蔽日，仓廪与青苗都受到威胁。灾情不等人，你必须立刻决断。',
    options: [
      { id: 'open', label: '开仓赈灾', hint: '粮 −20%，民忠 +6', tone: 'good' },
      { id: 'requisition', label: '强征余粮', hint: '民忠 −10，防灾 +2', tone: 'warn' },
      { id: 'buy', label: '邻州购粮', hint: '金 −300，粮 +600', tone: 'info' },
    ],
  },
  caravan: {
    id: 'caravan',
    title: '商队来投',
    eyebrow: '商路',
    description: '一支西域商队抵达 {city}，请求借道与庇护。他们带来的财富与麻烦一样多。',
    options: [
      { id: 'escort', label: '派兵护送', hint: '金 +600，民忠 +2', tone: 'good' },
      { id: 'tax', label: '课以重税', hint: '金 +400，商业 −3，民忠 −4', tone: 'warn' },
      { id: 'ignore', label: '闭门不纳', hint: '商业 −2，民忠 −2', tone: 'info' },
    ],
  },
  refugees: {
    id: 'refugees',
    title: '流民南下',
    eyebrow: '人口',
    description: '战乱中的流民涌向 {city}。他们需要粮食与土地，也可能成为新的兵源。',
    options: [
      { id: 'settle', label: '安置流民', hint: '粮 −15%，人口 +8%，民忠 +5', tone: 'good' },
      { id: 'conscript', label: '就地征兵', hint: '兵力 +8%，粮 −10%，民忠 −5', tone: 'warn' },
      { id: 'drive', label: '驱逐出境', hint: '民忠 −8，防灾 +3', tone: 'info' },
    ],
  },
  scholar: {
    id: 'scholar',
    title: '名士来访',
    eyebrow: '人才',
    description: '一位名士来到 {city}，愿以策论换取安身之所。如何接待，考验你的眼光。',
    options: [
      { id: 'patron', label: '礼聘为上宾', hint: '金 −400，农业 +8，商业 +8，民忠 +2', tone: 'good' },
      { id: 'test', label: '当堂策问', hint: '君主智力 ≥ 70：金 +500；否则金 −200', tone: 'warn' },
      { id: 'decline', label: '婉言谢绝', hint: '民忠 +1', tone: 'info' },
    ],
  },
};

export const EVENT_IDS: EventId[] = Object.keys(EVENTS) as EventId[];
