import type { GameState } from '../core/state';

export const SAVE_VERSION = 2;
export const DB_NAME = 'sanguo-baye';
export const STORE_NAME = 'saves';

export interface SaveFile {
  version: number;
  createdAt: number;
  label: string;
  state: GameState;
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
    version: SAVE_VERSION,
    createdAt: Date.now(),
    label,
    state,
  };
  await tx('readwrite', (store) => store.put(file));
}

export async function getSave(slot: string): Promise<SaveFile | null> {
  const row = await tx<((SaveFile & { slot: string }) | undefined)>('readonly', (store) =>
    store.get(slot),
  );
  if (!row) return null;
  if (row.version > SAVE_VERSION) {
    throw new Error('存档来自更高版本，请更新游戏后再读取');
  }
  if (row.version < SAVE_VERSION) {
    throw new Error('存档来自旧版本（11 城数据），请开始新游戏');
  }
  return row;
}

export async function listSaves(): Promise<SaveSlotInfo[]> {
  const rows = await tx<Array<SaveFile & { slot: string }>>('readonly', (store) =>
    store.getAll(),
  );
  return rows
    .filter((r) => r.version === SAVE_VERSION)
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
