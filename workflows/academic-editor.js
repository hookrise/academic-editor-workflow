// ============================================================
// Academic Editor v2.3 — 优化 agent 开销
// ============================================================
// 运行时注入: agent, parallel, pipeline, phase, log, args, budget
// 这些符号由 Claude Code Workflow 运行时提供，无需定义
// ============================================================

export const meta = {
  name: 'academic-editor',
  description: '学术写作全流程 v2.3：读取→规划→研究→大纲→撰写→审查→修复',
  phases: [
    { title: '读取文档', detail: 'safe-docx MCP → fallback' },
    { title: '规划+大纲', detail: '策略+大纲（lite 合并）' },
    { title: '研究', detail: '学术搜索（lite 跳过）' },
    { title: '撰写', detail: '分章撰写' },
    { title: '格式化', detail: 'markdown/docx/latex 输出' },
    { title: '审查', detail: 'P0-P3 审查（lite 单维）' },
    { title: '修复', detail: '自动修复（lite 跳过）' },
  ],
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
} = args || {}

// ---- 阶段 0: 读取文档 ----
let existingContent = null

if (targetFile) {
  phase('读取文档')
  log(`读取: ${targetFile}`)
  const doc = await agent(
    `读取: ${targetFile}。${T.read}。${K}`,
    { label: '读取', model: 'haiku' }
  )
  if (doc && doc.length > 50) { existingContent = doc; log(`读取成功: ${doc.length} 字符`) }
  else { log('[WARN] 读取失败，按新建模式') }
}

// ---- 阶段 1: 规划+大纲 (lite 模式合并) ----
const isEditMode = !!(targetFile && existingContent)
const isLite = mode === 'lite'

phase(isLite ? '规划+大纲' : '规划')

log(`[v2.3] ${isLite ? 'lite' : mode || 'auto'} | ${isEditMode ? '编辑' : '新建'} | ${task}`)

const plan = await agent(
  `你是学术编辑。${isLite ? '一步完成策略判断+大纲构建。' : '分析任务并制定策略。'}

任务: "${task}"
${isEditMode ? `编辑模式。现有文档:\n\`\`\`\n${existingContent.slice(0, 2000)}\n\`\`\`` : ''}
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
    model: 'haiku',
  }
)

if (!plan) return { error: '规划失败' }

const effectiveMode = mode || plan.mode || 'full'
const wordTarget = plan.totalWords || totalWordTarget

// ---- 大纲 (非 lite 模式单独构建) ----
let outline = isLite ? (plan.outline || []) : []

if (!isLite) {
  phase('大纲')
  const or = await agent(
    `构建大纲。任务:"${task}" | 类型:${plan.documentType} | 字数:${wordTarget} | 章节:${plan.sections}
${isEditMode ? `现有文档:\n${existingContent.slice(0, 1500)}` : ''}
字数分配: 引言15-20% 核心章节均分 结论15-20%。
输出: outline数组，每项 id(S1..)/title/keyPoints(3-5个)/wordBudget。${K} ${T.draft}`,
    { label: '大纲', schema: { type: 'object', properties: { outline: { type: 'array', items: OUTLINE_ITEM } } }, model: 'haiku' }
  )
  outline = or?.outline || []
}

if (!outline.length) return { error: '大纲构建失败' }

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
    { label: '搜索', schema: RESEARCH_BRIEF, model: 'haiku' }
  )
  if (!sr?.sources?.length) {
    log('[WARN] 搜索为空，重试...')
    const retry = await agent(
      `搜索: ${plan.keyTopics?.slice(0,3)?.join(';') || task}。3-5篇核心文献。${K}`,
      { label: '重试', schema: RESEARCH_BRIEF, model: 'haiku' }
    )
    if (retry?.sources?.length) researchData = { sources: retry.sources, keyFindings: retry.keyFindings || [] }
  } else {
    researchData = { sources: sr.sources, keyFindings: sr.keyFindings || [] }
  }
  log(`研究: ${researchData?.sources?.length || 0} 篇`)
}

// ---- 阶段 3: 撰写 ----
phase('撰写')

