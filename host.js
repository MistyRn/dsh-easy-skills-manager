/**
 * dsh-easy-skills-manager — host half.
 *
 * 两个技能根：
 *   - 全局：<DSH_HOME>/skills/<name>/SKILL.md
 *   - 工作区：<工作区>/.dsh/skills/<name>/SKILL.md
 *
 * 开关 = 重命名 SKILL.md <-> SKILL.md.disabled（DSH 内置 skill-filesystem 只扫一层，
 * 且 frontmatter 的 name 与 description 必填，所以分类是逻辑分组，成员仍平铺在根下）。
 * 分类、成员归属存在 $DSH_HOME/dsh-easy-skills-manager.state.json。
 */
import { homedir } from 'node:os'
import { join, basename } from 'node:path'
import { readdir, readFile, stat, mkdir, rename, rm, writeFile, cp } from 'node:fs/promises'

export const name = 'dsh-easy-skills-manager'
export const inject = ['webServer', 'workspaceRegistry', 'agents']

const PLUGIN = 'dsh-easy-skills-manager'
const ROUTE = '/plugins/dsh-easy-skills-manager'
const SKILL_FILE = 'SKILL.md'
const DISABLED_SUFFIX = '.disabled'
const TRASH_DIR = '.trash'
const MAX_BODY_BYTES = 1024 * 1024
const MAX_CONTENT_BYTES = 512 * 1024
const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const DIR_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._ -]*$/

const DSH_HOME = (process.env.DSH_HOME && process.env.DSH_HOME.trim()) || join(homedir(), '.dsh')
const STATE_FILE = join(DSH_HOME, 'dsh-easy-skills-manager.state.json')

class HttpError extends Error {
  constructor(status, message) { super(message); this.name = 'HttpError'; this.status = status }
}

const asError = (e) => (e instanceof Error ? e : new Error(String(e)))

function cleanName(value) {
  if (typeof value !== 'string') throw new HttpError(400, '技能名必须是字符串')
  const n = value.trim()
  if (!KEBAB_RE.test(n)) throw new HttpError(400, '技能名必须是 kebab-case（小写字母、数字、连字符），例如 my-skill')
  if (n.length > 128) throw new HttpError(400, '技能名过长')
  return n
}

function cleanDirName(value) {
  const n = String(value == null ? '' : value).trim()
  if (!n || n.length > 128 || n === '.' || n === '..') throw new HttpError(400, '目录名无效')
  if (!DIR_NAME_RE.test(n)) throw new HttpError(400, '目录名包含非法字符')
  return n
}

function parseFrontmatter(content) {
  const text = String(content || '').replace(/^\uFEFF/, '')
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!m) return { fields: {}, body: text, hasFrontmatter: false }
  const fields = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/)
    if (kv) fields[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '')
  }
  return { fields, body: text.slice(m[0].length), hasFrontmatter: true }
}

function firstLine(text) {
  const line = String(text || '').split(/\r?\n/).map((l) => l.trim()).find((l) => l !== '')
  if (!line) return ''
  return line.replace(/^#{1,6}\s+/, '').replace(/[*_\x60~]/g, '').slice(0, 160)
}

async function pathIsFile(p) { try { return (await stat(p)).isFile() } catch { return false } }

// ── 分类状态 ─────────────────────────────────────────────────────────────────

async function readState() {
  try {
    const raw = JSON.parse(await readFile(STATE_FILE, 'utf8'))
    if (raw && typeof raw === 'object' && raw.scopes && typeof raw.scopes === 'object') return raw
  } catch { /* 首次运行或损坏时重建 */ }
  return { version: 1, scopes: {} }
}

async function writeState(s) {
  await mkdir(DSH_HOME, { recursive: true })
  await writeFile(STATE_FILE, JSON.stringify(s, null, 2) + '\n', 'utf8')
}

function scopeKey(scope, workspacePath) {
  return scope === 'workspace' ? 'ws:' + String(workspacePath || '').toLowerCase() : 'global'
}

function scopeBucket(state, key) {
  if (!state.scopes[key]) state.scopes[key] = { categories: [], members: {} }
  const b = state.scopes[key]
  if (!Array.isArray(b.categories)) b.categories = []
  if (!b.members || typeof b.members !== 'object') b.members = {}
  if (!b.pinned || typeof b.pinned !== 'object') b.pinned = {}
  return b
}

function categoryId(name) {
  const slug = String(name || '').trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-|-$/g, '')
  return (slug || 'category') + '-' + Math.random().toString(36).slice(2, 7)
}

// ── 扫描与写盘 ───────────────────────────────────────────────────────────────

