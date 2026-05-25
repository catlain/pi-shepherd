/**
 * Guard StateTracker — 有状态规则引擎的状态收集器
 *
 * 自动追踪工具调用次数、字符量和连续错误次数，
 * 供 shepherd 的 tool_result hook 查询匹配。
 *
 * 状态只存在内存中，不持久化（重启 pi 重置）。
 */

export interface StateCondition {
  tools?: string[];
  gte?: number;
  lte?: number;
  countKind?: "calls" | "errors" | "chars";
}

export interface ResettableRule {
  comment: string;
  state?: StateCondition;
  resetOn?: string[];
  /** 运行时：已触发标记 */
  _triggered?: boolean;
}

export class StateTracker {
  private toolCounts = new Map<string, number>();
  private toolChars = new Map<string, number>();
  private consecutiveErrors = 0;
  /** 规则级触发状态：key = comment（规则唯一标识），value = { triggered, firedCount } */
  private ruleStates = new Map<string, { triggered: boolean; firedCount: number }>();

  /** 每次 tool_result 调用，自动更新状态 */
  update(toolName: string, resultChars: number, isError: boolean): void {
    this.toolCounts.set(toolName, (this.toolCounts.get(toolName) ?? 0) + 1);
    this.toolChars.set(toolName, (this.toolChars.get(toolName) ?? 0) + resultChars);
    this.consecutiveErrors = isError ? this.consecutiveErrors + 1 : 0;
  }

  /** 判断规则的状态条件是否满足 */
  matches(condition: StateCondition): boolean {
    const kind = condition.countKind ?? "calls";
    let value: number;

    if (kind === "errors") {
      value = this.consecutiveErrors;
    } else if (kind === "chars") {
      value = (condition.tools ?? []).reduce(
        (sum, t) => sum + (this.toolChars.get(t) ?? 0), 0,
      );
    } else {
      value = (condition.tools ?? []).reduce(
        (sum, t) => sum + (this.toolCounts.get(t) ?? 0), 0,
      );
    }

    if (condition.gte != null && value < condition.gte) return false;
    if (condition.lte != null && value > condition.lte) return false;
    return true;
  }

  /** 检查当前 toolName 是否触发 resetOn → 重置匹配规则的计数 */
  resetIf(toolName: string, rules: ResettableRule[]): void {
    for (const rule of rules) {
      if (rule.resetOn?.includes(toolName)) {
        if (rule.state?.tools) {
          for (const t of rule.state.tools) {
            this.toolCounts.delete(t);
            this.toolChars.delete(t);
          }
        }
        // 重置规则触发状态（持久化的 ruleStates）
        const key = rule.comment;
        if (this.ruleStates.has(key)) {
          this.ruleStates.get(key)!.triggered = false;
        }
        rule._triggered = false;
      }
    }
  }

  /** 获取格式化信息（用于 reason 模板替换） */
  getStats(tools: string[]): { count: number; chars: number } {
    return {
      count: tools.reduce((s, t) => s + (this.toolCounts.get(t) ?? 0), 0),
      chars: tools.reduce((s, t) => s + (this.toolChars.get(t) ?? 0), 0),
    };
  }

  /** 规则是否已触发（持久化在 StateTracker 内，不受 loadRules 重新创建实例影响） */
  isTriggered(ruleKey: string): boolean {
    return this.ruleStates.get(ruleKey)?.triggered ?? false;
  }

  /** 标记规则已触发，返回当前触发次数 */
  markTriggered(ruleKey: string): number {
    const s = this.ruleStates.get(ruleKey) ?? { triggered: true, firedCount: 0 };
    s.triggered = true;
    s.firedCount++;
    this.ruleStates.set(ruleKey, s);
    return s.firedCount;
  }

  /** 计算递增阈值：baseThreshold + firedCount * step */
  nextThreshold(baseThreshold: number, ruleKey: string, step = 5): number {
    const firedCount = this.ruleStates.get(ruleKey)?.firedCount ?? 0;
    return baseThreshold + firedCount * step;
  }
}