const drafts = await pipeline(
  outline,
  (section) => agent(
    `撰写章节。文档:"${task}" | 类型:${plan.documentType} | 语言:${language}
${isEditMode ? `编辑模式。原文:\n${existingContent.slice(0, 1500)}` : ''}

本章: ${section.id} ${section.title}
论点: ${section.keyPoints?.join('; ')}
${W(section.wordBudget || Math.floor(wordTarget / outline.length))}

大纲: ${JSON.stringify(outline.map(s => `${s.id} ${s.title}`))}
${researchData?.keyFindings ? `资料: ${researchData.keyFindings.slice(0, 5).join('; ')}` : ''}

要求:
- ${isEditMode ? '直接输出完整正文，不要写修改说明。保留原文合理部分，只改需改的。' : `字数在 budget ±15%。`}
- 论点有数据/引用支撑。术语首次附英文。章节间逻辑衔接。
- 输出: id="${section.id}", title="${section.title}", content=纯正文, wordCount=数字
${K} ${T.draft}`,
    { label: section.id, schema: SECTION_DRAFT }
  ),
  // 瘦身
  (draft) => {
    if (!draft) return null
    const budget = outline.find(s => s.id === draft.id)?.wordBudget || 500
    if (draft.wordCount <= budget * 1.2) return draft
    return agent(
      `精简至约${budget}字（当前${draft.wordCount}，超${Math.round((draft.wordCount-budget)/budget*100)}%）。
原文: ${draft.content?.slice(0, 3000)}。保留关键论点。${K}`,
      { label: `瘦${draft.id}`, schema: SECTION_DRAFT, model: 'haiku' }
    ).then(r => r || draft)
  },
)

const validDrafts = drafts.filter(Boolean)
if (!validDrafts.length) {
  log('[ERROR] 所有章节撰写失败')
  return { error: '撰写阶段失败，无有效章节', outline }
}
const totalWords = validDrafts.reduce((s, d) => s + (d.wordCount || 0), 0)
log(`撰写: ${validDrafts.length}/${outline.length} 节 | ${totalWords} 字`)

// ---- 阶段 4: 格式化 ----
phase('格式化')

let finalDoc = null
if (outputFormat === 'docx') {
  finalDoc = await agent(
    `safe-docx 创建文档。学术排版、目录、页码。内容:\n${validDrafts.map(d => `## ${d.title}\n${d.content}`).join('\n\n---\n\n')}`,
    { label: 'DOCX', model: 'haiku' }
  )
} else if (outputFormat === 'latex') {
  finalDoc = await agent(
    `转LaTeX。${language==='zh'?'ctex':'article'}。\n${validDrafts.map(d=>d.content).join('\n\n')}`,
    { label: 'LaTeX', model: 'haiku' }
  )
} else {
  finalDoc = validDrafts.map(d => `## ${d.title}\n\n${d.content}`).join('\n\n---\n\n')
}
log(`格式化: ${outputFormat.toUpperCase()}`)

// ---- 阶段 5: 审查 ----
let reviewFindings = []
const PRIORITY = 'P0=阻塞(引用缺失/事实错误/逻辑断裂) P1=高 P2=中(术语/格式) P3=低(措辞)。每项: priority+confidence(0-1)+fix。'

