import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { DashboardProvider } from './store/DashboardProvider';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/thresholds.css';
// Additive class names only, before the shell so shell.css's two
// forced overrides of the sheets above still win on source order.
import './styles/pages.css';
// The freshness verdict's two evidence layers. Additive, and imported after
// pages.css because the verdict reuses the page vocabulary it defines.
import './styles/freshness.css';
// Identification: the camera viewport, the manual box, and the four answers the
// lookup can give. Additive, and imported after freshness.css because the found
// item reuses the verdict chip and the fact grid it defines.
import './styles/identify.css';
// Last, so the shell's own rules and its two forced overrides of the
// stylesheets above win on source order.
import './styles/shell.css';

const container = document.getElementById('root');
if (container === null) throw new Error('index.html is missing its #root element');

createRoot(container).render(
  <StrictMode>
    <DashboardProvider>
      <App />
    </DashboardProvider>
  </StrictMode>,
);