async function scanRoot(root, bucket) {
  const skills = []
  let entries
  try { entries = await readdir(root, { withFileTypes: true }) } catch { return { root, exists: false, skills } }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue
    const d = join(root, e.name)
    const live = join(d, SKILL_FILE)
    const dead = join(d, SKILL_FILE + DISABLED_SUFFIX)
    let enabled = false
    let filePath = null
    if (await pathIsFile(live)) { enabled = true; filePath = live }
    else if (await pathIsFile(dead)) { enabled = false; filePath = dead }
    if (!filePath) continue
    let skillName = e.name
    let description = ''
    try {
      const parsed = parseFrontmatter(await readFile(filePath, 'utf8'))
      skillName = parsed.fields.name || e.name
      description = parsed.fields.description || firstLine(parsed.body)
    } catch { /* 保留目录名 */ }
    const pinned = !!(bucket && bucket.pinned && bucket.pinned[e.name] === true)
    skills.push({
      dirName: e.name,
      name: skillName,
      description,
      enabled,
      mode: enabled ? (pinned ? 'pinned' : 'available') : 'off',
      categoryId: (bucket && bucket.members && bucket.members[e.name]) || null,
    })
  }
  skills.sort((a, b) => a.dirName.localeCompare(b.dirName))
  return { root, exists: true, skills }
}

async function setSkillEnabled(root, dirName, enabled) {
  const d = join(root, dirName)
  const live = join(d, SKILL_FILE)
  const dead = join(d, SKILL_FILE + DISABLED_SUFFIX)
  // 幂等：已达到目标状态就直接返回，切换三挡模式时不会互相踩到
  if (enabled) {
    if (await pathIsFile(live)) return
    if (!(await pathIsFile(dead))) throw new HttpError(404, '技能文件不存在或状态已变化，请刷新')
    await rename(dead, live)
    return
  }
  if (await pathIsFile(dead)) return
  if (!(await pathIsFile(live))) throw new HttpError(404, '技能文件不存在或状态已变化，请刷新')
  await rename(live, dead)
}

function buildDocument(skillName, description, body) {
  const raw = String(description || '').trim().replace(/\r?\n/g, ' ')
  const weak = raw === '' || /^(无|none|null|undefined|-|n\/a)$/i.test(raw)
  const desc = (weak ? (firstLine(body) || skillName) : raw)
  const text = String(body || '').replace(/\uFEFF/g, '').replace(/^\n+|\n+$/g, '')
  return '---\nname: ' + skillName + '\ndescription: ' + desc + '\n---\n\n' + text + '\n'
}

/** 导入：正文可能已是完整 md（含 frontmatter），统一重写为受控 frontmatter。 */
function buildFromContent(skillName, content) {
  const parsed = parseFrontmatter(content)
  const desc = parsed.fields.description || firstLine(parsed.body) || skillName
  const body = parsed.hasFrontmatter ? parsed.body.replace(/^\r?\n/, '') : String(content || '')
  return buildDocument(skillName, desc, body)
}

async function importSkill(root, skillName, doc) {
  const d = join(root, skillName)
  if (await pathIsFile(join(d, SKILL_FILE + DISABLED_SUFFIX))) throw new HttpError(409, '同名技能已存在（已停用），请先启用或改名')
  if (await pathIsFile(join(d, SKILL_FILE))) throw new HttpError(409, '同名技能已存在，请换个名字')
  await mkdir(d, { recursive: true })
  await writeFile(join(d, SKILL_FILE), doc, 'utf8')
}

async function readSkillDoc(root, dirName) {
  const d = join(root, dirName)
  for (const file of [SKILL_FILE, SKILL_FILE + DISABLED_SUFFIX]) {
    const p = join(d, file)
    if (await pathIsFile(p)) {
      const parsed = parseFrontmatter(await readFile(p, 'utf8'))
      return {
        dirName,
        enabled: file === SKILL_FILE,
        name: parsed.fields.name || dirName,
        description: parsed.fields.description || firstLine(parsed.body),
        body: parsed.body.replace(/^\r?\n/, '').replace(/\s+$/, ''),
      }
    }
  }
  throw new HttpError(404, '技能不存在')
}

async function updateSkill(root, dirName, skillName, description, body) {
  const d = join(root, dirName)
  const live = join(d, SKILL_FILE)
  const dead = join(d, SKILL_FILE + DISABLED_SUFFIX)
  const target = (await pathIsFile(live)) ? live : (await pathIsFile(dead)) ? dead : null
  if (!target) throw new HttpError(404, '技能不存在')
  await writeFile(target, buildDocument(skillName, description, body), 'utf8')
}

