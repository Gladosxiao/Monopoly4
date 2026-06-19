import './style.css';
import { enableTestMode } from './testMode/index.js';
import { loadCurrentUser, getCurrentUser } from './state/user.js';
import { navigateToLogin, navigateToLobby } from './router.js';

// 仅在开发环境启用测试模式面板（后端仍受 ENABLE_TEST_MODE 环境变量与房主权限控制）
if ((import.meta as any).env?.DEV) {
  enableTestMode();
}

// 启动
loadCurrentUser();
if (getCurrentUser()) {
  navigateToLobby();
} else {
  navigateToLogin();
}
