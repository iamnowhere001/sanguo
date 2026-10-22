// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from '../src/ui/App';
import { CityPanel } from '../src/ui/CityPanel';
import { createGame } from '../src/data/tables/scenarios';
import { gameStore } from '../src/store/gameStore';

declare global {
  // React 19 的 act 环境标记
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
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
  });

  it('城池面板展示训练、交易额度、演武与全城宴请', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const state = createGame({ playerFactionId: 'liubei', aiEnabled: false });
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
  });
});
