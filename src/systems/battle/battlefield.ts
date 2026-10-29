import { createRng, nextFloat, randInt, type RngState } from '../../core/rng';
import { sliceBattlefieldFromMap } from './mapSlice';
import type {
  BattleTerrain,
  BattlefieldFeature,
  BattlefieldInfo,
  BattlefieldThemeId,
  CitySize,
  Terrain,
} from '../../core/state';
import { BATTLE_H, BATTLE_W } from './grid';

/**
 * 战场生成：每座城根据自己的地形、水城属性与城市规模，得到一套有辨识度的
 * 12×8 战场。地图仍然是确定性的（同一上下文生成同一张图），但不再是四张
 * 固定模板轮换：
 *
 * - 地形主题决定“这张图像哪里”：屯田、河川、关隘、峡谷、密林、水乡、湖沼、
 *   城郊、古战场、丘陵；
 * - 地标（桥、渡口、村落、粮营、关隘、烽燧、废墟）负责让玩家一眼记住地形；
 * - 城市格、出生点与粮仓点仍固定，保证战斗逻辑、AI 与旧测试不受影响。
 */

const W = BATTLE_W;
const H = BATTLE_H;

const CITY_X0 = 7;
const CITY_X1 = 8;
const CITY_Y0 = 3;
const CITY_Y1 = 4;
const SUPPLY_X = 10;
const SUPPLY_Y = 3;

const SPAWN_ATTACKER_CELLS: Array<[number, number]> = [
  [0, 3],
  [0, 4],
  [1, 3],
  [1, 4],
  [0, 2],
  [1, 2],
  [0, 5],
  [1, 5],
];

const SPAWN_DEFENDER_CELLS: Array<[number, number]> = [
  [7, 3],
  [8, 4],
  [8, 3],
  [7, 4],
  [7, 2],
  [9, 3],
  [9, 4],
  [6, 3],
  [6, 4],
  [7, 5],
];

/** 中央交战区与城门通道始终保持开阔，避免主题地形把战斗变成绕路比赛 */
const OPEN_CORRIDOR: Array<[number, number]> = [
  [5, 3],
  [5, 4],
  [6, 3],
  [6, 4],
  [9, 3],
  [9, 4],
];

export const BATTLEFIELD_THEME_LABEL: Record<BattlefieldThemeId, string> = {
  farmland: '屯田',
  river: '河川',
  pass: '关隘',
  gorge: '峡谷',
  forest: '密林',
  watertown: '水乡',
  lake: '湖沼',
  city: '城郊',
  ruins: '古战场',
  highland: '丘陵',
};

export interface BattlefieldContext {
  seed: number;
  turn: number;
  battleSerial: number;
  attackerCityId: string;
  defenderCityId: string;
  targetCityId: string;
  targetCityName: string;
  targetTerrain: Terrain;
  isWaterCity?: boolean;
  citySize?: CitySize;
}

export interface BattlefieldResult {
  grid: BattleTerrain[][];
  battlefield: BattlefieldInfo;
}

interface BattlefieldDraft {
  grid: BattleTerrain[][];
  features: BattlefieldFeature[];
}

interface ThemeSpec {
  name: string;
  subtitle: string;
}

interface SpecialBattlefield extends ThemeSpec {
  theme: BattlefieldThemeId;
}

