import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TrafficApp } from './ui/TrafficApp';
import './traffic.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TrafficApp />
  </StrictMode>,
);
