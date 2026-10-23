import { useEffect, useState, type ReactNode } from 'react';
import { gameStore, useGameStore } from '../store/gameStore';
import { getSave, type SaveSlotInfo } from '../save/db';
import { AudioSettingsButton } from './AudioSettings';
import { fmt, formatTime, useEscape, useSaveSlots } from './common';
import { SaveDialog } from './SaveDialog';
import { audio } from '../audio';

/**
 * 菜单背景：抽象的势力网络 + 两团势力晕染 + 缓慢流动的河道。
 * 全部由 SVG 与 CSS 动画构成，不加载任何图片资源。
 */
function MenuArt() {
  const nodes = [
    { x: 210, y: 300, c: '#2f7d4f', r: 9 },
    { x: 370, y: 400, c: '#2f7d4f', r: 7 },
    { x: 520, y: 250, c: '#2f5fa8', r: 12 },
    { x: 690, y: 330, c: '#2f5fa8', r: 8 },
    { x: 470, y: 540, c: '#b03a3a', r: 10 },
    { x: 780, y: 520, c: '#b8892f', r: 7 },
    { x: 880, y: 250, c: '#7f77dd', r: 6 },
    { x: 300, y: 560, c: '#8a6a4a', r: 6 },
  ];
  const edges: Array<[number, number]> = [
    [0, 1],
    [1, 2],
    [2, 3],
    [1, 4],
    [4, 5],
    [3, 6],
    [0, 7],
  ];
  return (
    <svg className="menu-art" viewBox="0 0 1000 760" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <radialGradient id="mg" cx="52%" cy="38%" r="60%">
          <stop offset="0%" stopColor="#2a2620" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#12110e" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="mg-red">
          <stop offset="0%" stopColor="#b03a3a" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#b03a3a" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="mg-blue">
          <stop offset="0%" stopColor="#3f6bb0" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#3f6bb0" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width="1000" height="760" fill="url(#mg)" />

      {/* 势力晕染：极慢的呼吸，让静止的菜单有一点活气 */}
      <g className="art-breathe">
        <circle cx="700" cy="230" r="230" fill="url(#mg-blue)" />
        <circle cx="470" cy="545" r="200" fill="url(#mg-red)" />
      </g>

      <g stroke="#efe6d2" strokeOpacity="0.12" strokeDasharray="3 6">
        {edges.map(([a, b], i) => (
          <line
            key={i}
            x1={nodes[a]!.x}
            y1={nodes[a]!.y}
            x2={nodes[b]!.x}
            y2={nodes[b]!.y}
          />
        ))}
      </g>

      <path
        d="M 120 620 C 300 520, 430 660, 610 570 S 820 470, 940 380"
        fill="none"
        stroke="#3d5f5a"
        strokeOpacity="0.45"
        strokeWidth="10"
        strokeLinecap="round"
      />

      {nodes.map((n, i) => (
        <g key={i}>
          <circle cx={n.x} cy={n.y} r={n.r + 7} fill={n.c} fillOpacity="0.12" />
          <circle cx={n.x} cy={n.y} r={n.r} fill="#14130f" stroke={n.c} strokeWidth="2" />
          <circle cx={n.x} cy={n.y} r={2.2} fill={n.c} />
          {/* 脉冲：错开相位，避免整片一起闪 */}
          <circle
            className="art-pulse"
            cx={n.x}
            cy={n.y}
            r={n.r}
            fill="none"
            stroke={n.c}
            strokeWidth="1"
            style={{ animationDelay: `${i * 1.35}s` }}
          />
        </g>
      ))}
    </svg>
  );
}

