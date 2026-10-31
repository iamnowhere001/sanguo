import React from 'react';
import { createRoot } from 'react-dom/client';
import MapStudio from './MapStudio';
import '../styles/global.css';

const el = document.getElementById('studio-app');
if (!el) throw new Error('缺少 #studio-app 挂载点');

createRoot(el).render(
  <React.StrictMode>
    <MapStudio />
  </React.StrictMode>,
);
