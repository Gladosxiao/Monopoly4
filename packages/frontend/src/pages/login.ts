import { getAuthConfig, login, register, saveAuth } from '../api.js';
import { setCurrentUser } from '../state/user.js';
import { navigateToLogin, navigateToLobby } from '../router.js';
import { escapeHtml } from '../ui/common.js';

const app = document.getElementById('app')!;

function translateAuthError(message: string): string {
  const map: Record<string, string> = {
    'Invalid credentials': '用户名或密码错误',
    'Username already exists': '用户名已被注册，请更换或直接登录',
    'Invalid username or password': '用户名至少 3 位，密码至少 6 位',
    'Missing refresh token': '登录状态已失效，请重新登录',
    'Invalid refresh token': '登录状态已过期，请重新登录',
    'User not found': '用户不存在，请重新登录',
    'Unauthorized': '未登录或登录已过期',
    'Registration is disabled': '当前不开放注册',
    '登录已过期，请重新登录': '登录已过期，请重新登录',
  };
  return map[message] || message;
}

export async function renderLoginPage(error?: string): Promise<void> {
  let allowRegistration = false;
  try {
    const config = await getAuthConfig();
    allowRegistration = config.allowRegistration;
  } catch {
    allowRegistration = false;
  }

  const container = document.createElement('div');
  container.className = 'page login-page';
  container.innerHTML = `
    <div class="brand">
      <span class="logo">🎲</span>
      <h1>大富翁4 Web</h1>
      <span class="tagline">Monopoly 4 · Online</span>
    </div>
    <div class="auth-box">
      <h2>登录</h2>
      ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
      <div class="auth-hint">
        <span class="hint-label">默认账号</span>
        <code>test</code> / <code>test123</code>
      </div>
      <input type="text" id="username" placeholder="用户名" autocomplete="username" />
      <input type="password" id="password" placeholder="密码" autocomplete="current-password" />
      <div class="buttons">
        <button id="btn-login">登录</button>
        ${allowRegistration ? '<button id="btn-register" class="btn-register">注册新账号</button>' : ''}
      </div>
    </div>
  `;
  app.appendChild(container);

  const username = container.querySelector<HTMLInputElement>('#username')!;
  const password = container.querySelector<HTMLInputElement>('#password')!;

  function clearErrorOnInput(): void {
    const errorEl = container.querySelector('.error');
    if (errorEl) errorEl.textContent = '';
  }
  username.addEventListener('input', clearErrorOnInput);
  password.addEventListener('input', clearErrorOnInput);

  container.querySelector('#btn-login')!.addEventListener('click', async () => {
    if (!username.value || !password.value) {
      const errorEl = container.querySelector('.error');
      if (errorEl) errorEl.textContent = '请输入用户名和密码';
      return;
    }
    try {
      const res = await login(username.value, password.value);
      saveAuth(res);
      setCurrentUser(res.user);
      navigateToLobby();
    } catch (e: any) {
      navigateToLogin(translateAuthError(e.message));
    }
  });

  if (allowRegistration) {
    container.querySelector('#btn-register')!.addEventListener('click', async () => {
      if (username.value.length < 3 || password.value.length < 6) {
        const errorEl = container.querySelector('.error');
        if (errorEl) errorEl.textContent = '用户名至少 3 位，密码至少 6 位';
        return;
      }
      try {
        const res = await register(username.value, password.value);
        saveAuth(res);
        setCurrentUser(res.user);
        navigateToLobby();
      } catch (e: any) {
        navigateToLogin(translateAuthError(e.message));
      }
    });
  }
}
