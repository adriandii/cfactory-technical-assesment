import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HttpJobGateway } from './infrastructure/http-job-gateway';
import { App } from './presentation/App';
import './presentation/styles.css';

// Composition root: the only place that picks a concrete adapter for the JobGateway port.
const gateway = new HttpJobGateway('/api');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App gateway={gateway} />
  </StrictMode>,
);