/** 有明确历史意象的城池：固定主题与专名，让玩家一眼认出“这是哪一战” */
const SPECIAL_BATTLEFIELDS: Record<string, SpecialBattlefield> = {
  xiangyang: {
    theme: 'river',
    name: '汉水渡口',
    subtitle: '汉水横切战场，浮桥与浅滩是两军必争的咽喉。',
  },
  jiangling: {
    theme: 'watertown',
    name: '江陵水郭',
    subtitle: '江汉交汇，堤桥纵横，水军可沿港汊绕后。',
  },
  jiangxia: {
    theme: 'lake',
    name: '江夏江渚',
    subtitle: '大江与湖泊夹出狭长洲渚，沿岸芦苇可藏伏兵。',
  },
  hefei: {
    theme: 'watertown',
    name: '逍遥津',
    subtitle: '水网与芦荡交错，轻骑难展，步卒可借堤岸逼近。',
  },
  jianye: {
    theme: 'river',
    name: '建业江防',
    subtitle: '大江为屏，渡口与滩头决定攻守节奏。',
  },
  chaisang: {
    theme: 'lake',
    name: '柴桑湖口',
    subtitle: '湖口烟波浩渺，舟师纵横，陆军须沿堤推进。',
  },
  poyang: {
    theme: 'lake',
    name: '鄱阳湖口',
    subtitle: '湖面开阔，风急浪高，水军可远距离包抄。',
  },
  yiling: {
    theme: 'gorge',
    name: '夷陵峡口',
    subtitle: '两岸连山，中道狭窄，火势一旦燃起便沿林蔓延。',
  },
  badong: {
    theme: 'gorge',
    name: '巴东峡口',
    subtitle: '三峡天险，绝壁夹江，只有峡道可以通行。',
  },
  shangyong: {
    theme: 'gorge',
    name: '上庸山城',
    subtitle: '山城临水，峡谷与栈道把战场切成数段。',
  },
  hanzhong: {
    theme: 'pass',
    name: '汉中门户',
    subtitle: '秦岭余脉横断，关隘与山道是唯一快路。',
  },
  shangdang: {
    theme: 'pass',
    name: '太行壶关',
    subtitle: '太行山脊如墙，壶关一线是兵家必争之地。',
  },
  hongnong: {
    theme: 'pass',
    name: '函谷故道',
    subtitle: '崤函古道夹在山塬之间，窄处只容一军通过。',
  },
  wuling: {
    theme: 'forest',
    name: '武陵蛮溪',
    subtitle: '溪谷密林遮天，弓兵与伏兵在此如鱼得水。',
  },
  yunnan: {
    theme: 'forest',
    name: '南中密林',
    subtitle: '瘴林深密，道路难辨，骑兵几乎无法展开。',
  },
  chengdu: {
    theme: 'farmland',
    name: '成都平原',
    subtitle: '沃野千里，无险可守，胜负取决于谁先展开阵形。',
  },
  xinye: {
    theme: 'farmland',
    name: '新野屯田',
    subtitle: '田垄与沟渠交错，平原上适合骑兵迂回。',
  },
  xuchang: {
    theme: 'city',
    name: '许都外郭',
    subtitle: '都城外郭，官道直抵城门，两侧村落与田庄可作参照。',
  },
  luoyang: {
    theme: 'city',
    name: '洛阳城郊',
    subtitle: '旧都郊野，驰道宽阔，城垣高厚，正面强攻最为艰难。',
  },
  changan: {
    theme: 'city',
    name: '长安城下',
    subtitle: '关中沃野托起坚城，攻方须在野战中先破守军。',
  },
  ye: {
    theme: 'city',
    name: '邺城宫道',
    subtitle: '铜雀台外的宫道与田庄，城高池深，守方以逸待劳。',
  },
  beihai: {
    theme: 'river',
    name: '北海盐泽',
    subtitle: '盐泽与河汊遍布，泥泞难行，水军可沿泽边突进。',
  },
  guangling: {
    theme: 'watertown',
    name: '广陵漕渠',
    subtitle: '漕渠穿城而过，堤岸与桥梁控制着粮道。',
  },
  shouchun: {
    theme: 'watertown',
    name: '寿春淮上',
    subtitle: '淮水与芍陂水网交错，城郭之外尽是堤桥。',
  },
  wu: {
    theme: 'lake',
    name: '吴郡泽国',
    subtitle: '太湖东岸水网密布，舟师可借港汊迂回。',
  },
  kuaiji: {
    theme: 'watertown',
    name: '会稽水乡',
    subtitle: '镜湖与河渠环绕，堤桥是唯一快路。',
  },
  lujiang: {
    theme: 'watertown',
    name: '庐江水寨',
    subtitle: '巢湖之滨，港汊芦苇可藏舟师。',
  },
  yuzhang: {
    theme: 'river',
    name: '豫章赣水',
    subtitle: '赣水横贯，渡口与浮桥是南北往来的咽喉。',
  },
  gongan: {
    theme: 'watertown',
    name: '公安江渚',
    subtitle: '长江南岸洲渚交错，水陆并进方能破城。',
  },
  tianshui: {
    theme: 'highland',
    name: '陇上高原',
    subtitle: '黄土塬与沟壑交错，骑兵可沿塬面机动。',
  },
  wuwei: {
    theme: 'highland',
    name: '凉州旷野',
    subtitle: '旷野风沙，视野极远，骑兵冲锋威力倍增。',
  },
  jiangzhou: {
    theme: 'river',
    name: '江州水口',
    subtitle: '两江交汇，水口与滩头是攻守关键。',
  },
};

