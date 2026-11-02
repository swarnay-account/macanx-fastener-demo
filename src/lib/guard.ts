declare const __ALLOWED_HOSTS__: string;
declare const __ARTIFACT__: boolean;

/**
 * The demo only runs on the hosts it was built for (DEMO_ALLOWED_HOSTS at build
 * time), plus this computer during development. A copy of the files served from
 * anywhere else shows a notice instead of the app.
 */
export function hostAllowed(): boolean {
  const host = window.location.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return true;
  const allowed = __ALLOWED_HOSTS__.split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
  if (allowed.length === 0) return true;
  return allowed.some(h => host === h || (h.startsWith('*.') && host.endsWith(h.slice(1))));
}

/** Keeps the demo from being shown inside someone else's page. */
export function breakOutOfFrames() {
  if (__ARTIFACT__) return; // The Claude-hosted copy is meant to be shown in Claude's frame.
  try {
    if (window.top && window.top !== window.self) window.top.location.href = window.location.href;
  } catch {
    document.documentElement.innerHTML = '';
  }
}
