/**
 * KNITCAT — PWA layer: install, offline, updates, and launched files.
 *
 * Everything here is additive. No browser is required to support any of it: each
 * capability is feature-detected, and when it is missing the app simply carries
 * on as a web page. That matters because the audience skews toward phones and
 * older laptops, and a knitting studio that throws on `navigator.registerProtocolHandler`
 * is worse than one that quietly does not offer the shortcut.
 *
 * What it gives a visitor who taps "Install":
 *   - a standalone window with its own taskbar entry
 *   - the whole studio on a plane, in a basement yarn shop, or in a field
 *   - `.kcard` files opening straight into the app from the file manager
 *   - a visible notice when a new deploy is waiting, instead of a silent split
 *     between what one tab shows and the next one gets
 */

const SW_PATH = 'sw.js';

let notifier = null;
let hooks = null;
let deferredPrompt = null;
let chipEl = null;
let bannerEl = null;
let installBtn = null;

/** Standalone = running from an installed shortcut rather than a browser tab. */
export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches ||
    navigator.standalone === true;
}

function injectChrome() {
  const actions = document.querySelector('.header-actions');
  if (actions) {
    installBtn = document.createElement('button');
    installBtn.type = 'button';
    installBtn.id = 'btn-install-app';
    installBtn.className = 'btn-action pwa-install hidden';
    installBtn.title = 'Put KNITCAT on this device so it works with no signal';
    installBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M12 3v12" /><path d="m7 10 5 5 5-5" />
        <path d="M5 21h14" />
      </svg>
      Install`;
    installBtn.addEventListener('click', () => promptInstall());
    // Install belongs at the end of the row: it is the least-used, most permanent
    // action here, and it should never out-shout Feasibility or Export.
    actions.appendChild(installBtn);
  }

  chipEl = document.createElement('span');
  chipEl.id = 'net-status';
  chipEl.className = 'net-status';
  chipEl.setAttribute('role', 'status');
  chipEl.setAttribute('aria-live', 'polite');
  chipEl.hidden = true;
  (actions || document.body).prepend(chipEl);

  bannerEl = document.createElement('div');
  bannerEl.id = 'pwa-banner';
  bannerEl.className = 'pwa-banner';
  bannerEl.setAttribute('role', 'status');
  bannerEl.hidden = true;
  const container = document.getElementById('toast-container');
  if (container?.parentNode) {
    container.parentNode.insertBefore(bannerEl, container);
  } else {
    document.body.appendChild(bannerEl);
  }
}

function setBanner(text, actionLabel, onAction) {
  if (!bannerEl) return;
  if (!text) {
    bannerEl.hidden = true;
    bannerEl.textContent = '';
    return;
  }
  bannerEl.textContent = '';
  const label = document.createElement('span');
  label.className = 'pwa-banner-text';
  label.textContent = text;
  bannerEl.appendChild(label);
  if (actionLabel && typeof onAction === 'function') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pwa-banner-action';
    button.textContent = actionLabel;
    button.addEventListener('click', onAction);
    bannerEl.appendChild(button);
  }
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'pwa-banner-close';
  close.setAttribute('aria-label', 'Dismiss');
  close.textContent = '×';
  close.addEventListener('click', () => setBanner(null));
  bannerEl.appendChild(close);
  bannerEl.hidden = false;
}

function refreshStatus(registration) {
  const offline = navigator.onLine === false;
  if (!chipEl) return;
  const installed = isStandalone();
  chipEl.hidden = !(offline || installed);
  chipEl.classList.toggle('net-status--offline', offline);
  chipEl.classList.toggle('net-status--installed', installed && !offline);
  chipEl.textContent = offline ? 'Offline' : 'Installed';
  chipEl.title = offline
    ? 'No connection. The studio and everything you have drawn are still here — this app runs fully offline once it has been loaded once.'
    : 'KNITCAT is installed on this device and cached for offline use.';
  if (registration?.active?.state === 'activated' && !offline) {
    // The worker is live and the link is up: nothing to tell the user.
    setBanner(null);
  }
}

function showInstallButton(show) {
  if (!installBtn) return;
  installBtn.classList.toggle('hidden', !show);
  installBtn.setAttribute('aria-hidden', show ? 'false' : 'true');
}

/**
 * Ask the browser for the install prompt. Returns true if a real prompt appeared.
 * Safari has no `beforeinstallprompt` at all, so iPhone users get the manual
 * Add-to-Home-Screen route instead — see the help panel (section 15).
 */
export async function promptInstall() {
  if (!deferredPrompt) return false;
  const prompt = deferredPrompt;
  deferredPrompt = null;
  showInstallButton(false);
  prompt.prompt();
  const { outcome } = await prompt.userChoice.catch(() => ({ outcome: 'error' }));
  if (outcome !== 'accepted') {
    // Do not nag. The browser will fire another beforeinstallprompt later if the
    // user keeps visiting, and that is the right time to offer again.
    notifier?.info('Install declined — the button stays in the header if you change your mind.');
    return false;
  }
  return true;
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    if (!window.isSecureContext) {
      console.info('[KNITCAT][PWA] Insecure origin: service worker skipped (needs HTTPS or localhost).');
    }
    return null;
  }
  try {
    const registration = await navigator.serviceWorker.register(SW_PATH, { scope: './' });

    registration.addEventListener('updatefound', () => {
      const next = registration.installing;
      if (!next) return;
      next.addEventListener('statechange', () => {
        if (next.state === 'installed' && navigator.serviceWorker.controller) {
          setBanner('A new version of KNITCAT is ready.', 'Reload now', () => {
            setBanner(null);
            next.postMessage?.({ type: 'knitcat:skip-waiting' });
            window.location.reload();
          });
        }
      });
    });

    navigator.serviceWorker.addEventListener('message', event => {
      const type = event.data?.type;
      if (type === 'knitcat:offline-miss') {
        notifier?.warn('That part needs one online load.', {
          details: `KNITCAT could not fetch ${new URL(event.data.url).pathname.split('/').pop()} without a connection. Everything already loaded still works.`,
          duration: 7000
        });
      }
    });

    return registration;
  } catch (err) {
    console.warn('[KNITCAT][PWA] Service worker registration failed:', err);
    return null;
  }
}

/** Read the launch intent out of the URL (manifest shortcuts + protocol handler + share target). */
function consumeUrlIntent() {
  const params = new URLSearchParams(window.location.search);
  const intent = {};
  if (params.get('tab')) intent.tab = params.get('tab');
  if (params.get('open')) intent.open = params.get('open');
  if (params.get('import')) intent.import = params.get('import');
  if (params.get('mode')) intent.mode = params.get('mode');
  // A GET share target (manifest `share_target`) arrives as title/text/url.
  for (const key of ['title', 'text', 'url']) {
    if (params.get(key)) intent[key] = params.get(key);
  }
  if (!Object.keys(intent).length) return;
  hooks?.onIntent?.(intent);
  // The intent is spent. Leaving it in the address bar means a refresh (or a
  // shared link) replays it, and a modal that reopens itself is a bug report
  // waiting to happen.
  try {
    params.delete('tab');
    params.delete('open');
    params.delete('import');
    params.delete('mode');
    params.delete('title');
    params.delete('text');
    params.delete('url');
    // The fragment is carried over deliberately: `#p=…` is a share payload that
    // js/features/share.js still has to read, and rewriting without it would
    // silently delete the pattern the visitor came for.
    const clean = `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash || ''}`;
    window.history.replaceState(null, '', clean);
  } catch (_) { /* sandboxed history is not fatal */ }
}