const THEME_VARIANTS: Record<BattlefieldThemeId, ThemeSpec[]> = {
  farmland: [
    { name: '城郊麦田', subtitle: '阡陌纵横，视野开阔，适合骑兵展开。' },
    { name: '屯田旷野', subtitle: '田垄与沟渠交错，平原上无险可依。' },
    { name: '秋收原野', subtitle: '秸秆与谷堆散落，火势容易蔓延。' },
  ],
  river: [
    { name: '河川渡口', subtitle: '河水横断战场，浮桥是唯一的快路。' },
    { name: '大江浮桥', subtitle: '江面宽急，桥头与浅滩决定攻守节奏。' },
    { name: '河岸战场', subtitle: '两岸芦苇丛生，渡河时阵形最易散乱。' },
  ],
  pass: [
    { name: '山岭关隘', subtitle: '山脊横断，关隘一线是兵家必争之地。' },
    { name: '岭上烽燧', subtitle: '烽燧高悬，山道狭窄，强攻代价极高。' },
    { name: '山口要道', subtitle: '两山夹出缺口，谁能先占山口谁就掌握主动。' },
  ],
  gorge: [
    { name: '两山夹峙', subtitle: '绝壁夹出中道，侧翼尽是难以翻越的山岭。' },
    { name: '峡谷栈道', subtitle: '栈道贴壁而行，一军当关，万军难开。' },
    { name: '绝壁长廊', subtitle: '山影压顶，只有峡道可以通行。' },
  ],
  forest: [
    { name: '密林伏兵', subtitle: '林木蔽野，弓兵得势，骑兵难行。' },
    { name: '林间小道', subtitle: '树影间只容小队穿行，伏兵最易得手。' },
    { name: '黑松林子', subtitle: '松涛遮住马蹄声，林缘处处可能藏着杀机。' },
  ],
  watertown: [
    { name: '水乡泽国', subtitle: '港汊纵横，堤桥相连，水军可绕后。' },
    { name: '港汊水网', subtitle: '河道把战场切成碎块，桥梁成为必争点。' },
    { name: '芦荡水寨', subtitle: '芦苇与浅水交错，步卒可借堤岸逼近。' },
  ],
  lake: [
    { name: '湖口烟波', subtitle: '湖面开阔，舟师可纵横，陆军须沿堤推进。' },
    { name: '大泽浅滩', subtitle: '浅滩与芦苇绵延，阵形很容易被水网拉散。' },
    { name: '湖堤战场', subtitle: '长堤是唯一快路，谁控制堤口谁就掌握主动。' },
  ],
  city: [
    { name: '都城外郭', subtitle: '官道直抵城门，两侧村落与田庄可作参照。' },
    { name: '城郊市井', subtitle: '城外市集与驿道交错，攻城前先要在野战中取胜。' },
    { name: '官道驿亭', subtitle: '驰道宽阔，城垣高厚，守方以逸待劳。' },
  ],
  ruins: [
    { name: '古战场', subtitle: '荒草没膝，断戟残旗间无险可依。' },
    { name: '废垒荒丘', subtitle: '旧垒残破，只能借断墙与土丘勉强遮身。' },
    { name: '断戟坡', subtitle: '风过荒原，昔日战死者留下的兵刃仍半埋土中。' },
  ],
  highland: [
    { name: '黄土高坡', subtitle: '塬面起伏，沟壑切割，骑兵可沿塬面机动。' },
    { name: '乱石山岗', subtitle: '石岗与矮林交错，适合步卒借势固守。' },
    { name: '丘陵战场', subtitle: '缓坡连绵，视野时断时续，伏兵易于藏身。' },
  ],
};

class FieldRng {
  private rng: RngState;

  constructor(seed: number) {
    this.rng = createRng(seed);
  }

  float(): number {
    const [value, next] = nextFloat(this.rng);
    this.rng = next;
    return value;
  }

  int(min: number, max: number): number {
    const [value, next] = randInt(this.rng, min, max);
    this.rng = next;
    return value;
  }

  chance(p: number): boolean {
    return this.float() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)]!;
  }
}

function hashText(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

function hashParts(parts: Array<string | number>): number {
  return hashText(parts.join('|'));
}

function blankGrid(): BattleTerrain[][] {
  return Array.from({ length: H }, () => Array<BattleTerrain>(W).fill('plain'));
}

function inBounds(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < W && y < H;
}

function isCityCell(x: number, y: number): boolean {
  return x >= CITY_X0 && x <= CITY_X1 && y >= CITY_Y0 && y <= CITY_Y1;
}

function isSpawnCell(x: number, y: number): boolean {
  return [...SPAWN_ATTACKER_CELLS, ...SPAWN_DEFENDER_CELLS].some(
    ([sx, sy]) => sx === x && sy === y,
  );
}

function isReserved(x: number, y: number): boolean {
  return (
    isCityCell(x, y) ||
    isSpawnCell(x, y) ||
    (x === SUPPLY_X && y === SUPPLY_Y) ||
    OPEN_CORRIDOR.some(([cx, cy]) => cx === x && cy === y)
  );
}

function setTile(
  draft: BattlefieldDraft,
  x: number,
  y: number,
  terrain: BattleTerrain,
  force = false,
): void {
  if (!inBounds(x, y)) return;
  if (isCityCell(x, y) && !force) return;
  if (!force && isReserved(x, y)) return;
  draft.grid[y]![x] = terrain;
}

function paintCluster(
  draft: BattlefieldDraft,
  x: number,
  y: number,
  w: number,
  h: number,
  terrain: BattleTerrain,
  force = false,
): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      setTile(draft, x + dx, y + dy, terrain, force);
    }
  }
}