async function deleteSkill(root, dirName) {
  const d = join(root, dirName)
  if (!(await pathIsFile(join(d, SKILL_FILE))) && !(await pathIsFile(join(d, SKILL_FILE + DISABLED_SUFFIX)))) {
    throw new HttpError(404, '技能不存在')
  }
  const trash = join(root, TRASH_DIR)
  await mkdir(trash, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  await rename(d, join(trash, dirName + '-' + stamp))
}

// ── 工作区 ───────────────────────────────────────────────────────────────────

async function rawWorkspaces(ctx) {
  try {
    const list = await ctx.workspaceRegistry?.list?.()
    return list == null ? [] : (Array.isArray(list) ? list : [...list])
  } catch { return [] }
}

async function listWorkspaces(ctx) {
  return (await rawWorkspaces(ctx))
    .map((w) => {
      const path = w && (w.path || w.cwd)
      return { path, title: (w && w.title) || (path ? basename(path) : '') }
    })
    .filter((w) => w.path)
}

async function resolveActiveWorkspace(ctx, sessionId, workspacePath) {
  if (workspacePath) {
    const cleaned = String(workspacePath).trim()
    if (!cleaned || cleaned.length > 512) throw new HttpError(400, '工作区路径无效')
    const spaces = await listWorkspaces(ctx)
    if (spaces.length) {
      const norm = (value) => String(value).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
      const hit = spaces.find((w) => norm(w.path) === norm(cleaned))
      // 只允许访问已登记的工作区，避免串到别的工作区目录
      if (!hit) throw new HttpError(404, '该工作区未登记')
      return hit
    }
    return { path: cleaned, title: basename(cleaned) }
  }
  const spaces = await listWorkspaces(ctx)
  if (!spaces.length) return null
  if (!sessionId) return spaces[0]
  for (const w of await rawWorkspaces(ctx)) {
    const ids = w ? (Array.isArray(w.sessionIds) ? w.sessionIds : (typeof w.sessionIds === 'function' ? [...w.sessionIds()] : [])) : []
    if (ids.includes(sessionId)) {
      const path = w.path || w.cwd
      return { path, title: w.title || basename(path) }
    }
  }
  return spaces[0]
}

/** 解析请求里的作用域 → 技能根 + 分类桶 key。 */
async function resolveScope(ctx, scope, workspacePath, sessionId) {
  if (scope === 'workspace') {
    const active = await resolveActiveWorkspace(ctx, sessionId, workspacePath)
    if (!active || !active.path) throw new HttpError(400, '未找到工作区')
    return { root: join(active.path, '.dsh', 'skills'), key: scopeKey('workspace', active.path), workspacePath: active.path }
  }
  return { root: join(DSH_HOME, 'skills'), key: 'global', workspacePath: null }
}

async function buildState(ctx, sessionId, workspacePath) {
  const state = await readState()
  const globalRoot = join(DSH_HOME, 'skills')
  const globalBucket = state.scopes.global || { categories: [], members: {} }
  const globalScan = await scanRoot(globalRoot, globalBucket)

  const spaces = await listWorkspaces(ctx)
  const active = await resolveActiveWorkspace(ctx, sessionId, workspacePath)
  let workspace = null
  if (active && active.path) {
    const wroot = join(active.path, '.dsh', 'skills')
    const key = scopeKey('workspace', active.path)
    const bucket = state.scopes[key] || { categories: [], members: {} }
    const scan = await scanRoot(wroot, bucket)
    workspace = { ...scan, title: active.title, path: active.path, key, categories: bucket.categories }
  }
  return {
    globalRoot,
    statePath: STATE_FILE,
    global: { root: globalRoot, exists: globalScan.exists, skills: globalScan.skills, categories: globalBucket.categories, key: 'global' },
    workspace,
    workspaces: spaces,
    sessionId: sessionId || null,
  }
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

async function readJsonBody(req, limit = MAX_BODY_BYTES) {
  let text = ''
  if (req && typeof req === 'object') {
    if (Buffer.isBuffer(req.body)) text = req.body.toString('utf8')
    else if (typeof req.body === 'string') text = req.body
    else {
      const chunks = []
      let size = 0
      for await (const chunk of req) {
        const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        size += b.length
        if (size > limit) throw new HttpError(413, '请求体过大')
        chunks.push(b)
      }
      text = Buffer.concat(chunks).toString('utf8')
    }
  }
  if (!text.trim()) return {}
  try { return JSON.parse(text) } catch { throw new HttpError(400, '无效的 JSON 请求体') }
}

function sendJson(res, status, body, headOnly = false) {
  const text = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  if (headOnly) res.end()
  else res.end(text)
}

// ── 面向模型的安装入口 ───────────────────────────────────────────────────────

const STRING_OUT = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: value == null ? '' : String(value) }],
}

/** 写进系统提示的技能编写规范：让 Agent 自己起名、写描述。 */
const SKILL_SPEC = [
  '技能管理约定（dsh-easy-skills-manager）',
  '本机技能只有两个根：',
  '- 全局：<DSH_HOME>/skills/<name>/SKILL.md',
  '- 工作区：<工作区>/.dsh/skills/<name>/SKILL.md',
  '当用户要求安装、保存、创建或更新一个技能时，调用 skill_save 工具写入；不要自己拼路径，也不要用写文件工具手写 SKILL.md。',
  '命名规则：',
  '- name 必须是 kebab-case（只含 a-z、0-9、连字符），2~4 个英文词，语义化且能概括用途，例如 pdf-table-extract。',
  '- 目录名与 frontmatter 的 name 一致；中文名无法被加载。',
  '描述规则：',
  '- description 必填，一句话说明「做什么 + 什么时候用」，建议 20~60 字，不要换行。',
  '正文规则：',
  '- body 是给模型的完整操作指令（Markdown），不要包含 --- frontmatter，也不要重复 name/description。',
  '写入后管理面板与本机技能目录会自动识别，无需重启。',
  '若同名技能已存在，先调用 skill_list 查看，再决定是否传 overwrite。',
].join('\n')

function serviceOf(ctx, name) {
  try {
    if (typeof ctx.get === 'function') {
      const found = ctx.get(name)
      if (found) return found
    }
  } catch { /* 服务未就绪 */ }
  try { return ctx[name] } catch { return undefined }
}

