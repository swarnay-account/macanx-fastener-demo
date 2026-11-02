import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { notify } from '../components/ui';

declare const __ARTIFACT__: boolean;

/**
 * Prints a document from the demo. Every page carries a "DEMO" watermark so a
 * demo bill or tag can never pass as a real one.
 */
export function printDoc(node: ReactNode) {
  if (__ARTIFACT__) {
    notify('Printing is switched off in this online preview. The full version prints bills, tags and reports.', 'info');
    return;
  }
  let host = document.getElementById('print-root');
  if (!host) {
    host = document.createElement('div');
    host.id = 'print-root';
    document.body.appendChild(host);
  }
  const root = createRoot(host);
  flushSync(() => root.render(<div className="print-doc">{node}<div className="print-mark" aria-hidden="true">DEMO, SAMPLE ONLY</div></div>));
  document.body.classList.add('printing');
  const done = () => {
    document.body.classList.remove('printing');
    root.unmount();
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 50);
}
