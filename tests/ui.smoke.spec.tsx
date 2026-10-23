// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from '../src/ui/App';
import { AudioSettingsButton } from '../src/ui/AudioSettings';
import { CityPanel } from '../src/ui/CityPanel';
import { FactionDiplomacyDialog } from '../src/ui/FactionDiplomacyDialog';
import { RosterDialog } from '../src/ui/RosterDialog';
import { ReportModal } from '../src/ui/ReportModal';
import { PolicyModal } from '../src/ui/PolicyModal';
import { EventModal } from '../src/ui/EventModal';
import { createGame } from '../src/data/tables/scenarios';
import { createBattle } from '../src/systems/battle';
import { gameStore } from '../src/store/gameStore';
import type { Report } from '../src/core/state';

declare global {
  // React 19 的 act 环境标记
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

// jsdom 没有 ResizeObserver / canvas 2d；战棋冒烟只需要组件能挂载
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

describe('UI 冒烟', () => {
  let root: Root | null = null;
  let el: HTMLDivElement | null = null;

  afterEach(async () => {
    if (root) {
      await act(async () => root!.unmount());
      root = null;
    }
    el?.remove();
    el = null;
    gameStore.go('menu');
  });

  it('主菜单渲染标题与入口', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => {
      root!.render(<App />);
    });
    expect(el.textContent).toContain('三国霸业');
    expect(el.textContent).toContain('新的征程');
    expect(el.textContent).toContain('读取存档');
  });

  it('点击"新的征程"进入剧本选择', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => {
      root!.render(<App />);
    });
    const btn = [...el.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('新的征程'),
    );
    expect(btn).toBeTruthy();
    await act(async () => {
      btn!.click();
    });
    expect(el.textContent).toContain('赤壁之战');
    expect(el.textContent).toContain('三国鼎立');
    expect(el.textContent).toContain('选择君主');
    expect(el.textContent).toContain('刘备');
    expect(el.textContent).toContain('AI 难度');
    expect(el.textContent).toContain('粮草溢出规则');
    expect(el.textContent).toContain('安全模式');
    expect(el.textContent).toContain('经典归零');
    expect(el.textContent).toContain('稀有物点位');
    expect(el.textContent).toContain('随机点位');
  });

  it('城池面板展示训练、交易额度、演武与全城宴请', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const state = createGame({ playerFactionId: 'liubei', aiEnabled: false });
    state.cities.jiangxia!.projects = [
      {
        kind: 'farm',
        monthsLeft: 2,
        totalMonths: 3,
        startedTurn: state.turn,
        generalId: 'guanyu',
      },
    ];
    state.cities.jiangxia!.landmarks = ['farm'];
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => {
      root!.render(<CityPanel state={state} cityId="jiangxia" onDeploy={() => {}} />);
    });
    expect(el.textContent).toContain('训练');
    expect(el.textContent).toContain('演武');
    expect(el.textContent).toContain('本月额度');
    expect(el.textContent).toContain('全城宴请');
    expect(el.textContent).toContain('事件驱动');
    expect(el.textContent).toContain('按上限分配');
    expect(el.textContent).toContain('营造');
    expect(el.textContent).toContain('营造位 1/2');
    expect(el.textContent).toContain('2 月后完工');
    expect(el.textContent).toContain('屯田');
    expect(el.textContent).toContain('市集');
    expect(el.textContent).toContain('城墙');
    expect(el.textContent).toContain('兵营');
    expect(el.textContent).toContain('地标');
    expect(el.textContent).toContain('农田');
    expect(el.textContent).toContain('探索');
    expect(el.textContent).toContain('人才');
    expect(el.textContent).toContain('宝物');
    expect(el.textContent).toContain('情报');
    expect(el.textContent).toContain('民心');
    expect(el.textContent).toContain('本州传闻');
  });

  it('经典模式隐藏营造区块', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const state = createGame({
      playerFactionId: 'liubei',
      aiEnabled: false,
      ruleset: 'classic',
    });
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => {
      root!.render(<CityPanel state={state} cityId="jiangxia" onDeploy={() => {}} />);
    });
    expect(el.textContent).not.toContain('营造');
    expect(el.textContent).toContain('搜索');
    expect(el.textContent).not.toContain('本州传闻');
  });

  it('武将总览按城分组列出全势力将领', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const state = createGame({ playerFactionId: 'liubei', aiEnabled: false });
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => {
      root!.render(
        <RosterDialog state={state} onClose={() => {}} onPickCity={() => {}} />,
      );
    });
    expect(el.textContent).toContain('武将总览');
    expect(el.textContent).toContain('江夏');
    expect(el.textContent).toContain('新野');
    expect(el.textContent).toContain('关羽');
    expect(el.textContent).toContain('陈到');
    expect(el.textContent).toContain('兵');
  });

  it('国策与事件弹窗展示三选一和城内资源', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const state = createGame({ playerFactionId: 'liubei', aiEnabled: false });
    state.policy = { offer: ['tuntian', 'salt', 'qiuxian'], offeredTurn: state.turn };
    state.pendingEvent = { eventId: 'caravan', cityId: 'jiangxia', turn: state.turn };
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => {
      root!.render(
        <>
          <PolicyModal state={state} />
          <EventModal state={state} />
        </>,
      );
    });
    expect(el.textContent).toContain('定下未来 3 回合的路线');
    expect(el.textContent).toContain('屯田');
    expect(el.textContent).toContain('城内金钱');
    expect(el.textContent).toContain('商队来投');
  });

  it('月报渲染结论、建议与可展开的原因/明细', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const report: Report = {
      kind: 'month',
      title: '208 年 3 月 · 月报',
      subtitle: '月结已结算',
      lines: [
        {
          label: '资源',
          text: '粮食 +200',
          tone: 'info',
          reason: '月产粮 +200',
          detail: '江夏 +200',
          advice: '局势平稳',
        },
      ],
    };
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => {
      root!.render(<ReportModal report={report} />);
    });
    expect(el.textContent).toContain('粮食 +200');
    expect(el.textContent).toContain('建议：局势平稳');
    expect(el.textContent).toContain('原因与明细');
    expect(el.textContent).toContain('月产粮 +200');
    expect(el.textContent).toContain('江夏 +200');
  });

  it('战棋渲染行动顺序条与六层信息入口', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const state = createGame({ playerFactionId: 'liubei', aiEnabled: false });
    createBattle(state, 'jiangxia', 'xiangyang', ['liubei', 'guanyu']);
    gameStore.start(state);

    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => {
      root!.render(<App />);
    });

    expect(el.querySelector('.action-order')).toBeTruthy();
    expect(el.querySelectorAll('.ao-chip').length).toBeGreaterThan(0);
    expect(el.textContent).toContain('战场部队');
    expect(el.textContent).toContain('显示威胁范围');
    expect(el.textContent).toContain('预计破城');
  });

  it('中立空城面板显示劝降入口', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const state = createGame({ playerFactionId: 'liubei', aiEnabled: false });
    state.cities.xiangyang!.ownerId = null;
    for (const g of Object.values(state.generals)) {
      if (g.locationId === 'xiangyang') {
        g.status = 'inactive';
        g.troops = 0;
      }
    }
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => {
      root!.render(<CityPanel state={state} cityId="xiangyang" onDeploy={() => {}} />);
    });
    expect(el.textContent).toContain('劝降');
    expect(el.textContent).toContain('中立空城');
  });

  it('大势已定时显示统一弹窗', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const state = createGame({ playerFactionId: 'liubei', aiEnabled: false });
    state.unifyReady = true;
    gameStore.start(state);
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => {
      root!.render(<App />);
    });
    expect(el.textContent).toContain('大势已定');
    expect(el.textContent).toContain('直接统一');
    expect(el.textContent).toContain('继续征战');
  });

  it('键盘：? 打开快捷键，Esc 关闭，E 结束回合', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const state = createGame({ playerFactionId: 'liubei', aiEnabled: false });
    gameStore.start(state);
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => {
      root!.render(<App />);
    });

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }));
    });
    expect(el.textContent).toContain('战棋 Tab');
    expect(el.textContent).toContain('战棋 Space');

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(el.textContent).not.toContain('战棋 Tab');

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e' }));
    });
    expect(gameStore.state?.month).toBe(2);
    await act(async () => {
      gameStore.quit();
    });
  });

  it('音量设置面板可以打开并显示三路音量', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => {
      root!.render(<AudioSettingsButton />);
    });

    const btn = [...el.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('声音'),
    );
    expect(btn).toBeTruthy();

    await act(async () => {
      btn!.click();
    });

    expect(el.textContent).toContain('总音量');
    expect(el.textContent).toContain('音乐');
    expect(el.textContent).toContain('音效');
    expect(el.querySelectorAll('input[type="range"]').length).toBe(3);
  });

  it('势力外交弹窗列出国力、关系与行动', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const state = createGame({ playerFactionId: 'liubei', aiEnabled: false });
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => {
      root!.render(<FactionDiplomacyDialog state={state} onClose={() => {}} />);
    });
    expect(el.textContent).toContain('势力外交');
    expect(el.textContent).toContain('曹操');
    expect(el.textContent).toContain('战争');
    expect(el.textContent).toContain('送礼');
    expect(el.textContent).toContain('停战');
    expect(el.textContent).toContain('结盟');
  });

  it('城池面板提供弃城撤退入口', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const state = createGame({ playerFactionId: 'liubei', aiEnabled: false });
    // 给江夏腾出驻军空间，确保新野守军可以整建制撤过去
    for (const g of Object.values(state.generals)) {
      if (g.status === 'active' && g.locationId === 'jiangxia') g.troops = 100;
    }
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => {
      root!.render(<CityPanel state={state} cityId="xinye" onDeploy={() => {}} />);
    });
    const btn = [...el.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === '弃城撤退',
    );
    expect(btn).toBeTruthy();
    expect(btn!.disabled).toBe(false);
  });

  it('守城战显示弃城撤退按钮', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const state = createGame({ playerFactionId: 'liubei', aiEnabled: false });
    state.turn = 3;
    state.generals.caocao!.troops = 3000;
    createBattle(state, 'xuchang', 'xinye', ['caocao'], 'caocao');
    gameStore.start(state);
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => {
      root!.render(<App />);
    });
    expect(el.textContent).toContain('弃城撤退');
  });

  it('AI 求和时弹出停战请求', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const state = createGame({ playerFactionId: 'liubei', aiEnabled: false });
    state.pendingDiplomacy = {
      fromFactionId: 'caocao',
      kind: 'truce',
      turn: state.turn,
    };
    gameStore.start(state);
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => {
      root!.render(<App />);
    });
    expect(el.textContent).toContain('停战请求');
    expect(el.textContent).toContain('接受停战');
    expect(el.textContent).toContain('拒绝');
  });
});
