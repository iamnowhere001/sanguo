/**
 * 大地图配置台
 *
 * 三栏结构：左「元素清单」、中「地图画布」、右「属性检查器」。
 * 所有修改先落到内存文档，显式保存后写 localStorage；导出 JSON 是正式产物。
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  CITY_SIZE_LABEL,
  CITY_TERRAIN_LABEL,
  ELEMENT_KINDS,
  ELEMENT_META,
  PASS_KIND_LABEL,
  TIER_LABEL,
  WORLD,
  allIds,
  appendElement,
  clamp,
  clampWorld,
  countOf,
  findElement,
  lonLatOf,
  makeElement,
  nextId,
  removeElement,
  round1,
  sameRef,
  tileOf,
  validateDocument,
  withElement,
  type AnyElement,
  type CityNode,
  type CitySize,
  type CityTerrain,
  type ElementKind,
  type FerryNode,
  type LakeNode,
  type MapDocument,
  type PassKind,
  type PassNode,
  type RangeNode,
  type Ref,
  type RiverNode,
  type RoadNode,
  type Tier,
  type XY,
} from './types';
import { buildSeedDocument } from './seed';
import { downloadDocument, loadStored, readDocumentFile, saveStored } from './storage';
import { terrainIssues, terrainSummary, type TerrainIssue } from './terrain';
import { loadStrictRuntime, type StrictIssue, type StrictRuntime, type StrictState } from './strict';
import type { StructBuild, StructIssue } from './gateBuild';
import type { GateSite } from '../render/gateGrid';
import { snapFerry, snapFerryPair, snapPass, snapRefs } from './snap';
import {
  clampView,
  drawMap,
  fitView,
  pickAt,
  pickVertex,
  toScreen,
  toWorld,
  zoomAt,
  type MapView,
  type Viewport,
} from './render';
import './studio.css';

type Source = 'seed' | 'stored' | 'imported';
type Filter = ElementKind | 'all';
type ToastTone = 'ok' | 'warn' | 'bad';

type DragState =
  | { mode: 'pan'; sx: number; sy: number; start: MapView }
  | { mode: 'point'; ref: Ref; dx: number; dy: number; snapshot: MapDocument }
  | { mode: 'vertex'; ref: Ref; index: number; snapshot: MapDocument };

interface ToastState {
  text: string;
  tone: ToastTone;
}

const SOURCE_LABEL: Record<Source, string> = {
  seed: '内置基线',
  stored: '本地存档',
  imported: '导入文件',
};

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function coordText(x: number, y: number): string {
  return `x ${x.toFixed(0)} · y ${y.toFixed(0)}`;
}

function elementName(el: AnyElement, doc: MapDocument): string {
  if ('name' in el) return el.name;
  const from = doc.cities.find((c) => c.id === (el as RoadNode).from)?.name ?? (el as RoadNode).from;
  const to = doc.cities.find((c) => c.id === (el as RoadNode).to)?.name ?? (el as RoadNode).to;
  return `${from} → ${to}`;
}

export default function MapStudio() {
  const [boot] = useState(() => {
    const loaded = loadStored();
    return {
      doc: loaded.doc ?? buildSeedDocument(),
      source: (loaded.doc ? 'stored' : 'seed') as Source,
      error: loaded.error,
    };
  });

  const [doc, setDoc] = useState<MapDocument>(boot.doc);
  const [source, setSource] = useState<Source>(boot.source);
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState<Ref | null>(null);
  const [hover, setHover] = useState<Ref | null>(null);
  const [filter, setFilter] = useState<Filter>('city');
  const [query, setQuery] = useState('');
  const [showLabels, setShowLabels] = useState(true);
  const [showRoads, setShowRoads] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [showTerrainFlags, setShowTerrainFlags] = useState(true);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [strictState, setStrictState] = useState<StrictState>('idle');
  const [strictIssues, setStrictIssues] = useState<StrictIssue[]>([]);
  const [strictError, setStrictError] = useState<string | null>(null);
  const [structState, setStructState] = useState<'idle' | 'running' | 'ready' | 'error'>('idle');
  const [structBuild, setStructBuild] = useState<StructBuild | null>(null);
  const [structError, setStructError] = useState<string | null>(null);
  const [structDoc, setStructDoc] = useState<MapDocument | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [preview, setPreview] = useState<{ doc: MapDocument; note: string | null } | null>(null);

  const [past, setPast] = useState<MapDocument[]>([]);
  const [future, setFuture] = useState<MapDocument[]>([]);
  const lastEdit = useRef<{ tag: string; at: number } | null>(null);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const strictRuntime = useRef<StrictRuntime | null>(null);
  const docRef = useRef(doc);
  docRef.current = doc;
  const toastTimer = useRef<number | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const spaceRef = useRef(false);
  const [spaceDown, setSpaceDown] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [vp, setVp] = useState<Viewport>({ width: 0, height: 0 });
  const [view, setView] = useState<MapView | null>(null);
  const [cursor, setCursor] = useState<XY | null>(null);

  const notify = (text: string, tone: ToastTone = 'ok') => {
    setToast({ text, tone });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2800);
  };

  useEffect(() => {
    if (boot.error) notify(boot.error, 'bad');
  }, [boot.error]);

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, []);

  const mutate = (next: MapDocument, tag: string) => {
    const now = Date.now();
    const last = lastEdit.current;
    if (!last || last.tag !== tag || now - last.at > 900) {
      setPast((p) => [...p, doc].slice(-60));
      setFuture([]);
    }
    lastEdit.current = { tag, at: now };
    setDoc(next);
    setDirty(true);
  };

  const undo = () => {
    if (!past.length) return;
    const prev = past[past.length - 1]!;
    setPast(past.slice(0, -1));
    setFuture([doc, ...future].slice(0, 60));
    setDoc(prev);
    setDirty(true);
    lastEdit.current = null;
  };

  const redo = () => {
    if (!future.length) return;
    const next = future[0]!;
    setFuture(future.slice(1));
    setPast((p) => [...p, doc].slice(-60));
    setDoc(next);
    setDirty(true);
    lastEdit.current = null;
  };

  const selectedEl = selected ? findElement(doc, selected) : null;

  const structureIssues = useMemo(() => validateDocument(doc), [doc]);
  const terrain = useMemo(() => terrainIssues(doc), [doc]);
  const terrainKeys = useMemo(
    () => new Set(terrain.map((issue) => `${issue.ref.kind}:${issue.ref.id}`)),
    [terrain],
  );
  const strictKeys = useMemo(
    () => new Set(strictIssues.map((issue) => `${issue.ref.kind}:${issue.ref.id}`)),
    [strictIssues],
  );
  const structIssues = structBuild?.issues ?? [];
  const structKeys = useMemo(
    () => new Set(structIssues.map((issue) => `${issue.ref.kind}:${issue.ref.id}`)),
    [structIssues],
  );
  const issueKeys = useMemo(
    () => new Set([...terrainKeys, ...strictKeys, ...structKeys]),
    [terrainKeys, strictKeys, structKeys],
  );
  const strictSelected = useMemo(
    () =>
      selected
        ? strictIssues.find((i) => i.ref.kind === selected.kind && i.ref.id === selected.id) ?? null
        : null,
    [selected, strictIssues],
  );
  const structStale = structState === 'ready' && structDoc !== doc;
  const structSelected = useMemo(
    () =>
      selected
        ? structIssues.filter((i) => i.ref.kind === selected.kind && i.ref.id === selected.id)
        : [],
    [selected, structIssues],
  );
  /** 结构重建的 lane / 门洞叠加层（世界坐标） */
  const structOverlay = useMemo(() => {
    if (structState !== 'ready' || !structBuild) return undefined;
    const lanes: XY[] = [];
    const icons: XY[] = [];
    for (const site of Object.values(structBuild.sites)) {
      for (const p of site.lane) lanes.push({ x: (p.col + 0.5) * WORLD.tile, y: (p.row + 0.5) * WORLD.tile });
      icons.push({ x: (site.icon.col + 0.5) * WORLD.tile, y: (site.icon.row + 0.5) * WORLD.tile });
    }
    return { lanes, icons };
  }, [structState, structBuild]);

  useEffect(() => {
    if (selected && !findElement(doc, selected)) setSelected(null);
  }, [doc, selected]);

  // 严格校验加载后，拖动 / 改坐标会即时重算；未加载时不产生任何开销
  useEffect(() => {
    if (strictState !== 'ready' || !strictRuntime.current) return;
    setStrictIssues(strictRuntime.current.check(doc));
  }, [doc, strictState]);

  // ── 视口 ─────────────────────────────────────────────────
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setVp({ width: Math.round(rect.width), height: Math.round(rect.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!view && vp.width > 0 && vp.height > 0) setView(fitView(vp, 22));
  }, [view, vp]);

  useEffect(() => {
    setView((v) => (v ? clampView(v, vp) : v));
  }, [vp]);

  // ── 绘制 ─────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !view || vp.width === 0 || vp.height === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(vp.width * dpr);
    canvas.height = Math.round(vp.height * dpr);
    canvas.style.width = `${vp.width}px`;
    canvas.style.height = `${vp.height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawMap(ctx, doc, view, vp, {
      selected,
      hover,
      showLabels,
      showRoads,
      showGrid,
      flagged: showTerrainFlags ? terrainKeys : undefined,
      strictFlagged: strictState === 'ready' ? strictKeys : undefined,
      struct: structOverlay,
    });
  }, [
    doc,
    view,
    vp,
    selected,
    hover,
    showLabels,
    showRoads,
    showGrid,
    showTerrainFlags,
    terrainKeys,
    strictState,
    strictKeys,
    structOverlay,
  ]);

  // ── 保存 / 导出 / 导入 ───────────────────────────────────
  const saveNow = () => {
    try {
      const next = saveStored(doc);
      setDoc(next);
      setDirty(false);
      setSource('stored');
      notify('已保存到本地存档');
    } catch (error) {
      notify(error instanceof Error ? error.message : '保存失败', 'bad');
    }
  };

  const exportJson = () => {
    try {
      downloadDocument(doc);
      notify('已导出 JSON');
    } catch (error) {
      notify(error instanceof Error ? error.message : '导出失败', 'bad');
    }
  };

  const onImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const imported = await readDocumentFile(file);
      setDoc(imported);
      setSource('imported');
      setDirty(true);
      setPast([]);
      setFuture([]);
      setSelected(null);
      notify(`已导入 ${file.name}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : '导入失败', 'bad');
    }
  };

  const resetToSeed = () => {
    setDoc(buildSeedDocument());
    setSource('seed');
    setDirty(true);
    setPast([]);
    setFuture([]);
    setSelected(null);
    notify('已回到内置基线', 'warn');
  };

  const openPreview = () => {
    const stored = loadStored();
    const saved = stored.doc;
    const note = dirty
      ? saved
        ? '当前有未保存修改，预览与导出使用上一次保存的本地存档。'
        : '当前修改尚未保存，预览使用内置基线；先保存可发布你的版本。'
      : saved
        ? null
        : '尚未保存过，预览使用内置基线。';
    setPreview({ doc: saved ?? doc, note });
  };

  // ── 元素操作 ─────────────────────────────────────────────
  const addElement = () => {
    const kind: ElementKind = filter === 'all' ? 'city' : filter;
    const center = view ? toWorld(view, vp.width / 2, vp.height / 2) : { x: WORLD.width / 2, y: WORLD.height / 2 };
    const offset = (countOf(doc, kind) % 6) * 16;
    const id = nextId(ELEMENT_META[kind].prefix, allIds(doc));
    const element = makeElement(kind, { x: center.x + offset, y: center.y + offset }, id, doc);
    mutate(appendElement(doc, kind, element), `add:${id}`);
    setFilter(kind);
    setSelected({ kind, id });
    notify(`已新增${ELEMENT_META[kind].label}`);
  };

  const deleteSelected = () => {
    if (!selected) return;
    const el = findElement(doc, selected);
    if (!el) return;
    mutate(removeElement(doc, selected), `delete:${selected.id}`);
    setSelected(null);
    notify(`已删除「${elementName(el, doc)}」`, 'warn');
  };

  const updateElement = (kind: ElementKind, element: AnyElement, tag: string) => {
    mutate(withElement(doc, kind, element), tag);
  };

  const centerOf = (el: AnyElement): XY | null => {
    if ('x' in el) return { x: el.x, y: el.y };
    if ('cx' in el) return { x: el.cx, y: el.cy };
    if ('points' in el && el.points.length > 0) {
      const total = el.points.reduce((sum, p) => ({ x: sum.x + p.x, y: sum.y + p.y }), { x: 0, y: 0 });
      return { x: total.x / el.points.length, y: total.y / el.points.length };
    }
    const road = el as RoadNode;
    const a = doc.cities.find((c) => c.id === road.from);
    const b = doc.cities.find((c) => c.id === road.to);
    if (a && b) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    return null;
  };

  // ── 严格校验 / 吸附 ─────────────────────────────────────
  const strictAccept =
    strictState === 'ready' && strictRuntime.current
      ? (kind: 'pass' | 'ferry', p: XY) => strictRuntime.current!.accept(kind, p)
      : undefined;
  const strictSeparated =
    strictState === 'ready' && strictRuntime.current
      ? (a: XY, b: XY) => strictRuntime.current!.separated(a, b)
      : undefined;

  const runStrict = async () => {
    if (strictState === 'loading') return;
    if (strictRuntime.current) {
      setStrictState('ready');
      setStrictIssues(strictRuntime.current.check(docRef.current));
      return;
    }
    setStrictState('loading');
    setStrictError(null);
    try {
      const runtime = await loadStrictRuntime();
      strictRuntime.current = runtime;
      setStrictIssues(runtime.check(docRef.current));
      setStrictState('ready');
      notify('运行时地形已加载（576×360）');
    } catch (error) {
      setStrictState('error');
      setStrictError(error instanceof Error ? error.message : '运行时地形加载失败');
    }
  };

  const disableStrict = () => {
    setStrictState('idle');
    setStrictIssues([]);
    setStrictError(null);
  };

  // ── 关防结构重建（面板版 map:gates）─────────────────────
  const runStruct = () => {
    if (structState === 'running') return;
    setStructState('running');
    setStructError(null);
    // 先让 loading 画出来：重建是同步的，约 1.5 秒
    window.setTimeout(() => {
      const snapshot = docRef.current;
      void (async () => {
        try {
          const { runStructBuild } = await import('./gateBuild');
          const build = runStructBuild(snapshot);
          setStructBuild(build);
          setStructDoc(snapshot);
          setStructState('ready');
          notify(
            `结构重建完成：${Object.keys(build.sites).length} 处落位 · ${build.issues.length} 项问题`,
            build.issues.length || build.failures.length ? 'warn' : 'ok',
          );
        } catch (error) {
          setStructState('error');
          setStructError(error instanceof Error ? error.message : '结构重建失败');
        }
      })();
    }, 16);
  };

  /** 把文档点位挪到重建后的门洞 / 滩头，消除「锚点在水里」这类提示 */
  const adoptStruct = (ref: Ref, site: GateSite) => {
    const element = findElement(doc, ref);
    if (!element || !('x' in element)) return;
    const x = (site.icon.col + 0.5) * WORLD.tile;
    const y = (site.icon.row + 0.5) * WORLD.tile;
    mutate(withElement(doc, ref.kind, { ...element, x, y } as AnyElement), `adopt:${ref.id}`);
    notify('已采用落位坐标');
  };

  const disableStruct = () => {
    setStructState('idle');
    setStructBuild(null);
    setStructDoc(null);
    setStructError(null);
  };

  const snapSelected = () => {
    if (!selected || !selectedEl) return;
    if (selected.kind === 'pass') {
      const element = selectedEl as PassNode;
      const p = snapPass(doc, element, strictAccept);
      if (!p) {
        notify('附近 240 单位内找不到同时满足编辑期与运行时地形的山脚', 'warn');
        return;
      }
      if (Math.hypot(p.x - element.x, p.y - element.y) < 0.05) {
        notify('已经在合法位置');
        return;
      }
      mutate(withElement(doc, 'pass', { ...element, x: p.x, y: p.y }), `snap:${element.id}`);
      notify(`已吸附到 (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`);
      return;
    }
    if (selected.kind === 'ferry') {
      const element = selectedEl as FerryNode;
      const twin = element.pairId ? doc.ferries.find((f) => f.id === element.pairId) : undefined;

      if (twin) {
        const pair = snapFerryPair(doc, element, twin, strictAccept, strictSeparated);
        if (!pair) {
          notify('两港在 240 单位内找不到「分居两岸且确实跨水」的一对岸点', 'warn');
          return;
        }
        const [pa, pb] = pair;
        const moveA = Math.hypot(pa.x - element.x, pa.y - element.y) >= 0.05;
        const moveB = Math.hypot(pb.x - twin.x, pb.y - twin.y) >= 0.05;
        if (!moveA && !moveB) {
          notify('两港已在合法位置');
          return;
        }
        let next = doc;
        if (moveA) next = withElement(next, 'ferry', { ...element, x: pa.x, y: pa.y });
        if (moveB) next = withElement(next, 'ferry', { ...twin, x: pb.x, y: pb.y });
        mutate(next, `snap:${element.id}+${twin.id}`);
        notify(`已按岸线法向吸附：${element.name} ↔ ${twin.name}`);
        return;
      }

      const p = snapFerry(doc, element, strictAccept);
      if (!p) {
        notify('附近 240 单位内找不到同时满足编辑期与运行时地形的岸点', 'warn');
        return;
      }
      if (Math.hypot(p.x - element.x, p.y - element.y) < 0.05) {
        notify('已经在合法位置');
        return;
      }
      mutate(withElement(doc, 'ferry', { ...element, x: p.x, y: p.y }), `snap:${element.id}`);
      notify(`已吸附到 (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`);
    }
  };

  const snapAll = () => {
    const refs: Ref[] = [];
    for (const key of issueKeys) {
      const index = key.indexOf(':');
      const kind = key.slice(0, index) as ElementKind;
      const id = key.slice(index + 1);
      if (kind === 'pass' || kind === 'ferry') refs.push({ kind, id });
    }
    if (refs.length === 0) return;

    const result = snapRefs(doc, refs, strictAccept, strictSeparated);
    if (result.moved === 0) {
      notify('没有可吸附的点；请检查对岸约束或手动调整', 'warn');
      return;
    }
    mutate(result.doc, `snap:all:${Date.now()}`);
    const leftTerrain = terrainIssues(result.doc).length;
    const leftStrict =
      strictState === 'ready' && strictRuntime.current
        ? strictRuntime.current.check(result.doc).length
        : null;
    const tail = leftStrict === null ? `地形剩 ${leftTerrain}` : `地形剩 ${leftTerrain} · 严格剩 ${leftStrict}`;
    notify(
      `已吸附 ${result.moved} 处${result.failed ? `，${result.failed} 处失败` : ''}；${tail}`,
      result.failed || leftTerrain || (leftStrict ?? 0) > 0 ? 'warn' : 'ok',
    );
  };

  /** 从清单选中元素；若不在当前视口内则把它带回画面中央 */
  const selectAndReveal = (ref: Ref) => {
    setSelected(ref);
    if (!view || vp.width === 0) return;
    const el = findElement(doc, ref);
    const center = el ? centerOf(el) : null;
    if (!center) return;
    const s = toScreen(view, center);
    const margin = 40;
    if (s.x >= margin && s.x <= vp.width - margin && s.y >= margin && s.y <= vp.height - margin) return;
    setView(
      clampView(
        {
          scale: view.scale,
          x: vp.width / 2 - center.x * view.scale,
          y: vp.height / 2 - center.y * view.scale,
        },
        vp,
      ),
    );
  };

  // ── 画布交互 ─────────────────────────────────────────────
  const localPoint = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { sx: event.clientX - rect.left, sy: event.clientY - rect.top };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!view) return;
    if (event.button === 2) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const { sx, sy } = localPoint(event);
    const world = toWorld(view, sx, sy);

    if (spaceRef.current || event.button === 1) {
      dragRef.current = { mode: 'pan', sx, sy, start: view };
      setDragging(true);
      return;
    }

    if (selected) {
      const vertex = pickVertex(doc, selected, view, sx, sy);
      if (vertex !== null) {
        dragRef.current = { mode: 'vertex', ref: selected, index: vertex, snapshot: doc };
        setDragging(true);
        return;
      }
    }

    const hit = pickAt(doc, view, sx, sy);
    if (hit) {
      setSelected(hit);
      if (hit.kind === 'city' || hit.kind === 'pass' || hit.kind === 'ferry') {
        const el = findElement(doc, hit) as CityNode | PassNode | FerryNode | null;
        if (el) {
          dragRef.current = {
            mode: 'point',
            ref: hit,
            dx: el.x - world.x,
            dy: el.y - world.y,
            snapshot: doc,
          };
          setDragging(true);
        }
      }
      return;
    }

    setSelected(null);
    dragRef.current = { mode: 'pan', sx, sy, start: view };
    setDragging(true);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!view) return;
    const { sx, sy } = localPoint(event);
    const world = toWorld(view, sx, sy);
    setCursor(world);
    const drag = dragRef.current;

    if (drag) {
      if (drag.mode === 'pan') {
        setView(
          clampView(
            {
              scale: drag.start.scale,
              x: drag.start.x + (sx - drag.sx),
              y: drag.start.y + (sy - drag.sy),
            },
            vp,
          ),
        );
      } else if (drag.mode === 'point') {
        const el = findElement(doc, drag.ref);
        if (el && 'x' in el) {
          const next = {
            ...el,
            x: round1(clamp(world.x + drag.dx, 0, WORLD.width)),
            y: round1(clamp(world.y + drag.dy, 0, WORLD.height)),
          };
          setDoc(withElement(doc, drag.ref.kind, next));
          setDirty(true);
        }
      } else {
        const el =
          drag.ref.kind === 'river'
            ? doc.rivers.find((r) => r.id === drag.ref.id)
            : doc.ranges.find((r) => r.id === drag.ref.id);
        if (el) {
          const points = el.points.map((p, i) =>
            i === drag.index
              ? { x: round1(clamp(world.x, 0, WORLD.width)), y: round1(clamp(world.y, 0, WORLD.height)) }
              : p,
          );
          setDoc(withElement(doc, drag.ref.kind, { ...el, points }));
          setDirty(true);
        }
      }
      return;
    }

    setHover(pickAt(doc, view, sx, sy));
  };

  const endDrag = () => {
    const drag = dragRef.current;
    if (drag && drag.mode !== 'pan' && drag.snapshot !== doc) {
      setPast((p) => [...p, drag.snapshot].slice(-60));
      setFuture([]);
    }
    dragRef.current = null;
    setDragging(false);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      if (!view) return;
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = event.clientX - rect.left;
      const sy = event.clientY - rect.top;
      const factor = Math.exp(-event.deltaY * 0.0018);
      setView(clampView(zoomAt(view, sx, sy, factor), vp));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [view, vp]);

  const actionsRef = useRef({ save: () => {}, undo: () => {}, redo: () => {}, del: () => {} });
  actionsRef.current = { save: saveNow, undo, redo, del: deleteSelected };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'SELECT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        actionsRef.current.save();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) actionsRef.current.redo();
        else actionsRef.current.undo();
        return;
      }
      if (typing) return;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        actionsRef.current.del();
      } else if (event.key === 'Escape') {
        setSelected(null);
      } else if (event.code === 'Space') {
        spaceRef.current = true;
        setSpaceDown(true);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        spaceRef.current = false;
        setSpaceDown(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // ── 列表 ─────────────────────────────────────────────────
  const cityName = (id: string) => doc.cities.find((c) => c.id === id)?.name ?? id;

  const listItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    const kinds: ElementKind[] = filter === 'all' ? ELEMENT_KINDS : [filter];
    const out: Array<{ ref: Ref; name: string; meta: string }> = [];

    for (const kind of kinds) {
      switch (kind) {
        case 'city':
          for (const c of doc.cities) {
            out.push({
              ref: { kind, id: c.id },
              name: c.name,
              meta: `${coordText(c.x, c.y)} · ${CITY_SIZE_LABEL[c.size]}`,
            });
          }
          break;
        case 'pass':
          for (const p of doc.passes) {
            out.push({
              ref: { kind, id: p.id },
              name: p.name,
              meta: `${coordText(p.x, p.y)} · ${PASS_KIND_LABEL[p.kind]} T${p.tier}`,
            });
          }
          break;
        case 'ferry':
          for (const f of doc.ferries) {
            out.push({
              ref: { kind, id: f.id },
              name: f.name,
              meta: `${coordText(f.x, f.y)} · T${f.tier}`,
            });
          }
          break;
        case 'river':
          for (const r of doc.rivers) {
            out.push({
              ref: { kind, id: r.id },
              name: r.name,
              meta: `${r.points.length} 点 · 宽 ${r.width}`,
            });
          }
          break;
        case 'range':
          for (const r of doc.ranges) {
            out.push({
              ref: { kind, id: r.id },
              name: r.name,
              meta: `${r.points.length} 点 · 带宽 ${r.width}`,
            });
          }
          break;
        case 'lake':
          for (const l of doc.lakes) {
            out.push({
              ref: { kind, id: l.id },
              name: l.name,
              meta: `${coordText(l.cx, l.cy)} · ${l.rx}×${l.ry}`,
            });
          }
          break;
        case 'road':
          for (const road of doc.roads) {
            out.push({
              ref: { kind, id: road.id },
              name: `${cityName(road.from)} → ${cityName(road.to)}`,
              meta: `${road.cost} 费${road.wild ? ' · 险道' : ''}`,
            });
          }
          break;
      }
    }

    if (!q) return out;
    return out.filter(
      (item) => item.name.toLowerCase().includes(q) || item.ref.id.toLowerCase().includes(q),
    );
  }, [doc, filter, query]);

  const visibleItems = onlyIssues
    ? listItems.filter((item) => issueKeys.has(`${item.ref.kind}:${item.ref.id}`))
    : listItems;

  const errors = structureIssues.filter((i) => i.level === 'error');
  const strictBad = strictState === 'ready' && strictIssues.length > 0;
  const statusParts: string[] = [];
  if (errors.length > 0) statusParts.push(`${errors.length} 错误`);
  else if (terrain.length > 0) statusParts.push(`地形 ${terrain.length}`);
  else if (structureIssues.length > 0) statusParts.push(`结构提示 ${structureIssues.length}`);
  if (strictState === 'ready') statusParts.push(strictIssues.length ? `严格 ${strictIssues.length}` : '严格通过');
  else if (strictState === 'loading') statusParts.push('严格加载中');
  else if (strictState === 'error') statusParts.push('严格失败');
  const statusText = statusParts.join(' · ') || '校验通过';
  const statusTone = errors.length > 0 || strictBad ? 'ms-bad' : terrain.length > 0 || structureIssues.length > 0 ? 'ms-warn' : 'ms-clean';
  const total = ELEMENT_KINDS.reduce((sum, kind) => sum + countOf(doc, kind), 0);
  const cursorTile = cursor ? tileOf(cursor) : null;
  const cursorLonLat = cursor ? lonLatOf(cursor) : null;
  const selectedName = selectedEl ? elementName(selectedEl, doc) : null;

  return (
    <div className="ms-root">
      <header className="ms-top">
        <div className="ms-brand">
          <div className="ms-mark">圖</div>
          <div>
            <h1>大地图配置台</h1>
            <p>
              {WORLD.cols}×{WORLD.rows} 格 · 世界 {WORLD.width}×{WORLD.height} · schema v1
            </p>
          </div>
        </div>

        <div className="ms-state">
          <span className={dirty ? 'ms-dirty' : 'ms-clean'}>
            {dirty ? '● 有未保存修改' : source === 'seed' ? '内置基线 · 未保存' : `已保存 · ${timeLabel(doc.meta.updatedAt)}`}
          </span>
          <span className="ms-state-sep">/</span>
          <span>来源 {SOURCE_LABEL[source]}</span>
          <span className="ms-state-sep">/</span>
          <span>{total} 个元素</span>
          {errors.length > 0 ? (
            <span className="ms-bad">{errors.length} 个阻塞问题</span>
          ) : terrain.length > 0 ? (
            <span className="ms-warn">地形 {terrain.length}</span>
          ) : null}
          {strictState === 'ready' ? (
            strictIssues.length > 0 ? (
              <span className="ms-bad">严格 {strictIssues.length}</span>
            ) : (
              <span className="ms-clean">严格通过</span>
            )
          ) : strictState === 'loading' ? (
            <span className="ms-warn">严格加载中</span>
          ) : strictState === 'error' ? (
            <span className="ms-warn">严格失败</span>
          ) : null}
        </div>

        <div className="ms-actions">
          <button className="btn ghost sm" onClick={undo} disabled={!past.length} title="撤销 ⌘Z">
            撤销
          </button>
          <button className="btn ghost sm" onClick={redo} disabled={!future.length} title="重做 ⇧⌘Z">
            重做
          </button>
          <span className="ms-divider" />
          <button className="btn sm" onClick={() => fileRef.current?.click()}>
            导入
          </button>
          <button className="btn sm" onClick={exportJson}>
            导出 JSON
          </button>
          <button className="btn accent sm" onClick={openPreview}>
            生成地图
          </button>
          <button className="btn primary sm" onClick={saveNow}>
            保存 <kbd>⌘S</kbd>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            onChange={(e) => void onImportFile(e)}
            hidden
          />
        </div>
      </header>

      <div className="ms-body">
        <aside className="ms-rail">
          <div className="ms-rail-head">
            <div className="ms-eyebrow">MAP ELEMENTS</div>
            <input
              className="ms-search"
              placeholder="搜索名称或 id"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="ms-chips">
            <button
              className={`ms-chip ${filter === 'all' ? 'on' : ''}`}
              onClick={() => {
                setFilter('all');
                setOnlyIssues(false);
              }}
            >
              全部 <b>{total}</b>
            </button>
            {ELEMENT_KINDS.map((kind) => (
              <button
                key={kind}
                className={`ms-chip ${filter === kind ? 'on' : ''}`}
                onClick={() => {
                  setFilter(kind);
                  setOnlyIssues(false);
                }}
              >
                <i style={{ background: ELEMENT_META[kind].color }} />
                {ELEMENT_META[kind].label} <b>{countOf(doc, kind)}</b>
              </button>
            ))}
          </div>

          <div className="ms-list-head">
            <span>
              {onlyIssues ? (strictState === 'ready' ? '全部问题' : '地形问题') : filter === 'all' ? '全部元素' : ELEMENT_META[filter].label}
              <em>{visibleItems.length}</em>
            </span>
            <div className="ms-list-actions">
              <button
                className={`ms-mini ${onlyIssues ? 'on' : ''}`}
                onClick={() => {
                  setOnlyIssues((v) => !v);
                  if (!onlyIssues) setFilter('all');
                }}
                title="跨类型列出有地形 / 严格提示的元素"
                disabled={issueKeys.size === 0 && !onlyIssues}
              >
                仅问题 {issueKeys.size}
              </button>
              <button className="btn accent sm" onClick={addElement}>
                ＋ 新增
              </button>
            </div>
          </div>

          <div className="ms-list">
            {visibleItems.length === 0 ? (
              <p className="ms-empty">{onlyIssues ? '当前筛选下没有问题。' : '没有匹配的元素。'}</p>
            ) : (
              visibleItems.map((item) => {
                const key = `${item.ref.kind}:${item.ref.id}`;
                return (
                  <button
                    key={key}
                    className={`ms-row ${sameRef(selected, item.ref) ? 'on' : ''}`}
                    onClick={() => selectAndReveal(item.ref)}
                    title={item.ref.id}
                  >
                    <i style={{ background: ELEMENT_META[item.ref.kind].color }} />
                    <span className="ms-row-main">
                      <b>{item.name}</b>
                      <em>{item.meta}</em>
                    </span>
                    {strictKeys.has(key) ? (
                      <span className="ms-row-strict" title="严格校验未通过">!</span>
                    ) : terrainKeys.has(key) ? (
                      <span className="ms-row-warn" title="有地形提示">!</span>
                    ) : null}
                    <span className="ms-row-type">{ELEMENT_META[item.ref.kind].label}</span>
                  </button>
                );
              })
            )}
          </div>

          <div className="ms-rail-foot">
            <button className="btn ghost sm" onClick={resetToSeed}>
              重置为内置基线
            </button>
          </div>
        </aside>

        <section className="ms-stage">
          <div
            className={`ms-canvas-wrap ${spaceDown ? 'grab' : dragging ? 'dragging' : ''}`}
            ref={wrapperRef}
          >
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onPointerLeave={() => {
                setHover(null);
                if (!dragRef.current) setCursor(null);
              }}
            />

            <div className="ms-hud">
              <button
                className="ms-hud-btn"
                title="放大"
                onClick={() => view && setView(clampView(zoomAt(view, vp.width / 2, vp.height / 2, 1.25), vp))}
              >
                ＋
              </button>
              <span>{view ? `${Math.round(view.scale * 100)}%` : '—'}</span>
              <button
                className="ms-hud-btn"
                title="缩小"
                onClick={() => view && setView(clampView(zoomAt(view, vp.width / 2, vp.height / 2, 0.8), vp))}
              >
                －
              </button>
              <button className="ms-hud-btn wide" onClick={() => setView(fitView(vp, 22))}>
                全图
              </button>
            </div>

            <div className="ms-toggles">
              <button className={`ms-toggle ${showLabels ? 'on' : ''}`} onClick={() => setShowLabels((v) => !v)}>
                地名
              </button>
              <button className={`ms-toggle ${showRoads ? 'on' : ''}`} onClick={() => setShowRoads((v) => !v)}>
                路网
              </button>
              <button className={`ms-toggle ${showGrid ? 'on' : ''}`} onClick={() => setShowGrid((v) => !v)}>
                网格
              </button>
              <button
                className={`ms-toggle ${showTerrainFlags ? 'on' : ''}`}
                onClick={() => setShowTerrainFlags((v) => !v)}
                title="在地图上标出地形提示"
              >
                问题
              </button>
              <button
                className={`ms-toggle ${strictState === 'ready' ? 'on' : ''}`}
                disabled={strictState === 'loading'}
                onClick={() => {
                  if (strictState === 'ready') disableStrict();
                  else if (strictState !== 'loading') void runStrict();
                }}
                title="运行 / 关闭 576×360 运行时地形严格校验"
              >
                {strictState === 'loading' ? '严格…' : `严格${strictState === 'ready' && strictIssues.length ? ` ${strictIssues.length}` : ''}`}
              </button>
            </div>

            <div className="ms-tip">滚轮缩放 · 拖拽移动 · 空格拖动画布</div>
          </div>

          <footer className="ms-cursorbar">
            <span className="ms-mono">
              {cursor && cursorTile && cursorLonLat
                ? `x ${cursor.x.toFixed(1)} · y ${cursor.y.toFixed(1)}　格 ${cursorTile.col},${cursorTile.row}　${cursorLonLat.lon.toFixed(2)}°E ${cursorLonLat.lat.toFixed(2)}°N`
                : '移动鼠标查看坐标'}
            </span>
            <span className="ms-cursor-selected">{selectedName ? `选中：${selectedName}` : '未选中元素'}</span>
            <span className={statusTone}>{statusText}</span>
          </footer>
        </section>

        <aside className="ms-inspector">
          {selectedEl && selected ? (
            <Inspector
              doc={doc}
              element={selectedEl}
              kind={selected.kind}
              onChange={updateElement}
              onDelete={deleteSelected}
              strictState={strictState}
              strictIssue={strictSelected}
              onSnap={snapSelected}
              structState={structState}
              structIssues={structSelected}
              structStale={structStale}
              structSite={
                selected && structBuild ? structBuild.sites[selected.id] ?? null : null
              }
              onAdopt={(site) => selected && adoptStruct(selected, site)}
            />
          ) : (
            <Overview
              doc={doc}
              source={source}
              structureIssues={structureIssues}
              terrain={terrain}
              onFilter={(kind) => setFilter(kind)}
              onTitle={(title) => mutate({ ...doc, meta: { ...doc.meta, title } }, 'meta:title')}
              onSelect={(ref) => {
                setFilter(ref.kind);
                setOnlyIssues(false);
                selectAndReveal(ref);
              }}
              strictState={strictState}
              strictIssues={strictIssues}
              strictError={strictError}
              onStrictRun={() => void runStrict()}
              onStrictDisable={disableStrict}
              onSnapAll={snapAll}
              snapCount={issueKeys.size}
              structState={structState}
              structBuild={structBuild}
              structError={structError}
              structStale={structStale}
              onStructRun={runStruct}
              onStructDisable={disableStruct}
            />
          )}
        </aside>
      </div>

      {toast ? <div className={`ms-toast ${toast.tone}`}>{toast.text}</div> : null}

      {preview ? (
        <MapPreview doc={preview.doc} note={preview.note} onClose={() => setPreview(null)} />
      ) : null}
    </div>
  );
}

