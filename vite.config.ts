import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        studio: 'map-studio.html',
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
    /**
     * 每个测试文件都会重建地形 / 关防这些重模块，起进程约 4 s。
     * 默认按 CPU 核数铺满时，60+ 文件同时起 worker 会撞上
     * `Timeout waiting for worker to respond`（2026-10-31 复现两次）。
     * 限到 4 个 worker：单文件隔离不变，只是不再让机器过载。
     */
    pool: 'forks',
    maxWorkers: 4,
  },
});