function addFeature(draft: BattlefieldDraft, feature: BattlefieldFeature): void {
  if (!inBounds(feature.x, feature.y)) return;
  if (isCityCell(feature.x, feature.y)) return;
  if (
    draft.features.some(
      (f) => f.x === feature.x && f.y === feature.y && f.kind === feature.kind,
    )
  ) {
    return;
  }
  draft.features.push(feature);
}

function addRoad(draft: BattlefieldDraft, x: number, y: number): void {
  if (!inBounds(x, y) || isCityCell(x, y)) return;
  if (draft.grid[y]![x] === 'water') return;
  draft.grid[y]![x] = 'plain';
  addFeature(draft, {
    x,
    y,
    kind: 'road',
    label: '官道',
    description: '车马往来的土路，可作行军参照。',
  });
}

function addBridge(
  draft: BattlefieldDraft,
  x: number,
  y: number,
  label = '浮桥',
): void {
  if (!inBounds(x, y) || isCityCell(x, y)) return;
  draft.grid[y]![x] = 'plain';
  addFeature(draft, {
    x,
    y,
    kind: 'bridge',
    label,
    description: '木桥横跨水面，过桥不额外消耗移动力。',
    dir: 'h',
  });
}

function addFord(draft: BattlefieldDraft, x: number, y: number): void {
  if (!inBounds(x, y) || isCityCell(x, y)) return;
  addFeature(draft, {
    x,
    y,
    kind: 'ford',
    label: '浅滩',
    description: '水势较缓，可涉水而过，但比走桥更慢。',
    dir: 'h',
  });
}

function addLandmark(
  draft: BattlefieldDraft,
  x: number,
  y: number,
  kind: 'village' | 'camp' | 'pass' | 'watchtower' | 'temple' | 'ruins' | 'banner',
  label: string,
  description: string,
): void {
  if (!inBounds(x, y) || isCityCell(x, y)) return;
  if (draft.grid[y]![x] === 'water') draft.grid[y]![x] = 'plain';
  addFeature(draft, { x, y, kind, label, description });
}

function roadToGate(draft: BattlefieldDraft, fromY: number): void {
  for (let x = 0; x <= 6; x++) addRoad(draft, x, fromY);
  const gateY = fromY <= 3 ? 3 : 4;
  if (fromY !== gateY) {
    const step = gateY > fromY ? 1 : -1;
    for (let y = fromY; y !== gateY; y += step) addRoad(draft, 6, y);
  }
  addRoad(draft, 6, gateY);
}

// ── 主题生成器 ────────────────────────────────────────────

function genFarmland(draft: BattlefieldDraft, rng: FieldRng, variant: number): void {
  // 田埂与防风林带：短条状森林，而不是大片林地
  const hedges = 3 + rng.int(0, 2);
  for (let i = 0; i < hedges; i++) {
    const horizontal = rng.chance(0.55);
    const len = 2 + rng.int(0, 2);
    const x = rng.int(1, W - 2);
    const y = rng.int(1, H - 2);
    for (let j = 0; j < len; j++) {
      setTile(draft, horizontal ? x + j : x, horizontal ? y : y + j, 'forest');
    }
  }

  // 一处小树林，给弓兵一点可站的地形
  const groveX = rng.pick([1, 2, 3]);
  const groveY = rng.pick([0, 6]);
  paintCluster(draft, groveX, groveY, 2, 2, 'forest');

  const gateY = 3 + (variant % 2);
  roadToGate(draft, 4);

  const villageX = rng.int(2, 4);
  const villageY = rng.pick([1, 6]);
  addLandmark(
    draft,
    villageX,
    villageY,
    'village',
    '村落',
    '几户农家散落道旁，炊烟与谷仓可作行军参照。',
  );

  const towerX = rng.int(4, 6);
  const towerY = rng.pick([0, 7]);
  addLandmark(
    draft,
    towerX,
    towerY,
    'watchtower',
    '烽燧',
    '土台上的烽燧，早已不复当年烟火。',
  );

  addLandmark(draft, 6, gateY, 'banner', '军旗', '城门外插着的守军旗号。');
}

function genRiver(draft: BattlefieldDraft, rng: FieldRng, variant: number): void {
  const riverX = 3;
  for (let y = 0; y < H; y++) {
    setTile(draft, riverX, y, 'water');
    setTile(draft, riverX + 1, y, 'water');
  }

  const mainY = 3 + (variant % 2);
  const fordY = mainY === 3 ? 6 : 1;

  addBridge(draft, riverX, mainY);
  addBridge(draft, riverX + 1, mainY);
  addFord(draft, riverX, fordY);
  addFord(draft, riverX + 1, fordY);

  // 河岸芦苇与矮林，只落在上游，避免堵住下游浅滩
  for (const y of [0, 1, 2]) {
    if (rng.chance(0.65)) setTile(draft, riverX - 1, y, 'forest');
    if (rng.chance(0.55)) setTile(draft, riverX + 2, y, 'forest');
  }

  // 城下柳林：给攻方一处可以借以遮蔽、重整阵形的落脚点
  setTile(draft, 7, 5, 'forest', true);
  setTile(draft, 8, 5, 'forest', true);

  roadToGate(draft, mainY);

  addLandmark(
    draft,
    rng.int(1, 2),
    mainY === 3 ? 1 : 6,
    'village',
    '渡口村落',
    '靠摆渡为生的几户人家，屋后晾着渔网。',
  );

  addLandmark(
    draft,
    riverX + 2,
    fordY === 1 ? 2 : 5,
    'watchtower',
    '渡口哨塔',
    '守军在此监视河面与浅滩动静。',
  );
}

