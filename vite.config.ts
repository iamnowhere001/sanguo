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
    /**
     * 两套环境分两个 project：
     * - `unit`：Node 环境，61 个 .spec.ts，纯规则 / 数据；
     * - `ui`：jsdom 环境，2 个 .spec.tsx，要起 DOM + 挂载整个 App，单文件环境开销约 17 s。
     *
     * 分开的直接原因：jsdom 文件与 node 文件混跑时，jsdom 的 environment 初始化会把
     * worker 启动拖到 vitest 硬编码的 60 s 之外，报
     * `[vitest-pool-runner]: Timeout waiting for worker to respond`（2026-10-31 复现三次）。
     * 串行跑这两个文件（`fileParallelism: false`）比调大并发更稳。
     */
    maxWorkers: 4,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/**/*.spec.ts'],
          /**
           * 复用 worker：61 个文件若每个都新起进程，启动开销（约 4.9 s/个）会占掉一半时间，
           * 且偶发撞上 60 s 启动超时。关掉隔离后只在 4 个 worker 里轮流跑。
           * 前提：用例之间不共享可变模块状态——本项目的地形 / 关防缓存是**只读**的静态构建，
           * 每个用例自己 `createGame`，所以安全。新增会写模块级状态的用例时，需显式复位。
           */
          isolate: false,
        },
      },
      {
        extends: true,
        test: {
          name: 'ui',
          environment: 'jsdom',
          include: ['tests/**/*.spec.tsx'],
          fileParallelism: false,
          maxWorkers: 1,
        },
      },
    ],
  },
});
