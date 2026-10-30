/**
 * 音频对外门面。
 *
 * 集成只有三个入口：
 * 1. `installAudioUnlock()` —— 首次用户手势恢复 AudioContext（浏览器策略要求）
 * 2. `installUiAudio()`     —— 全局按钮点击音，20+ 个组件不用各写一遍
 * 3. `audio.*`              —— 规则层 / 界面按需调用
 */

import { AudioEngine } from './engine';
import type { OneShotId } from './types';

export const audio = new AudioEngine();

export { cuesForAction, playerCityGain, sceneFor } from './director';

let unlockInstalled = false;

/**
 * 浏览器自动播放策略：AudioContext 必须在用户手势里 resume。
 * 监听 pointerdown / keydown，成功后自行摘除，避免长期占着全局监听。
 */
export function installAudioUnlock(): void {
  if (unlockInstalled || typeof window === 'undefined') return;
  unlockInstalled = true;

  const onGesture = (): void => {
    audio.unlock();
    if (audio.isRunning()) {
      window.removeEventListener('pointerdown', onGesture, true);
      window.removeEventListener('keydown', onGesture, true);
    }
  };

  window.addEventListener('pointerdown', onGesture, true);
  window.addEventListener('keydown', onGesture, true);
}

let uiInstalled = false;

/**
 * 全局按钮音。
 *
 * 用捕获阶段的事件委托而不是逐个组件埋点：
 * - 覆盖所有现有与后续新增的 <button>，不会漏；
 * - 通过 data-audio 属性可覆盖默认判定（none / cancel / confirm）。
 */
export function installUiAudio(): void {
  if (uiInstalled || typeof document === 'undefined') return;
  uiInstalled = true;

  document.addEventListener(
    'click',
    (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const el = target.closest('button, [data-audio]');
      if (!el) return;
      if (el instanceof HTMLButtonElement && el.disabled) return;
      if (el.getAttribute('aria-disabled') === 'true') return;

      const cue = el.getAttribute('data-audio');
      if (cue === 'none') return;

      let id: OneShotId = 'ui.click';
      if (cue === 'cancel') id = 'ui.cancel';
      else if (cue === 'confirm') id = 'ui.confirm';
      else if (
        el.classList.contains('primary') ||
        el.classList.contains('danger') ||
        el.classList.contains('hero')
      ) {
        id = 'ui.confirm';
      }
      audio.play(id);
    },
    true,
  );
}