// ── 右栏：概览 ────────────────────────────────────────────

function Overview({
  doc,
  source,
  structureIssues,
  terrain,
  onFilter,
  onTitle,
  onSelect,
  strictState,
  strictIssues,
  strictError,
  onStrictRun,
  onStrictDisable,
  onSnapAll,
  snapCount,
  structState,
  structBuild,
  structError,
  structStale,
  onStructRun,
  onStructDisable,
}: {
  doc: MapDocument;
  source: Source;
  structureIssues: ReturnType<typeof validateDocument>;
  terrain: TerrainIssue[];
  onFilter: (kind: ElementKind) => void;
  onTitle: (title: string) => void;
  onSelect: (ref: Ref) => void;
  strictState: StrictState;
  strictIssues: StrictIssue[];
  strictError: string | null;
  onStrictRun: () => void;
  onStrictDisable: () => void;
  onSnapAll: () => void;
  snapCount: number;
  structState: 'idle' | 'running' | 'ready' | 'error';
  structBuild: StructBuild | null;
  structError: string | null;
  structStale: boolean;
  onStructRun: () => void;
  onStructDisable: () => void;
}) {
  const errors = structureIssues.filter((i) => i.level === 'error');
  const strictLabel =
    strictState === 'ready'
      ? strictIssues.length
        ? `${strictIssues.length} 处`
        : '通过'
      : strictState === 'loading'
        ? '生成中'
        : strictState === 'error'
          ? '失败'
          : '未运行';
  const structLabel =
    structState === 'ready'
      ? structBuild && structBuild.issues.length
        ? `${structBuild.issues.length} 处${structStale ? ' · 已过期' : ''}`
        : `通过${structStale ? ' · 已过期' : ''}`
      : structState === 'running'
        ? '重建中'
        : structState === 'error'
          ? '失败'
          : '未运行';
  return (
    <div className="ms-insp">
      <div className="ms-insp-head">
        <div className="ms-eyebrow">DOCUMENT</div>
        <h2>配置概览</h2>
        <p className="ms-sub">所有改动先保存在内存，点右上角「保存」写入本地存档。</p>
      </div>

      <div className="ms-insp-body">
        <Field label="文档标题">
          <input
            className="ms-input"
            value={doc.meta.title}
            onChange={(e) => onTitle(e.target.value)}
          />
        </Field>

        <div className="ms-stats">
          {ELEMENT_KINDS.map((kind) => (
            <button className="ms-stat" key={kind} onClick={() => onFilter(kind)}>
              <span style={{ color: ELEMENT_META[kind].color }}>{ELEMENT_META[kind].label}</span>
              <b>{countOf(doc, kind)}</b>
              <em>{ELEMENT_META[kind].unit}</em>
            </button>
          ))}
        </div>

        <div className="ms-info">
          <InfoRow label="幅面" value={`${doc.meta.cols} × ${doc.meta.rows} 格`} />
          <InfoRow label="世界" value={`${WORLD.width} × ${WORLD.height}`} />
          <InfoRow label="格宽" value={`${doc.meta.tile} 世界单位`} />
          <InfoRow label="数据来源" value={SOURCE_LABEL[source]} />
          <InfoRow label="更新时间" value={timeLabel(doc.meta.updatedAt)} />
          <InfoRow label="存档键" value="sanguo.map-config.v1" mono />
        </div>

        <div className="ms-section-title">
          结构校验 <em>{errors.length ? `${errors.length} 错误` : '通过'}</em>
        </div>
        {structureIssues.length === 0 ? (
          <p className="ms-ok">没有发现越界、重复 id 或断引用。</p>
        ) : (
          <ul className="ms-issues">
            {structureIssues.slice(0, 6).map((issue, i) => (
              <li key={`${issue.text}-${i}`} className={issue.level}>
                <i>{issue.level === 'error' ? '✕' : '!'}</i>
                {issue.text}
              </li>
            ))}
            {structureIssues.length > 6 ? <li className="more">另有 {structureIssues.length - 6} 条…</li> : null}
          </ul>
        )}

        <div className="ms-section-title">
          地形体检 <em className={terrain.length ? 'ms-warn' : undefined}>{terrain.length ? `${terrain.length} 处待复核` : '通过'}</em>
        </div>
        {terrain.length === 0 ? (
          <p className="ms-ok">关隘贴山、渡口贴岸。</p>
        ) : (
          <>
            <p className="ms-note">
              关隘需落在山体 / 丘陵带，渡口图标需在岸上且离水不超过 2 格。内置基线的渡口坐标取自
              <code>GATE.anchor</code>（渡线中点），多数图标仍在江心——这是数据现状，不是校验误报。
            </p>
            <ul className="ms-issues terrain">
              {terrain.slice(0, 5).map((issue) => (
                <li key={`${issue.ref.kind}:${issue.ref.id}`}>
                  <button className="ms-issue-link" onClick={() => onSelect(issue.ref)}>
                    <i>!</i>
                    {issue.text.replace('地形：', '')}
                  </button>
                </li>
              ))}
              {terrain.length > 5 ? (
                <li className="more">另有 {terrain.length - 5} 处，点左侧「仅问题」逐条看</li>
              ) : null}
            </ul>
          </>
        )}

        {snapCount > 0 ? (
          <>
            <SnapAllButton count={snapCount} onSnapAll={onSnapAll} disabled={strictState === 'loading'} />
            <p className="ms-note ms-note-tight">批量按对岸约束搜索；成对渡口建议吸附后再复核一次。</p>
          </>
        ) : null}

        <div className="ms-section-title">
          严格校验（运行时地形）
          <em className={strictState === 'ready' && strictIssues.length ? 'ms-bad' : undefined}>{strictLabel}</em>
        </div>

        {strictState === 'idle' ? (
          <>
            <p className="ms-note">
              用 576×360 地形栅格检查山地 / 水面 / 岸线 / 对岸（运行时地形，不随面板改山川而变），首次生成约 0.5 秒。采样版不重建关墙与通行线，完整结构检查仍跑
              <code>npm run map:gates</code>。
            </p>
            <button className="btn accent sm wide" onClick={onStrictRun}>运行严格校验</button>
          </>
        ) : null}

        {strictState === 'loading' ? (
          <p className="ms-loading"><i className="ms-spinner" />正在生成 576×360 地形栅格…</p>
        ) : null}

        {strictState === 'error' ? (
          <>
            <p className="ms-error-text">{strictError ?? '运行时地形加载失败'}</p>
            <button className="btn sm wide" onClick={onStrictRun}>重试</button>
          </>
        ) : null}

        {strictState === 'ready' ? (
          <>
            {strictIssues.length === 0 ? (
              <p className="ms-ok">运行时地形通过：山口、岸线、对岸均符合。</p>
            ) : (
              <ul className="ms-issues strict">
                {strictIssues.slice(0, 5).map((issue) => (
                  <li key={`${issue.ref.kind}:${issue.ref.id}`}>
                    <button className="ms-issue-link" onClick={() => onSelect(issue.ref)}>
                      <i>✕</i>
                      {issue.text.replace('运行时地形：', '')}
                    </button>
                  </li>
                ))}
                {strictIssues.length > 5 ? (
                  <li className="more">另有 {strictIssues.length - 5} 处，点左侧「仅问题」逐条看</li>
                ) : null}
              </ul>
            )}
            <p className="ms-note ms-note-tight">
              采样版：只判山 / 水 / 岸 / 对岸，不重建关墙、门洞与滩头；完整结构检查仍跑
              <code>npm run map:gates</code>。
            </p>
            <div className="ms-inline-actions">
              <button className="btn ghost sm" onClick={onStrictRun}>重新校验</button>
              <button className="btn ghost sm" onClick={onStrictDisable}>关闭</button>
            </div>
          </>
        ) : null}

        <div className="ms-section-title">
          关防结构（lane / wall 重建）
          <em className={structState === 'ready' && (structBuild?.issues.length ?? 0) > 0 ? 'ms-bad' : undefined}>
            {structLabel}
          </em>
        </div>

        {structState === 'idle' ? (
          <>
            <p className="ms-note">
              按文档坐标重新砌关墙、落关港，跑与 <code>npm run map:gates</code> 同一份规则：山口、门洞、墙端、
              通行线 4 邻接、渡线水宽、对岸配对。约 1.5 秒，结果画在地图上（青绿方块 = 通行线，空心框 = 重建后的门洞 / 滩头）。
            </p>
            <button className="btn accent sm wide" onClick={onStructRun}>结构重建</button>
          </>
        ) : null}

        {structState === 'running' ? (
          <p className="ms-loading"><i className="ms-spinner" />正在砌关墙、落关港…</p>
        ) : null}

        {structState === 'error' ? (
          <>
            <p className="ms-error-text">{structError ?? '结构重建失败'}</p>
            <button className="btn sm wide" onClick={onStructRun}>重试</button>
          </>
        ) : null}

        {structState === 'ready' && structBuild ? (
          <>
            <div className="ms-info">
              <InfoRow label="落位" value={`${Object.keys(structBuild.sites).length} 处`} />
              <InfoRow label="关墙" value={`${structBuild.walls.size} 道`} />
              <InfoRow label="耗时" value={`${structBuild.ms} ms`} mono />
            </div>
            {structStale ? (
              <p className="ms-note ms-warn-text">文档已改动，重建结果过期，请再跑一次。</p>
            ) : null}
            {structBuild.skipped.length > 0 ? (
              <p className="ms-note">未绑定道路、已跳过：{structBuild.skipped.join('、')}</p>
            ) : null}
            {structBuild.issues.length === 0 && structBuild.failures.length === 0 ? (
              <p className="ms-ok">结构与运行时同口径通过：山口、门洞、墙端、通行线、对岸均符合。</p>
            ) : (
              <ul className="ms-issues strict">
                {structBuild.issues.slice(0, 5).map((issue) => (
                  <li key={`${issue.ref.kind}:${issue.ref.id}`}>
                    <button className="ms-issue-link" onClick={() => onSelect(issue.ref)}>
                      <i>✕</i>
                      {issue.text}
                    </button>
                  </li>
                ))}
                {structBuild.failures.slice(0, 3).map((text, i) => (
                  <li key={`fail-${i}`} className="error">
                    <i>✕</i>
                    {text}
                  </li>
                ))}
                {structBuild.issues.length + structBuild.failures.length > 8 ? (
                  <li className="more">
                    另有 {structBuild.issues.length + structBuild.failures.length - 8} 条，点左侧「仅问题」逐条看
                  </li>
                ) : null}
              </ul>
            )}
            <div className="ms-inline-actions">
              <button className="btn ghost sm" onClick={onStructRun}>重新重建</button>
              <button className="btn ghost sm" onClick={onStructDisable}>关闭</button>
            </div>
          </>
        ) : null}

        <div className="ms-section-title">图例</div>
        <div className="ms-legend">
          <span><i className="ms-dot city" />城池</span>
          <span><i className="ms-dot pass" />关隘</span>
          <span><i className="ms-dot ferry" />渡口</span>
          <span><i className="ms-line river" />河流</span>
          <span><i className="ms-line range" />山脉</span>
          <span><i className="ms-line road" />路网</span>
          <span><i className="ms-flag">!</i>地形提示</span>
          <span><i className="ms-flag strict">!</i>严格校验</span>
          <span><i className="ms-lane" />通行线</span>
        </div>

        <div className="ms-section-title">操作</div>
        <ul className="ms-keys">
          <li><kbd>拖动</kbd> 移动点状元素或折线顶点</li>
          <li><kbd>滚轮</kbd> 缩放，<kbd>空格 + 拖动</kbd> 平移</li>
          <li><kbd>⌘S</kbd> 保存，<kbd>⌘Z</kbd> 撤销，<kbd>Delete</kbd> 删除</li>
        </ul>
      </div>
    </div>
  );
}