function AboutModal({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  return (
    <div className="modal" onClick={onClose}>
      <div
        className="modal-card narrow"
        role="dialog"
        aria-modal="true"
        aria-label="关于这个版本"
        onClick={(e) => e.stopPropagation()}
      >
        <h3>关于这个版本</h3>
        <p>
          以《三国霸业》Web 复刻版 GDD 为真值，先做一条可玩的垂直切片：选君主 → 经营一城
          → 出征相邻城 → 战棋推进 → 占城 → 月结存档。
        </p>
        <p className="muted">
          技术：TypeScript + React + Canvas；规则层为纯函数，随机数可复现，配表启动即校验。
          当前内容为 189 / 200 / 208 / 220 四个剧本、61 城，含内政、战棋、计策、外交与俘虏。后续继续补齐搜索点位、伤害预览与原版细节。
        </p>
        <button className="btn primary" onClick={onClose}>
          知道了
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <span className="cc-stat">
      <em>{label}</em>
      <b>{value}</b>
    </span>
  );
}

/** 继续游戏卡：把「我上次玩到哪」直接摆在首屏，而不是一个盲按钮 */
function ContinueCard({
  slot,
  busy,
  onLoad,
}: {
  slot: SaveSlotInfo;
  busy: boolean;
  onLoad: () => void;
}) {
  return (
    <button
      className="continue-card"
      onClick={onLoad}
      disabled={busy}
      aria-label={`继续 ${slot.factionName} 的存档：${slot.year} 年 ${slot.month} 月，第 ${slot.turn} 回合`}
    >
      <span className="cc-head">
        <span className="cc-tag">自动存档</span>
        <span className="cc-time">{formatTime(slot.createdAt)}</span>
      </span>
      <span className="cc-title">{slot.factionName}</span>
      <span className="cc-sub">
        {slot.year} 年 {slot.month} 月 · 第 {slot.turn} 回合
      </span>
      <span className="cc-stats">
        <Stat label="城池" value={slot.cities} />
        <Stat label="兵力" value={fmt(slot.troops)} />
      </span>
      <span className="cc-go">{busy ? '读取中…' : '继续征战'} <i>→</i></span>
    </button>
  );
}

export function MainMenu() {
  const store = useGameStore();
  const { slots, error } = useSaveSlots();
  const auto = slots.find((s) => s.slot === 'auto');
  const manual = slots
    .filter((s) => s.slot !== 'auto')
    .sort((a, b) => b.createdAt - a.createdAt);
  const [loadOpen, setLoadOpen] = useState(false);
  const [about, setAbout] = useState(false);
  const [busy, setBusy] = useState(false);

  const startNew = () => {
    audio.play('ui.confirm');
    store.go('select');
  };

  const load = async (slot: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const save = await getSave(slot);
      if (!save) {
        gameStore.notify('该槽位没有存档', 'warn');
        return;
      }
      gameStore.load(save.state);
    } catch (e) {
      gameStore.notify(e instanceof Error ? e.message : '读取失败', 'danger');
    } finally {
      setBusy(false);
    }
  };

  /** 键盘：菜单是玩家见到的第一屏，不该只能靠鼠标 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (loadOpen || about) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) return;
      const onButton = el?.tagName === 'BUTTON';
      const k = e.key.toLowerCase();

      if (k === 'n') {
        e.preventDefault();
        startNew();
      } else if (k === 'c' && auto) {
        e.preventDefault();
        void load('auto');
      } else if (k === 'l') {
        e.preventDefault();
        setLoadOpen(true);
      } else if (k === 'h' || e.key === '?') {
        e.preventDefault();
        setAbout(true);
      } else if (e.key === 'Enter' && !onButton) {
        // 回车默认走最省事的那条路：有存档就继续，没有就开始新的
        e.preventDefault();
        if (auto) void load('auto');
        else startNew();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [auto, loadOpen, about, busy]);

  return (
    <div className="menu">
      <MenuArt />
      <div className="menu-corner">
        <AudioSettingsButton />
      </div>

      <div className="menu-grid">
        <div className="menu-inner">
          <span className="eyebrow">步步高 9288T · WEB REMAKE</span>
          <h1>
            三国霸业<span className="seal-mini">复刻</span>
          </h1>
          <p className="menu-sub">月度回合 · 城池经营 · 战棋征伐</p>

          <div className="menu-actions">
            <button className="btn hero lg" onClick={startNew} aria-keyshortcuts="n">
              <span className="cta-text">
                <b>新的征程</b>
                <em>选择剧本与君主</em>
              </span>
              <kbd className="cta-key">N</kbd>
            </button>

            <button
              className="btn lg"
              disabled={!auto || busy}
              onClick={() => auto && void load('auto')}
              title={auto ? `继续 ${auto.year} 年 ${auto.month} 月` : '暂无自动存档'}
              aria-keyshortcuts="c"
            >
              <span className="cta-text">
                <b>继续征战</b>
                <em>
                  {auto
                    ? `${auto.factionName} · 第 ${auto.turn} 回合 · 按 C 直接进入`
                    : '还没有存档 —— 先从「新的征程」开始'}
                </em>
              </span>
              {auto ? <kbd className="cta-key">C</kbd> : null}
            </button>

            <button className="btn lg" onClick={() => setLoadOpen(true)} aria-keyshortcuts="l">
              <span className="cta-text">
                <b>读取存档</b>
                <em>
                  {manual.length > 0 ? `${manual.length} 个手动存档` : '暂无手动存档'}
                </em>
              </span>
              <kbd className="cta-key">L</kbd>
            </button>

            <button className="btn ghost sm menu-about" onClick={() => setAbout(true)}>
              关于本作
            </button>
          </div>

          <div className="menu-keys" aria-hidden>
            <span>
              <kbd>N</kbd>新游戏
            </span>
            <span>
              <kbd>C</kbd>继续
            </span>
            <span>
              <kbd>L</kbd>读档
            </span>
            <span>
              <kbd>H</kbd>关于
            </span>
          </div>

          <div className="menu-foot">四剧本 · 61 城 · 回合制单机 · v0.1</div>
        </div>

        <aside className="menu-side">
          {error ? <p className="danger-text small">{error}</p> : null}

          {auto ? (
            <>
              <div className="side-label">上次的进度</div>
              <ContinueCard slot={auto} busy={busy} onLoad={() => void load('auto')} />
              {manual.length > 0 ? (
                <div className="side-block">
                  <div className="side-label">其他存档</div>
                  <div className="side-saves">
                    {manual.slice(0, 3).map((s) => (
                      <button
                        key={s.slot}
                        className="side-save"
                        disabled={busy}
                        onClick={() => void load(s.slot)}
                      >
                        <i>{s.slot}</i>
                        <span>{s.factionName}</span>
                        <em>
                          {s.year}/{s.month}
                        </em>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="firstrun">
              <div className="side-label">初次征战</div>
              <ol>
                <li>
                  <b>择主</b>四个剧本、八位君主，起手城池与难度各不相同。
                </li>
                <li>
                  <b>经营</b>每月分配内政、征兵、探索；粮草有单城上限，超出会折损。
                </li>
                <li>
                  <b>征伐</b>从己方城池出征相邻敌城，12×8 战棋决定城池归属。
                </li>
              </ol>
              <p className="muted small">
                每月结算后自动存档，随时关掉页面都能接着玩。
              </p>
            </div>
          )}
        </aside>
      </div>

      {loadOpen ? <SaveDialog mode="load" onClose={() => setLoadOpen(false)} /> : null}
      {about ? <AboutModal onClose={() => setAbout(false)} /> : null}
    </div>
  );
}
