import { execSync } from 'child_process';

export default function setup() {
  // 在测试运行前初始化数据库表
  execSync('npm run db:init', { stdio: 'ignore', cwd: process.cwd() });
}