function SnapAllButton({
  count,
  onSnapAll,
  disabled,
}: {
  count: number;
  onSnapAll: () => void;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 3200);
    return () => window.clearTimeout(timer);
  }, [armed]);
  return (
    <button
      className={`btn wide sm ${armed ? 'danger' : 'accent'}`}
      disabled={disabled}
      onClick={() => {
        if (armed) {
          onSnapAll();
          setArmed(false);
        } else {
          setArmed(true);
        }
      }}
    >
      {armed ? `确认移动 ${count} 处` : `一键吸附 ${count} 处`}
    </button>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="ms-info-row">
      <span>{label}</span>
      <b className={mono ? 'ms-mono' : undefined}>{value}</b>
    </div>
  );
}

function StructCard({
  site,
  docPos,
  issues,
  state,
  stale,
  kind,
  onAdopt,
}: {
  site: GateSite | null;
  docPos: XY;
  issues: StructIssue[];
  state: 'idle' | 'running' | 'ready' | 'error';
  stale: boolean;
  kind: ElementKind;
  onAdopt: () => void;
}) {
  const idleText =
    state === 'running'
      ? '正在砌关墙、落关港…'
      : state === 'error'
        ? '重建失败，见右侧概览'
        : '未重建：点概览「结构重建」后显示 lane / 门洞 / 墙端检查。';

  if (!site) {
    return (
      <div className="ms-terrain">
        <div className="ms-terrain-head">
          <span>关防结构</span>
          <b>{state === 'running' ? '重建中' : '未运行'}</b>
        </div>
        <p>{idleText}</p>
      </div>
    );
  }

  const iconX = (site.icon.col + 0.5) * WORLD.tile;
  const iconY = (site.icon.row + 0.5) * WORLD.tile;
  const offset = Math.hypot(iconX - docPos.x, iconY - docPos.y);
  const bad = issues.length > 0;
  return (
    <div className={`ms-terrain ${bad ? 'strict' : 'ok'}`}>
      <div className="ms-terrain-head">
        <span>关防结构</span>
        <b>{bad ? `${issues.length} 项` : '通过'}</b>
      </div>
      <div className="ms-info ms-info-tight">
        <InfoRow label="落位" value={`格 ${site.icon.col},${site.icon.row}`} mono />
        <InfoRow label="通行线" value={`${site.lane.length} 格`} />
        <InfoRow
          label="文档 → 落位"
          value={offset < 6 ? `重合（${offset.toFixed(0)}）` : `偏 ${offset.toFixed(0)} 单位`}
          mono
        />
        {kind === 'ferry' ? <InfoRow label="渡河" value={`${site.crossDays} MP`} /> : null}
        {kind === 'ferry' ? (
          <InfoRow
            label="滩头"
            value={
              site.approaches.length === 2
                ? site.approaches.map((p) => `${p.col},${p.row}`).join(' → ')
                : '无'
            }
            mono
          />
        ) : null}
      </div>
      {bad ? (
        <ul className="ms-issues strict tight">
          {issues.map((issue, i) => (
            <li key={`${issue.short}-${i}`}>
              <i>✕</i>
              {issue.text}
            </li>
          ))}
        </ul>
      ) : null}
      {offset >= 6 && kind === 'pass' ? (
        <button className="btn ghost sm wide ms-snap-btn" onClick={onAdopt}>
          采用落位坐标（消除 {offset.toFixed(0)} 单位偏差）
        </button>
      ) : null}
      {offset >= 6 && kind === 'ferry' ? (
        <p className="ms-note ms-note-tight">
          渡口点位是渡线锚点，图标由渡线推出。把点位改成图标会让下一次重建重新选渡线（实测 30 处里有 10 处移 1–2 格），
          所以这里不给回填按钮。
        </p>
      ) : null}
      {stale ? <p className="ms-note ms-note-tight">文档已改动，结果过期。</p> : null}
    </div>
  );
}

