import type { SiegeWeaponId } from '../../core/state';

/**
 * 器械采购表。
 *
 * 只负责「叫什么、多少钱、干什么用」；**破城倍率不在这里**，
 * 真值源仍是 `BALANCE.DURABILITY.siegeWeaponMult`（战斗层唯一读数点）。
 * 器械随出征一次性采购，不占政令，金币从出发城扣。
 */
export interface SiegeWeaponDef {
  id: SiegeWeaponId;
  name: string;
  /** 采购价（金币） */
  gold: number;
  /** 一句战术定位，出征条与城池面板共用 */
  text: string;
  /** 简写，塞进窄按钮 */
  short: string;
}

export const SIEGE_WEAPONS: Record<SiegeWeaponId, SiegeWeaponDef> = {
  ram: {
    id: 'ram',
    name: '冲车',
    gold: 60,
    short: '冲车',
    text: '抵近城门冲撞，对城墙耐久 ×4；不带器械的裸兵只能慢慢磨。',
  },
  tower: {
    id: 'tower',
    name: '井阑',
    gold: 90,
    short: '井阑',
    text: '高台箭楼压制城头，对城墙耐久 ×3，兼可掩护登城。',
  },
  catapult: {
    id: 'catapult',
    name: '投石',
    gold: 120,
    short: '投石',
    text: '远程抛石拆墙，对城墙耐久 ×3；射程外也能持续磨损。',
  },
  beast: {
    id: 'beast',
    name: '木兽',
    gold: 80,
    short: '木兽',
    text: '火兽冲阵，对城墙耐久 ×2 且守军伤亡更重。',
  },
};

export const SIEGE_WEAPON_LIST: SiegeWeaponDef[] = Object.values(SIEGE_WEAPONS);