function genPass(draft: BattlefieldDraft, rng: FieldRng, variant: number): void {
  const ridgeX = 4;
  const passY = 2 + (variant % 3);
  const passRows = new Set([passY, passY + 1]);
  const flankY = passY === 2 ? 7 : 0;

  for (let y = 0; y < H; y++) {
    if (passRows.has(y) || y === flankY) continue;
    setTile(draft, ridgeX, y, 'mountain');
    if (rng.chance(0.55)) setTile(draft, ridgeX - 1, y, 'mountain');
    if (rng.chance(0.35)) setTile(draft, ridgeX + 1, y, 'mountain');
  }

  // 山脚疏林
  for (const y of [0, 2, 5, 7]) {
    if (rng.chance(0.55)) setTile(draft, ridgeX - 2, y, 'forest');
    if (rng.chance(0.4)) setTile(draft, ridgeX + 2, y, 'forest');
  }

  roadToGate(draft, passY);
  addLandmark(
    draft,
    ridgeX,
    passY,
    'pass',
    '关隘',
    '两侧山岭难越，这座关隘是唯一快路。',
  );
  addLandmark(
    draft,
    ridgeX + 1,
    passY === 0 ? 1 : passY - 1,
    'watchtower',
    '关楼',
    '关楼上的守军可以俯瞰整条山道。',
  );
  addLandmark(draft, 6, passY <= 3 ? 3 : 4, 'banner', '关旗', '关隘上飘着的守军旗。');
}

function genGorge(draft: BattlefieldDraft, rng: FieldRng, variant: number): void {
  // 上下两条山壁，中间留出狭长走廊
  for (let x = 0; x < W; x++) {
    if (rng.chance(0.82)) setTile(draft, x, 0, 'mountain');
    if (rng.chance(0.62)) setTile(draft, x, 1, 'mountain');
    if (rng.chance(0.62)) setTile(draft, x, 6, 'mountain');
    if (rng.chance(0.82)) setTile(draft, x, 7, 'mountain');
  }

  // 山脚树林与散落岩块
  for (let x = 1; x < W - 1; x++) {
    if (rng.chance(0.3)) setTile(draft, x, 2, 'forest');
    if (rng.chance(0.3)) setTile(draft, x, 5, 'forest');
  }
  for (let i = 0; i < 3; i++) {
    setTile(draft, rng.int(2, 9), rng.pick([2, 5]), 'mountain');
  }

  const roadY = 3 + (variant % 2);
  roadToGate(draft, roadY);
  addLandmark(
    draft,
    2,
    roadY,
    'pass',
    '峡口栈道',
    '贴着绝壁修出的栈道，窄处只容一军通过。',
  );
  addLandmark(draft, 6, roadY <= 3 ? 3 : 4, 'banner', '峡口旗', '峡口高处插着的军旗。');
}

function genForest(draft: BattlefieldDraft, rng: FieldRng, variant: number): void {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (isReserved(x, y)) continue;
      if (rng.chance(0.42)) setTile(draft, x, y, 'forest');
    }
  }

  // 中央林间空地
  paintCluster(draft, 2, 3, 2, 2, 'plain', true);
  paintCluster(draft, 5, 2, 2, 3, 'plain', true);

  const roadY = 3 + (variant % 2);
  roadToGate(draft, roadY);
  addRoad(draft, 1, 5);
  addRoad(draft, 2, 5);
  addRoad(draft, 3, 5);
  addRoad(draft, 4, 4);
  addRoad(draft, 4, 3);
  addRoad(draft, 5, 3);

  addLandmark(
    draft,
    rng.pick([2, 3]),
    rng.pick([0, 6]),
    'temple',
    '山神庙',
    '密林深处的山神庙，香火未绝。',
  );
  addLandmark(
    draft,
    rng.pick([4, 5]),
    rng.pick([1, 6]),
    'village',
    '猎户村',
    '靠山吃山的猎户村落，屋前晾着兽皮。',
  );
  addLandmark(draft, 6, roadY <= 3 ? 3 : 4, 'banner', '林间旗', '挂在树梢上的军旗。');
}