function TerrainCard({
  doc,
  target,
  strictState,
  strictIssue,
  onSnap,
}: {
  doc: MapDocument;
  target: Ref;
  strictState: StrictState;
  strictIssue: StrictIssue | null;
  onSnap: () => void;
}) {
  const summary = terrainSummary(doc, target);
  if (!summary) return null;
  const bad = !summary.ok || !!strictIssue;
  const runtimeText =
    strictState === 'ready'
      ? strictIssue
        ? `✗ ${strictIssue.short}`
        : '✓ 通过'
      : strictState === 'loading'
        ? '生成中…'
        : strictState === 'error'
          ? '加载失败'
          : '未运行';
  const runtimeTone = strictState === 'ready' ? (strictIssue ? 'bad' : 'ok') : '';
  return (
    <div className={`ms-terrain ${bad ? 'bad' : 'ok'}${strictIssue ? ' strict' : ''}`}>
      <div className="ms-terrain-head">
        <span>地形校验</span>
        <b>{bad ? '需复核' : '通过'}</b>
      </div>
      <p>{summary.text}</p>
      <div className="ms-terrain-runtime">
        <span>运行时地形</span>
        <b className={runtimeTone}>{runtimeText}</b>
      </div>
      {bad ? (
        <button className="btn accent sm wide ms-snap-btn" onClick={onSnap}>
          吸附到{target.kind === 'ferry' ? '岸' : '山脚'}
        </button>
      ) : null}
    </div>
  );
}