function invalidateSkills(ctx) {
  try {
    const skills = serviceOf(ctx, 'skills')
    if (skills && typeof skills.invalidate === 'function') skills.invalidate()
  } catch { /* 缓存失效失败不影响写入结果 */ }
}

function toolSessionId(exec) {
  const id = exec && exec.agent && exec.agent.id
  return typeof id === 'string' ? id : undefined
}

/** skill_save 的核心实现（与工具解耦，便于单测）。 */
export async function saveSkillForTool(ctx, args, sessionId) {
  const skillName = cleanName(args.name)
  const rawDesc = String(args.description || '').replace(/\s+/g, ' ').trim()
  if (!rawDesc) throw new Error('description 必填：请用一句话说明技能做什么、什么时候用')
  const weak = /^(无|none|null|undefined|-|n\/a)$/i.test(rawDesc)
  const description = weak ? (firstLine(args.body) || rawDesc) : rawDesc
  const body = String(args.body || '')
  if (!body.trim()) throw new Error('body 不能为空：请给出给模型的完整操作指令')
  const scope = args.scope === 'workspace' ? 'workspace' : 'global'
  const resolved = await resolveScope(ctx, scope, undefined, sessionId)
  const dir = join(resolved.root, skillName)
  const live = join(dir, SKILL_FILE)
  const dead = join(dir, SKILL_FILE + DISABLED_SUFFIX)
  const exists = (await pathIsFile(live)) || (await pathIsFile(dead))
  if (exists && args.overwrite !== true) {
    return JSON.stringify({ ok: false, error: '同名技能已存在；确认覆盖请传 overwrite:true，或换个 name', name: skillName, scope })
  }
  await mkdir(dir, { recursive: true })
  await writeFile(live, buildDocument(skillName, description, body), 'utf8')
  await rm(dead, { force: true })
  if (args.mode === 'pinned' || args.mode === 'off') {
    const state = await readState()
    const bucket = scopeBucket(state, resolved.key)
    if (args.mode === 'pinned') bucket.pinned[skillName] = true
    else { delete bucket.pinned[skillName]; await setSkillEnabled(resolved.root, skillName, false) }
    await writeState(state)
  }
  invalidateSkills(ctx)
  return JSON.stringify({ ok: true, name: skillName, description, scope, path: live, enabled: true, updated: exists })
}

/** skill_list 的核心实现。 */
export async function listSkillsForTool(ctx, args, sessionId) {
  const state = await buildState(ctx, sessionId, undefined)
  const rows = []
  const push = (s, scope) => rows.push({ name: s.name, dirName: s.dirName, description: s.description, scope, enabled: s.enabled })
  if (args.scope !== 'workspace') (state.global.skills || []).forEach((s) => push(s, 'global'))
  if (args.scope !== 'global' && state.workspace) (state.workspace.skills || []).forEach((s) => push(s, 'workspace'))
  const q = String(args.query || '').trim().toLowerCase()
  const filtered = q
    ? rows.filter((r) => (r.name || '').toLowerCase().includes(q) || (r.description || '').toLowerCase().includes(q))
    : rows
  return JSON.stringify({ count: filtered.length, skills: filtered })
}

async function registerSkillTools(ctx) {
  let defineTool
  try {
    const mod = await import('@deepseek-ai/dsh-tools')
    defineTool = mod.defineTool
  } catch (error) {
    ctx.logger?.warn?.(PLUGIN + ': 无法加载 @deepseek-ai/dsh-tools，技能工具未注册（' + asError(error).message + '）')
    return
  }
  const tools = serviceOf(ctx, 'tools')
  if (!tools || typeof tools.register !== 'function') {
    ctx.logger?.warn?.(PLUGIN + ': 没有 tools 服务，技能工具未注册')
    return
  }
  const reg = (definition) => {
    try { tools.register(defineTool(definition)) }
    catch (error) { ctx.logger?.warn?.(PLUGIN + ': 注册工具 ' + definition.name + ' 失败（' + asError(error).message + '）') }
  }

  reg({
    name: 'skill_save',
    description: '把一份 Agent Skill 写入本机 DSH 技能目录（全局 ~/.dsh/skills 或当前工作区 .dsh/skills），并立即被 DSH 与技能管理器识别。'
      + '用户要求“安装/保存/创建/更新技能”时使用它。name 必须是 kebab-case 英文短名；description 必填，用一句话说明做什么、什么时候用；body 是给模型的完整 Markdown 指令，不要写 frontmatter。',
    parameters: {
      name: { type: 'string', required: true, description: '技能名，kebab-case（a-z、0-9、-），2~4 个英文词，例如 pdf-table-extract。' },
      description: { type: 'string', required: true, description: '一句话描述：这个技能做什么、什么时候该用。不要换行。' },
      body: { type: 'string', required: true, description: '给模型的完整 Markdown 指令正文，不含 frontmatter。' },
      scope: { type: 'string', enum: ['global', 'workspace'], description: 'global（默认，所有会话通用）或 workspace（仅当前工作区）。' },
      overwrite: { type: 'boolean', description: '同名技能已存在时是否覆盖，默认 false。' },
      mode: { type: 'string', enum: ['available', 'pinned'], description: 'available（默认，仅可被按需调用）或 pinned（常驻：每轮注入系统提示，适合行为约束类技能）。' },
    },
    output: STRING_OUT,
    execute: async (args, exec) => saveSkillForTool(ctx, args, toolSessionId(exec)),
  })

  reg({
    name: 'skill_list',
    description: '列出本机已安装的 Agent 技能（全局与当前工作区），返回 name、description、是否启用，用于安装前查重或回答“我有哪些技能”。',
    parameters: {
      query: { type: 'string', description: '按名称或描述过滤，可选。' },
      scope: { type: 'string', enum: ['global', 'workspace'], description: '只看某一作用域，可选。' },
    },
    output: STRING_OUT,
    execute: async (args, exec) => listSkillsForTool(ctx, args, toolSessionId(exec)),
  })
}

