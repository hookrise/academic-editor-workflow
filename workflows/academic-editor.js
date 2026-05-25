// ============================================================
// Academic Editor v2.4 — 修复全部 code review 问题
// ============================================================
// 运行时注入: agent, parallel, pipeline, phase, log, args, budget
// 这些符号由 Claude Code Workflow 运行时提供，无需定义
//
// @typedef {(prompt: string, opts?: {label?: string, schema?: object, model?: string}) => Promise<any>} AgentFn
// @typedef {(tasks: (() => Promise<any>)[]) => Promise<any[]>} ParallelFn
// @typedef {(items: any[], fn: (item: any) => any, ...fns: ((item: any) => any)[]) => Promise<any[]>} PipelineFn
// @typedef {(title: string) => void} PhaseFn
// @typedef {(msg: string) => void} LogFn
// ============================================================

export const meta = {
  name: 'academic-editor',
  description: '学术写作全流程 v2.4：读取→规划→研究→大纲→撰写→审查→修复→格式化',
  phases: [],
  whenToUse: '写论文、编辑文档、文献综述、研究报告、学术写作',
}

// ============================================================
// Schema
// ============================================================
const PLAN = {
  type: 'object',
  properties: {
    mode: { enum: ['lite', 'full', 'ultra'] },
    documentType: { enum: ['paper', 'article', 'report', 'thesis', 'proposal', 'review', 'other'] },
    sections: { type: 'number' },
    totalWords: { type: 'number' },
    needsResearch: { type: 'boolean' },
    keyTopics: { type: 'array', items: { type: 'string' } },
    strategy: { type: 'string' },
  },
  required: ['mode', 'documentType', 'strategy'],
}

const OUTLINE_ITEM = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    keyPoints: { type: 'array', items: { type: 'string' } },
    wordBudget: { type: 'number' },
  },
  required: ['id', 'title', 'keyPoints', 'wordBudget'],
}

const RESEARCH_BRIEF = {
  type: 'object',
  properties: {
    sources: { type: 'array', items: {
      type: 'object',
      properties: { title: { type:'string' }, authors: { type:'string' }, year: { type:'string' }, venue: { type:'string' }, contribution: { type:'string' }, url: { type:'string' } },
    }},
    keyFindings: { type: 'array', items: { type: 'string' } },
  },
}

const SECTION_DRAFT = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    content: { type: 'string' },
    wordCount: { type: 'number' },
    citations: { type: 'array', items: { type: 'string' } },
  },
  required: ['id', 'title', 'content', 'wordCount'],
}

