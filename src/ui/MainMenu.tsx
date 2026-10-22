import { useState } from 'react';
import { gameStore, useGameStore } from '../store/gameStore';
import { getSave } from '../save/db';
import { AudioSettingsButton } from './AudioSettings';
import { useEscape, useSaveSlots } from './common';
import { SaveDialog } from './SaveDialog';

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
      </defs>
      <rect width="1000" height="760" fill="url(#mg)" />
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
          <circle
            cx={n.x}
            cy={n.y}
            r={n.r}
            fill="#14130f"
            stroke={n.c}
            strokeWidth="2"
          />
          <circle cx={n.x} cy={n.y} r={2.2} fill={n.c} />
        </g>
      ))}
    </svg>
  );
}

function AboutModal({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-card narrow" onClick={(e) => e.stopPropagation()}>
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

export function MainMenu() {
  const store = useGameStore();
  const { slots } = useSaveSlots();
  const auto = slots.find((s) => s.slot === 'auto');
  const [loadOpen, setLoadOpen] = useState(false);
  const [about, setAbout] = useState(false);

  const load = async (slot: string) => {
    try {
      const save = await getSave(slot);
      if (!save) {
        gameStore.notify('该槽位没有存档', 'warn');
        return;
      }
      gameStore.load(save.state);
    } catch (e) {
      gameStore.notify(e instanceof Error ? e.message : '读取失败', 'danger');
    }
  };

  return (
    <div className="menu">
      <MenuArt />
      <div className="menu-corner">
        <AudioSettingsButton />
      </div>
      <div className="menu-inner">
        <span className="eyebrow">步步高 9288T · WEB REMAKE</span>
        <h1>
          三国霸业<span className="seal-mini">复刻</span>
        </h1>
        <p className="menu-sub">月度回合 · 城池经营 · 战棋征伐</p>

        <div className="menu-actions">
          <button className="btn primary lg" onClick={() => store.go('select')}>
            新的征程
          </button>
          <button
            className="btn lg"
            disabled={!auto}
            onClick={() => auto && load('auto')}
            title={auto ? `继续 ${auto.year} 年 ${auto.month} 月` : '暂无自动存档'}
          >
            {auto ? `继续 · ${auto.year} 年 ${auto.month} 月` : '继续（暂无存档）'}
          </button>
          <button className="btn lg" onClick={() => setLoadOpen(true)}>
            读取存档
          </button>
          <button className="btn ghost" onClick={() => setAbout(true)}>
            关于
          </button>
        </div>

        <div className="menu-foot">
          四剧本 · 61 城 · 回合制单机
        </div>
      </div>
      {loadOpen ? <SaveDialog mode="load" onClose={() => setLoadOpen(false)} /> : null}
      {about ? <AboutModal onClose={() => setAbout(false)} /> : null}
    </div>
  );
}
