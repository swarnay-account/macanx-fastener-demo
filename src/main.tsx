import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/app.css';
import App from './App';
import { hostAllowed, breakOutOfFrames } from './lib/guard';

breakOutOfFrames();

const root = createRoot(document.getElementById('root')!);
if (hostAllowed()) {
  root.render(<StrictMode><App /></StrictMode>);
} else {
  root.render(
    <div className="empty empty--page">
      <h1>This demo is not available here</h1>
      <p>The Fastener ERP demo runs only on its own address. Please contact MacanX for access.</p>
    </div>,
  );
}
