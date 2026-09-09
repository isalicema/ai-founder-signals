# Changelog

## 1.2.0 - 2026-09-09

这是 AI Founder Signals 的首个正式 GitHub Release；此前的公开迭代没有单独打 tag。

### 新增

- 深看历史面板：集中查看所有标记过深看的信号，不受未读收件箱清空影响。
- 历史搜索与状态筛选：区分有笔记、待处理及已处理但尚未关联的记录。
- 可选 Obsidian 跳转：通过 vault 名称和笔记相对路径打开本地分析笔记。
- 复古与极光两套历史面板界面，以及对应的公开演示截图。

### 调整

- 缩小极光皮肤中历史入口的辅助文字，保持概览数字的视觉主次。
- 修复加载状态标题在视口中的布局边界。
- 公开示例和文档改用中性 vault、笔记路径与工作流称呼。

### 升级说明

- 依次执行 `supabase/migrations/20260909090000_add_obsidian_path.sql`。
- 如需本地 Obsidian 跳转，在 `.env.local` 设置 `AFS_OBSIDIAN_VAULT_NAME`。
- 不配置 Obsidian 时，深看历史和归档状态仍可正常使用。
