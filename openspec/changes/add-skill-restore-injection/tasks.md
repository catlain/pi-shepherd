## 1. 技能记录器

- [x] 1.1 新建 `shepherd/skill-restore.ts`：纯函数谓词 `isSkillRead(toolName, args)`（toolName==="read" 且 path 以 SKILL.md 结尾，大小写不敏感）
- [x] 1.2 会话内存态激活集（Set，插入序保最近激活）+ `registerSkillTracker(pi)` 监听 tool_result 调用谓词记录

## 2. 恢复注入与联动

- [x] 2.1 注入决策函数：读激活集 → 磁盘读正文（失败跳过入未恢复名单）→ maxSkills/maxTokens 双上限截断（最近优先）→ 产出 {注入正文, 未恢复名单}
- [x] 2.2 `session_compact` 回调集成：skillRestore 启用且激活集非空时 `sendMessage({ customType: "shepherd.skillRestore", content, display: false, details }, {})`；isSubagent 跳过
- [x] 2.3 `shepherd/compaction.ts` 联动：注入成功跳过 steer 文本改 ui.notify；空集/关闭/失败维持原提醒；截断名单追加进提醒文本点名

## 3. 配置接入

- [x] 3.1 `shepherd.skillRestore` 子键（enabled/maxSkills/maxTokens）走 `getEffectiveConfig` 三层合并，defaults { enabled: true, maxSkills: 4, maxTokens: 20000 }

## 4. 事件注册与导出

- [x] 4.1 barrel（shepherd/index.ts）导出 skill-restore；主 index.ts 注册 tool_result 追踪与 session_compact 内的注入调用

## 5. 测试

- [x] 5.1 谓词单测：read×SKILL.md 命中；大小写/反斜杠路径；非 SKILL.md、非 read 工具不命中
- [x] 5.2 记录器单测：mock tool_result 事件序列后激活集内容与插入序
- [x] 5.3 注入决策单测：上限截断（超技能数/超 token）、读盘失败入名单、空集零注入
- [x] 5.4 联动单测：注入成功降级 notify 不 pushWarning；关闭/空集维持提醒；截断点名
- [x] 5.5 barrel mock 回归：为 mock `../shepherd` barrel 的既有测试文件补 `registerSkillTracker`/新导出 mock（0.2.0 的 54 失败教训）

## 6. 冒烟与门禁

- [x] 6.1 真机冒烟：read 一个 SKILL.md → `/compact` → 验证 session 历史新增 `shepherd.skillRestore` entry 且 AI 下轮可见正文、TUI 无显示
- [x] 6.2 `npm run typecheck` + `npm test` 全绿 + 分仓精确 `git add` 提交