if (!isLite) {
  // full/ultra: 3 维并行审查 (haiku)
  phase('审查')
  const docSnippet = typeof finalDoc === 'string' ? finalDoc.slice(0, 5000) : JSON.stringify(finalDoc).slice(0, 5000)
  const reviews = await parallel([
    () => agent(`审查逻辑: ${docSnippet}。${PRIORITY}。最多8个。${K} ${T.review}`,
      { label:'logic', schema:{type:'object',properties:{findings:{type:'array',items:FINDING}}}, model:'haiku' }),
    () => agent(`审查语言: ${docSnippet}。术语/句式/${language==='zh'?'欧化中文':''}。${PRIORITY}。最多8个。${K} ${T.review}`,
      { label:'lang', schema:{type:'object',properties:{findings:{type:'array',items:FINDING}}}, model:'haiku' }),
    () => agent(`审查规范: ${docSnippet}。引用/层级/伦理。${PRIORITY}。最多8个。${K} ${T.review}`,
      { label:'format', schema:{type:'object',properties:{findings:{type:'array',items:FINDING}}}, model:'haiku' }),
  ])
  reviewFindings = reviews.filter(Boolean).flatMap(r => r?.findings || [])

  // 对抗验证 P0/P1 (2票, haiku)
  const blocking = reviewFindings.filter(f => f.priority === 'P0' || f.priority === 'P1')
  if (blocking.length > 0) {
    log(`验证 ${blocking.length} 个 P0/P1...`)
    const verified = await pipeline(
      blocking.slice(0, 5),
      (f) => parallel([
        () => agent(`验证: "${f.issue}" (${f.location})。真实则 isReal=true。`,
          { label:`V1`, schema:{type:'object',properties:{isReal:{type:'boolean'},reason:{type:'string'}}}, model:'haiku' }),
        () => agent(`反驳: "${f.issue}" (${f.location})。默认 isReal=false。`,
          { label:`V2`, schema:{type:'object',properties:{isReal:{type:'boolean'},reason:{type:'string'}}}, model:'haiku' }),
      ]).then(vs => { const y = vs.filter(Boolean).filter(v=>v.isReal).length; return {...f, confirmed: y>=2} })
    )
    const confirmed = verified.filter(Boolean).filter(f => f.confirmed)
    reviewFindings = reviewFindings.map(f => {
      const v = confirmed.find(c => c.location===f.location && c.issue===f.issue)
      return v ? {...f, confirmed:true} : f
    })
    log(`确认: ${confirmed.length} 个需修复`)
  }
} else {
  // lite: 单 agent 审查，不验证
  phase('审查')
  const docSnippet = typeof finalDoc === 'string' ? finalDoc.slice(0, 4000) : JSON.stringify(finalDoc).slice(0, 4000)
  const review = await agent(
    `审查文档: ${docSnippet}。
检查: 逻辑一致性、语言表达、引用规范。
${PRIORITY}。最多5个最严重问题。
${K} ${T.review}`,
    { label:'审查', schema:{type:'object',properties:{findings:{type:'array',items:FINDING}}}, model:'haiku' }
  )
  reviewFindings = review?.findings || []
}

const p0 = reviewFindings.filter(f=>f.priority==='P0').length
const p1 = reviewFindings.filter(f=>f.priority==='P1').length
log(`审查: ${reviewFindings.length} 发现 (P0:${p0} P1:${p1} P2:${reviewFindings.filter(f=>f.priority==='P2').length} P3:${reviewFindings.filter(f=>f.priority==='P3').length})`)

// ---- 阶段 6: 修复 (lite 跳过) ----
if (!isLite && reviewFindings.some(f => f.confirmed)) {
  phase('修复')
  const toFix = reviewFindings.filter(f => f.confirmed)
  log(`修复 ${toFix.length} 个问题...`)
  const fixed = await agent(
    `修复文档。\n文档:\n${typeof finalDoc==='string'?finalDoc.slice(0,6000):JSON.stringify(finalDoc).slice(0,6000)}\n\n问题:\n${toFix.map(f=>`- [${f.priority}] ${f.location}: ${f.issue}\n  修复: ${f.fix}`).join('\n')}\n\n逐一修复，返回完整文档。${K}`,
    { label: '修复', model: 'haiku' }
  )
  if (fixed) { finalDoc = fixed; log('修复完成') }
}

// ---- 最终 ----
log('')
log('═══════════════════════════════')
log(`  v2.3 | ${isEditMode?'编辑':'新建'} | ${effectiveMode} | ${validDrafts.length}节 | ${totalWords}字`)
log(`  审查: ${reviewFindings.length} 发现 | 修复: ${reviewFindings.filter(f=>f.confirmed).length}`)
log('═══════════════════════════════')

return {
  plan, effectiveMode, isEditMode,
  existingContent: existingContent?.slice(0, 500),
  research: researchData, outline, drafts: validDrafts, finalDocument: finalDoc,
  review: {
    total: reviewFindings.length, P0: p0, P1: p1,
    P2: reviewFindings.filter(f=>f.priority==='P2').length, P3: reviewFindings.filter(f=>f.priority==='P3').length,
    confirmed: reviewFindings.filter(f=>f.confirmed).length, findings: reviewFindings,
  },
  stats: { sections: validDrafts.length, totalWords },
}