// ── 让「已启用」真正生效：注入每个会话的系统提示 ─────────────────────────────

const ACTIVE_SECTION = 'skills-quick:active'
const ACTIVE_ORDER = 11060
const ACTIVE_MAX_SKILLS = 30
const ACTIVE_MAX_CHARS = 60000
const activeSessions = new Map()
let hostCtx = null
let activeTimer = null
let activeDirty = false

function markSkillsDirty() {
  activeDirty = true
  if (activeTimer) return
  activeTimer = setTimeout(() => {
    activeTimer = null
    if (!activeDirty) return
    activeDirty = false
    void refreshAllAgents()
  }, 300)
}

export async function collectEnabledDocs(ctx, sessionId) {
  const state = await readState()
  const docs = []
  const push = async (root, bucket) => {
    const scan = await scanRoot(root, bucket || { categories: [], members: {} })
    for (const skill of scan.skills) {
      if (skill.mode !== 'pinned') continue
      try { docs.push(await readSkillDoc(root, skill.dirName)) } catch { /* 单个读取失败不影响其他 */ }
    }
  }
  await push(join(DSH_HOME, 'skills'), state.scopes.global)
  const active = await resolveActiveWorkspace(ctx, sessionId, null).catch(() => null)
  if (active && active.path) {
    await push(join(active.path, '.dsh', 'skills'), state.scopes[scopeKey('workspace', active.path)])
  }
  return docs
}

export function renderActiveSkills(docs) {
  if (!docs.length) return ''
  const lines = [
    '# 已启用的技能（dsh-easy-skills-manager）',
    '下列技能已在本机启用，必须按其中的指令执行；与其它指令冲突时以技能内容为准。',
  ]
  let budget = ACTIVE_MAX_CHARS
  let count = 0
  for (const doc of docs) {
    if (count >= ACTIVE_MAX_SKILLS) break
    const body = String(doc.body || '').trim()
    if (!body) continue
    const chunk = '<skill name="' + doc.name + '">\n' + body + '\n</skill>'
    if (chunk.length > budget) break
    budget -= chunk.length
    count += 1
    lines.push(chunk)
  }
  return count === 0 ? '' : lines.join('\n\n')
}

function disposeSession(entry) { try { entry.dispose?.() } catch { /* best effort */ } }

async function refreshAgentSkills(agent) {
  const ctx = hostCtx
  if (!ctx || !agent || typeof agent.id !== 'string') return
  const sessionId = agent.id
  let text = ''
  try { text = renderActiveSkills(await collectEnabledDocs(ctx, sessionId)) } catch { text = '' }
  let entry = activeSessions.get(sessionId)
  if (entry && entry.agent !== agent) { disposeSession(entry); entry = undefined }
  if (!entry) {
    const state = { text }
    let dispose
    try {
      dispose = agent.ctx.plugin({
        name: 'dsh-easy-skills-manager:active-skills',
        inject: ['systemPrompt'],
        apply(scopeCtx) {
          scopeCtx.effect(() => scopeCtx.systemPrompt.section({
            name: ACTIVE_SECTION,
            order: ACTIVE_ORDER,
            text: () => state.text,
            interpolate: false,
          }), 'dsh-easy-skills-manager: active skills')
        },
      })
    } catch (error) {
      ctx.logger?.warn?.(PLUGIN + ': 注入已启用技能失败（' + asError(error).message + '）')
      return
    }
    activeSessions.set(sessionId, { agent, state, dispose })
    return
  }
  entry.state.text = text
}

async function refreshAllAgents() {
  const ctx = hostCtx
  if (!ctx) return
  let agents = []
  try { agents = ctx.agents?.list?.() ?? [] } catch { agents = [] }
  for (const agent of agents) await refreshAgentSkills(agent)
}

