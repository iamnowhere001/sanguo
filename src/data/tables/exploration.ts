import type { ExploreDirection } from '../../core/state';

/**
 * 探索派遣方向配表。
 *
 * 人才 / 宝物是 3 步线索链：每在一个目标城累计 1 步，第 3 步必出目标。
 * 情报验证本州传闻，民心提升本城民忠与粮草。
 */
export interface ExploreDirectionDef {
  id: ExploreDirection;
  label: string;
  /** 单字标记，地图与按钮上使用 */
  mark: string;
  /** 面板中的一句话说明 */
  description: string;
  /** 归来目标的口径，用于进度文案 */
  targetLabel: string;
}

export const EXPLORE_DIRECTIONS: Record<ExploreDirection, ExploreDirectionDef> = {
  talent: {
    id: 'talent',
    label: '人才',
    mark: '贤',
    description: '寻访在野名将，累计 3 步线索必得人才',
    targetLabel: '寻访在野名将',
  },
  treasure: {
    id: 'treasure',
    label: '宝物',
    mark: '宝',
    description: '搜求名品兵符，累计 3 步线索必得宝物',
    targetLabel: '搜求名品宝物',
  },
  intel: {
    id: 'intel',
    label: '情报',
    mark: '谍',
    description: '刺探本州，每月验证 1 条传闻真假',
    targetLabel: '刺探本州传闻',
  },
  loyalty: {
    id: 'loyalty',
    label: '民心',
    mark: '民',
    description: '安抚百姓，每月民忠 +2、粮草 +80',
    targetLabel: '安抚民心',
  },
};

export const EXPLORE_ORDER: ExploreDirection[] = ['talent', 'treasure', 'intel', 'loyalty'];

export function exploreDirectionLabel(direction: ExploreDirection): string {
  return EXPLORE_DIRECTIONS[direction]?.label ?? direction;
}
