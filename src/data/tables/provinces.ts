/**
 * 东汉末州域映射：把 61 城归入 12 个州。
 *
 * 传闻系统按州生成，每州 3 条且恰好 1 条为真；
 * 州域只影响传闻与情报派遣范围，不改变地图道路与归属。
 */
export interface ProvinceDef {
  id: string;
  name: string;
  cityIds: string[];
}

export const PROVINCES: ProvinceDef[] = [
  {
    id: 'youzhou',
    name: '幽州',
    cityIds: ['zhuo', 'ji', 'beiping', 'xiangping'],
  },
  {
    id: 'jizhou',
    name: '冀州',
    cityIds: ['ye', 'nanpi'],
  },
  {
    id: 'bingzhou',
    name: '并州',
    cityIds: ['jinyang', 'shangdang'],
  },
  {
    id: 'sili',
    name: '司隶',
    cityIds: ['luoyang', 'changan', 'hongnong'],
  },
  {
    id: 'liangzhou',
    name: '凉州',
    cityIds: ['wuwei', 'jincheng', 'anding', 'tianshui', 'wudu'],
  },
  {
    id: 'qingzhou',
    name: '青州',
    cityIds: ['beihai', 'linzi', 'pingyuan'],
  },
  {
    id: 'yanzhou',
    name: '兖州',
    cityIds: ['puyang', 'chenliu'],
  },
  {
    id: 'xuzhou',
    name: '徐州',
    cityIds: ['xiaopei', 'xiapi', 'pengcheng', 'guangling', 'langya'],
  },
  {
    id: 'yuzhou',
    name: '豫州',
    cityIds: ['xuchang', 'runan', 'wan'],
  },
  {
    id: 'jingzhou',
    name: '荆州',
    cityIds: [
      'xinye',
      'xiangyang',
      'jiangling',
      'jiangxia',
      'changsha',
      'wuling',
      'guiyang',
      'lingling',
      'yiling',
      'gongan',
      'shangyong',
    ],
  },
  {
    id: 'yangzhou',
    name: '扬州',
    cityIds: [
      'shouchun',
      'hefei',
      'jianye',
      'wu',
      'kuaiji',
      'chaisang',
      'lujiang',
      'danyang',
      'yuzhang',
      'poyang',
    ],
  },
  {
    id: 'yizhou',
    name: '益州',
    cityIds: [
      'chengdu',
      'mianzhu',
      'zhangtong',
      'jiangzhou',
      'langzhong',
      'badong',
      'jianning',
      'yunnan',
      'hanzhong',
    ],
  },
];

/** 城 id -> 州 id；由 PROVINCES 展开，避免两处维护 */
export const PROVINCE_OF_CITY: Record<string, string> = Object.fromEntries(
  PROVINCES.flatMap((p) => p.cityIds.map((cityId) => [cityId, p.id] as const)),
);

const PROVINCE_BY_ID: Record<string, ProvinceDef> = Object.fromEntries(
  PROVINCES.map((p) => [p.id, p]),
);

export function provinceOf(cityId?: string | null): ProvinceDef | undefined {
  if (!cityId) return undefined;
  const provinceId = PROVINCE_OF_CITY[cityId];
  return provinceId ? PROVINCE_BY_ID[provinceId] : undefined;
}

export function provinceNameOf(cityId?: string | null): string {
  return provinceOf(cityId)?.name ?? '未知州';
}
