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
import { join, basename, isAbsolute } from 'node:path'
import { readdir, readFile, stat, mkdir, rename, rm, writeFile } from 'node:fs/promises'

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

// 每份 frontmatter 只解析一次：/state 从「读全文」降为「stat + 必要时重读」
const metaCache = new Map()
async function readMeta(file, fallbackName) {
  try {
    const info = await stat(file)
    const cached = metaCache.get(file)
    if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return cached
    const parsed = parseFrontmatter(await readFile(file, 'utf8'))
    const meta = {
      mtimeMs: info.mtimeMs,
      size: info.size,
      name: parsed.fields.name || fallbackName,
      description: parsed.fields.description || firstLine(parsed.body),
    }
    metaCache.set(file, meta)
    return meta
  } catch {
    return { name: fallbackName, description: '' }
  }
}

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
  // 原子写：先写临时文件再改名，进程中途退出不会留下半截 JSON
  const tmp = STATE_FILE + '.' + process.pid + '.tmp'
  await writeFile(tmp, JSON.stringify(s, null, 2) + '\n', 'utf8')
  try { await rename(tmp, STATE_FILE) } catch (error) { await rm(tmp, { force: true }); throw error }
}

// 所有「读-改-写」串行化：两个请求同时读到旧状态会互相覆盖
let stateChain = Promise.resolve()
function withStateLock(fn) {
  const run = stateChain.then(fn, fn)
  stateChain = run.then(() => {}, () => {})
  return run
}

/** 锁内完成一次状态变更：readState → mutate → writeState。 */
function mutateState(mutate) {
  return withStateLock(async () => {
    const state = await readState()
    const result = await mutate(state)
    await writeState(state)
    return result
  })
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
  if (!b.links || typeof b.links !== 'object') b.links = {}
  if (!b.off || typeof b.off !== 'object') b.off = {}
  return b
}

function defaultGlobalRoot() {
  return join(DSH_HOME, 'skills')
}

/** 全局技能根：默认 <DSH_HOME>/skills，可由设置覆盖。 */
function globalRootOf(state) {
  const settings = state && state.settings && typeof state.settings === 'object' ? state.settings : {}
  const custom = typeof settings.globalRoot === 'string' ? settings.globalRoot.trim() : ''
  return custom || defaultGlobalRoot()
}

/** 会话级技能：只在该会话注入，不改任何全局设置。 */
function sessionBucket(state, sessionId) {
  state.sessions = state.sessions && typeof state.sessions === 'object' ? state.sessions : {}
  const key = String(sessionId || '')
  if (!state.sessions[key] || typeof state.sessions[key] !== 'object') state.sessions[key] = { pins: [] }
  const bucket = state.sessions[key]
  if (!Array.isArray(bucket.pins)) bucket.pins = []
  return bucket
}

// ── 新会话预置：详情页先选，首个 turn 前转成该会话的覆盖 ─────────────────────

