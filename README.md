# Academic Editor

Claude Code 多智能体学术写作工作流。读取→规划→大纲→研究→撰写→格式化→审查→修复，全流程自动化。

## 架构

```
读取文档 → 规划+大纲 → 研究 → 分章撰写 → 格式化 → 审查 → 修复
(safe-docx  (haiku)   (haiku)  (sonnet)   (haiku)  (haiku) (haiku)
 优先读取)
```

参考 [oh-my-claudecode](https://github.com/Yeachan-Heo/oh-my-claudecode) Team Pipeline 和 [oh-my-pi](https://github.com/can1357/oh-my-pi) 工具表面设计。

## 特性

- **3 种模式**: `lite`(轻量) / `full`(标准) / `ultra`(深度)
- **新建 + 编辑**: 支持从零写作和修改已有文档
- **OMP P0-P3 审查**: P0(阻塞)~P3(可选) + 置信度评分
- **对抗验证**: P0/P1 发现需 2 票确认
- **质量门禁**: 研究→大纲→审查，三处出站检查
- **字数控制**: ±15% 硬约束 + 自动瘦身
- **自动修复**: full/ultra 模式审查后自动修 P0/P1 问题
- **模型路由**: haiku 做搜索/审查/格式化（低成本），sonnet/opus 做撰写（高质量）
- **文档读取**: safe-docx MCP → Read 工具 → firecrawl-parse 三级 fallback

## 安装

```bash
# 1. 克隆项目
git clone https://github.com/hookrise/academic-editor.git
cd academic-editor

# 2. 安装 workflow（二选一）
# 方式 A: 用户级安装
cp workflows/academic-editor.js ~/.claude/workflows/

# 方式 B: 项目级安装（在目标项目中）
mkdir -p .claude/workflows
cp workflows/academic-editor.js .claude/workflows/

# 3. (可选) 安装精简 CLAUDE.md 以减少 agent 上下文开销
cp CLAUDE.md ~/.claude/CLAUDE.md           # 用户级
# 或
cp CLAUDE.md <你的项目>/.claude/CLAUDE.md    # 项目级

# 4. (可选) 安装学术写作规则
mkdir -p ~/.claude/rules
cp rules/academic-writing.md ~/.claude/rules/
```

**前置依赖**:
- Claude Code CLI（任意版本）
- 推荐启用：WebSearch（内置）、safe-docx MCP（可选，用于 DOCX 读写）

## 使用

### 命令行

```bash
# 新建短文（lite 模式）
/academic-editor task="写一篇关于大语言模型提示工程的综述" mode=lite totalWordTarget=2000

# 标准学术文章（full 模式）
/academic-editor task="Transformer 架构在计算机视觉中的应用综述" mode=full

# 深度论文（ultra 模式）
/academic-editor task="多模态大语言模型的幻觉问题：成因、检测与缓解" mode=ultra totalWordTarget=8000

# 编辑已有文档
/academic-editor task="补充参考文献、修正实验数据、改进学术语言" targetFile="C:\docs\paper-draft.docx"
```

### 参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `task` | **必填** | 写作/编辑任务描述 |
| `mode` | 自动判断 | `lite` / `full` / `ultra` |
| `language` | `zh` | `zh` / `en` / `bilingual` |
| `outputFormat` | `markdown` | `markdown` / `docx` / `latex` |
| `totalWordTarget` | 3000 | 目标总字数 |
| `targetFile` | - | 要编辑的已有文档路径 |
| `style` | `academic` | `academic` / `business` |
| `references` | - | 参考文献列表 |

### 模式对比

| | lite | full | ultra |
|------|------|------|-------|
| 适用 | 短文/博客 | 学术文章 | 深度论文 |
| 研究 | 跳过 | 文献搜索 | 文献搜索 |
| 审查 | 单维 | 三维并行 + 对抗验证 | 三维并行 + 对抗验证 |
| 修复 | 跳过 | 自动修 P0/P1 | 自动修 P0/P1 |
| 预计 tokens | ~400K | ~800K | ~1.5M |

## 推荐搭配

为减少每个 agent 的上下文开销，建议在学术写作项目中只保留必要的 rules：

```bash
# 删除或移走与学术写作无关的 rules（代码审查、前端、测试等）
# 只保留：
~/.claude/CLAUDE.md              # 精简版（本项目附带）
~/.claude/rules/academic-writing.md  # 学术写作规则（本项目附带）
```

完整 rules 集（含代码审查、Web 前端、TypeScript 等）会让每个 agent 额外加载 ~70KB 上下文，20 个 agent 就是 1.4M tokens 的固定税。

## 架构参考

- [oh-my-claudecode](https://github.com/Yeachan-Heo/oh-my-claudecode) — Team Pipeline (plan→prd→exec→verify→fix)
- [oh-my-pi](https://github.com/can1357/oh-my-pi) — web_search 学术源、P0-P3 审查、工具表面设计

## License

MIT