// ── 右栏：检查器 ──────────────────────────────────────────

function Inspector({
  doc,
  element,
  kind,
  onChange,
  onDelete,
  strictState,
  strictIssue,
  onSnap,
  structState,
  structIssues,
  structStale,
  structSite,
  onAdopt,
}: {
  doc: MapDocument;
  element: AnyElement;
  kind: ElementKind;
  onChange: (kind: ElementKind, element: AnyElement, tag: string) => void;
  onDelete: () => void;
  strictState: StrictState;
  strictIssue: StrictIssue | null;
  onSnap: () => void;
  structState: 'idle' | 'running' | 'ready' | 'error';
  structIssues: StructIssue[];
  structStale: boolean;
  structSite: GateSite | null;
  onAdopt: (site: GateSite) => void;
}) {
  const meta = ELEMENT_META[kind];
  const name = elementName(element, doc);
  const id = element.id;

  return (
    <div className="ms-insp">
      <div className="ms-insp-head">
        <div className="ms-eyebrow" style={{ color: meta.color }}>
          {meta.label} · {meta.hint}
        </div>
        <h2>{name}</h2>
        <code className="ms-id">{id}</code>
      </div>

      <div className="ms-insp-body">
        {kind === 'pass' || kind === 'ferry' ? (
          <TerrainCard
            doc={doc}
            target={{ kind, id }}
            strictState={strictState}
            strictIssue={strictIssue}
            onSnap={onSnap}
          />
        ) : null}
        {kind === 'pass' || kind === 'ferry' ? (
          <StructCard
            site={structSite}
            docPos={{ x: (element as PassNode | FerryNode).x, y: (element as PassNode | FerryNode).y }}
            issues={structIssues}
            state={structState}
            stale={structStale}
            kind={kind}
            onAdopt={() => onAdopt(structSite!)}
          />
        ) : null}
        {kind === 'city' ? (
          <CityForm city={element as CityNode} onChange={onChange} onDelete={onDelete} />
        ) : null}
        {kind === 'pass' ? (
          <PassForm pass={element as PassNode} doc={doc} onChange={onChange} onDelete={onDelete} />
        ) : null}
        {kind === 'ferry' ? (
          <FerryForm ferry={element as FerryNode} doc={doc} onChange={onChange} onDelete={onDelete} />
        ) : null}
        {kind === 'river' ? (
          <RiverForm river={element as RiverNode} onChange={onChange} onDelete={onDelete} />
        ) : null}
        {kind === 'range' ? (
          <RangeForm range={element as RangeNode} onChange={onChange} onDelete={onDelete} />
        ) : null}
        {kind === 'lake' ? (
          <LakeForm lake={element as LakeNode} onChange={onChange} onDelete={onDelete} />
        ) : null}
        {kind === 'road' ? (
          <RoadForm road={element as RoadNode} doc={doc} onChange={onChange} onDelete={onDelete} />
        ) : null}
      </div>
    </div>
  );
}

