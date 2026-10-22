import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App';
import { gameStore } from './store/gameStore';
import { installAudioUnlock, installUiAudio, audio } from './audio';
import './styles/global.css';

// 音频初始化的两步都在渲染前装好：
// 1) 首次用户手势解锁 AudioContext（浏览器自动播放策略）
// 2) 全局按钮点击音，一次覆盖所有界面
installAudioUnlock();
installUiAudio();

if (import.meta.env.DEV) {
  // 开发期调试入口：自动化脚本与控制台可直接读取同一 store / 音频引擎实例
  (globalThis as typeof globalThis & { __gameStore?: typeof gameStore }).__gameStore = gameStore;
  (globalThis as typeof globalThis & { __audio?: typeof audio }).__audio = audio;
}

const el = document.getElementById('app');
if (!el) throw new Error('缺少 #app 挂载点');

createRoot(el).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