const FINDING = {
  type: 'object',
  properties: {
    location: { type: 'string' },
    issue: { type: 'string' },
    priority: { enum: ['P0', 'P1', 'P2', 'P3'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    fix: { type: 'string' },
    category: { enum: ['logic', 'evidence', 'structure', 'language', 'format', 'citation'] },
    confirmed: { type: 'boolean' },
  },
  required: ['location', 'issue', 'priority', 'confidence', 'fix'],
}

// ============================================================
// 精简模板
// ============================================================
const K = '1.只改必须改的 2.先理解再行动 3.写清楚为什么 4.输出可被检查'

const W = (budget) => `字数: ${budget} 字 (±15%)。`

const T = {
  read: '工具: mcp__safe-docx__read_file(首选) → Read(备选) → firecrawl-parse(最后)。返回完整文本。',
  research: '工具: WebSearch(arxiv.org, semanticscholar.org, aclweb.org)。禁用: Bash, codegraph。',
  draft: '工具: Read。禁用: WebSearch, Bash。',
  review: '工具: Read。禁用: WebSearch, Edit, Write。只发现，不修改。',
}

// ============================================================
// 主流程
// ============================================================
const {
  task, mode, language = 'zh', outputFormat = 'markdown',
  totalWordTarget = 3000, targetFile, style = 'academic', references,
  // 模型配置（可覆盖 CLI 默认模型）
  fastModel = 'haiku',       // 搜索/审查/格式化/规划/大纲/瘦身
  writeModel,                // 撰写（不指定则用 CLI 默认模型）
  fixModel,                  // 修复（不指定则用 CLI 默认模型）
} = args || {}

// ---- 参数校验 ----
if (!task || typeof task !== 'string' || task.trim().length === 0) {
  return { success: false, stage: 'validation', error: '缺少必填参数 task' }
}
const rawTarget = Number(totalWordTarget)
if (isNaN(rawTarget) || rawTarget < 100 || rawTarget > 100000) {
  return { success: false, stage: 'validation', error: 'totalWordTarget 必须在 100-100000 之间' }
}
if (mode && !['lite', 'full', 'ultra'].includes(mode)) {
  return { success: false, stage: 'validation', error: `mode 必须是 lite/full/ultra，收到: ${mode}` }
}
if (!['markdown', 'docx', 'latex'].includes(outputFormat)) {
  return { success: false, stage: 'validation', error: `outputFormat 必须是 markdown/docx/latex，收到: ${outputFormat}` }
}

const MB = 1024 * 1024
const MAX_SNIPPET = 30 * MB  // 全文安全上限: 30MB (模型上下文保护)

// ---- 阶段 0: 读取文档 ----
let existingContent = null

if (targetFile) {
  phase('读取文档')
  log(`读取: ${targetFile}`)
  const doc = await agent(
    `读取: ${targetFile}。${T.read}。${K}`,
    { label: '读取', model: fastModel }
  )
  if (doc != null && typeof doc === 'string' && doc.length > 0) {
    existingContent = doc
    log(`读取成功: ${doc.length} 字符`)
  } else {
    log('[WARN] 读取返回空，按新建模式继续')
  }
}

// ---- 阶段 1: 规划+大纲 (lite 模式合并) ----
const isEditMode = !!(targetFile && existingContent)
const isLite = mode === 'lite'

phase(isLite ? '规划+大纲' : '规划')

log(`[v2.4] ${isLite ? 'lite' : mode || 'auto'} | ${isEditMode ? '编辑' : '新建'} | ${task}`)

const plan = await agent(
  `你是学术编辑。${isLite ? '一步完成策略判断+大纲构建。' : '分析任务并制定策略。'}

任务: "${task}"
${isEditMode ? `编辑模式。现有文档:\n\`\`\`\n${(existingContent || '').slice(0, Math.min(existingContent.length, 2000))}\n\`\`\`` : ''}
语言: ${language} | 字数: ${totalWordTarget} | 风格: ${style}
${mode ? `模式: ${mode}` : '自判模式(lite<2000字/full<5000/ultra 5000+)'}
${references ? `参考: ${references}` : ''}

${isLite ? `
## 输出（合并）
1. 策略字段: mode, documentType, sections, totalWords, needsResearch(填false), keyTopics, strategy(一句话)
2. 大纲字段: outline 数组，每项 id(S1..), title, keyPoints(3个), wordBudget
字数之和 ≈ ${totalWordTarget}` : `
## 输出
mode, documentType, sections, totalWords, needsResearch, keyTopics, strategy(一句话)。`}
${K}`,
  {
    label: isLite ? '规划+大纲' : '规划',
    schema: isLite
      ? { type: 'object', properties: {
          mode: PLAN.properties.mode, documentType: PLAN.properties.documentType,
          sections: PLAN.properties.sections, totalWords: PLAN.properties.totalWords,
          needsResearch: PLAN.properties.needsResearch, keyTopics: PLAN.properties.keyTopics,
          strategy: PLAN.properties.strategy,
          outline: { type: 'array', items: OUTLINE_ITEM },
        }, required: ['mode', 'documentType', 'strategy', 'outline'] }
      : PLAN,
    model: fastModel,
  }
)

if (!plan) return { success: false, stage: 'plan', error: '规划失败' }

const effectiveMode = mode || plan.mode || 'full'
const wordTarget = plan.totalWords || rawTarget

// 动态更新 phases 以匹配实际执行路径
meta.phases = (() => {
  const p = [
    { title: '读取文档', detail: 'safe-docx MCP → fallback' },
    { title: isLite ? '规划+大纲' : '规划', detail: '策略判断（lite 合并大纲）' },
  ]
  if (!isLite) p.push({ title: '大纲', detail: '详细章节构建' })
  if (!isLite && plan.needsResearch) p.push({ title: '研究', detail: '学术文献搜索' })
  p.push({ title: '撰写', detail: '分章撰写' })
  p.push({ title: '生成正文', detail: '规范格式正文' })
  p.push({ title: '审查', detail: `P0-P3 审查（${isLite ? '单维' : '三维并行'}）` })
  if (!isLite) p.push({ title: '修复', detail: '自动修复 P0/P1' })
  p.push({ title: '格式化', detail: `${outputFormat} 输出` })
  return p
})()

// ---- 大纲 (非 lite 模式单独构建) ----
let outline = isLite ? (plan.outline || []) : []

if (!isLite) {
  phase('大纲')
  const or = await agent(
    `构建大纲。任务:"${task}" | 类型:${plan.documentType} | 字数:${wordTarget} | 章节:${plan.sections}
${isEditMode ? `现有文档:\n${(existingContent || '').slice(0, Math.min(existingContent.length, 1500))}` : ''}
字数分配: 引言15-20% 核心章节均分 结论15-20%。
输出: outline数组，每项 id(S1..)/title/keyPoints(3-5个)/wordBudget。${K} ${T.draft}`,
    { label: '大纲', schema: { type: 'object', properties: { outline: { type: 'array', items: OUTLINE_ITEM } } }, model: fastModel }
  )
  outline = or?.outline || []
}

if (!outline.length) return { success: false, stage: 'outline', error: '大纲构建失败' }

const totalBudget = outline.reduce((s, i) => s + (i.wordBudget || 0), 0)
log(`${isLite ? '规划+大纲' : '大纲'}: ${outline.length} 节 | 预算: ${totalBudget}/${wordTarget} 字`)
outline.forEach(s => log(`  ${s.id} ${s.title} [${s.wordBudget}字]`))

// ---- 阶段 2: 研究 (lite 跳过) ----
let researchData = null

if (!isLite && plan.needsResearch) {
  phase('研究')
  const sr = await agent(
    `搜索: ${plan.keyTopics?.join('; ') || task}。
定向: arxiv.org, semanticscholar.org, aclweb.org, neurips.cc。
每篇: title/authors/year/venue/contribution/url。5-10篇。${K} ${T.research}`,
    { label: '搜索', schema: RESEARCH_BRIEF, model: fastModel }
  )
  if (!sr?.sources?.length) {
    log('[WARN] 搜索为空，重试...')
    const retry = await agent(
      `搜索: ${plan.keyTopics?.slice(0,3)?.join(';') || task}。3-5篇核心文献。${K}`,
      { label: '重试', schema: RESEARCH_BRIEF, model: fastModel }
    )
    if (retry?.sources?.length) {
      researchData = { sources: retry.sources, keyFindings: retry.keyFindings || [] }
    } else {
      log('[WARN] 搜索重试也失败，将无文献资料继续撰写')
    }
  } else {
    researchData = { sources: sr.sources, keyFindings: sr.keyFindings || [] }
  }
  log(`研究: ${researchData?.sources?.length || 0} 篇`)
}

// ---- 阶段 3: 撰写 ----
phase('撰写')

const sectionWordBudget = Math.floor(wordTarget / Math.max(outline.length, 1))

const drafts = await pipeline(
  outline,
  (section) => agent(
    `撰写章节。文档:"${task}" | 类型:${plan.documentType} | 语言:${language}
${isEditMode ? `编辑模式。原文:\n${(existingContent || '').slice(0, Math.min(existingContent.length, 1500))}` : ''}

本章: ${section.id} ${section.title}
论点: ${section.keyPoints?.join('; ')}
${W(section.wordBudget || sectionWordBudget)}

大纲: ${JSON.stringify(outline.map(s => `${s.id} ${s.title}`))}
${researchData?.keyFindings ? `资料: ${researchData.keyFindings.slice(0, 5).join('; ')}` : ''}

要求:
- ${isEditMode ? '直接输出完整正文，不要写修改说明。保留原文合理部分，只改需改的。' : `字数在 budget ±15%。`}
- 论点有数据/引用支撑。术语首次附英文。章节间逻辑衔接。
- 输出: id="${section.id}", title="${section.title}", content=纯正文, wordCount=数字
${K} ${T.draft}`,
    { label: section.id, schema: SECTION_DRAFT, ...(writeModel ? { model: writeModel } : {}) }
  ),
  // 瘦身（传递完整内容，不截断）
  (draft) => {
    if (!draft) return null
    const budget = outline.find(s => s.id === draft.id)?.wordBudget || sectionWordBudget
    if (draft.wordCount <= budget * 1.2) return draft
    return agent(
      `精简至约${budget}字（当前${draft.wordCount}，超${Math.round((draft.wordCount-budget)/budget*100)}%）。
原文: ${draft.content}。保留关键论点。${K}`,
      { label: `瘦${draft.id}`, schema: SECTION_DRAFT, model: fastModel }
    ).then(r => r || draft)
  },
)

const validDrafts = drafts.filter(Boolean)
if (!validDrafts.length) {
  log('[ERROR] 所有章节撰写失败')
  return { success: false, stage: 'write', error: '撰写阶段失败，无有效章节', outline }
}
const totalWords = validDrafts.reduce((s, d) => s + (d.wordCount || 0), 0)
log(`撰写: ${validDrafts.length}/${outline.length} 节 | ${totalWords} 字`)

// ---- 阶段 4: 生成规范正文 (markdown 规范格式，始终作为审查/修复的正交基准) ----
phase('生成正文')

const markdownDoc = validDrafts.map(d => `## ${d.title}\n\n${d.content}`).join('\n\n---\n\n')
log(`正文: ${markdownDoc.length} 字符`)

// ---- 阶段 5: 审查 ----
let reviewFindings = []
const PRIORITY = 'P0=阻塞(引用缺失/事实错误/逻辑断裂) P1=高 P2=中(术语/格式) P3=低(措辞)。每项: priority+confidence(0-1)+fix。'

// 审查用全文（非截断），仅当超出安全上限时警告
const reviewDoc = markdownDoc.length > MAX_SNIPPET
  ? (log(`[WARN] 正文过长 (${markdownDoc.length} > ${MAX_SNIPPET})，截断至 ${MAX_SNIPPET} 字符`), markdownDoc.slice(0, MAX_SNIPPET))
  : markdownDoc

if (!isLite) {
  // full/ultra: 3 维并行审查 (haiku)
  phase('审查')
  const reviews = await parallel([
    () => agent(`审查逻辑: ${reviewDoc}。${PRIORITY}。最多8个。${K} ${T.review}`,
      { label:'logic', schema:{type:'object',properties:{findings:{type:'array',items:FINDING}}}, model: fastModel }),
    () => agent(`审查语言: ${reviewDoc}。术语/句式/${language==='zh'?'欧化中文':''}。${PRIORITY}。最多8个。${K} ${T.review}`,
      { label:'lang', schema:{type:'object',properties:{findings:{type:'array',items:FINDING}}}, model: fastModel }),
    () => agent(`审查规范: ${reviewDoc}。引用/层级/伦理。${PRIORITY}。最多8个。${K} ${T.review}`,
      { label:'format', schema:{type:'object',properties:{findings:{type:'array',items:FINDING}}}, model: fastModel }),
  ])
  reviewFindings = reviews.filter(Boolean).flatMap(r => r?.findings || [])

  // 对抗验证 P0/P1 (2票, haiku)，无数量上限
  const blocking = reviewFindings.filter(f => f.priority === 'P0' || f.priority === 'P1')
  if (blocking.length > 0) {
    log(`验证 ${blocking.length} 个 P0/P1...`)
    const verified = await pipeline(
      blocking,
      (f) => parallel([
        () => agent(`验证: "${f.issue}" (${f.location})。真实则 isReal=true。`,
          { label:`V1`, schema:{type:'object',properties:{isReal:{type:'boolean'},reason:{type:'string'}}}, model: fastModel }),
        () => agent(`反驳: "${f.issue}" (${f.location})。默认 isReal=false。`,
          { label:`V2`, schema:{type:'object',properties:{isReal:{type:'boolean'},reason:{type:'string'}}}, model: fastModel }),
      ]).then(vs => { const y = vs.filter(Boolean).filter(v=>v.isReal).length; return {...f, confirmed: y>=2} })
    )
    const confirmed = verified.filter(Boolean).filter(f => f.confirmed)
    reviewFindings = reviewFindings.map(f => {
      const v = confirmed.find(c => c.location===f.location && c.issue===f.issue)
      return v ? {...f, confirmed:true} : f
    })
    log(`确认: ${confirmed.length} 个需修复 | 未验证: ${blocking.length - verified.length} 个（pipeline 截断）`)
  }
} else {
  // lite: 单 agent 审查，不验证
  phase('审查')
  const liteLimit = Math.max(10000, wordTarget * 6)
  const liteDoc = reviewDoc.length > liteLimit
    ? (log(`[WARN] lite 模式正文过长 (${reviewDoc.length})，截断至 ${liteLimit} 字符`), reviewDoc.slice(0, liteLimit))
    : reviewDoc
  const review = await agent(
    `审查文档: ${liteDoc}。
检查: 逻辑一致性、语言表达、引用规范。
${PRIORITY}。最多5个最严重问题。
${K} ${T.review}`,
    { label:'审查', schema:{type:'object',properties:{findings:{type:'array',items:FINDING}}}, model: fastModel }
  )
  reviewFindings = review?.findings || []
}

const p0 = reviewFindings.filter(f=>f.priority==='P0').length
const p1 = reviewFindings.filter(f=>f.priority==='P1').length
const p2 = reviewFindings.filter(f=>f.priority==='P2').length
const p3 = reviewFindings.filter(f=>f.priority==='P3').length
log(`审查: ${reviewFindings.length} 发现 (P0:${p0} P1:${p1} P2:${p2} P3:${p3})`)

// ---- 阶段 6: 修复 (lite 跳过) ----
let fixedDoc = markdownDoc

if (!isLite && reviewFindings.some(f => f.confirmed)) {
  phase('修复')
  const toFix = reviewFindings.filter(f => f.confirmed)
  log(`修复 ${toFix.length} 个问题...`)
  const FIX_LIMIT = 30000
  const docForFix = markdownDoc.length > FIX_LIMIT
    ? (log(`[WARN] 正文过长 (${markdownDoc.length})，修复阶段仅传递前 ${FIX_LIMIT} 字符，${toFix.length} 个问题中超出范围的可能无法修复`), markdownDoc.slice(0, FIX_LIMIT))
    : markdownDoc

  const fixed = await agent(
    `修复文档。\n文档:\n${docForFix}\n\n问题:\n${toFix.map(f=>`- [${f.priority}] ${f.location}: ${f.issue}\n  修复: ${f.fix}`).join('\n')}\n\n逐一修复，返回完整文档。${K}`,
    { label: '修复', ...(fixModel ? { model: fixModel } : {}) }
  )
  if (fixed && typeof fixed === 'string' && fixed.length > 0) {
    fixedDoc = fixed
    log('修复完成')
  } else {
    log('[WARN] 修复返回无效结果，保留原文')
  }
}

// ---- 阶段 7: 格式化 (在审查修复之后，始终基于 markdown 转换) ----
phase('格式化')

let finalDoc = null
let formatWarn = null

if (outputFormat === 'docx') {
  finalDoc = await agent(
    `safe-docx 创建文档。学术排版、目录、页码。内容:\n${fixedDoc}`,
    { label: 'DOCX', model: fastModel }
  )
  if (!finalDoc || typeof finalDoc !== 'string' || finalDoc.length < 10) {
    formatWarn = 'DOCX 转换失败（safe-docx MCP 可能未安装），回退到 Markdown'
    log(`[WARN] ${formatWarn}`)
    finalDoc = fixedDoc
  }
} else if (outputFormat === 'latex') {
  finalDoc = await agent(
    `转LaTeX。${language==='zh'?'ctex':'article'}。\n${fixedDoc}`,
    { label: 'LaTeX', model: fastModel }
  )
  if (!finalDoc || typeof finalDoc !== 'string' || finalDoc.length < 10) {
    formatWarn = 'LaTeX 转换失败，回退到 Markdown'
    log(`[WARN] ${formatWarn}`)
    finalDoc = fixedDoc
  }
} else {
  finalDoc = fixedDoc
}
log(`格式化: ${outputFormat.toUpperCase()}${formatWarn ? ` → Markdown (${formatWarn})` : ''}`)

// ---- 最终 ----
log('')
log('═══════════════════════════════')
log(`  v2.4 | ${isEditMode?'编辑':'新建'} | ${effectiveMode} | ${validDrafts.length}节 | ${totalWords}字`)
log(`  审查: ${reviewFindings.length} 发现 | 修复: ${reviewFindings.filter(f=>f.confirmed).length}`)
log('═══════════════════════════════')

return {
  success: true,
  plan, effectiveMode, isEditMode,
  existingContent: existingContent != null ? existingContent.slice(0, Math.min(existingContent.length, 500)) : null,
  research: researchData, outline, drafts: validDrafts, finalDocument: finalDoc,
  review: {
    total: reviewFindings.length, P0: p0, P1: p1, P2: p2, P3: p3,
    confirmed: reviewFindings.filter(f=>f.confirmed).length, findings: reviewFindings,
  },
  stats: { sections: validDrafts.length, totalWords },
  formatWarn,
}
