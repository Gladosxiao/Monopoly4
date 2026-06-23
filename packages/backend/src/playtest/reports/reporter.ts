/**
 * 测试报告生成器
 *
 * 收集问题并生成 Markdown 格式的测试报告。
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { PlaytestReport, Issue, IssueSeverity } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 报告输出目录 */
const REPORTS_DIR = path.resolve(__dirname, '../../../playtest-reports');

/** 严重程度排序权重 */
const SEVERITY_ORDER: Record<IssueSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

/** 严重程度标签 */
const SEVERITY_LABEL: Record<IssueSeverity, string> = {
  critical: '🔴 严重',
  high: '🟠 高',
  medium: '🟡 中',
  low: '🟢 低',
  info: '🔵 信息',
};

/**
 * 报告收集器。
 * 在测试过程中收集问题，最终生成报告。
 */
export class Reporter {
  private issues: Issue[] = [];

  /** 记录一个问题 */
  record(issue: Issue): void {
    this.issues.push(issue);
  }

  /** 获取所有问题 */
  getIssues(): Issue[] {
    return [...this.issues];
  }

  /** 获取指定严重程度的问题 */
  getIssuesBySeverity(severity: IssueSeverity): Issue[] {
    return this.issues.filter((i) => i.severity === severity);
  }

  /** 生成 Markdown 报告 */
  generateReport(report: PlaytestReport): string {
    const lines: string[] = [];

    lines.push('# 自动化对局测试报告');
    lines.push('');
    lines.push(`- **时间**：${report.startTime}`);
    lines.push(`- **耗时**：${(report.duration / 1000).toFixed(1)}s`);
    lines.push(`- **场景**：${report.scenario}`);
    lines.push(`- **回合数**：${report.totalTurns}`);
    lines.push(`- **结果**：${report.result === 'completed' ? '正常结束' : report.result === 'timeout' ? '超时' : '异常终止'}`);
    if (report.winnerId) {
      const winner = report.players.find((p) => p.userId === report.winnerId);
      lines.push(`- **胜者**：${winner?.username ?? report.winnerId}`);
    }
    lines.push('');

    // 玩家配置
    lines.push('## 玩家配置');
    lines.push('');
    lines.push('| 玩家 | 角色 | 策略 |');
    lines.push('|---|---|---|');
    for (const p of report.players) {
      lines.push(`| ${p.username} | ${p.characterId} | ${p.brainType} |`);
    }
    lines.push('');

    // 问题统计
    const allIssues = [...this.issues, ...report.issues];
    const criticalCount = allIssues.filter((i) => i.severity === 'critical').length;
    const highCount = allIssues.filter((i) => i.severity === 'high').length;
    const mediumCount = allIssues.filter((i) => i.severity === 'medium').length;

    lines.push('## 问题统计');
    lines.push('');
    lines.push(`- 🔴 严重: ${criticalCount}`);
    lines.push(`- 🟠 高: ${highCount}`);
    lines.push(`- 🟡 中: ${mediumCount}`);
    lines.push(`- 总计: ${allIssues.length}`);
    lines.push('');

    // 问题详情
    if (allIssues.length > 0) {
      lines.push('## 发现的问题');
      lines.push('');

      // 按严重程度排序
      const sorted = [...allIssues].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

      for (const issue of sorted) {
        lines.push(`### ${SEVERITY_LABEL[issue.severity]} ${issue.category}`);
        lines.push('');
        lines.push(`- **回合**：${issue.turn}`);
        if (issue.playerId) {
          const player = report.players.find((p) => p.userId === issue.playerId);
          lines.push(`- **玩家**：${player?.username ?? issue.playerId}`);
        }
        if (issue.action) {
          lines.push(`- **操作**：${issue.action}`);
        }
        lines.push(`- **期望**：${issue.expected}`);
        lines.push(`- **实际**：${issue.actual}`);
        if (issue.details) {
          lines.push(`- **详情**：${issue.details}`);
        }
        lines.push('');
      }
    } else {
      lines.push('## 发现的问题');
      lines.push('');
      lines.push('✅ 未发现任何问题');
      lines.push('');
    }

    // 最终状态
    if (report.finalState) {
      lines.push('## 最终状态');
      lines.push('');
      lines.push('| 玩家 | 资金 | 存款 | 贷款 | 地产数 | 破产 |');
      lines.push('|---|---|---|---|---|---|');
      for (const p of report.finalState.players) {
        lines.push(
          `| ${p.username} | ${p.cash} | ${p.deposit} | ${p.loan} | ${p.properties} | ${p.isBankrupt ? '是' : '否'} |`
        );
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /** 将报告写入文件 */
  async saveReport(report: PlaytestReport): Promise<string> {
    // 确保目录存在
    if (!fs.existsSync(REPORTS_DIR)) {
      fs.mkdirSync(REPORTS_DIR, { recursive: true });
    }

    const timestamp = report.startTime.replace(/[:.]/g, '-').slice(0, 19);
    const filename = `${timestamp}-report.md`;
    const filepath = path.join(REPORTS_DIR, filename);

    const content = this.generateReport(report);
    fs.writeFileSync(filepath, content, 'utf-8');

    return filepath;
  }
}
