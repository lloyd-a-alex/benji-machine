/**
 * Accessible toast notification center for KNITCAT.
 * Replaces blocking alert() dialogs with non-modal, screen-reader-friendly messages.
 */

const TYPE_META = {
  success: { label: 'Success', icon: '✓' },
  error: { label: 'Error', icon: '✕' },
  warning: { label: 'Warning', icon: '!' },
  info: { label: 'Info', icon: 'i' }
};

export class NotificationCenter {
  constructor(containerId = 'toast-container') {
    this.container = document.getElementById(containerId);
    this.queue = [];
    this.maxVisible = 4;
  }

  show(message, options = {}) {
    const {
      type = 'info',
      title = null,
      details = null,
      duration = 4500,
      log = true
    } = options;

    const headline = title || message;
    const body = title ? message : null;
    const detailLines = Array.isArray(details)
      ? details.filter(Boolean)
      : (details ? [details] : []);

    if (log) {
      const payload = detailLines.length ? detailLines : (body || headline);
      const logFn = type === 'error' ? console.error : type === 'warning' ? console.warn : console.log;
      logFn(`[KNITCAT][${type}] ${headline}`, payload);
    }

    if (!this.container) {
      console.warn('[KNITCAT] Toast container missing; falling back to console only.');
      return null;
    }

    const toast = document.createElement('div');
    toast.className = `app-toast app-toast--${type}`;
    toast.setAttribute('role', type === 'error' || type === 'warning' ? 'alert' : 'status');
    toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');

    const meta = TYPE_META[type] || TYPE_META.info;

    toast.innerHTML = `
      <div class="app-toast-icon" aria-hidden="true">${meta.icon}</div>
      <div class="app-toast-body">
        <div class="app-toast-title">${this._escape(headline)}</div>
        ${body ? `<div class="app-toast-message">${this._escape(body)}</div>` : ''}
        ${detailLines.length ? `<ul class="app-toast-details">${detailLines.map(line => `<li>${this._escape(line)}</li>`).join('')}</ul>` : ''}
      </div>
      <button type="button" class="app-toast-close" aria-label="Dismiss notification">×</button>
    `;

    const dismiss = () => {
      toast.classList.add('app-toast--dismiss');
      window.setTimeout(() => toast.remove(), 220);
    };

    toast.querySelector('.app-toast-close')?.addEventListener('click', dismiss);
    toast.addEventListener('click', (e) => {
      if (e.target === toast) dismiss();
    });

    this.container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('app-toast--visible'));

    while (this.container.children.length > this.maxVisible) {
      this.container.firstElementChild?.remove();
    }

    if (duration > 0) {
      window.setTimeout(dismiss, duration);
    }

    return toast;
  }

  success(message, options = {}) {
    return this.show(message, { ...options, type: 'success' });
  }

  error(message, options = {}) {
    return this.show(message, { ...options, type: 'error', duration: options.duration ?? 7000 });
  }

  warn(message, options = {}) {
    return this.show(message, { ...options, type: 'warning', duration: options.duration ?? 6000 });
  }

  info(message, options = {}) {
    return this.show(message, { ...options, type: 'info' });
  }

  _escape(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