function normWorkspacePath(value) {
  return String(value == null ? '' : value).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/** 无工作区路径时落到通配键 *：首页还没选工作区也能先存预置。 */
function presetKey(workspacePath) {
  const norm = normWorkspacePath(workspacePath)
  return norm ? 'ws:' + norm : '*'
}

/** 只读查预置：不新建任何条目，GET 不留痕。 */
function peekPreset(state, workspacePath) {
  const presets = state.presets && typeof state.presets === 'object' ? state.presets : null
  if (!presets) return []
  const bucket = presets[presetKey(workspacePath)]
  return bucket && Array.isArray(bucket.pins) ? bucket.pins : []
}

function presetBucket(state, workspacePath) {
  state.presets = state.presets && typeof state.presets === 'object' ? state.presets : {}
  const key = presetKey(workspacePath)
  if (!state.presets[key] || typeof state.presets[key] !== 'object') state.presets[key] = { pins: [], at: 0 }
  const bucket = state.presets[key]
  if (!Array.isArray(bucket.pins)) bucket.pins = []
  return bucket
}

/** agent 所属工作区：优先会话头里的 cwd，退回工作区登记表。 */
async function agentWorkspacePath(ctx, agent) {
  try {
    const session = agent && agent.session
    const cwd = session && (session.cwd || (session.header && session.header.cwd))
    if (typeof cwd === 'string' && cwd.trim()) return cwd
  } catch { /* 会话头不可读时回退 */ }
  try {
    const active = await resolveActiveWorkspace(ctx, agent && agent.id, null)
    return (active && active.path) || ''
  } catch { return '' }
}

/** 某作用域内技能当前的实际挡位（用于判断会话覆盖是否已与继承值相同）。 */
async function inheritedMode(state, pin) {
  const key = pin.scope === 'workspace' ? scopeKey('workspace', pin.workspacePath) : 'global'
  const bucket = state.scopes && state.scopes[key] ? state.scopes[key] : null
  const root = pin.scope === 'workspace' ? join(String(pin.workspacePath || ''), '.dsh', 'skills') : globalRootOf(state)
  try {
    const scan = await scanRoot(root, bucket)
    const hit = scan.skills.find((s) => s.dirName === pin.dirName)
    return hit ? hit.mode : null
  } catch { return null }
}

/** 全局技能被删除/停用时，清掉所有会话与预置对它的覆盖。 */
function dropOverridesForSkill(state, scope, dirName) {
  let removed = 0
  const strip = (holder) => {
    if (!holder || !Array.isArray(holder.pins)) return
    const before = holder.pins.length
    holder.pins = holder.pins.filter((p) => !(p.scope === scope && p.dirName === dirName))
    removed += before - holder.pins.length
  }
  if (state.sessions && typeof state.sessions === 'object') {
    for (const key of Object.keys(state.sessions)) strip(state.sessions[key])
  }
  if (state.presets && typeof state.presets === 'object') {
    for (const key of Object.keys(state.presets)) {
      const bucket = state.presets[key]
      strip(bucket)
      if (bucket && Array.isArray(bucket.pins) && !bucket.pins.length) delete state.presets[key]
    }
  }
  return removed
}

/**
 * 写入一条会话/预置覆盖。与继承挡位相同则不保留覆盖。
 * pins 原地修改；返回是否发生变更。
 */
async function setPinMode(state, pins, ref) {
  const { scope, dirName, mode } = ref
  const workspacePath = scope === 'workspace' ? String(ref.workspacePath || '') : null
  const same = (p) => p.dirName === dirName && p.scope === scope
  const pinRef = { scope, workspacePath: ref.workspacePath || null, dirName }
  const inherited = await inheritedMode(state, pinRef)
  const index = pins.findIndex(same)
  const existing = index >= 0 ? pins[index] : null
  if (inherited !== null && inherited === mode) {
    if (existing) pins.splice(index, 1)
    return false
  }
  if (existing) { existing.mode = mode; return false }
  if (pins.length >= 50) throw new HttpError(400, '技能覆盖最多 50 条')
  const at = pinResolve(state, pinRef)
  const live = join(at.root, at.dirName, SKILL_FILE)
  const dead = join(at.root, at.dirName, SKILL_FILE + DISABLED_SUFFIX)
  // 允许在会话/预置里启用一个在总面板被停用的技能
  if (!(await pathIsFile(live)) && !(await pathIsFile(dead))) throw new HttpError(404, '技能不存在')
  pins.push({ scope, workspacePath, dirName, mode })
  return true
}

/** 会话卡片实际指向的物理位置：工作区/全局里的逻辑链接要穿过去。 */
function pinResolve(state, pin) {
  const key = pin.scope === 'workspace' ? scopeKey('workspace', pin.workspacePath) : 'global'
  const bucket = state.scopes && state.scopes[key] ? state.scopes[key] : null
  const link = bucket && bucket.links ? bucket.links[pin.dirName] : null
  if (link) return { root: linkRoot(state, link), dirName: link.dirName }
  return {
    root: pin.scope === 'workspace' ? join(String(pin.workspacePath || ''), '.dsh', 'skills') : globalRootOf(state),
    dirName: pin.dirName,
  }
}

/** 链接指向的物理根。 */
function linkRoot(state, link) {
  if (link && link.scope === 'workspace') return join(String(link.workspacePath || ''), '.dsh', 'skills')
  return globalRootOf(state)
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
    const meta = await readMeta(filePath, e.name)
    const skillName = meta.name
    const description = meta.description
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

/** 回收站条目：还原用的 entry、原目录名、删除时间。 */
async function listTrash(root) {
  let entries
  try { entries = await readdir(join(root, TRASH_DIR), { withFileTypes: true }) } catch { return [] }
  const out = []
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const m = e.name.match(/^(.*)-(\d{4}-\d{2}-\d{2}T[\d-]+Z)$/)
    let at = 0
    try { at = (await stat(join(root, TRASH_DIR, e.name))).mtimeMs } catch { /* 取不到时间就用 0 */ }
    out.push({ entry: e.name, dirName: m ? m[1] : e.name, at })
  }
  return out.sort((a, b) => b.at - a.at)
}

async function restoreTrash(root, entry, dirName) {
  const src = join(root, TRASH_DIR, cleanDirName(entry))
  const dst = join(root, cleanDirName(dirName))
  if (!(await pathIsFile(join(src, SKILL_FILE))) && !(await pathIsFile(join(src, SKILL_FILE + DISABLED_SUFFIX)))) {
    throw new HttpError(404, '回收站里没有这个技能')
  }
  if ((await pathIsFile(join(dst, SKILL_FILE))) || (await pathIsFile(join(dst, SKILL_FILE + DISABLED_SUFFIX)))) {
    throw new HttpError(409, '同名技能已存在，请先改名或删除它')
  }
  await rename(src, dst)
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
  const state = await readState()
  return { root: globalRootOf(state), key: 'global', workspacePath: null }
}

/** 逻辑链接（不复制文件）在某个作用域里投影出的技能条目。 */
async function listLinkedSkills(state, bucket) {
  const out = []
  for (const alias of Object.keys(bucket.links || {})) {
    const link = bucket.links[alias]
    try {
      const root = linkRoot(state, link)
      const dir = join(root, link.dirName)
      const live = join(dir, SKILL_FILE)
      const dead = join(dir, SKILL_FILE + DISABLED_SUFFIX)
      let file = null
      if (await pathIsFile(live)) file = live
      else if (await pathIsFile(dead)) file = dead
      if (!file) continue
      const meta = await readMeta(file, link.dirName)
      // 链接的启停只由本分区自己的记录决定，不受源文件停用状态影响
      const off = bucket.off[alias] === true
      const pinned = bucket.pinned[alias] === true
      out.push({
        dirName: alias,
        name: meta.name,
        description: meta.description,
        enabled: !off,
        mode: off ? 'off' : (pinned ? 'pinned' : 'available'),
        categoryId: bucket.members[alias] || null,
        linked: true,
        link: { scope: link.scope, workspacePath: link.workspacePath || null, dirName: link.dirName },
      })
    } catch { /* 目标不可读时跳过 */ }
  }
  return out
}

/** 解析某作用域里的技能：可能是本地目录，也可能是指向别处的逻辑链接。 */
async function resolveSkill(ctx, scope, dirName, workspacePath, sessionId) {
  const resolved = await resolveScope(ctx, scope, workspacePath, sessionId)
  const state = await readState()
  const bucket = scopeBucket(state, resolved.key)
  const link = bucket.links[dirName]
  if (!link) return { state, bucket, key: resolved.key, root: resolved.root, dirName, isLink: false, link: null }
  return { state, bucket, key: resolved.key, root: linkRoot(state, link), dirName: link.dirName, isLink: true, link }
}

async function buildState(ctx, sessionId, workspacePath) {
  const state = await readState()
  const globalRoot = globalRootOf(state)
  const globalBucket = scopeBucket(state, 'global')
  const globalScan = await scanRoot(globalRoot, globalBucket)
  const globalLinked = await listLinkedSkills(state, globalBucket)

  const spaces = await listWorkspaces(ctx)
  const active = await resolveActiveWorkspace(ctx, sessionId, workspacePath)
  let workspace = null
  if (active && active.path) {
    const wroot = join(active.path, '.dsh', 'skills')
    const key = scopeKey('workspace', active.path)
    const bucket = scopeBucket(state, key)
    const scan = await scanRoot(wroot, bucket)
    const linked = await listLinkedSkills(state, bucket)
    workspace = { ...scan, skills: [...scan.skills, ...linked], title: active.title, path: active.path, key, categories: bucket.categories }
  }
  const root = defaultGlobalRoot()
  const sessionPins = []
  if (sessionId) {
    const session = state.sessions && state.sessions[String(sessionId)]
    for (const pin of (session && Array.isArray(session.pins) ? session.pins : [])) {
      try {
        const at = pinResolve(state, pin)
        const dir = join(at.root, at.dirName)
        const live = join(dir, SKILL_FILE)
        const dead = join(dir, SKILL_FILE + DISABLED_SUFFIX)
        const isLive = await pathIsFile(live)
        const file = isLive ? live : (await pathIsFile(dead)) ? dead : null
        if (!file) continue
        const meta = await readMeta(file, pin.dirName)
        sessionPins.push({
          dirName: pin.dirName,
          name: meta.name,
          description: meta.description,
          scope: pin.scope,
          workspacePath: pin.workspacePath || null,
          mode: pin.mode || 'pinned',
          disabled: !isLive,
        })
      } catch { /* 失效的会话技能跳过 */ }
    }
  }
  if (sessionId && state.sessions && state.sessions[String(sessionId)]) {
    const pins = Array.isArray(state.sessions[String(sessionId)].pins) ? state.sessions[String(sessionId)].pins : []
    for (const skill of globalScan.skills) {
      const pin = pins.find((p) => p.scope === 'global' && p.dirName === skill.dirName)
      if (pin) { skill.sessionMode = pin.mode; skill.sessionOverride = true }
    }
  }
  // 首页预置：无会话时前端据此初始化开关，与总面板状态区分
  const presetPins = peekPreset(state, workspace ? workspace.path : '')
  return {
    sessionPins,
    presetPins,
    globalRoot,
    defaultGlobalRoot: root,
    customGlobalRoot: globalRoot !== root,
    statePath: STATE_FILE,
    global: { root: globalRoot, exists: globalScan.exists, skills: [...globalScan.skills, ...globalLinked], categories: globalBucket.categories, key: 'global' },
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
    await mutateState(async (state) => {
      const bucket = scopeBucket(state, resolved.key)
      if (args.mode === 'pinned') bucket.pinned[skillName] = true
      else { delete bucket.pinned[skillName]; await setSkillEnabled(resolved.root, skillName, false) }
    })
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
// 有预置待套用时不读盘：空会话可能早已建好 agent（agent/created 已过去），
// 所以首个 turn 的 pre-step 是最后的兜底时机。
let presetPending = false
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
  const session = state.sessions && sessionId ? state.sessions[String(sessionId)] : null
  const pins = session && Array.isArray(session.pins) ? session.pins : []
  // 会话覆盖按「技能名」判定：同名技能无论来自哪个作用域，都由会话卡片接管
  const overridden = new Set()
  for (const pin of pins) {
    try {
      const at = pinResolve(state, pin)
      overridden.add((await readSkillDoc(at.root, at.dirName)).name)
    } catch { /* 失效会话卡片忽略 */ }
  }

  const docs = []
  const push = async (scope, root, bucket, skip) => {
    const b = bucket || { categories: [], members: {}, pinned: {}, links: {} }
    const scan = await scanRoot(root, b)
    for (const skill of scan.skills) {
      if (skill.mode !== 'pinned') continue
      try {
        const doc = await readSkillDoc(root, skill.dirName)
        if (overridden.has(doc.name)) continue
        if (skip && skip.has(doc.name)) continue
        docs.push(doc)
      } catch { /* 单个读取失败不影响其他 */ }
    }
    const links = b.links || {}
    for (const alias of Object.keys(links)) {
      if (!b.pinned || b.pinned[alias] !== true) continue
      if (b.off && b.off[alias] === true) continue
      try {
        const doc = await readSkillDoc(linkRoot(state, links[alias]), links[alias].dirName)
        if (overridden.has(doc.name)) continue
        if (skip && skip.has(doc.name)) continue
        docs.push(doc)
      } catch { /* 链接目标不可读 */ }
    }
  }
  // 工作区优先：只要工作区里存在该技能（无论什么挡位），全局同名副本就不再参与
  const active = await resolveActiveWorkspace(ctx, sessionId, null).catch(() => null)
  const workspaceNames = new Set()
  if (active && active.path) {
    const wroot = join(active.path, '.dsh', 'skills')
    const wbucket = scopeBucket(state, scopeKey('workspace', active.path))
    const wscan = await scanRoot(wroot, wbucket)
    for (const s of wscan.skills) workspaceNames.add(s.name)
    for (const s of await listLinkedSkills(state, wbucket)) workspaceNames.add(s.name)
    await push('workspace', wroot, wbucket)
  }
  await push('global', globalRootOf(state), state.scopes.global, workspaceNames)
  // 会话卡片：只有「常驻」才注入
  for (const pin of pins) {
    if ((pin.mode || 'pinned') !== 'pinned') continue
    try {
      const at = pinResolve(state, pin)
      docs.push(await readSkillDoc(at.root, at.dirName))
    } catch { /* 目标不存在则跳过 */ }
  }
  // 同名只保留一份
  const seen = new Set()
  return docs.filter((doc) => (seen.has(doc.name) ? false : (seen.add(doc.name), true)))
}

export function renderActiveSkills(docs) {
  if (!docs.length) return ''
  const lines = [
    '# 已启用的技能（dsh-easy-skills-manager）',
    '下列技能已在本机启用，必须按其中的指令执行；与其它指令冲突时以技能内容为准。',
  ]
  let budget = ACTIVE_MAX_CHARS
  let count = 0
  const seen = new Set()
  const skipped = new Set()
  for (const doc of docs) {
    if (seen.has(doc.name)) continue
    const body = String(doc.body || '').trim()
    if (!body) continue
    const chunk = '<skill name="' + doc.name + '">\n' + body + '\n</skill>'
    if (count >= ACTIVE_MAX_SKILLS || chunk.length > budget) { skipped.add(doc.name); continue }
    seen.add(doc.name)
    budget -= chunk.length
    count += 1
    lines.push(chunk)
  }
  // 截断不再静默：模型和用户都该知道有常驻技能没进去
  if (skipped.size) {
    lines.push('> 已达注入上限（' + ACTIVE_MAX_SKILLS + ' 个技能 / ' + ACTIVE_MAX_CHARS + ' 字符）。'
      + '另有 ' + skipped.size + ' 个常驻技能本轮未注入：' + [...skipped].slice(0, 10).join('、') + (skipped.size > 10 ? ' 等' : '') + '。')
  }
  return count === 0 ? '' : lines.join('\n\n')
}

function disposeSession(entry) { try { entry.dispose?.() } catch { /* best effort */ } }

/**
 * 把首页预置转成本会话的覆盖。只在首个 turn 之前执行一次，用完即删。
 * 失败不阻断会话创建：预置是锦上添花，会话本身必须能起来。
 */
export async function applyPresetForAgent(agent) {
  const ctx = hostCtx
  if (!ctx || !agent || typeof agent.id !== 'string') return false
  let applied = false
  await mutateState(async (state) => {
    if (!state.presets || typeof state.presets !== 'object') return
    const wsPath = await agentWorkspacePath(ctx, agent).catch(() => '')
    let key = presetKey(wsPath)
    // 只认该 agent 自己工作区的预置：换了工作区就不套用，预置留给它原本的归属
    const bucket = state.presets[key]
    if (!bucket || !Array.isArray(bucket.pins) || !bucket.pins.length) return
    const pins = sessionBucket(state, agent.id).pins
    for (const pin of bucket.pins) {
      const same = pins.find((p) => p.dirName === pin.dirName && p.scope === pin.scope)
      if (same) { same.mode = pin.mode; applied = true; continue }
      if (pins.length >= 50) break
      pins.push({ scope: pin.scope, workspacePath: pin.workspacePath || null, dirName: pin.dirName, mode: pin.mode })
      applied = true
    }
    // 预置是一次性的：套用后即删，下个新会话回到总面板状态
    delete state.presets[key]
    presetPending = Object.keys(state.presets).length > 0
  })
  return applied
}

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
      // 写请求串行：每个 POST 都是「读-改-写」，并发会丢更新
      .then(() => (req.method === 'POST' ? withStateLock(() => handler(req, res)) : handler(req, res)))
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

    disposers.push(route('/session', 'session', async (req, res) => {
      if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method not allowed' }); return }
      const body = await readJsonBody(req)
      const sessionId = String(body.sessionId || '')
      if (!sessionId) throw new HttpError(400, '缺少会话 ID')
      const dirName = cleanDirName(body.dirName)
      const scope = body.scope === 'workspace' ? 'workspace' : 'global'
      const state = await readState()
      const bucket = sessionBucket(state, sessionId)
      const same = (p) => p.dirName === dirName && p.scope === scope
      const mode = body.mode === 'available' ? 'available' : body.mode === 'off' ? 'off' : 'pinned'
      if (body.action === 'remove') {
        bucket.pins = bucket.pins.filter((p) => !same(p))
      } else if (body.action === 'mode') {
        await setPinMode(state, bucket.pins, { scope, workspacePath: body.workspacePath || null, dirName, mode })
      } else {
        const at = pinResolve(state, { scope, workspacePath: body.workspacePath, dirName })
        if (!(await pathIsFile(join(at.root, at.dirName, SKILL_FILE)))) {
          throw new HttpError(404, '技能不可用（不存在或已停用）')
        }
        const existing = bucket.pins.find(same)
        if (existing) existing.mode = mode
        else bucket.pins.push({ scope, workspacePath: scope === 'workspace' ? String(body.workspacePath || '') : null, dirName, mode })
      }
      await writeState(state)
      invalidateSkills(ctx)
      sendJson(res, 200, { ok: true, pins: bucket.pins })
    }))

    // 首页（尚无会话）先选技能挡位：先存预置，等 agent/created 时转成该会话的覆盖
    disposers.push(route('/preset', 'preset', async (req, res) => {
      // 首页没有会话，只能按当前默认工作区归置；换了工作区就不套用
      const resolvePresetWorkspace = async (given) => {
        const raw = String(given || '').trim()
        if (raw) return raw
        try {
          const active = await resolveActiveWorkspace(ctx, null, null)
          return (active && active.path) || ''
        } catch { return '' }
      }
      if (req.method === 'GET' || req.method === 'HEAD') {
        const url = new URL(req.url || '/', 'http://localhost')
        const workspacePath = await resolvePresetWorkspace(url.searchParams.get('workspace'))
        const state = await readState()
        const pins = peekPreset(state, workspacePath)
        sendJson(res, 200, { ok: true, pins, workspacePath: workspacePath || null }, req.method === 'HEAD')
        return
      }
      if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method not allowed' }); return }
      const body = await readJsonBody(req)
      const workspacePath = await resolvePresetWorkspace(body.workspacePath)
      const state = await readState()
      const key = presetKey(workspacePath)
      if (body.clear === true) {
        if (state.presets && state.presets[key]) delete state.presets[key]
        presetPending = !!(state.presets && Object.keys(state.presets).length)
        await writeState(state)
        sendJson(res, 200, { ok: true, pins: [] })
        return
      }
      const dirName = cleanDirName(body.dirName)
      const scope = body.scope === 'workspace' ? 'workspace' : 'global'
      const mode = body.mode === 'available' ? 'available' : body.mode === 'off' ? 'off' : 'pinned'
      const bucket = presetBucket(state, workspacePath)
      // 预置也允许用工作区技能，路径由请求显式给出
      const wsForPin = scope === 'workspace' ? (body.skillWorkspace || workspacePath) : null
      await setPinMode(state, bucket.pins, { scope, workspacePath: wsForPin, dirName, mode })
      bucket.at = Date.now()
      if (!bucket.pins.length) delete state.presets[key]
      presetPending = !!(state.presets && Object.keys(state.presets).length)
      await writeState(state)
      sendJson(res, 200, { ok: true, pins: bucket.pins })
    }))

    disposers.push(route('/settings', 'settings', async (req, res) => {
      const state = await readState()
      if (req.method === 'GET' || req.method === 'HEAD') {
        sendJson(res, 200, {
          ok: true,
          globalRoot: globalRootOf(state),
          defaultGlobalRoot: defaultGlobalRoot(),
          custom: globalRootOf(state) !== defaultGlobalRoot(),
        }, req.method === 'HEAD')
        return
      }
      if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method not allowed' }); return }
      const body = await readJsonBody(req)
      const raw = typeof body.globalRoot === 'string' ? body.globalRoot.trim() : ''
      if (!raw) {
        if (state.settings && typeof state.settings === 'object') delete state.settings.globalRoot
        await writeState(state)
        invalidateSkills(ctx)
        sendJson(res, 200, { ok: true, globalRoot: globalRootOf(state), defaultGlobalRoot: defaultGlobalRoot() })
        return
      }
      if (raw.length > 512) throw new HttpError(400, '路径过长')
      if (!isAbsolute(raw)) throw new HttpError(400, '请填写绝对路径，例如 D:\\Skills')
      await mkdir(raw, { recursive: true })
      state.settings = { ...(state.settings && typeof state.settings === 'object' ? state.settings : {}), globalRoot: raw }
      await writeState(state)
      invalidateSkills(ctx)
      sendJson(res, 200, { ok: true, globalRoot: globalRootOf(state), defaultGlobalRoot: defaultGlobalRoot() })
    }))

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
      const ref = await resolveSkill(ctx, scope, dirName, url.searchParams.get('workspace'), url.searchParams.get('sessionId'))
      sendJson(res, 200, { ok: true, ...(await readSkillDoc(ref.root, ref.dirName)) })
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
      const ref = await resolveSkill(ctx, scope, dirName, body.workspacePath, body.sessionId)
      const description = typeof body.description === 'string' ? body.description : ''
      const content = typeof body.body === 'string' ? body.body : ''
      if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) throw new HttpError(400, '内容过大')
      await updateSkill(ref.root, ref.dirName, skillName, description, content)
      sendJson(res, 200, { ok: true })
    }))

    disposers.push(route('/delete', 'delete', async (req, res) => {
      if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method not allowed' }); return }
      const body = await readJsonBody(req)
      const scope = body.scope === 'workspace' ? 'workspace' : 'global'
      const dirName = cleanDirName(body.dirName)
      const ref = await resolveSkill(ctx, scope, dirName, body.workspacePath, body.sessionId)
      const state = ref.state
      const bucket = ref.bucket
      if (ref.isLink) delete bucket.links[dirName]
      else await deleteSkill(ref.root, ref.dirName)
      delete bucket.members[dirName]
      delete bucket.pinned[dirName]
      dropOverridesForSkill(state, scope, dirName)
      await writeState(state)
      invalidateSkills(ctx)
      sendJson(res, 200, { ok: true, unlinked: ref.isLink })
    }))

    disposers.push(route('/trash', 'trash', async (req, res) => {
      const url = new URL(req.url || '/', 'http://localhost')
      if (req.method === 'GET' || req.method === 'HEAD') {
        const scope = url.searchParams.get('scope') === 'workspace' ? 'workspace' : 'global'
        const resolved = await resolveScope(ctx, scope, url.searchParams.get('workspace'), url.searchParams.get('sessionId'))
        sendJson(res, 200, { ok: true, scope, root: resolved.root, items: await listTrash(resolved.root) }, req.method === 'HEAD')
        return
      }
      if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method not allowed' }); return }
      const body = await readJsonBody(req)
      const scope = body.scope === 'workspace' ? 'workspace' : 'global'
      const resolved = await resolveScope(ctx, scope, body.workspacePath, body.sessionId)
      await restoreTrash(resolved.root, body.entry, body.dirName)
      invalidateSkills(ctx)
      sendJson(res, 200, { ok: true, scope })
    }))

    disposers.push(route('/mode', 'mode', async (req, res) => {
      if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method not allowed' }); return }
      const body = await readJsonBody(req)
      const dirName = cleanDirName(body.dirName)
      const mode = body.mode === 'pinned' ? 'pinned' : body.mode === 'off' ? 'off' : 'available'
      const scope = body.scope === 'workspace' ? 'workspace' : 'global'
      const ref = await resolveSkill(ctx, scope, dirName, body.workspacePath, body.sessionId)
      const state = ref.state
      const bucket = ref.bucket
      if (ref.isLink) {
        // 链接与源共用同一份文件：停用/常驻只记在本分区，互不影响
        if (mode === 'off') bucket.off[dirName] = true
        else delete bucket.off[dirName]
        if (mode === 'pinned') bucket.pinned[dirName] = true
        else delete bucket.pinned[dirName]
        await writeState(state)
        invalidateSkills(ctx)
        sendJson(res, 200, { ok: true, mode, dirName })
        return
      }
      await setSkillEnabled(ref.root, ref.dirName, mode !== 'off')
      if (mode === 'pinned') bucket.pinned[dirName] = true
      else delete bucket.pinned[dirName]
      // 全局停用后，会话覆盖自动失效
      if (mode === 'off') dropOverridesForSkill(state, scope, dirName)
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
      const srcRef = await resolveSkill(ctx, fromScope, dirName, body.workspacePath, body.sessionId)
      const dst = await resolveScope(ctx, toScope, body.targetWorkspace || body.workspacePath, body.sessionId)
      const state = srcRef.state
      const dstBucket = scopeBucket(state, dst.key)

      // 同一物理根：只改分类，不动文件
      if (srcRef.root === dst.root) {
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

      // 跨作用域拖拽 = 逻辑复制：只登记链接，不复制任何文件
      const fromDir = join(srcRef.root, srcRef.dirName)
      if (!(await pathIsFile(join(fromDir, SKILL_FILE))) && !(await pathIsFile(join(fromDir, SKILL_FILE + DISABLED_SUFFIX)))) {
        throw new HttpError(404, '技能不存在')
      }
      const toDir = join(dst.root, dirName)
      const targetExists = dstBucket.links[dirName]
        || (await pathIsFile(join(toDir, SKILL_FILE)))
        || (await pathIsFile(join(toDir, SKILL_FILE + DISABLED_SUFFIX)))
      if (targetExists) {
        // 两个分区状态独立：目标已存在就保持它自己的挡位，不覆盖
        sendJson(res, 200, { ok: true, existed: true, scope: toScope })
        return
      }
      const origin = srcRef.isLink
        ? { scope: srcRef.link.scope, workspacePath: srcRef.link.workspacePath || null, dirName: srcRef.dirName }
        : { scope: fromScope, workspacePath: fromScope === 'workspace' ? (body.workspacePath || '') : null, dirName: srcRef.dirName }
      dstBucket.links[dirName] = origin
      if (categoryId) {
        if (!dstBucket.categories.some((c) => c.id === categoryId)) throw new HttpError(404, '目标分类不存在')
        dstBucket.members[dirName] = categoryId
      }
      // 新建时带上源启停状态；此后两个分区各自独立
      if (body.mode === 'pinned') dstBucket.pinned[dirName] = true
      else delete dstBucket.pinned[dirName]
      if (body.mode === 'off') dstBucket.off[dirName] = true
      else delete dstBucket.off[dirName]
      await writeState(state)
      sendJson(res, 200, { ok: true, copied: true, logical: true, scope: toScope, target: dst.root })
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
  // 重启后仍可能残留未套用的预置，先把标志置对，首个 turn 才走兜底
  void readState().then((state) => {
    presetPending = !!(state.presets && Object.keys(state.presets).length)
  }).catch(() => {})
  try {
    const existing = (typeof ctx.agents?.list === 'function' ? ctx.agents.list() : []) || []
    for (const agent of existing) void refreshAgentSkills(agent)
  } catch (error) {
    ctx.logger?.warn?.(PLUGIN + ': 初始化已启用技能失败（' + asError(error).message + '）')
  }

  if (typeof ctx.on === 'function') {
    ctx.effect(() => {
      const offCreated = ctx.on('agent/created', async ({ agent }) => {
        // 预置必须早于首次注入，否则首个 turn 拿不到用户选的挡位
        try { await applyPresetForAgent(agent) } catch (error) {
          ctx.logger?.warn?.(PLUGIN + ': 套用新会话预置失败（' + asError(error).message + '）')
        }
        await refreshAgentSkills(agent)
      })
      // 空白会话的 agent 可能早于点击就建好了；首个 turn 前再兜一次
      const offPreStep = ctx.on('agent/pre-step', async ({ agent }, next) => {
        if (presetPending) {
          try { await applyPresetForAgent(agent); await refreshAgentSkills(agent) } catch (error) {
            ctx.logger?.warn?.(PLUGIN + ': 首轮套用预置失败（' + asError(error).message + '）')
          }
        }
        return next()
      })
      const offDisposed = ctx.on('agent/disposed', ({ agent }) => {
        const entry = activeSessions.get(agent && agent.id)
        if (entry) { disposeSession(entry); activeSessions.delete(agent.id) }
      })
      return () => {
        try { offCreated?.() } catch { /* best effort */ }
        try { offDisposed?.() } catch { /* best effort */ }
        try { offPreStep?.() } catch { /* best effort */ }
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
