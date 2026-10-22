import type { GameState } from '../core/state';
import { migrateSave } from './migrate';

export const SAVE_VERSION = 3;
export const DB_NAME = 'sanguo-baye';
export const STORE_NAME = 'saves';

/** 【优化】§6.4 平衡预设：classic 锁原版参数，balanced 走校准值 */
export interface SavePresets {
  balance: 'classic' | 'balanced';
  rules: Record<string, boolean>;
}

export interface SaveFile {
  schemaVersion: number;
  createdAt: number;
  label: string;
  runSeed: number;
  turn: number;
  presets: SavePresets;
  state: GameState;
}

/** 磁盘上的原始行：兼容 v2 及更早的 `version` 字段 */
interface StoredSaveFile {
  slot: string;
  schemaVersion?: number;
  /** v2 及更早 */
  version?: number;
  createdAt: number;
  label: string;
  runSeed?: number;
  turn?: number;
  presets?: SavePresets;
  state: GameState;
}

export function defaultPresets(state: GameState): SavePresets {
  return {
    balance: 'balanced',
    rules: {
      safeOverflow: (state.settings?.overflowMode ?? 'safe') === 'safe',
      classicSpawn: state.settings?.classicSpawn ?? false,
    },
  };
}

/**
 * 版本迁移链：每个函数只负责“上一版 → 下一版”，失败时抛明确错误。
 * 当前只有 v2 → v3（随机数分流 + 顶层 runSeed / presets）。
 */
const migrations: Record<number, (file: StoredSaveFile) => StoredSaveFile> = {
  2: (file) => ({
    ...file,
    schemaVersion: 3,
    runSeed: file.runSeed ?? file.state.seed,
    turn: file.turn ?? file.state.turn,
    presets: file.presets ?? defaultPresets(file.state),
  }),
};

export function migrateSaveFile(row: StoredSaveFile): SaveFile {
  const from = row.schemaVersion ?? row.version ?? 0;
  if (from > SAVE_VERSION) {
    throw new Error('存档来自更高版本，请更新游戏后再读取');
  }

  let file = row;
  let version = from;
  while (version < SAVE_VERSION) {
    const step = migrations[version];
    if (!step) {
      throw new Error(`存档缺少 v${version} → v${version + 1} 的迁移，无法读取`);
    }
    file = step(file);
    version = file.schemaVersion ?? version + 1;
  }

  const state = migrateSave(file.state);
  return {
    schemaVersion: SAVE_VERSION,
    createdAt: file.createdAt,
    label: file.label,
    runSeed: file.runSeed ?? state.seed,
    turn: file.turn ?? state.turn,
    presets: file.presets ?? defaultPresets(state),
    state,
  };
}

export interface SaveSlotInfo {
  slot: string;
  label: string;
  createdAt: number;
  year: number;
  month: number;
  factionName: string;
}

/** 复用同一个连接，避免每次读写都走一遍 open/close。 */
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前环境不支持 IndexedDB'));
      return;
    }

    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'slot' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // 其他标签页升级数据库时主动让路，下次操作会重新打开
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 打开失败'));
    req.onblocked = () => reject(new Error('存档数据库被其他标签页占用'));
  });

  // 打开失败时清掉缓存，允许后续重试
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        let result!: T;
        let requestError: DOMException | null = null;
        let settled = false;

        const succeed = (): void => {
          if (settled) return;
          settled = true;
          resolve(result);
        };
        const abortWith = (reason: unknown): void => {
          if (settled) return;
          settled = true;
          reject(reason);
        };

        let t: IDBTransaction;
        try {
          t = db.transaction(STORE_NAME, mode);
        } catch (e) {
          reject(e);
          return;
        }

        t.oncomplete = succeed;
        t.onerror = () =>
          abortWith(requestError ?? t.error ?? new Error('存档操作失败'));
        t.onabort = () => abortWith(t.error ?? new Error('存档事务已中止'));

        let req: IDBRequest<T>;
        try {
          req = run(t.objectStore(STORE_NAME));
        } catch (e) {
          abortWith(e);
          try {
            t.abort();
          } catch {
            // transaction 可能已经结束，忽略
          }
          return;
        }
        req.onsuccess = () => {
          result = req.result;
        };
        req.onerror = () => {
          requestError = req.error;
        };
      }),
  );
}

export async function putSave(slot: string, state: GameState, label: string): Promise<void> {
  const file: SaveFile & { slot: string } = {
    slot,
    schemaVersion: SAVE_VERSION,
    runSeed: state.seed,
    turn: state.turn,
    presets: defaultPresets(state),
    createdAt: Date.now(),
    label,
    state,
  };
  await tx('readwrite', (store) => store.put(file));
}

export async function getSave(slot: string): Promise<SaveFile | null> {
  const row = await tx<StoredSaveFile | undefined>('readonly', (store) => store.get(slot));
  if (!row) return null;
  return migrateSaveFile(row);
}

export async function listSaves(): Promise<SaveSlotInfo[]> {
  const rows = await tx<StoredSaveFile[]>('readonly', (store) => store.getAll());
  return rows
    .filter((r) => {
      const version = r.schemaVersion ?? r.version ?? 0;
      return version >= 1 && version <= SAVE_VERSION;
    })
    .sort((a, b) => a.slot.localeCompare(b.slot))
    .map((r) => ({
      slot: r.slot,
      label: r.label,
      createdAt: r.createdAt,
      year: r.state.year,
      month: r.state.month,
      factionName: r.state.factions[r.state.playerFactionId]?.name ?? '未知势力',
    }));
}

export async function deleteSave(slot: string): Promise<void> {
  await tx('readwrite', (store) => store.delete(slot));
}
