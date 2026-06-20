/** 转义 HTML 特殊字符，防止 XSS。 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** 显示 Toast 通知 */
export function showToast(message: string, type: 'info' | 'error' | 'success' = 'info'): void {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    (toast as HTMLElement).style.animation = 'toastOut 0.25s forwards';
    toast.addEventListener('animationend', () => toast.remove());
  }, 3000);
}

let bannerTimer: ReturnType<typeof setTimeout> | null = null;
let currentBanner: HTMLElement | null = null;

/**
 * 显示顶部居中 Banner，几秒后自动消失，新的 Banner 会立即顶掉旧的。
 * 用于事件类消息（罚款、获得金钱、住院等）的强提醒。
 */
export function showBanner(
  message: string,
  type: 'info' | 'error' | 'success' | 'warning' = 'info',
  duration = 4000
): void {
  let container = document.querySelector('.banner-container') as HTMLElement | null;
  if (!container) {
    container = document.createElement('div');
    container.className = 'banner-container';
    document.body.appendChild(container);
  }

  if (currentBanner) {
    currentBanner.remove();
    currentBanner = null;
  }
  if (bannerTimer) {
    clearTimeout(bannerTimer);
    bannerTimer = null;
  }

  const banner = document.createElement('div');
  banner.className = `banner ${type}`;
  banner.textContent = message;
  container.appendChild(banner);
  currentBanner = banner;

  bannerTimer = setTimeout(() => {
    banner.style.animation = 'bannerOut 0.3s forwards';
    banner.addEventListener('animationend', () => {
      banner.remove();
      if (currentBanner === banner) currentBanner = null;
    });
  }, duration);
}

/** 显示一个自定义输入弹窗，替代 window.prompt */
export function showPrompt(
  message: string,
  options?: { choices?: { label: string; value: string }[]; defaultValue?: string }
): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const box = document.createElement('div');
    box.className = 'modal-box';

    const title = document.createElement('h3');
    title.textContent = '请输入';

    const body = document.createElement('p');
    body.textContent = message;

    let input: HTMLInputElement | HTMLSelectElement;
    if (options?.choices && options.choices.length > 0) {
      input = document.createElement('select');
      options.choices.forEach((c) => {
        const opt = document.createElement('option');
        opt.value = c.value;
        opt.textContent = c.label;
        input.appendChild(opt);
      });
    } else {
      input = document.createElement('input');
      input.type = 'text';
      input.value = options?.defaultValue ?? '';
      input.placeholder = '输入内容...';
    }

    const buttons = document.createElement('div');
    buttons.className = 'modal-buttons';

    const okBtn = document.createElement('button');
    okBtn.textContent = '确定';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '取消';
    cancelBtn.className = 'secondary';

    buttons.appendChild(cancelBtn);
    buttons.appendChild(okBtn);

    box.appendChild(title);
    box.appendChild(body);
    box.appendChild(input);
    box.appendChild(buttons);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    input.focus();

    const close = (value: string | null) => {
      overlay.remove();
      resolve(value);
    };

    okBtn.addEventListener('click', () => close(input.value));
    cancelBtn.addEventListener('click', () => close(null));
    input.addEventListener('keydown', (e) => {
      const evt = e as KeyboardEvent;
      if (evt.key === 'Enter') close(input.value);
      if (evt.key === 'Escape') close(null);
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });
  });
}