/**
 * Boot the PWA layer.
 *
 * @param {object} ctx
 * @param {{info?:Function,warn?:Function}} [ctx.notifier]
 * @param {(intent: {tab?:string,open?:string,import?:string,mode?:string,title?:string,text?:string,url?:string}) => void} [ctx.onIntent]
 * @param {(file: File) => void} [ctx.onFile]  a .kcard handed over by the OS
 */
export function initPwa(ctx = {}) {
  notifier = ctx.notifier || null;
  hooks = ctx;

  injectChrome();
  consumeUrlIntent();
  refreshStatus(null);

  window.addEventListener('online', () => {
    refreshStatus(null);
    setBanner(null);
    notifier?.success('Back online — exports, shares and updates are available again.', { duration: 4000 });
  });
  window.addEventListener('offline', () => {
    refreshStatus(null);
    notifier?.info('Offline. Keep working — the studio is fully cached.', {
      details: 'Drawing, compiling, simulating and the 1:1 print view all run with no connection.',
      duration: 6000
    });
  });

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event;
    showInstallButton(true);
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    showInstallButton(false);
    notifier?.success('KNITCAT installed. Look for it with the other apps.');
    refreshStatus(null);
  });

  if ('launchQueue' in window && typeof window.launchQueue?.setConsumer === 'function') {
    window.launchQueue.setConsumer(params => {
      const file = params?.files?.[0];
      if (file) hooks?.onFile?.(file);
    });
  }

  const registration = registerServiceWorker().then(reg => {
    refreshStatus(reg);
    return reg;
  });

  return {
    isStandalone: () => isStandalone(),
    canInstall: () => Boolean(deferredPrompt),
    promptInstall,
    registration,
    refreshStatus: () => refreshStatus(null),
    setBanner
  };
}
