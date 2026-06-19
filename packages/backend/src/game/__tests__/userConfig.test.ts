import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadUsersConfig,
  getUsersConfigPath,
  isRegistrationAllowed,
  shouldShowTestHint,
  getConfiguredUsers,
  resetUsersConfigCache,
} from '../../userConfig.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_CONFIG_DIR = path.join(__dirname, '../../../test-configs');
const TEST_CONFIG_PATH = path.join(TEST_CONFIG_DIR, 'users.test.json');

describe('userConfig', () => {
  beforeEach(() => {
    resetUsersConfigCache();
    if (!fs.existsSync(TEST_CONFIG_DIR)) {
      fs.mkdirSync(TEST_CONFIG_DIR, { recursive: true });
    }
    process.env.USERS_CONFIG_PATH = TEST_CONFIG_PATH;
  });

  afterEach(() => {
    delete process.env.USERS_CONFIG_PATH;
    resetUsersConfigCache();
    if (fs.existsSync(TEST_CONFIG_PATH)) {
      fs.unlinkSync(TEST_CONFIG_PATH);
    }
  });

  it('配置文件不存在时返回默认关闭注册', () => {
    if (fs.existsSync(TEST_CONFIG_PATH)) fs.unlinkSync(TEST_CONFIG_PATH);
    resetUsersConfigCache();
    expect(isRegistrationAllowed()).toBe(false);
    expect(shouldShowTestHint()).toBe(false);
    expect(getConfiguredUsers()).toEqual([]);
  });

  it('读取配置文件的注册开关', () => {
    fs.writeFileSync(
      TEST_CONFIG_PATH,
      JSON.stringify({ allowRegistration: true, showTestHint: true, users: [] })
    );
    resetUsersConfigCache();
    expect(isRegistrationAllowed()).toBe(true);
    expect(shouldShowTestHint()).toBe(true);
  });

  it('读取配置文件中的固定用户', () => {
    fs.writeFileSync(
      TEST_CONFIG_PATH,
      JSON.stringify({
        allowRegistration: false,
        users: [{ id: 'u1', username: 'alice', password: 'secret' }],
      })
    );
    resetUsersConfigCache();
    const users = getConfiguredUsers();
    expect(users).toHaveLength(1);
    expect(users[0].id).toBe('u1');
    expect(users[0].username).toBe('alice');
  });

  it('缓存会在 reset 后重新读取', () => {
    fs.writeFileSync(
      TEST_CONFIG_PATH,
      JSON.stringify({ allowRegistration: true, users: [] })
    );
    resetUsersConfigCache();
    expect(isRegistrationAllowed()).toBe(true);

    fs.writeFileSync(
      TEST_CONFIG_PATH,
      JSON.stringify({ allowRegistration: false, users: [] })
    );
    // 未 reset 前仍使用缓存
    expect(isRegistrationAllowed()).toBe(true);
    resetUsersConfigCache();
    expect(isRegistrationAllowed()).toBe(false);
  });

  it('getUsersConfigPath 优先使用环境变量', () => {
    expect(getUsersConfigPath()).toBe(TEST_CONFIG_PATH);
  });
});