function genWatertown(draft: BattlefieldDraft, rng: FieldRng, _variant: number): void {
  // 一条纵向水道 + 几片池塘，形成“堤桥相连”的水乡
  for (let y = 0; y < H; y++) setTile(draft, 3, y, 'water');

  const ponds: Array<[number, number, number, number]> = [
    [1, 1, 2, 2],
    [6, 0, 2, 2],
    [9, 5, 2, 2],
    [2, 5, 2, 1],
  ];
  for (const [x, y, w, h] of ponds) {
    if (!rng.chance(0.85)) continue;
    paintCluster(draft, x, y, w, h, 'water');
  }

  const bridgeRows = [3, 4, 6];
  for (const y of bridgeRows) {
    addBridge(draft, 3, y, '石桥');
    if (rng.chance(0.55)) addFord(draft, 4, y);
  }

  // 水岸芦苇
  for (let y = 0; y < H; y++) {
    if (rng.chance(0.4)) setTile(draft, 2, y, 'forest');
    if (rng.chance(0.4)) setTile(draft, 4, y, 'forest');
  }

  roadToGate(draft, 4);
  addRoad(draft, 1, 5);
  addRoad(draft, 2, 5);
  addRoad(draft, 4, 5);
  addRoad(draft, 5, 5);

  addLandmark(
    draft,
    rng.pick([1, 2]),
    rng.pick([1, 6]),
    'village',
    '水乡村落',
    '临水而建的村落，门前就是小码头。',
  );
  addLandmark(
    draft,
    rng.pick([5, 6]),
    rng.pick([0, 6]),
    'temple',
    '水神庙',
    '水乡人家供奉的水神庙。',
  );
  addLandmark(draft, 6, 4, 'banner', '水寨旗', '堤桥边插着的守军旗。');
}

function genLake(draft: BattlefieldDraft, rng: FieldRng, variant: number): void {
  // 上下两片大水面，中间留出湖堤走廊
  for (let x = 2; x < W; x++) {
    if (x === SUPPLY_X) continue;
    if (rng.chance(0.9)) setTile(draft, x, 0, 'water');
    if (rng.chance(0.65)) setTile(draft, x, 1, 'water');
  }
  for (let x = 0; x < 7; x++) {
    if (rng.chance(0.65)) setTile(draft, x, 6, 'water');
    if (rng.chance(0.9)) setTile(draft, x, 7, 'water');
  }

  // 湖心小洲与岸边芦苇
  paintCluster(draft, 9, 1, 2, 1, 'plain', true);
  for (let x = 0; x < W; x++) {
    if (rng.chance(0.32)) setTile(draft, x, 2, 'forest');
    if (rng.chance(0.32)) setTile(draft, x, 5, 'forest');
  }

  const roadY = 3 + (variant % 2);
  roadToGate(draft, roadY);
  addLandmark(
    draft,
    rng.pick([4, 5]),
    roadY,
    'watchtower',
    '湖堤哨塔',
    '哨塔立在长堤上，可以远望湖面。',
  );
  addLandmark(
    draft,
    9,
    1,
    'temple',
    '湖心庙',
    '湖心小洲上的旧庙，只有枯水时才能走到。',
  );
  addLandmark(draft, 6, roadY <= 3 ? 3 : 4, 'banner', '湖防旗', '湖堤守军的旗号。');
}

function genCity(draft: BattlefieldDraft, rng: FieldRng, variant: number): void {
  // 城郊：整齐的田垄、官道、村落与驿亭
  const hedges = 2 + rng.int(0, 2);
  for (let i = 0; i < hedges; i++) {
    const horizontal = rng.chance(0.5);
    const x = rng.int(1, W - 2);
    const y = rng.int(1, H - 2);
    const len = 2 + rng.int(0, 3);
    for (let j = 0; j < len; j++) {
      setTile(draft, horizontal ? x + j : x, horizontal ? y : y + j, 'forest');
    }
  }

  roadToGate(draft, 4);
  roadToGate(draft, 3);

  addLandmark(
    draft,
    2,
    2,
    'village',
    '城郊村',
    '城门外的小村落，屋舍沿官道排开。',
  );
  addLandmark(
    draft,
    3,
    5,
    'village',
    '田庄',
    '田庄的谷仓与晒场，可供大军临时屯驻。',
  );
  addLandmark(
    draft,
    variant % 2 === 0 ? 1 : 4,
    variant % 2 === 0 ? 6 : 1,
    'temple',
    '驿亭',
    '官道旁的驿亭，四面透风，是传递军情的歇脚处。',
  );
  addLandmark(draft, 6, 3, 'banner', '城防旗', '城门外高插的守军旗。');
  addLandmark(draft, 5, 1, 'watchtower', '望楼', '官道旁的小望楼。');
}

