import type { Item } from '../../core/state';

/**
 * 道具表。GDD §4.5 / §5.2。
 * 【裁决】⑤ 兵符（tally）全局唯一 —— 表里每个 id 只有一份实例，
 * 一旦被某武将装备，其他武将就拿不到，"极兵/玄兵唯一性"由此成立。
 */
export const ITEM_TABLE: Record<string, Item> = {
  weapon_fangtian: { id: 'weapon_fangtian', type: 'weapon', name: '方天画戟', forceBonus: 10 },
  book_sunzi: { id: 'book_sunzi', type: 'book', name: '孙子兵法', intellectBonus: 10 },
  mount_dilu: { id: 'mount_dilu', type: 'mount', name: '爪黄飞电', moveBonus: 1 },

  tally_iron: { id: 'tally_iron', type: 'tally', name: '铁骑兵符' },
  tally_mystic: { id: 'tally_mystic', type: 'tally', name: '太玄兵符' },

  weapon_common_a: { id: 'weapon_common_a', type: 'weapon', name: '普通长枪', forceBonus: 3 },
  book_common_a: { id: 'book_common_a', type: 'book', name: '普通兵书', intellectBonus: 3 },
};