interface FormProps<T> {
  element: T;
  onChange: (kind: ElementKind, element: AnyElement, tag: string) => void;
  onDelete: () => void;
}

function CityForm({ city, onChange, onDelete }: { city: CityNode; onChange: FormProps<CityNode>['onChange']; onDelete: () => void }) {
  const patch = (next: Partial<CityNode>, tag: string) =>
    onChange('city', { ...city, ...next }, `city:${city.id}:${tag}`);
  return (
    <>
      <Field label="名称">
        <input className="ms-input" value={city.name} onChange={(e) => patch({ name: e.target.value }, 'name')} />
      </Field>
      <CoordFields x={city.x} y={city.y} onChange={(x, y) => patch({ x, y }, 'coord')} />
      <div className="ms-pair">
        <Field label="规模">
          <select className="ms-input" value={city.size} onChange={(e) => patch({ size: e.target.value as CitySize }, 'size')}>
            {(Object.keys(CITY_SIZE_LABEL) as CitySize[]).map((s) => (
              <option key={s} value={s}>{CITY_SIZE_LABEL[s]}</option>
            ))}
          </select>
        </Field>
        <Field label="地形">
          <select className="ms-input" value={city.terrain} onChange={(e) => patch({ terrain: e.target.value as CityTerrain }, 'terrain')}>
            {(Object.keys(CITY_TERRAIN_LABEL) as CityTerrain[]).map((t) => (
              <option key={t} value={t}>{CITY_TERRAIN_LABEL[t]}</option>
            ))}
          </select>
        </Field>
      </div>
      <div className="ms-pair">
        <Field label="归属势力">
          <input
            className="ms-input"
            value={city.ownerId ?? ''}
            placeholder="无主"
            onChange={(e) => patch({ ownerId: e.target.value.trim() || null }, 'owner')}
          />
        </Field>
        <Field label="城防 0–100">
          <NumberBox value={city.fortification} min={0} max={100} onCommit={(v) => patch({ fortification: clamp(Math.round(v), 0, 100) }, 'fort')} />
        </Field>
      </div>
      <label className="ms-check">
        <input type="checkbox" checked={city.isWaterCity} onChange={(e) => patch({ isWaterCity: e.target.checked }, 'water')} />
        水城（战场含水战）
      </label>
      <NoteField value={city.note} onChange={(note) => patch({ note }, 'note')} />
      <DeleteButton name={city.name} onDelete={onDelete} />
    </>
  );
}