function genRuins(draft: BattlefieldDraft, rng: FieldRng, variant: number): void {
  // 古战场：荒草、断墙与残旗
  for (let i = 0; i < 6; i++) {
    const x = rng.int(0, W - 1);
    const y = rng.int(0, H - 1);
    setTile(draft, x, y, rng.chance(0.65) ? 'forest' : 'mountain');
  }

  roadToGate(draft, 4);
  addRoad(draft, 1, 5);
  addRoad(draft, 2, 5);
  addRoad(draft, 3, 5);

  const ruinSpots: Array<[number, number]> = [
    [2, 1],
    [4, 6],
    [5, 1],
    [1, 6],
  ];
  for (const [x, y] of ruinSpots) {
    addLandmark(draft, x, y, 'ruins', '断墙', '半塌的旧垒，墙根下还埋着断戟。');
  }
  addLandmark(draft, 3, 2, 'banner', '残旗', '风里只剩半面破旗。');
  addLandmark(draft, 6, variant % 2 === 0 ? 3 : 4, 'banner', '军旗', '新插上的军旗。');
}

function genHighland(draft: BattlefieldDraft, rng: FieldRng, variant: number): void {
  // 黄土塬：散落的山岗与沟壑，视野被地形切成几段
  const outcrops = 9 + rng.int(0, 4);
  for (let i = 0; i < outcrops; i++) {
    const x = rng.int(0, W - 1);
    const y = rng.int(0, H - 1);
    paintCluster(draft, x, y, 1 + rng.int(0, 1), 1 + rng.int(0, 1), 'mountain');
  }
  for (let i = 0; i < 3; i++) {
    setTile(draft, rng.int(1, 6), rng.pick([0, 6]), 'forest');
  }

  const roadY = 3 + (variant % 2);
  roadToGate(draft, roadY);
  addLandmark(
    draft,
    rng.pick([2, 3]),
    rng.pick([1, 5]),
    'watchtower',
    '塬上烽燧',
    '黄土塬上的烽燧，可以望出很远。',
  );
  addLandmark(draft, 6, roadY <= 3 ? 3 : 4, 'banner', '塬上旗', '风沙里猎猎作响的军旗。');
}

// ── 主题选择与收尾 ────────────────────────────────────────

function chooseTheme(ctx: BattlefieldContext, identityHash: number): BattlefieldThemeId {
  const special = SPECIAL_BATTLEFIELDS[ctx.targetCityId];
  if (special) return special.theme;

  const roll = identityHash % 100;
  const size = ctx.citySize ?? 'medium';

  if (ctx.isWaterCity) {
    if (roll < 38) return 'river';
    if (roll < 74) return 'watertown';
    return 'lake';
  }
  if (ctx.targetTerrain === 'mountain') {
    if (roll < 40) return 'pass';
    if (roll < 72) return 'gorge';
    return 'highland';
  }
  if (ctx.targetTerrain === 'forest') {
    if (roll < 55) return 'forest';
    if (roll < 80) return 'highland';
    return 'ruins';
  }
  if (ctx.targetTerrain === 'water') {
    if (roll < 45) return 'river';
    if (roll < 80) return 'watertown';
    return 'lake';
  }

  if (size === 'capital') return 'city';
  if (size === 'large' && roll < 34) return 'city';
  if (roll < 12) return 'river';
  if (roll < 28) return 'forest';
  if (roll < 38) return 'ruins';
  if (roll < 46) return 'city';
  return 'farmland';
}

function themeDetails(
  ctx: BattlefieldContext,
  theme: BattlefieldThemeId,
  identityHash: number,
): ThemeSpec {
  const special = SPECIAL_BATTLEFIELDS[ctx.targetCityId];
  if (special && special.theme === theme) {
    return { name: special.name, subtitle: special.subtitle };
  }
  const variants = THEME_VARIANTS[theme];
  return variants[identityHash % variants.length]!;
}

function finalize(draft: BattlefieldDraft): void {
  // 城池格永远固定
  for (let y = CITY_Y0; y <= CITY_Y1; y++) {
    for (let x = CITY_X0; x <= CITY_X1; x++) {
      draft.grid[y]![x] = 'city';
    }
  }

  // 攻方出生点必须是平地，避免开局部队陷在水里
  for (const [x, y] of SPAWN_ATTACKER_CELLS) {
    if (!isCityCell(x, y)) draft.grid[y]![x] = 'plain';
  }

  // 守方出生点如果被水淹，改回平地；森林 / 山地保留，作为守方地形
  for (const [x, y] of SPAWN_DEFENDER_CELLS) {
    if (isCityCell(x, y)) {
      draft.grid[y]![x] = 'city';
    } else if (draft.grid[y]![x] === 'water') {
      draft.grid[y]![x] = 'plain';
    }
  }

  // 粮仓与中央交战区保持开阔
  for (const [x, y] of OPEN_CORRIDOR) {
    if (!isCityCell(x, y)) draft.grid[y]![x] = 'plain';
  }
  draft.grid[SUPPLY_Y]![SUPPLY_X] = 'plain';

  // 清理落在城池上的道路 / 地标
  draft.features = draft.features.filter(
    (f) => inBounds(f.x, f.y) && !isCityCell(f.x, f.y),
  );
}

