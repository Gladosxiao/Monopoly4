import { runMigrations } from '../migrations/index.js';
import { syncUsersFromConfig } from '../userConfig.js';

// 应用所有数据库迁移
runMigrations();

// 同步配置文件中定义的固定用户（不删除已有用户）
syncUsersFromConfig();

console.log('Database initialized.');