/**
 * 道路边绑定：关防结构重建要知道这一处挂在哪条城际道路上。
 * 选项直接取文档里的路网，保证 from/to 一定是有效城池 id。
 */
function EdgesField({
  doc,
  value,
  onChange,
}: {
  doc: MapDocument;
  value: Array<[string, string]>;
  onChange: (edges: Array<[string, string]>) => void;
}) {
  const cityName = (id: string) => doc.cities.find((c) => c.id === id)?.name ?? id;
  const sameEdge = (a: [string, string], b: [string, string]) =>
    (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);
  const options = doc.roads.filter((r) => !value.some((e) => sameEdge(e, [r.from, r.to])));

  return (
    <Field label="覆盖道路" hint="决定关墙 / 渡线方向与 A→P→B 折线">
      <div className="ms-edges">
        {value.length === 0 ? (
          <span className="ms-edges-empty">未绑定 · 结构重建会跳过</span>
        ) : (
          value.map((edge, i) => (
            <span className="ms-edge" key={`${edge[0]}-${edge[1]}`}>
              {cityName(edge[0])} — {cityName(edge[1])}
              <button
                type="button"
                className="ms-edge-x"
                title="移除这条道路"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </span>
          ))
        )}
        <select
          className="ms-edge-add"
          value=""
          onChange={(e) => {
            const road = doc.roads.find((r) => r.id === e.target.value);
            if (road) onChange([...value, [road.from, road.to]]);
          }}
        >
          <option value="">＋ 绑定道路…</option>
          {options.map((r) => (
            <option key={r.id} value={r.id}>
              {cityName(r.from)} — {cityName(r.to)}
              {r.wild ? '（险道）' : ''}
            </option>
          ))}
        </select>
      </div>
    </Field>
  );
}