function generatorFor(theme: BattlefieldThemeId): (
  draft: BattlefieldDraft,
  rng: FieldRng,
  variant: number,
) => void {
  switch (theme) {
    case 'river':
      return genRiver;
    case 'pass':
      return genPass;
    case 'gorge':
      return genGorge;
    case 'forest':
      return genForest;
    case 'watertown':
      return genWatertown;
    case 'lake':
      return genLake;
    case 'city':
      return genCity;
    case 'ruins':
      return genRuins;
    case 'highland':
      return genHighland;
    case 'farmland':
    default:
      return genFarmland;
  }
}

/**
 * 只取战场身份（主题 / 专名 / 氛围），不生成 12×8 战术图。
 * 大地图战斗直接使用真实地形，但仍沿用同一套历史专名。
 */
export function identityOfBattlefield(ctx: BattlefieldContext): {
  theme: BattlefieldThemeId;
  name: string;
  subtitle: string;
} {
  const identityHash = hashParts([
    ctx.targetCityId,
    ctx.targetTerrain,
    ctx.isWaterCity ? 'water' : 'land',
    ctx.citySize ?? 'medium',
  ]);
  const theme = chooseTheme(ctx, identityHash);
  const details = themeDetails(ctx, theme, identityHash);
  return { theme, name: details.name, subtitle: details.subtitle };
}

/**
 * 生成一场战斗的战场。种子由 runSeed / 回合 / battleSerial / 攻守城共同决定，
 * 同一上下文可复现；不消耗战斗随机流。
 *
 * @deprecated 大地图战斗已直接使用 `terrainGrid`，此生成器仅保留给旧存档与测试。
 */
export function buildBattlefield(ctx: BattlefieldContext): BattlefieldResult {
  const identityHash = hashParts([
    ctx.targetCityId,
    ctx.targetTerrain,
    ctx.isWaterCity ? 'water' : 'land',
    ctx.citySize ?? 'medium',
  ]);
  const theme = chooseTheme(ctx, identityHash);
  const details = themeDetails(ctx, theme, identityHash);

  const layoutSeed = hashParts([
    ctx.seed,
    ctx.turn,
    ctx.battleSerial,
    ctx.attackerCityId,
    ctx.defenderCityId,
    ctx.targetCityId,
    'battlefield',
  ]);
  const rng = new FieldRng(layoutSeed);
  const variant = layoutSeed % 3;

  const draft: BattlefieldDraft = { grid: blankGrid(), features: [] };
  generatorFor(theme)(draft, rng, variant);

  // L 档「地图裁切战」：地形取自大地图真实栅格，主题专名与地标继续沿用。
  // 裁切层会强制城池格 / 出生点 / 中央通道，并在水域切断时架浮桥。
  const slice = sliceBattlefieldFromMap(ctx.targetCityId, ctx.attackerCityId);
  if (slice) {
    const keepLandmarks = draft.features.filter(
      (f) => slice.grid[f.y]?.[f.x] !== 'water' && !isCityCell(f.x, f.y),
    );
    draft.grid = slice.grid;
    draft.features = [
      ...keepLandmarks,
      ...slice.features.filter(
        (f) => !keepLandmarks.some((k) => k.x === f.x && k.y === f.y && k.kind === f.kind),
      ),
    ];
  }
  finalize(draft);

  return {
    grid: draft.grid,
    battlefield: {
      theme,
      name: details.name,
      subtitle: details.subtitle,
      features: draft.features,
    },
  };
}

/** 按现有 grid 推断主题，供旧存档或缺少 battlefield 字段时兜底。 */
export function inferBattlefieldTheme(grid: BattleTerrain[][]): BattlefieldThemeId {
  let water = 0;
  let mountain = 0;
  let forest = 0;
  for (const row of grid) {
    for (const t of row) {
      if (t === 'water') water++;
      else if (t === 'mountain') mountain++;
      else if (t === 'forest') forest++;
    }
  }
  if (water >= 6) return 'river';
  if (mountain >= 5) return 'pass';
  if (forest >= 8) return 'forest';
  return 'farmland';
}

/**
 * 旧战斗存档没有 battlefield 字段：按旧 grid 推断主题并补一个专名，
 * 不改变已经生成的地形与单位位置。
 */
export function describeLegacyBattlefield(
  targetCityId: string,
  targetCityName: string,
  targetTerrain: Terrain,
  isWaterCity: boolean | undefined,
  grid: BattleTerrain[][],
): BattlefieldInfo {
  const theme = inferBattlefieldTheme(grid);
  const identityHash = hashParts([
    targetCityId,
    targetCityName,
    targetTerrain,
    isWaterCity ? 'water' : 'land',
  ]);
  const variants = THEME_VARIANTS[theme];
  const details = variants[identityHash % variants.length]!;
  return {
    theme,
    name: details.name,
    subtitle: details.subtitle,
  };
}
