/**
 * 配置持久化：localStorage 存档 + JSON 文件导入导出。
 *
 * - localStorage 是「继续编辑」的快捷方式，键名固定为 `sanguo.map-config.v1`；
 * - JSON 文件才是可移交、可入库、可 diff 的正式产物；
 * - 两者内容完全一致，导入时走同一套 zod + 业务校验。
 */
import { parseDocument, serializeDocument } from './schema';
import { STORAGE_KEY, type MapDocument } from './types';

export interface LoadResult {
  doc: MapDocument | null;
  error: string | null;
}

export function loadStored(): LoadResult {
  if (typeof localStorage === 'undefined') return { doc: null, error: null };
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { doc: null, error: null };
  try {
    return { doc: parseDocument(JSON.parse(raw)), error: null };
  } catch (error) {
    return {
      doc: null,
      error: error instanceof Error ? error.message : '本地存档无法解析',
    };
  }
}

export function saveStored(doc: MapDocument): MapDocument {
  // 保存前先过一遍完整校验：空名称、越界坐标等不能写进本地存档，
  // 否则下次打开会解析失败并退回内置基线，等于丢改动。
  const valid = parseDocument(doc);
  const next: MapDocument = { ...valid, meta: { ...valid.meta, updatedAt: new Date().toISOString() } };
  localStorage.setItem(STORAGE_KEY, serializeDocument(next));
  return next;
}

function stamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export function downloadDocument(doc: MapDocument): void {
  const valid = parseDocument(doc);
  const blob = new Blob([serializeDocument(valid)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sanguo-map-config-v1-${stamp()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function readDocumentFile(file: File): Promise<MapDocument> {
  const text = await file.text();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('不是合法的 JSON 文件');
  }
  return parseDocument(raw);
}

export function clearStored(): void {
  localStorage.removeItem(STORAGE_KEY);
}