export function apply(ctx) {
  const server = ctx.webServer
  if (!server || typeof server.register !== 'function') {
    ctx.logger?.warn?.(PLUGIN + ': 没有 webServer，路由未挂载')
    return
  }

  const guard = (label, handler) => (req, res) => {
    Promise.resolve()
      .then(() => handler(req, res))
      .then(() => { if (req.method === 'POST') markSkillsDirty() })
      .catch((error) => {
        const status = error instanceof HttpError ? error.status : 500
        if (status >= 500) ctx.logger?.error?.(PLUGIN + ': ' + label + ' 处理失败', error)
        if (!res.headersSent) sendJson(res, status, { ok: false, error: asError(error).message })
        else { try { res.end() } catch { /* best effort */ } }
      })
  }

  const route = (path, label, handler) => server.register({ kind: 'exact', path: ROUTE + path, handler: guard(label, handler) })

  ctx.effect(() => {
    const disposers = []

    disposers.push(route('/state', 'state', async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') { sendJson(res, 405, { ok: false, error: 'method not allowed' }); return }
      const url = new URL(req.url || '/', 'http://localhost')
      const sessionId = url.searchParams.get('sessionId') || null
      const workspacePath = url.searchParams.get('workspace') || null
      sendJson(res, 200, { ok: true, ...(await buildState(ctx, sessionId, workspacePath)) }, req.method === 'HEAD')
    }))

    disposers.push(route('/skill', 'skill', async (req, res) => {
      const url = new URL(req.url || '/', 'http://localhost')
      const scope = url.searchParams.get('scope') === 'workspace' ? 'workspace' : 'global'
      const dirName = cleanDirName(url.searchParams.get('dirName'))
      const resolved = await resolveScope(ctx, scope, url.searchParams.get('workspace'), url.searchParams.get('sessionId'))
      sendJson(res, 200, { ok: true, ...(await readSkillDoc(resolved.root, dirName)) })
    }))

    disposers.push(route('/toggle', 'toggle', async (req, res) => {
      if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method not allowed' }); return }
      const body = await readJsonBody(req)
      const scope = body.scope === 'workspace' ? 'workspace' : 'global'
      const resolved = await resolveScope(ctx, scope, body.workspacePath, body.sessionId)
      await setSkillEnabled(resolved.root, cleanDirName(body.dirName), body.enabled === true)
      sendJson(res, 200, { ok: true })
    }))

    disposers.push(route('/import', 'import', async (req, res) => {
      if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method not allowed' }); return }
      const body = await readJsonBody(req)
      const skillName = cleanName(body.name)
      const scope = body.scope === 'workspace' ? 'workspace' : 'global'
      const content = typeof body.content === 'string' ? body.content : ''
      if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) throw new HttpError(400, '内容过大')
      const resolved = await resolveScope(ctx, scope, body.workspacePath, body.sessionId)
      await importSkill(resolved.root, skillName, buildFromContent(skillName, content))
      if (body.categoryId) {
        const state = await readState()
        const bucket = scopeBucket(state, resolved.key)
        bucket.members[skillName] = String(body.categoryId)
        await writeState(state)
      }
      sendJson(res, 200, { ok: true, name: skillName })
    }))

    disposers.push(route('/update', 'update', async (req, res) => {
      if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method not allowed' }); return }
      const body = await readJsonBody(req)
      const scope = body.scope === 'workspace' ? 'workspace' : 'global'
      const dirName = cleanDirName(body.dirName)
      const skillName = cleanName(body.name)
      const resolved = await resolveScope(ctx, scope, body.workspacePath, body.sessionId)
      const description = typeof body.description === 'string' ? body.description : ''
      const content = typeof body.body === 'string' ? body.body : ''
      if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) throw new HttpError(400, '内容过大')
      await updateSkill(resolved.root, dirName, skillName, description, content)
      sendJson(res, 200, { ok: true })
    }))

    disposers.push(route('/delete', 'delete', async (req, res) => {
      if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method not allowed' }); return }
      const body = await readJsonBody(req)
      const scope = body.scope === 'workspace' ? 'workspace' : 'global'
      const dirName = cleanDirName(body.dirName)
      const resolved = await resolveScope(ctx, scope, body.workspacePath, body.sessionId)
      await deleteSkill(resolved.root, dirName)
      const state = await readState()
      const bucket = scopeBucket(state, resolved.key)
      delete bucket.members[dirName]
      await writeState(state)
      sendJson(res, 200, { ok: true })
    }))

    disposers.push(route('/mode', 'mode', async (req, res) => {
      if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method not allowed' }); return }
      const body = await readJsonBody(req)
      const dirName = cleanDirName(body.dirName)
      const mode = body.mode === 'pinned' ? 'pinned' : body.mode === 'off' ? 'off' : 'available'
      const scope = body.scope === 'workspace' ? 'workspace' : 'global'
      const resolved = await resolveScope(ctx, scope, body.workspacePath, body.sessionId)
      await setSkillEnabled(resolved.root, dirName, mode !== 'off')
      const state = await readState()
      const bucket = scopeBucket(state, resolved.key)
      if (mode === 'pinned') bucket.pinned[dirName] = true
      else delete bucket.pinned[dirName]
      await writeState(state)
      invalidateSkills(ctx)
      sendJson(res, 200, { ok: true, mode, dirName })
    }))

    disposers.push(route('/bulk', 'bulk', async (req, res) => {
      if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method not allowed' }); return }
      const body = await readJsonBody(req)
      const mode = body.mode === 'pinned' ? 'pinned' : body.mode === 'off' ? 'off' : 'available'
      const scope = body.scope === 'workspace' ? 'workspace' : 'global'
      const resolved = await resolveScope(ctx, scope, body.workspacePath, body.sessionId)
      const state = await readState()
      const bucket = scopeBucket(state, resolved.key)
      const scan = await scanRoot(resolved.root, bucket)
      let changed = 0
      const failed = []
      for (const skill of scan.skills) {
        if (skill.mode === mode) continue
        try {
          await setSkillEnabled(resolved.root, skill.dirName, mode !== 'off')
          if (mode === 'pinned') bucket.pinned[skill.dirName] = true
          else delete bucket.pinned[skill.dirName]
          changed += 1
        } catch { failed.push(skill.dirName) }
      }
      await writeState(state)
      invalidateSkills(ctx)
      sendJson(res, 200, { ok: true, mode, changed, failed })
    }))

    disposers.push(route('/copy', 'copy', async (req, res) => {
      if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method not allowed' }); return }
      const body = await readJsonBody(req)
      const dirName = cleanDirName(body.dirName)
      const fromScope = body.scope === 'workspace' ? 'workspace' : 'global'
      const toScope = body.targetScope === 'workspace' ? 'workspace' : 'global'
      const categoryId = body.categoryId ? String(body.categoryId) : ''
      const src = await resolveScope(ctx, fromScope, body.workspacePath, body.sessionId)
      const dst = await resolveScope(ctx, toScope, body.targetWorkspace || body.workspacePath, body.sessionId)
      const state = await readState()
      const dstBucket = scopeBucket(state, dst.key)

      // 同一作用域内拖拽 = 只改分类，不复制文件
      if (src.root === dst.root) {
        if (categoryId) {
          if (!dstBucket.categories.some((c) => c.id === categoryId)) throw new HttpError(404, '分类不存在')
          dstBucket.members[dirName] = categoryId
        } else {
          delete dstBucket.members[dirName]
        }
        await writeState(state)
        sendJson(res, 200, { ok: true, copied: false })
        return
      }

      // 跨作用域拖拽 = 复制技能目录，源保持不变
      const fromDir = join(src.root, dirName)
      if (!(await pathIsFile(join(fromDir, SKILL_FILE))) && !(await pathIsFile(join(fromDir, SKILL_FILE + DISABLED_SUFFIX)))) {
        throw new HttpError(404, '技能不存在')
      }
      const toDir = join(dst.root, dirName)
      if ((await pathIsFile(join(toDir, SKILL_FILE))) || (await pathIsFile(join(toDir, SKILL_FILE + DISABLED_SUFFIX)))) {
        throw new HttpError(409, '目标位置已有同名技能')
      }
      await mkdir(dst.root, { recursive: true })
      await cp(fromDir, toDir, { recursive: true })
      if (categoryId) {
        if (!dstBucket.categories.some((c) => c.id === categoryId)) throw new HttpError(404, '目标分类不存在')
        dstBucket.members[dirName] = categoryId
      }
      await writeState(state)
      invalidateSkills(ctx)
      sendJson(res, 200, { ok: true, copied: true, scope: toScope, target: dst.root })
    }))

    disposers.push(route('/move', 'move', async (req, res) => {
      if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method not allowed' }); return }
      const body = await readJsonBody(req)
      const dirName = cleanDirName(body.dirName)
      const fromScope = body.scope === 'workspace' ? 'workspace' : 'global'
      const toScope = body.targetScope === 'workspace' ? 'workspace' : 'global'
      const categoryId = body.categoryId ? String(body.categoryId) : ''
      const src = await resolveScope(ctx, fromScope, body.workspacePath, body.sessionId)
      const dst = await resolveScope(ctx, toScope, body.workspacePath, body.sessionId)
      const state = await readState()
      const srcBucket = scopeBucket(state, src.key)
      const dstBucket = scopeBucket(state, dst.key)

      // 同一作用域内拖拽 = 改分类
      if (src.root === dst.root) {
        if (categoryId) {
          if (!dstBucket.categories.some((c) => c.id === categoryId)) throw new HttpError(404, '分类不存在')
          dstBucket.members[dirName] = categoryId
        } else {
          delete dstBucket.members[dirName]
        }
        await writeState(state)
        sendJson(res, 200, { ok: true, moved: false })
        return
      }

      // 跨作用域拖拽 = 真实搬移技能目录
      const fromDir = join(src.root, dirName)
      const toDir = join(dst.root, dirName)
      if (!(await pathIsFile(join(fromDir, SKILL_FILE))) && !(await pathIsFile(join(fromDir, SKILL_FILE + DISABLED_SUFFIX)))) {
        throw new HttpError(404, '技能不存在')
      }
      if ((await pathIsFile(join(toDir, SKILL_FILE))) || (await pathIsFile(join(toDir, SKILL_FILE + DISABLED_SUFFIX)))) {
        throw new HttpError(409, '目标作用域已有同名技能')
      }
      await mkdir(dst.root, { recursive: true })
      try {
        await rename(fromDir, toDir)
      } catch {
        await cp(fromDir, toDir, { recursive: true })
        await rm(fromDir, { recursive: true, force: true })
      }
      delete srcBucket.members[dirName]
      if (categoryId && dstBucket.categories.some((c) => c.id === categoryId)) dstBucket.members[dirName] = categoryId
      await writeState(state)
      invalidateSkills(ctx)
      sendJson(res, 200, { ok: true, moved: true, scope: toScope })
    }))

    disposers.push(route('/category', 'category', async (req, res) => {
      if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method not allowed' }); return }
      const body = await readJsonBody(req)
      const action = String(body.action || '')
      const scope = body.scope === 'workspace' ? 'workspace' : 'global'
      const resolved = await resolveScope(ctx, scope, body.workspacePath, body.sessionId)
      const state = await readState()
      const bucket = scopeBucket(state, resolved.key)

      if (action === 'create') {
        const label = String(body.name || '').trim()
        if (!label || label.length > 40) throw new HttpError(400, '分类名不能为空且不超过 40 字')
        const cat = { id: categoryId(label), name: label }
        bucket.categories.push(cat)
        await writeState(state)
        sendJson(res, 200, { ok: true, category: cat })
        return
      }

      const id = String(body.id || '')
      const cat = bucket.categories.find((c) => c.id === id)
      if (action === 'rename') {
        if (!cat) throw new HttpError(404, '分类不存在')
        const label = String(body.name || '').trim()
        if (!label || label.length > 40) throw new HttpError(400, '分类名不能为空且不超过 40 字')
        cat.name = label
        await writeState(state)
        sendJson(res, 200, { ok: true })
        return
      }
      if (action === 'delete') {
        if (!cat) throw new HttpError(404, '分类不存在')
        bucket.categories = bucket.categories.filter((c) => c.id !== id)
        for (const [dir, catId] of Object.entries(bucket.members)) if (catId === id) delete bucket.members[dir]
        await writeState(state)
        sendJson(res, 200, { ok: true })
        return
      }
      if (action === 'assign') {
        const dirName = cleanDirName(body.dirName)
        if (body.categoryId) {
          if (!bucket.categories.some((c) => c.id === body.categoryId)) throw new HttpError(404, '分类不存在')
          bucket.members[dirName] = String(body.categoryId)
        } else {
          delete bucket.members[dirName]
        }
        await writeState(state)
        sendJson(res, 200, { ok: true })
        return
      }
      if (action === 'toggle') {
        if (!cat) throw new HttpError(404, '分类不存在')
        const enabled = body.enabled === true
        const members = Object.entries(bucket.members).filter(([, c]) => c === id).map(([dir]) => dir)
        const failed = []
        for (const dirName of members) {
          try { await setSkillEnabled(resolved.root, dirName, enabled) } catch { failed.push(dirName) }
        }
        sendJson(res, 200, { ok: true, changed: members.length - failed.length, failed })
        return
      }
      throw new HttpError(400, '未知分类操作：' + (action || '(空)'))
    }))

    return () => { for (const d of disposers) { try { d?.() } catch { /* best effort */ } } }
  }, PLUGIN + ': routes')

  void registerSkillTools(ctx).catch((error) => {
    ctx.logger?.warn?.(PLUGIN + ': 技能工具注册异常（' + asError(error).message + '）')
  })

  try {
    const prompt = serviceOf(ctx, 'systemPrompt')
    if (prompt && typeof prompt.section === 'function') {
      ctx.effect(() => {
        const off = prompt.section({ name: 'skills-quick:spec', order: 11050, text: () => SKILL_SPEC, interpolate: false })
        return () => { try { off?.() } catch { /* best effort */ } }
      }, PLUGIN + ': skill spec section')
    }
  } catch (error) {
    ctx.logger?.warn?.(PLUGIN + ': 技能规范未注入（' + asError(error).message + '）')
  }

  hostCtx = ctx
  try {
    const existing = (typeof ctx.agents?.list === 'function' ? ctx.agents.list() : []) || []
    for (const agent of existing) void refreshAgentSkills(agent)
  } catch (error) {
    ctx.logger?.warn?.(PLUGIN + ': 初始化已启用技能失败（' + asError(error).message + '）')
  }

  if (typeof ctx.on === 'function') {
    ctx.effect(() => {
      const offCreated = ctx.on('agent/created', ({ agent }) => { void refreshAgentSkills(agent) })
      const offDisposed = ctx.on('agent/disposed', ({ agent }) => {
        const entry = activeSessions.get(agent && agent.id)
        if (entry) { disposeSession(entry); activeSessions.delete(agent.id) }
      })
      return () => {
        try { offCreated?.() } catch { /* best effort */ }
        try { offDisposed?.() } catch { /* best effort */ }
      }
    }, PLUGIN + ': active skill lifecycle')
  }

  ctx.effect(() => () => {
    if (activeTimer) { clearTimeout(activeTimer); activeTimer = null }
    for (const entry of activeSessions.values()) disposeSession(entry)
    activeSessions.clear()
  }, PLUGIN + ': active skill cleanup')

  ctx.logger?.info?.(PLUGIN + ': 就绪（全局技能根 ' + join(DSH_HOME, 'skills') + '）')
}
