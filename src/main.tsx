import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App';
import { gameStore } from './store/gameStore';
import './styles/global.css';

if (import.meta.env.DEV) {
  // 开发期调试入口：自动化脚本与控制台可直接读取同一 store 实例
  (globalThis as typeof globalThis & { __gameStore?: typeof gameStore }).__gameStore = gameStore;
}

const el = document.getElementById('app');
if (!el) throw new Error('缺少 #app 挂载点');

createRoot(el).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