function PassForm({ pass, doc, onChange, onDelete }: { pass: PassNode; doc: MapDocument; onChange: FormProps<PassNode>['onChange']; onDelete: () => void }) {
  const patch = (next: Partial<PassNode>, tag: string) =>
    onChange('pass', { ...pass, ...next }, `pass:${pass.id}:${tag}`);
  return (
    <>
      <Field label="名称">
        <input className="ms-input" value={pass.name} onChange={(e) => patch({ name: e.target.value }, 'name')} />
      </Field>
      <CoordFields x={pass.x} y={pass.y} onChange={(x, y) => patch({ x, y }, 'coord')} />
      <EdgesField doc={doc} value={pass.edges} onChange={(edges) => patch({ edges }, 'edges')} />
      <div className="ms-pair">
        <Field label="类型">
          <select className="ms-input" value={pass.kind} onChange={(e) => patch({ kind: e.target.value as PassKind }, 'kind')}>
            {(Object.keys(PASS_KIND_LABEL) as PassKind[]).map((k) => (
              <option key={k} value={k}>{PASS_KIND_LABEL[k]}</option>
            ))}
          </select>
        </Field>
        <Field label="档位">
          <select className="ms-input" value={pass.tier} onChange={(e) => patch({ tier: Number(e.target.value) as Tier }, 'tier')}>
            {[1, 2, 3].map((t) => (
              <option key={t} value={t}>{TIER_LABEL[t as Tier]}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="法理城">
        <select className="ms-input" value={pass.guardCityId ?? ''} onChange={(e) => patch({ guardCityId: e.target.value || null }, 'guard')}>
          <option value="">无主</option>
          {doc.cities.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </Field>
      <div className="ms-pair">
        <Field label="额外行军日">
          <NumberBox value={pass.extraDays} min={0} max={30} onCommit={(v) => patch({ extraDays: clamp(v, 0, 30) }, 'days')} />
        </Field>
        <Field label="工事值">
          <NumberBox value={pass.fortification} min={0} max={100} onCommit={(v) => patch({ fortification: clamp(v, 0, 100) }, 'fort')} />
        </Field>
      </div>
      <Field label="满编守军">
        <NumberBox value={pass.garrison} min={0} max={20000} step={100} onCommit={(v) => patch({ garrison: clamp(Math.round(v), 0, 20000) }, 'garrison')} />
      </Field>
      <div className="ms-pair">
        <Field label="月解送金">
          <NumberBox value={pass.gold} min={0} max={500} onCommit={(v) => patch({ gold: clamp(Math.round(v), 0, 500) }, 'gold')} />
        </Field>
        <Field label="月解送粮">
          <NumberBox value={pass.food} min={0} max={1000} step={5} onCommit={(v) => patch({ food: clamp(Math.round(v), 0, 1000) }, 'food')} />
        </Field>
      </div>
      <NoteField value={pass.note} onChange={(note) => patch({ note }, 'note')} />
      <DeleteButton name={pass.name} onDelete={onDelete} />
    </>
  );
}

function FerryForm({ ferry, doc, onChange, onDelete }: { ferry: FerryNode; doc: MapDocument; onChange: FormProps<FerryNode>['onChange']; onDelete: () => void }) {
  const patch = (next: Partial<FerryNode>, tag: string) =>
    onChange('ferry', { ...ferry, ...next }, `ferry:${ferry.id}:${tag}`);
  return (
    <>
      <Field label="名称">
        <input className="ms-input" value={ferry.name} onChange={(e) => patch({ name: e.target.value }, 'name')} />
      </Field>
      <CoordFields x={ferry.x} y={ferry.y} onChange={(x, y) => patch({ x, y }, 'coord')} />
      <EdgesField doc={doc} value={ferry.edges} onChange={(edges) => patch({ edges }, 'edges')} />
      <div className="ms-pair">
        <Field label="档位">
          <select className="ms-input" value={ferry.tier} onChange={(e) => patch({ tier: Number(e.target.value) as Tier }, 'tier')}>
            {[1, 2, 3].map((t) => (
              <option key={t} value={t}>{TIER_LABEL[t as Tier]}</option>
            ))}
          </select>
        </Field>
        <Field label="所属河流">
          <select className="ms-input" value={ferry.riverId ?? ''} onChange={(e) => patch({ riverId: e.target.value || null }, 'river')}>
            <option value="">未指定</option>
            {doc.rivers.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </Field>
      </div>
      <div className="ms-pair">
        <Field label="对岸渡口">
          <select className="ms-input" value={ferry.pairId ?? ''} onChange={(e) => patch({ pairId: e.target.value || null }, 'pair')}>
            <option value="">无</option>
            {doc.ferries.filter((f) => f.id !== ferry.id).map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </Field>
        <Field label="法理城">
          <select className="ms-input" value={ferry.guardCityId ?? ''} onChange={(e) => patch({ guardCityId: e.target.value || null }, 'guard')}>
            <option value="">无主</option>
            {doc.cities.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>
      </div>
      <div className="ms-pair">
        <Field label="工事值">
          <NumberBox value={ferry.fortification} min={0} max={100} onCommit={(v) => patch({ fortification: clamp(v, 0, 100) }, 'fort')} />
        </Field>
        <Field label="满编守军">
          <NumberBox value={ferry.garrison} min={0} max={20000} step={100} onCommit={(v) => patch({ garrison: clamp(Math.round(v), 0, 20000) }, 'garrison')} />
        </Field>
      </div>
      <label className="ms-check">
        <input type="checkbox" checked={ferry.waterBattle} onChange={(e) => patch({ waterBattle: e.target.checked }, 'water')} />
        由此渡口发起战斗按水战处理
      </label>
      <div className="ms-pair">
        <Field label="月解送金">
          <NumberBox value={ferry.gold} min={0} max={500} onCommit={(v) => patch({ gold: clamp(Math.round(v), 0, 500) }, 'gold')} />
        </Field>
        <Field label="月解送粮">
          <NumberBox value={ferry.food} min={0} max={1000} step={5} onCommit={(v) => patch({ food: clamp(Math.round(v), 0, 1000) }, 'food')} />
        </Field>
      </div>
      <NoteField value={ferry.note} onChange={(note) => patch({ note }, 'note')} />
      <DeleteButton name={ferry.name} onDelete={onDelete} />
    </>
  );
}

function RiverForm({ river, onChange, onDelete }: { river: RiverNode; onChange: FormProps<RiverNode>['onChange']; onDelete: () => void }) {
  const patch = (next: Partial<RiverNode>, tag: string) =>
    onChange('river', { ...river, ...next }, `river:${river.id}:${tag}`);
  return (
    <>
      <Field label="名称">
        <input className="ms-input" value={river.name} onChange={(e) => patch({ name: e.target.value }, 'name')} />
      </Field>
      <Field label="河面宽度（世界单位）" hint={`约 ${(river.width / WORLD.tile).toFixed(1)} 格`}>
        <NumberBox value={river.width} min={8} max={400} step={2} onCommit={(v) => patch({ width: clamp(v, 8, 400) }, 'width')} />
      </Field>
      <PointsEditor points={river.points} onChange={(points, tag) => patch({ points }, tag)} />
      <button className="btn ghost sm wide" onClick={() => patch({ points: [...river.points].reverse() }, 'reverse')}>
        反向（上游 → 下游）
      </button>
      <NoteField value={river.note} onChange={(note) => patch({ note }, 'note')} />
      <DeleteButton name={river.name} onDelete={onDelete} />
    </>
  );
}

function RangeForm({ range, onChange, onDelete }: { range: RangeNode; onChange: FormProps<RangeNode>['onChange']; onDelete: () => void }) {
  const patch = (next: Partial<RangeNode>, tag: string) =>
    onChange('range', { ...range, ...next }, `range:${range.id}:${tag}`);
  return (
    <>
      <Field label="名称">
        <input className="ms-input" value={range.name} onChange={(e) => patch({ name: e.target.value }, 'name')} />
      </Field>
      <div className="ms-pair">
        <Field label="山体带宽" hint={`${(range.width / WORLD.tile).toFixed(1)} 格`}>
          <NumberBox value={range.width} min={8} max={600} step={4} onCommit={(v) => patch({ width: clamp(v, 8, 600) }, 'width')} />
        </Field>
        <Field label="视觉高度 0–1">
          <NumberBox value={range.height} min={0} max={1} step={0.05} onCommit={(v) => patch({ height: clamp(v, 0, 1) }, 'height')} />
        </Field>
      </div>
      <PointsEditor points={range.points} onChange={(points, tag) => patch({ points }, tag)} />
      <NoteField value={range.note} onChange={(note) => patch({ note }, 'note')} />
      <DeleteButton name={range.name} onDelete={onDelete} />
    </>
  );
}

function LakeForm({ lake, onChange, onDelete }: { lake: LakeNode; onChange: FormProps<LakeNode>['onChange']; onDelete: () => void }) {
  const patch = (next: Partial<LakeNode>, tag: string) =>
    onChange('lake', { ...lake, ...next }, `lake:${lake.id}:${tag}`);
  return (
    <>
      <Field label="名称">
        <input className="ms-input" value={lake.name} onChange={(e) => patch({ name: e.target.value }, 'name')} />
      </Field>
      <div className="ms-pair">
        <Field label="中心 X">
          <NumberBox value={lake.cx} min={0} max={WORLD.width} onCommit={(v) => patch({ cx: round1(clamp(v, 0, WORLD.width)) }, 'cx')} />
        </Field>
        <Field label="中心 Y">
          <NumberBox value={lake.cy} min={0} max={WORLD.height} onCommit={(v) => patch({ cy: round1(clamp(v, 0, WORLD.height)) }, 'cy')} />
        </Field>
      </div>
      <p className="ms-derived">
        格 {Math.floor(lake.cx / WORLD.tile)},{Math.floor(lake.cy / WORLD.tile)}
      </p>
      <div className="ms-pair">
        <Field label="东西半径">
          <NumberBox value={lake.rx} min={4} max={1200} step={2} onCommit={(v) => patch({ rx: clamp(v, 4, 1200) }, 'rx')} />
        </Field>
        <Field label="南北半径">
          <NumberBox value={lake.ry} min={4} max={1200} step={2} onCommit={(v) => patch({ ry: clamp(v, 4, 1200) }, 'ry')} />
        </Field>
      </div>
      <NoteField value={lake.note} onChange={(note) => patch({ note }, 'note')} />
      <DeleteButton name={lake.name} onDelete={onDelete} />
    </>
  );
}

function RoadForm({ road, doc, onChange, onDelete }: { road: RoadNode; doc: MapDocument; onChange: FormProps<RoadNode>['onChange']; onDelete: () => void }) {
  const patch = (next: Partial<RoadNode>, tag: string) =>
    onChange('road', { ...road, ...next }, `road:${road.id}:${tag}`);
  return (
    <>
      <Field label="起点城池">
        <select className="ms-input" value={road.from} onChange={(e) => patch({ from: e.target.value }, 'from')}>
          {doc.cities.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </Field>
      <Field label="终点城池">
        <select className="ms-input" value={road.to} onChange={(e) => patch({ to: e.target.value }, 'to')}>
          {doc.cities.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </Field>
      <Field label="抽象代价" hint="只用于路网排序，不是行军 MP">
        <NumberBox value={road.cost} min={1} max={20} onCommit={(v) => patch({ cost: clamp(Math.round(v), 1, 20) }, 'cost')} />
      </Field>
      <label className="ms-check">
        <input type="checkbox" checked={road.wild} onChange={(e) => patch({ wild: e.target.checked }, 'wild')} />
        险道（可行军，不计邻城）
      </label>
      <NoteField value={road.note} onChange={(note) => patch({ note }, 'note')} />
      <DeleteButton name={`${road.from} → ${road.to}`} onDelete={onDelete} />
    </>
  );
}

// ── 通用表单件 ────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="ms-field">
      <span>{label}</span>
      {children}
      {hint ? <em>{hint}</em> : null}
    </label>
  );
}

function NumberBox({
  value,
  onCommit,
  min,
  max,
  step = 1,
}: {
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);

  const commit = () => {
    const parsed = Number(text);
    if (Number.isFinite(parsed)) onCommit(parsed);
    else setText(String(value));
  };

  return (
    <input
      className="ms-input ms-number"
      type="number"
      value={text}
      min={min}
      max={max}
      step={step}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function CoordFields({ x, y, onChange }: { x: number; y: number; onChange: (x: number, y: number) => void }) {
  const lonLat = lonLatOf({ x, y });
  const tile = tileOf({ x, y });
  return (
    <>
      <div className="ms-pair">
        <Field label="X 世界坐标">
          <NumberBox
            value={x}
            min={0}
            max={WORLD.width}
            onCommit={(v) => onChange(round1(clamp(v, 0, WORLD.width)), y)}
          />
        </Field>
        <Field label="Y 世界坐标">
          <NumberBox
            value={y}
            min={0}
            max={WORLD.height}
            onCommit={(v) => onChange(x, round1(clamp(v, 0, WORLD.height)))}
          />
        </Field>
      </div>
      <p className="ms-derived">
        格 {tile.col},{tile.row} · {lonLat.lon.toFixed(2)}°E {lonLat.lat.toFixed(2)}°N
      </p>
    </>
  );
}

function PointsEditor({ points, onChange }: { points: XY[]; onChange: (points: XY[], tag: string) => void }) {
  const setPoint = (index: number, x: number, y: number) => {
    const next = points.map((p, i) =>
      i === index ? { x: round1(clamp(x, 0, WORLD.width)), y: round1(clamp(y, 0, WORLD.height)) } : p,
    );
    onChange(next, `pt-${index}`);
  };

  return (
    <div className="ms-points">
      <div className="ms-points-head">
        <span>控制点 · {points.length}</span>
        <button
          className="btn ghost sm"
          onClick={() => {
            const last = points[points.length - 1] ?? { x: WORLD.width / 2, y: WORLD.height / 2 };
            onChange([...points, clampWorld({ x: last.x + 80, y: last.y + 20 })], 'pt-add');
          }}
        >
          ＋ 追加
        </button>
      </div>
      {points.map((p, i) => (
        <div className="ms-point-row" key={i}>
          <i>{String(i + 1).padStart(2, '0')}</i>
          <NumberBox value={p.x} min={0} max={WORLD.width} onCommit={(v) => setPoint(i, v, p.y)} />
          <NumberBox value={p.y} min={0} max={WORLD.height} onCommit={(v) => setPoint(i, p.x, v)} />
          <button
            className="ms-x"
            title="删除该点"
            disabled={points.length <= 2}
            onClick={() => onChange(points.filter((_, idx) => idx !== i), `pt-del-${i}`)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

function NoteField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Field label="备注">
      <textarea className="ms-input ms-textarea" rows={2} value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

function DeleteButton({ name, onDelete }: { name: string; onDelete: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => setArmed(false), [name]);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 3200);
    return () => window.clearTimeout(timer);
  }, [armed]);

  if (!armed) {
    return (
      <button className="btn danger-hint wide ms-delete" onClick={() => setArmed(true)}>
        删除此元素
      </button>
    );
  }
  return (
    <button className="btn danger wide ms-delete" onClick={onDelete}>
      确认删除「{name}」
    </button>
  );
}

// ── 生成地图预览 ──────────────────────────────────────────

function MapPreview({ doc, note, onClose }: { doc: MapDocument; note: string | null; onClose: () => void }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [vp, setVp] = useState<Viewport>({ width: 0, height: 0 });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setVp({ width: Math.round(rect.width), height: Math.round(rect.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || vp.width === 0 || vp.height === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(vp.width * dpr);
    canvas.height = Math.round(vp.height * dpr);
    canvas.style.width = `${vp.width}px`;
    canvas.style.height = `${vp.height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawMap(ctx, doc, fitView(vp, 24), vp, {
      selected: null,
      hover: null,
      showLabels: true,
      showRoads: true,
      showGrid: false,
      showAllLabels: true,
    });
  }, [doc, vp]);

  const downloadPng = () => {
    const width = 2400;
    const height = 1500;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawMap(ctx, doc, fitView({ width, height }, 48), { width, height }, {
      selected: null,
      hover: null,
      showLabels: true,
      showRoads: true,
      showGrid: false,
      showAllLabels: true,
      presentation: true,
      uiScale: 2.2,
    });
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'sanguo-map.png';
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  };

  return (
    <div className="ms-modal" role="dialog" aria-modal="true">
      <div className="ms-modal-panel">
        <header className="ms-modal-head">
          <div>
            <div className="ms-eyebrow">RENDER PREVIEW</div>
            <h2>{doc.meta.title}</h2>
          </div>
          <div className="ms-modal-meta">
            {doc.cities.length} 城 · {doc.passes.filter((p) => p.kind === 'pass').length} 关 · {doc.ferries.length} 渡 · 更新于 {timeLabel(doc.meta.updatedAt)}
          </div>
          <div className="ms-modal-actions">
            <button className="btn accent sm" onClick={downloadPng}>下载 PNG</button>
            <button className="btn sm" onClick={onClose}>关闭</button>
          </div>
        </header>
        {note ? <div className="ms-modal-note">{note}</div> : null}
        <div className="ms-modal-canvas" ref={wrapRef}>
          <canvas ref={canvasRef} />
        </div>
      </div>
    </div>
  );
}
