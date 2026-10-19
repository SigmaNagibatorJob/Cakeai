const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('path')
const https = require('https')
const fs = require('fs')
const { execFile } = require('child_process')
const os = require('os')
const crypto = require('crypto')
const { MCPManager } = require('./lib/mcp-manager')
const {
  runAnthropicToolLoop,
  runGeminiToolLoop,
  runOpenAIToolLoop
} = require('./lib/mcp-agent')

let win
let mcpManager

// ── Ключ шифрования истории ──────────────────────────────────────────────────
function getMachineKey() {
  const keyFile = path.join(app.getPath('userData'), 'machine.key')
  if (fs.existsSync(keyFile)) {
    return fs.readFileSync(keyFile)
  }
  const key = crypto.randomBytes(32)
  fs.writeFileSync(keyFile, key)
  return key
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    backgroundColor: '#0d0f12',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  try {
    const ses = win.webContents.session
    if (ses && ses.setPermissionRequestHandler) {
      ses.setPermissionRequestHandler((webContents, permission, callback) => {
        callback(false)
      })
    }
  } catch (e) {}

  win.loadFile(path.join(__dirname, 'src', 'index.html'))
  win.webContents.on('render-process-gone', (event, details) => {
    console.error('Renderer process gone:', details.reason)
  })

  // Внешние ссылки открываем в системном браузере
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

app.whenReady().then(() => {
  mcpManager = new MCPManager(path.join(app.getPath('userData'), 'mcp-config.json'))
  createWindow()
})
app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => { mcpManager?.closeAll().catch(() => {}) })

// ── Window controls ──────────────────────────────────────────────────────────
ipcMain.on('win-close',    () => win.close())
ipcMain.on('win-minimize', () => win.minimize())
ipcMain.on('win-maximize', () => {
  if (win.isMaximized()) win.unmaximize()
  else win.maximize()
})

// ── File system ──────────────────────────────────────────────────────────────
ipcMain.handle('open-folder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
  return r.canceled ? null : r.filePaths[0]
})

ipcMain.handle('read-dir', (_, p) => {
  try {
    return fs.readdirSync(p, { withFileTypes: true }).map(e => ({
      name: e.name,
      isDir: e.isDirectory(),
      path: path.join(p, e.name),
      ext: e.isFile() ? path.extname(e.name).toLowerCase() : ''
    })).sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name))
  } catch (e) { return { error: e.message } }
})

ipcMain.handle('read-file', (_, p) => {
  try {
    if (fs.statSync(p).size > 5e6) return { error: 'Файл >5MB' }
    return { content: fs.readFileSync(p, 'utf8') }
  } catch (e) { return { error: e.message } }
})

ipcMain.handle('write-file', (_, p, content) => {
  try { fs.writeFileSync(p, content, 'utf8'); return { ok: true } }
  catch (e) { return { error: e.message } }
})

ipcMain.handle('create-file', (_, dir, name) => {
  try {
    const fp = path.join(dir, name)
    if (fs.existsSync(fp)) return { error: 'Уже существует' }
    fs.writeFileSync(fp, '')
    return { path: fp }
  } catch (e) { return { error: e.message } }
})

ipcMain.handle('create-dir', (_, dir, name) => {
  try {
    const fp = path.join(dir, name)
    if (fs.existsSync(fp)) return { error: 'Уже существует' }
    fs.mkdirSync(fp, { recursive: true })
    return { path: fp }
  } catch (e) { return { error: e.message } }
})

ipcMain.handle('delete-entry', (_, p) => {
  try {
    fs.rmSync(p, { recursive: true, force: true })
    return { ok: true }
  } catch (e) { return { error: e.message } }
})

ipcMain.handle('rename-entry', (_, oldPath, newName) => {
  try {
    const newPath = path.join(path.dirname(oldPath), newName)
    fs.renameSync(oldPath, newPath)
    return { path: newPath }
  } catch (e) { return { error: e.message } }
})

ipcMain.handle('show-in-explorer', (_, p) => { shell.showItemInFolder(p); return true })

// ── MCP (Model Context Protocol) ─────────────────────────────────────────────
function requireMcpManager() {
  if (!mcpManager) throw new Error('MCP ещё не инициализирован')
  return mcpManager
}

function mcpSecretsForKey(key) {
  return key && key.startsWith('sk-orca-') ? { ORCAROUTER_API_KEY: key } : {}
}

ipcMain.handle('mcp-config-load', () => requireMcpManager().loadConfig())
ipcMain.handle('mcp-config-save', async (_, config) => {
  return requireMcpManager().saveConfig(config)
})
ipcMain.handle('mcp-test', async (_, { key } = {}) => {
  return requireMcpManager().getTools(mcpSecretsForKey(key))
})
ipcMain.handle('mcp-disconnect', async () => {
  await requireMcpManager().closeAll()
  return true
})

// ── Web Search (DuckDuckGo HTML) ─────────────────────────────────────────────
function postForm(hostname, path_, headers, bodyStr) {
  return new Promise((res, rej) => {
    const buf = Buffer.from(bodyStr)
    const req = https.request({
      hostname,
      path: path_,
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': buf.length
      }
    }, r => {
      let d = ''
      r.on('data', c => d += c)
      r.on('end', () => res(d))
    })
    req.on('error', rej)
    req.end(buf)
  })
}

function parseDDGResults(html) {
  const results = []
  const linkRegex = /class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g
  let match
  while ((match = linkRegex.exec(html)) !== null) {
    let url = match[1]
    const uddgMatch = url.match(/uddg=([^&]+)/)
    if (uddgMatch) {
      try { url = decodeURIComponent(uddgMatch[1]) } catch (e) { url = match[1] }
    } else if (url.startsWith('//')) {
      url = 'https:' + url
    }
    const title = match[2].replace(/<[^>]*>/g, '').trim()
    if (title && url) results.push({ url, title, snippet: '' })
  }
  const snippetRegex = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
  let sMatch
  let i = 0
  while ((sMatch = snippetRegex.exec(html)) !== null) {
    if (results[i]) {
      results[i].snippet = sMatch[1].replace(/<[^>]*>/g, '').trim().slice(0, 300)
    }
    i++
  }
  if (!results.length) {
    const liteRegex = /<a[^>]*href="([^"]*)"[^>]*rel="nofollow"[^>]*>([\s\S]*?)<\/a>/g
    while ((match = liteRegex.exec(html)) !== null) {
      const url = match[1]
      const title = match[2].replace(/<[^>]*>/g, '').trim()
      if (title && url.startsWith('http') && results.length < 5) {
        results.push({ url, title, snippet: '' })
      }
    }
  }
  return results.slice(0, 5)
}

// ── Поиск в интернете: Google News (для новостей) + DuckDuckGo + Bing ─────────
function fetchText(urlStr, opts) {
  const { headers = {}, body = null, timeout = 7000, redirects = 3 } = opts || {}
  return new Promise((resolve, reject) => {
    let u
    try { u = new URL(urlStr) } catch (e) { return reject(e) }
    const buf = body ? Buffer.from(body) : null
    const reqOpts = {
      method: buf ? 'POST' : 'GET',
      headers: Object.assign({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8'
      }, headers, buf ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': buf.length } : {})
    }
    const req = https.request(u, reqOpts, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume()
        const next = new URL(res.headers.location, u).toString()
        return resolve(fetchText(next, { headers, timeout, redirects: redirects - 1 }))
      }
      let d = ''
      res.setEncoding('utf8')
      res.on('data', c => { d += c; if (d.length > 2e6) req.destroy() })
      res.on('end', () => resolve({ status: res.statusCode, body: d }))
      res.on('error', reject)
    })
    req.setTimeout(timeout, () => req.destroy(new Error('таймаут')))
    req.on('error', reject)
    req.end(buf || undefined)
  })
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
}
const stripTags = s => decodeEntities(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

function parseRSS(xml, defaultSource) {
  const out = []
  const items = String(xml).match(/<item>[\s\S]*?<\/item>/g) || []
  for (const it of items) {
    const get = (tag) => {
      const m = it.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>'))
      return m ? m[1] : ''
    }
    let title = stripTags(get('title'))
    const link = decodeEntities(get('link')).trim()
    const date = decodeEntities(get('pubDate')).trim()
    const source = stripTags(get('source')) || defaultSource || ''
    let snippet = stripTags(get('description'))
    if (source && title.endsWith(' - ' + source)) title = title.slice(0, -(source.length + 3))
    if (snippet === title) snippet = ''
    if (title && /^https?:\/\//.test(link)) {
      out.push({ url: link, title, snippet: snippet.slice(0, 250), date, source })
    }
  }
  return out
}

function fmtDate(s) {
  const d = new Date(s)
  return isNaN(d) ? '' : d.toISOString().slice(0, 10)
}

const NEWS_RE = /новост|свеж|актуальн|сегодня|вчера|недавно|недел|последн|news|latest|today|breaking/i

function newsPeriod(q) {
  if (/сегодня|вчера|24 час|today|yesterday/i.test(q)) return ' when:1d'
  if (/недел|week/i.test(q)) return ' when:7d'
  if (/месяц|month/i.test(q)) return ' when:30d'
  return ' when:7d'
}
function cleanNewsQuery(q) {
  return q
    .replace(/за\s+(?:эту|последн\S*|прошл\S*|текущ\S*)\s+\S+/gi, ' ')
    .replace(/на\s+этой\s+неделе|сегодня|вчера|за\s+неделю|за\s+месяц/gi, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 120)
}

async function searchGoogleNews(query) {
  const loc = /[а-яё]/i.test(query) ? 'hl=ru&gl=RU&ceid=RU:ru' : 'hl=en-US&gl=US&ceid=US:en'
  const base = cleanNewsQuery(query) || query
  for (const q of [base + newsPeriod(query), base]) {
    const r = await fetchText('https://news.google.com/rss/search?q=' + encodeURIComponent(q) + '&' + loc)
    const items = parseRSS(r.body, '')
    if (items.length) return items.slice(0, 8)
  }
  return []
}

async function searchDDG(query) {
  const r = await fetchText('https://html.duckduckgo.com/html/', {
    body: 'q=' + encodeURIComponent(query),
    headers: { 'Referer': 'https://html.duckduckgo.com/', 'Accept': 'text/html,application/xhtml+xml' }
  })
  if (r.status !== 200) throw new Error('HTTP ' + r.status + ' (возможно, блокировка)')
  return parseDDGResults(r.body)
}

async function searchBing(query) {
  const r = await fetchText('https://www.bing.com/search?format=rss&count=8&setmkt=ru-RU&q=' + encodeURIComponent(query))
  return parseRSS(r.body, 'Bing').slice(0, 8)
}

async function doWebSearch(query) {
  const isNews = NEWS_RE.test(query)
  const engines = [
    ['DuckDuckGo', () => searchDDG(query)],
    ['Bing', () => searchBing(query)]
  ]
  if (isNews) engines.unshift(['Google News', () => searchGoogleNews(query)])

  const limit = new Promise((_, rej) => setTimeout(() => rej(new Error('таймаут 9 с')), 9000))
  const settled = await Promise.allSettled(engines.map(e => Promise.race([e[1](), limit])))

  const diag = []
  let all = []
  settled.forEach((s, i) => {
    const name = engines[i][0]
    if (s.status === 'fulfilled') { diag.push(name + ': ' + s.value.length); all = all.concat(s.value) }
    else diag.push(name + ': ' + ((s.reason && s.reason.message) || s.reason))
  })

  const seen = new Set()
  const results = all.filter(r => {
    const k = r.title.toLowerCase().slice(0, 60)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  }).slice(0, 10)

  console.log('[search] "' + query + '" → ' + diag.join(', '))

  const text = results.map((r, i) =>
    (i + 1) + '. ' + r.title + (r.source ? ' — ' + r.source : '') + (fmtDate(r.date) ? ' (' + fmtDate(r.date) + ')' : '') +
    '\n   URL: ' + r.url + (r.snippet ? '\n   ' + r.snippet : '')
  ).join('\n\n')

  return {
    results: results.map(r => ({ url: r.url, title: r.title + (r.source ? ' — ' + r.source : ''), snippet: r.snippet })),
    text,
    error: results.length ? undefined : diag.join('; ')
  }
}

ipcMain.handle('web-search', (_, query) => doWebSearch(query))

// ── AI API ───────────────────────────────────────────────────────────────────
function detectProvider(key) {
  if (!key) return null
  if (key.startsWith('sk-orca-')) return 'orcarouter'
  if (key.startsWith('sk-ant-'))  return 'claude'
  if (key.startsWith('AIza'))     return 'gemini'
  if (key.startsWith('gsk_'))     return 'groq'
  if (key.startsWith('dsk-'))     return 'deepseek'
  if (key.startsWith('sk-') && key.length >= 48) return 'openai'
  if (key.startsWith('sk-'))      return 'deepseek'
  return 'unknown'
}

ipcMain.handle('detect-provider', (_, key) => detectProvider(key))

function httpGet(hostname, path_, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path: path_, method: 'GET', headers }, res => {
      let d = ''
      res.on('data', c => d += c)
      res.on('end', () => resolve(d))
    })
    req.on('error', reject)
    req.end()
  })
}

const PREFERRED_MODELS = {
  claude: [
    'claude-opus-5',
    'claude-sonnet-5',
    'claude-fable-5',
    'claude-mythos-5',
    'claude-opus-4.8',
    'claude-sonnet-4.6'
  ],
  openai: [
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-5.6-luna',
    'gpt-5.5-pro',
    'gpt-5.5',
    'gpt-5.4-thinking',
    'gpt-5.4-pro'
  ],
  gemini: [
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-3.1-pro'
  ],
  deepseek: [
    'deepseek-v4-pro',
    'deepseek-v4-flash',
    'deepseek-r1'
  ],
  groq: [
    'llama-4-scout',
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'qwen3-32b'
  ],
  kimi: [
    'moonshot-v1-128k',
    'moonshot-v1-32k',
    'kimi-latest'
  ],
  // Бесплатная линейка ротируется. API обновляет этот список автоматически;
  // значения ниже нужны как офлайн-fallback, GLM 5.3 Flash — модель по умолчанию.
  orcarouter: [
    'z-ai/glm-5.3-flash-free',
    'orcarouter/free',
    'deepseek/deepseek-v4.1-flash-free',
    'deepseek/deepseek-v4-flash-free',
    'tencent/hy4-preview-free',
    'tencent/hy3-free',
    'orca/orcaverify-text1.0-free'
  ]
}

const DEFAULT_MODEL = {
  claude: 'claude-sonnet-4-6',
  openai: 'gpt-5.5',
  gemini: 'gemini-3.5-flash',
  deepseek: 'deepseek-v4-flash',
  groq: 'llama-4-scout',
  kimi: 'moonshot-v1-128k',
  orcarouter: 'z-ai/glm-5.3-flash-free'
}

function trimMsgs(msgs, maxCount) {
  if (msgs.length <= maxCount) return msgs
  return msgs.slice(-maxCount)
}

// ── Автоматический список моделей ───────────────────────────────────────────
// Список берётся с API провайдера. PREFERRED_MODELS выше — только запасной вариант
// (когда нет ключа или нет интернета), добавлять туда новые модели вручную не нужно.

const modelCache = {}                 // provider:ключ -> { t, models }
const MODEL_CACHE_MS = 10 * 60 * 1000 // 10 минут

// Не чат-модели: озвучка, картинки, эмбеддинги, модерация и т.д.
const SKIP_WORDS = ['embed', 'tts', 'whisper', 'transcribe', 'audio', 'realtime', 'image',
  'dall-e', 'moderation', 'guard', 'search', 'davinci', 'babbage', 'orpheus', 'imagen', 'veo']

// Маленькие/быстрые модели — не выбираем их по умолчанию, если есть что-то получше
const SMALL_RE = /(^|[-_.\/:])(haiku|mini|nano|lite|instant|small|8b)($|[-_.\/:])/i

function versionOf(id) {
  const m = id.match(/\d+(?:\.\d+)*/)
  return m ? m[0].split('.').map(Number) : []
}

// Сначала самые свежие: по дате создания, если API её отдаёт, иначе по номеру версии
function cmpNewest(a, b) {
  if ((a.created || 0) !== (b.created || 0)) return (b.created || 0) - (a.created || 0)
  const va = versionOf(a.id), vb = versionOf(b.id)
  for (let i = 0; i < Math.max(va.length, vb.length); i++) {
    const d = (vb[i] || 0) - (va[i] || 0)
    if (d) return d
  }
  return a.id.localeCompare(b.id)
}

function isChatModel(prov, id) {
  const low = id.toLowerCase()
  if (SKIP_WORDS.some(w => low.includes(w))) return false
  if (prov === 'openai') return /^(gpt-|chatgpt-|o\d)/.test(low)
  if (prov === 'gemini') return low.startsWith('gemini-')
  if (prov === 'claude') return low.startsWith('claude-')
  return true
}

async function fetchAvailableModels(prov, key, force) {
  const fallback = PREFERRED_MODELS[prov] || []
  // Каталог OrcaRouter публичный: бесплатные модели можно обновить ещё до ввода ключа.
  if (!key && prov !== 'orcarouter') return { models: fallback, fromApi: false }

  const cacheKey = prov + ':' + String(key || '').slice(-8)
  const hit = modelCache[cacheKey]
  if (!force && hit && Date.now() - hit.t < MODEL_CACHE_MS) {
    return { models: hit.models, fromApi: true }
  }

  try {
    let items = []
    if (prov === 'claude') {
      const raw = await httpGet('api.anthropic.com', '/v1/models?limit=100', { 'x-api-key': key, 'anthropic-version': '2023-06-01' })
      items = (JSON.parse(raw).data || []).map(m => ({ id: m.id, created: Date.parse(m.created_at) / 1000 || 0 }))
    } else if (prov === 'openai') {
      const raw = await httpGet('api.openai.com', '/v1/models', { 'Authorization': 'Bearer ' + key })
      items = (JSON.parse(raw).data || []).map(m => ({ id: m.id, created: m.created || 0 }))
    } else if (prov === 'gemini') {
      const raw = await httpGet('generativelanguage.googleapis.com', `/v1beta/models?pageSize=200&key=${key}`, {})
      items = (JSON.parse(raw).models || [])
        .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
        .map(m => ({ id: m.name.replace('models/', ''), created: 0 }))
    } else if (prov === 'deepseek') {
      const raw = await httpGet('api.deepseek.com', '/models', { 'Authorization': 'Bearer ' + key })
      items = (JSON.parse(raw).data || []).map(m => ({ id: m.id, created: m.created || 0 }))
    } else if (prov === 'groq') {
      const raw = await httpGet('api.groq.com', '/openai/v1/models', { 'Authorization': 'Bearer ' + key })
      items = (JSON.parse(raw).data || []).map(m => ({ id: m.id, created: m.created || 0 }))
    } else if (prov === 'kimi') {
      const raw = await httpGet('api.moonshot.cn', '/v1/models', { 'Authorization': 'Bearer ' + key })
      items = (JSON.parse(raw).data || []).map(m => ({ id: m.id, created: m.created || 0 }))
    } else if (prov === 'orcarouter') {
      // Специальный публичный endpoint отдаёт только текущую free-линейку и
      // заметно легче полного каталога /v1/models.
      const raw = await httpGet('api.orcarouter.ai', '/api/free-package/public', {})
      const data = JSON.parse(raw).data || {}
      items = [
        { id: 'orcarouter/free', created: 0 },
        ...(data.models || []).map(m => ({ id: m.free_alias, created: 0 }))
      ]
    }

    items = items.filter(m => m.id && isChatModel(prov, m.id)).sort(cmpNewest)
    let models = [...new Set(items.map(m => m.id))]
    if (prov === 'orcarouter') {
      const priority = PREFERRED_MODELS.orcarouter
      models = [...priority.filter(id => models.includes(id)), ...models.filter(id => !priority.includes(id))]
    }
    if (!models.length) return { models: fallback, fromApi: false }

    modelCache[cacheKey] = { t: Date.now(), models }
    return { models, fromApi: true }
  } catch {
    return { models: fallback, fromApi: false }
  }
}

// Самая свежая модель, но не «мини/лайт», если есть выбор
function pickBestModel(prov, available) {
  // Пользовательский default OrcaRouter должен быть предсказуемым: каталог
  // постоянно ротируется и сортировка по created для free-моделей не помогает.
  if (prov === 'orcarouter' && available.includes(DEFAULT_MODEL.orcarouter)) {
    return DEFAULT_MODEL.orcarouter
  }
  const big = available.find(m => !SMALL_RE.test(m))
  return big || available[0] || DEFAULT_MODEL[prov]
}

async function resolveModel(prov, key, explicitModel) {
  const { models, fromApi } = await fetchAvailableModels(prov, key)
  if (explicitModel) {
    // Выбранная вручную модель: используем, пока она есть у провайдера.
    // Если её убрали — молча берём самую свежую, чтобы чат не ломался.
    if (!fromApi || models.includes(explicitModel)) return explicitModel
  }
  return pickBestModel(prov, models)
}

// Меню выбора модели всегда запрашивает свежий список
ipcMain.handle('list-models', async (_, { provider, key }) => {
  return fetchAvailableModels(provider, key, true)
})

function post(hostname, path_, headers, body) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(body)
    const req = https.request({ hostname, path: path_, method: 'POST', headers: { ...headers, 'Content-Length': buf.length } }, res => {
      let d = ''
      res.on('data', c => d += c)
      res.on('end', () => resolve(d))
    })
    req.on('error', reject)
    req.end(buf)
  })
}

async function postJson(hostname, path_, headers, payload) {
  const raw = await post(hostname, path_, headers, JSON.stringify(payload))
  let json
  try { json = JSON.parse(raw) } catch (_) { throw new Error('API вернул некорректный JSON') }
  if (json.error) {
    const message = json.error.message || json.error
    const retry = json.error.metadata?.retry_after_seconds
    throw new Error((typeof message === 'string' ? message : JSON.stringify(message)) + (retry ? ` (повтор через ${retry} с)` : ''))
  }
  return json
}

const SYS_BASE = `Ты — Lungskull, ассистент, которого создал Cakein228.

КАК ОБЩАТЬСЯ
- Говори как умный живой собеседник, а не как робот или справочник. Просто и по-человечески.
- Отвечай на том языке, на котором пишет пользователь. Подстраивайся под его тон: пишет неформально — отвечай неформально.
- Без канцелярита и пафоса. Не начинай с «Отличный вопрос!», «Конечно!», «Разумеется!». Сразу к сути.
- Не хвали пользователя без причины и не извиняйся без нужды.
- На простой вопрос — короткий ответ (пара предложений). На сложный — подробно, но без воды.
- Не пересказывай вопрос и не заканчивай каждый ответ фразой «обращайся, если что».
- Уточняющий вопрос задавай только если без него реально нельзя ответить, и не больше одного. Сначала попробуй ответить сам.
- Не ругайся матом, пока пользователь сам не начал, и то в меру.

ЧЕСТНОСТЬ
- Не выдумывай факты, даты, ссылки, цитаты и названия. Не знаешь или не уверен — так и скажи.
- Не поддакивай. Если пользователь не прав или идея плохая — скажи прямо, но по-доброму и объясни почему.
- Свои ошибки признавай спокойно, без драмы, и сразу исправляй.
- Если спросят, какая модель у тебя под капотом — не угадывай, скажи, что точно не знаешь. Если спросят прямо, человек ли ты, — честно скажи, что ты ИИ.
- Если человеку тяжело или он расстроен — поддержи нормальными человеческими словами, без шаблонных фраз, и не читай лекций.

ФОРМАТ
- В обычном разговоре пиши обычным текстом, без заголовков и без списков. Списки — только когда реально перечисляешь шаги или варианты.
- Жирный шрифт и эмодзи используй редко. Эмодзи — только если пользователь сам их использует.
- Код всегда в блоках с указанием языка.

КОД
- Сразу давай готовый рабочий код, без длинных вступлений.
- Названия переменных понятные, комментарии короткие и только где они нужны.
- Если в коде пользователя ошибка — сначала покажи исправление, потом коротко объясни, что было не так.
- Если для задачи не хватает важных деталей — предположи разумное и скажи, что именно ты предположил.

ОБЪЯСНЕНИЯ
- Объясняй как умному другу: просто, на примерах и аналогиях, без академического стиля.
- Сложное разбивай на маленькие понятные шаги.

ПОИСК
- Если в системном сообщении есть блок «Результаты поиска в интернете» - Если в системном сообщении есть блок результатов поиска в интернете — отвечай по нему и давай ссылки только из него. Никогда не выдумывай ссылки и не говори, что у тебя нет доступа к новостям, если такой блок есть.
`

const SYS_CODE = SYS_BASE

const SYS = {
  lua:     SYS_CODE,
  fnf:     SYS_CODE,
  general: SYS_CODE,
  code:    SYS_CODE
}

// Текущая дата + правила для модели
function dateLine() {
  const d = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
  return `\n\nСегодняшняя дата: ${d}.\nЕсли не знаешь свою точную дату актуальности знаний — так и скажи, не выдумывай.\nЕсли результаты поиска не относятся к вопросу пользователя — игнорируй их и отвечай по смыслу вопроса.`
}

// ── ai-send (без стрима) ─────────────────────────────────────────────────────
ipcMain.handle('ai-send', async (_, { msgs, mode, key, provider, model, fileCtx }) => {
  const prov = provider || detectProvider(key)
  const sys = (SYS[mode] || SYS.general) + dateLine() + (fileCtx ? '\n\n' + fileCtx.slice(0, 12000) : '')

  if (prov === 'unknown' || !prov) {
    return { text: '⚠️ Неизвестный провайдер. Поддерживаемые:\n• OrcaRouter — sk-orca-...\n• Claude — sk-ant-...\n• ChatGPT — sk-... (длинный)\n• Gemini — AIza...\n• DeepSeek — sk-.../dsk-...\n• Groq — gsk_...\n• Kimi — sk-...' }
  }

  try {
    if (prov === 'claude') {
      const claudeModel = await resolveModel('claude', key, model)
      const body = JSON.stringify({ model: claudeModel, max_tokens: 8192, system: sys, messages: msgs })
      const raw = await post('api.anthropic.com', '/v1/messages', { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body)
      const j = JSON.parse(raw)
      if (j.error) throw j.error.message
      return { text: j.content[0].text }
    }
    if (prov === 'openai') {
      const openaiModel = await resolveModel('openai', key, model)
      const body = JSON.stringify({ model: openaiModel, max_completion_tokens: 8192, messages: [{ role: 'system', content: sys }, ...msgs] })
      const raw = await post('api.openai.com', '/v1/chat/completions', { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }, body)
      const j = JSON.parse(raw)
      if (j.error) throw j.error.message
      return { text: j.choices[0].message.content }
    }
    if (prov === 'orcarouter') {
      const orcaModel = await resolveModel('orcarouter', key, model)
      const body = JSON.stringify({ model: orcaModel, max_tokens: 8192, messages: [{ role: 'system', content: sys }, ...msgs] })
      const raw = await post('api.orcarouter.ai', '/v1/chat/completions', { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }, body)
      const j = JSON.parse(raw)
      if (j.error) throw j.error.message || j.error
      return { text: j.choices[0].message.content }
    }
    if (prov === 'gemini') {
      const geminiModel = await resolveModel('gemini', key, model)
      const contents = msgs.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
      const body = JSON.stringify({ system_instruction: { parts: [{ text: sys }] }, contents, generationConfig: { maxOutputTokens: 65536 } })
      const raw = await post('generativelanguage.googleapis.com', `/v1beta/models/${geminiModel}:generateContent?key=${key}`, { 'Content-Type': 'application/json' }, body)
      const j = JSON.parse(raw)
      if (j.error) throw j.error.message || j.error.status
      return { text: j.candidates[0].content.parts[0].text }
    }
    if (prov === 'deepseek') {
      const deepseekModel = await resolveModel('deepseek', key, model)
      const body = JSON.stringify({ model: deepseekModel, max_tokens: 8192, messages: [{ role: 'system', content: sys }, ...msgs] })
      const raw = await post('api.deepseek.com', '/v1/chat/completions', { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }, body)
      const j = JSON.parse(raw)
      if (j.error) throw j.error.message
      return { text: j.choices[0].message.content }
    }
    if (prov === 'groq') {
      const groqModel = await resolveModel('groq', key, model)
      const body = JSON.stringify({ model: groqModel, max_tokens: 4096, messages: [{ role: 'system', content: sys }, ...msgs] })
      const raw = await post('api.groq.com', '/openai/v1/chat/completions', { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }, body)
      const j = JSON.parse(raw)
      if (j.error) throw j.error.message || j.error
      return { text: j.choices[0].message.content }
    }
    if (prov === 'kimi') {
      const kimiModel = await resolveModel('kimi', key, model)
      const body = JSON.stringify({ model: kimiModel, max_tokens: 8192, messages: [{ role: 'system', content: sys }, ...msgs] })
      const raw = await post('api.moonshot.cn', '/v1/chat/completions', { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }, body)
      const j = JSON.parse(raw)
      if (j.error) throw j.error.message
      return { text: j.choices[0].message.content }
    }
  } catch (e) {
    throw String(e)
  }
})

// ── AI Stream ────────────────────────────────────────────────────────────────
let currentStream = null   // текущий запрос, чтобы его можно было остановить кнопкой «Стоп»

// Разделяет поток текста на «размышления» (внутри <think>…</think>) и обычный ответ.
// Теги могут прийти разорванными между кусками, поэтому хвост, похожий на начало тега, придерживаем.
function makeThinkSplitter(onThink, onText) {
  let buf = ''
  let inThink = false
  const emit = (t) => { if (t) (inThink ? onThink : onText)(t) }
  return {
    push(t) {
      buf += t
      while (true) {
        const tag = inThink ? '</think>' : '<think>'
        const i = buf.indexOf(tag)
        if (i === -1) {
          let cut = buf.length
          for (let k = Math.min(buf.length, tag.length - 1); k > 0; k--) {
            if (tag.startsWith(buf.slice(-k))) { cut = buf.length - k; break }
          }
          emit(buf.slice(0, cut))
          buf = buf.slice(cut)
          return
        }
        emit(buf.slice(0, i))
        buf = buf.slice(i + tag.length)
        inThink = !inThink
      }
    },
    flush() {
      emit(buf)
      buf = ''
    }
  }
}

const THINK_RE = /reasoner|thinking|r1|deepseek-v[4-9]|glm-5|(?:^|\/)hy[34]/i

ipcMain.handle('ai-stream', async (event, { msgs, mode, key, provider, model, fileCtx, customPrompt, deepthinkEnabled, webSearch }) => {
  const prov = provider || detectProvider(key)
  const ctl = { cancel: null, forceDone: null, stopped: false }
  currentStream = ctl
  let sys = (SYS[mode] || SYS.general) + dateLine() + (customPrompt ? '\n\n' + customPrompt : '') + (fileCtx ? '\n\n' + fileCtx.slice(0, 12000) : '')

  const chunk = (text) => {
    try { win.webContents.send('stream-chunk', text) } catch (e) {}
  }
  const reasoningChunk = (text) => {
    if (!deepthinkEnabled) return
    try { win.webContents.send('stream-reasoning', text) } catch (e) {}
  }
  const splitter = makeThinkSplitter(reasoningChunk, chunk)
  let completed = false
  const done = (err) => {
    if (completed) return
    completed = true
    if (currentStream === ctl) currentStream = null
    try { splitter.flush() } catch (e) {}
    try { win.webContents.send('stream-done', err || null) } catch (e) {}
  }

  ctl.forceDone = () => done(null)

  // Какая модель реально будет использована
  let resolved = null
  try {
    if (prov && prov !== 'unknown') {
      resolved = await resolveModel(prov, key, model)
      // DeepSeek: «думающая» модель — отдельная (reasoner). Если модель не выбрана вручную — берём её
      if (deepthinkEnabled && prov === 'deepseek' && !model && !THINK_RE.test(resolved)) {
        const { models } = await fetchAvailableModels('deepseek', key)
        const r = models.find(m => /reasoner/i.test(m))
        if (r) resolved = r
      }
    }
  } catch (e) {}

  // Поиск в интернете
  if (webSearch && msgs.length > 0) {
    const userMsgs = msgs.filter(m => m.role === 'user')
    const lastUserMsg = userMsgs[userMsgs.length - 1]
    if (lastUserMsg) {
      // Короткий вопрос ("а точной даты не знаешь?") ищем вместе с предыдущим, чтобы был контекст
      let q = lastUserMsg.content
      if (q.length < 50 && userMsgs.length > 1) {
        q = userMsgs[userMsgs.length - 2].content.slice(0, 120) + ' ' + q
      }
      const searchRes = await doWebSearch(q.slice(0, 200))
      if (searchRes.results.length > 0) {
                sys += '\n\n📋 СВЕЖИЕ РЕЗУЛЬТАТЫ ПОИСКА В ИНТЕРНЕТЕ (сегодня ' + new Date().toLocaleDateString('ru-RU') + '). Отвечай, опираясь на них. Ссылки давай ТОЛЬКО из этого списка, дословно. Не придумывай ссылки и не называй сайты из памяти. Если по результатам нельзя ответить, так и скажи.\n\n' + searchRes.text
        try { win.webContents.send('search-sources', searchRes.results) } catch (e) {}
      } else {
        sys += '\n\n⚠️ Поиск в интернете не дал результатов' + (searchRes.error ? ': ' + searchRes.error : '') + '. Ответь по своим знаниям и честно скажи, что поиск не сработал. Не придумывай ссылки и не советуй сайты «из памяти» как источники свежих новостей.'
      }
    }
  }

  if (ctl.stopped) { done(null); return }

  // DeepThink. Claude и «думающие» модели показывают размышления сами (через API).
  // Остальным просим думать вслух внутри <think>…</think>: мы покажем это в отдельном блоке.
  const nativeThinking = prov === 'claude' || THINK_RE.test(resolved || '')
  if (deepthinkEnabled && !nativeThinking) {
    sys += '\n\n[РЕЖИМ DEEPTHINK]: Сначала подумай вслух. Распиши ход рассуждений, проверь логику, краевые случаи и возможные ошибки. Всё это напиши ВНУТРИ тегов <think> и </think>. После закрывающего тега </think> дай финальный ответ, не повторяя рассуждения.'
  }

  const safeMsgs = prov === 'groq' ? trimMsgs(msgs, 8) : msgs

  const sendMcpStatus = payload => {
    try { win.webContents.send('mcp-tool-status', payload) } catch (_) {}
  }

  async function runWithMcpTools() {
    const state = await requireMcpManager().getTools(mcpSecretsForKey(key))
    if (!state.enabled) return false

    sendMcpStatus({ state: 'ready', tools: state.tools.length, servers: state.servers, error: state.error })
    if (!state.tools.length) return false

    const callTool = async (name, args) => {
      if (ctl.stopped) throw new Error('Запрос остановлен')
      return requireMcpManager().callTool(name, args)
    }
    const onTool = info => sendMcpStatus({ ...info, state: 'tool', toolState: info.state })
    const common = {
      tools: state.tools,
      callTool,
      onTool,
      onReasoning: reasoningChunk
    }
    let answer = ''

    if (prov === 'claude') {
      answer = await runAnthropicToolLoop({
        ...common,
        messages: safeMsgs,
        request: ({ messages, tools }) => {
          if (ctl.stopped) throw new Error('Запрос остановлен')
          return postJson('api.anthropic.com', '/v1/messages', {
            'Content-Type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2023-06-01'
          }, { model: resolved, max_tokens: deepthinkEnabled ? 16384 : 8192, system: sys, messages, tools })
        }
      })
    } else if (prov === 'gemini') {
      const contents = safeMsgs.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }))
      answer = await runGeminiToolLoop({
        ...common,
        contents,
        request: ({ contents: nextContents, tools }) => {
          if (ctl.stopped) throw new Error('Запрос остановлен')
          return postJson('generativelanguage.googleapis.com', `/v1beta/models/${resolved}:generateContent?key=${key}`,
            { 'Content-Type': 'application/json' }, {
              system_instruction: { parts: [{ text: sys }] },
              contents: nextContents,
              tools,
              generationConfig: { maxOutputTokens: 65536 }
            })
        }
      })
    } else {
      const endpoints = {
        openai: ['api.openai.com', '/v1/chat/completions', {}],
        orcarouter: ['api.orcarouter.ai', '/v1/chat/completions', { max_tokens: 8192 }],
        deepseek: ['api.deepseek.com', '/v1/chat/completions', { max_tokens: deepthinkEnabled ? 16384 : 8192 }],
        groq: ['api.groq.com', '/openai/v1/chat/completions', { max_tokens: 4096 }],
        kimi: ['api.moonshot.cn', '/v1/chat/completions', { max_tokens: deepthinkEnabled ? 16384 : 8192 }]
      }
      const endpoint = endpoints[prov]
      if (!endpoint) return false
      answer = await runOpenAIToolLoop({
        ...common,
        messages: [{ role: 'system', content: sys }, ...safeMsgs],
        request: ({ messages, tools }) => {
          if (ctl.stopped) throw new Error('Запрос остановлен')
          return postJson(endpoint[0], endpoint[1], {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + key
          }, { model: resolved, ...endpoint[2], messages, tools })
        }
      })
    }

    if (!ctl.stopped && answer) splitter.push(answer)
    return true
  }

  function streamSSE(hostname, path_, headers, body) {
    return new Promise((resolve, reject) => {
      const buf = Buffer.from(body)
      const req = https.request({ hostname, path: path_, method: 'POST', headers: { ...headers, 'Content-Length': buf.length } }, res => {

        // Если API вернул ошибку — показываем её, а не молчим
        if (res.statusCode >= 400) {
          let errBody = ''
          res.on('data', c => errBody += c)
          res.on('end', () => {
            let msg = errBody
            try {
              const j = JSON.parse(errBody)
              msg = j.error?.message || j.error || errBody
              const meta = j.error?.metadata
              if (j.error?.code === 'free_rate_limited') {
                if (meta?.reason === 'err_free_prompt_cap') msg = 'Превышен лимит размера запроса бесплатной модели. Сократи контекст или начни новый чат.'
                else if (meta?.reason === 'err_free_access_denied') msg = 'Бесплатный доступ OrcaRouter пока недоступен для этого аккаунта.'
                else if (meta?.retry_after_seconds) msg = `Лимит бесплатной модели. Повтори через ${meta.retry_after_seconds} с.`
              }
            } catch (e) {}
            reject('HTTP ' + res.statusCode + ': ' + (typeof msg === 'string' ? msg : JSON.stringify(msg)))
          })
          return
        }

        let buffer = ''
        res.on('data', raw => {
          buffer += raw.toString()
          const lines = buffer.split('\n')
          buffer = lines.pop()
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const data = line.slice(6).trim()
            if (data === '[DONE]') continue
            try {
              const j = JSON.parse(data)
              const d  = j.choices?.[0]?.delta
              const t  = d?.content
              const rc = d?.reasoning_content || d?.reasoning
              const ct = j.delta?.text
              const th = j.delta?.thinking

              if (rc) reasoningChunk(rc)
              else if (th) reasoningChunk(th)
              else if (t) splitter.push(t)
              else if (ct) splitter.push(ct)
            } catch (e) {}
          }
        })
        res.on('end', () => resolve())
        res.on('error', reject)
      })
      ctl.cancel = () => { try { req.destroy() } catch (e) {} resolve() }
      req.on('error', reject)
      req.end(buf)
    })
  }

  try {
    if (await runWithMcpTools()) {
      done(null)
      return
    }

    if (prov === 'claude') {
      const headers = { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }
      const base = {
        model: resolved,
        max_tokens: deepthinkEnabled ? 16384 : 8192,
        stream: true,
        system: sys,
        messages: safeMsgs
      }
      if (deepthinkEnabled) {
        try {
          // Новые модели Claude: adaptive thinking. display:'summarized' нужен, чтобы текст размышлений вообще приходил
          await streamSSE('api.anthropic.com', '/v1/messages', headers,
            JSON.stringify({ ...base, thinking: { type: 'adaptive', display: 'summarized' } }))
        } catch (e) {
          if (!String(e).startsWith('HTTP 400')) throw e
          // Старые модели: ручной бюджет на размышления
          await streamSSE('api.anthropic.com', '/v1/messages', headers,
            JSON.stringify({ ...base, thinking: { type: 'enabled', budget_tokens: 10000 } }))
        }
    } else {
        try {
          await streamSSE('api.anthropic.com', '/v1/messages', headers,
            JSON.stringify({ ...base, thinking: { type: 'disabled' } }))
        } catch (e) {
          if (!String(e).startsWith('HTTP 400')) throw e
          await streamSSE('api.anthropic.com', '/v1/messages', headers, JSON.stringify(base))
        }
      }

        } else if (prov === 'openai') {
      const oaHeaders = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }
      const mkBody = (x) => JSON.stringify({ model: resolved, stream: true, messages: [{ role: 'system', content: sys }, ...safeMsgs], ...x })
      const tries = deepthinkEnabled
        ? [{ reasoning_effort: 'high' }, {}]
        : [{ reasoning_effort: 'none' }, { reasoning_effort: 'minimal' }, {}]
      let lastErr = null
      for (const extra of tries) {
        try {
          await streamSSE('api.openai.com', '/v1/chat/completions', oaHeaders, mkBody(extra))
          lastErr = null
          break
        } catch (e) {
          lastErr = e
          if (!String(e).startsWith('HTTP 400')) throw e
        }
      }
      if (lastErr) throw lastErr

    } else if (prov === 'orcarouter') {
      const orcaHeaders = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }
      const mkBody = extra => JSON.stringify({
        model: resolved,
        max_tokens: deepthinkEnabled ? 16384 : 8192,
        stream: true,
        messages: [{ role: 'system', content: sys }, ...safeMsgs],
        ...extra
      })
      const tries = deepthinkEnabled ? [{ reasoning_effort: 'high' }, {}] : [{ reasoning_effort: 'none' }, {}]
      let lastErr = null
      for (const extra of tries) {
        try {
          await streamSSE('api.orcarouter.ai', '/v1/chat/completions', orcaHeaders, mkBody(extra))
          lastErr = null
          break
        } catch (e) {
          lastErr = e
          if (!String(e).startsWith('HTTP 400')) throw e
        }
      }
      if (lastErr) throw lastErr

    } else if (prov === 'deepseek') {
      const dsHeaders = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }
      const mkBody = (x) => JSON.stringify({ model: resolved, max_tokens: deepthinkEnabled ? 16384 : 8192, stream: true, messages: [{ role: 'system', content: sys }, ...safeMsgs], ...x })
      const extra = /deepseek-v[4-9]/i.test(resolved) ? { thinking: { type: deepthinkEnabled ? 'enabled' : 'disabled' } } : {}
      try {
        await streamSSE('api.deepseek.com', '/v1/chat/completions', dsHeaders, mkBody(extra))
      } catch (e) {
        if (!String(e).startsWith('HTTP 400') || !Object.keys(extra).length) throw e
        await streamSSE('api.deepseek.com', '/v1/chat/completions', dsHeaders, mkBody({}))
      }

    } else if (prov === 'groq') {
      const extra = {}
      if (/qwen3/i.test(resolved)) extra.reasoning_effort = deepthinkEnabled ? 'default' : 'none'
      else if (/gpt-oss/i.test(resolved)) extra.reasoning_effort = deepthinkEnabled ? 'high' : 'low'
      const mkBody = (x) => JSON.stringify({ model: resolved, max_tokens: 4096, stream: true, messages: [{ role: 'system', content: sys }, ...safeMsgs], ...x })
      const groqHeaders = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }
      try {
        await streamSSE('api.groq.com', '/openai/v1/chat/completions', groqHeaders, mkBody(extra))
      } catch (e) {
        if (!String(e).startsWith('HTTP 400') || !Object.keys(extra).length) throw e
        await streamSSE('api.groq.com', '/openai/v1/chat/completions', groqHeaders, mkBody({}))
      }

    } else if (prov === 'gemini') {
      const contents = safeMsgs.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
      const gTries = deepthinkEnabled
        ? [{ thinkingConfig: { thinkingLevel: 'high' } }, {}]
        : [{ thinkingConfig: { thinkingLevel: 'minimal' } }, { thinkingConfig: { thinkingLevel: 'low' } }, { thinkingConfig: { thinkingBudget: 0 } }, {}]
      let j = null
      for (const g of gTries) {
        const body = JSON.stringify({ system_instruction: { parts: [{ text: sys }] }, contents, generationConfig: { maxOutputTokens: 65536, ...g } })
        const raw = await post('generativelanguage.googleapis.com', `/v1beta/models/${resolved}:generateContent?key=${key}`, { 'Content-Type': 'application/json' }, body)
        j = JSON.parse(raw)
        if (!(j.error && j.error.code === 400)) break
      }
      if (j.error) throw j.error.message || j.error.status
      if (!ctl.stopped) splitter.push(j.candidates[0].content.parts.map(p => p.text || '').join(''))

    } else if (prov === 'kimi') {
      const body = JSON.stringify({ model: resolved, max_tokens: deepthinkEnabled ? 16384 : 8192, stream: true, messages: [{ role: 'system', content: sys }, ...safeMsgs] })
      await streamSSE('api.moonshot.cn', '/v1/chat/completions', { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }, body)

    } else {
      throw 'Неизвестный провайдер'
    }
    done(null)
  } catch (e) {
    done(ctl.stopped ? null : String(e))
  }
})

// Кнопка «Стоп»
ipcMain.handle('ai-stop', () => {
  const c = currentStream
  if (!c) return false
  c.stopped = true
  if (c.cancel) c.cancel()
  else if (c.forceDone) c.forceDone()
  return true
})

// ── Crypto (AES-256-GCM) ─────────────────────────────────────────────────────
ipcMain.handle('crypto-encrypt', (_, data) => {
  try {
    const key    = getMachineKey()
    const iv     = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
    const enc    = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()])
    const tag    = cipher.getAuthTag()
    const result = Buffer.concat([iv, tag, enc])
    return { data: result.toString('base64') }
  } catch (e) { return { error: e.message } }
})

ipcMain.handle('crypto-decrypt', (_, data) => {
  try {
    const key      = getMachineKey()
    const buf      = Buffer.from(data, 'base64')
    const iv       = buf.slice(0, 12)
    const tag      = buf.slice(12, 28)
    const enc      = buf.slice(28)
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    const dec = Buffer.concat([decipher.update(enc), decipher.final()])
    return { data: dec.toString('utf8') }
  } catch (e) { return { error: e.message } }
})

// ── History file ─────────────────────────────────────────────────────────────
ipcMain.handle('history-save', (_, encryptedData) => {
  try {
    fs.writeFileSync(path.join(app.getPath('userData'), 'history.enc'), encryptedData, 'utf8')
    return { ok: true }
  } catch (e) { return { error: e.message } }
})

ipcMain.handle('history-load', () => {
  try {
    const file = path.join(app.getPath('userData'), 'history.enc')
    if (!fs.existsSync(file)) return { data: null }
    return { data: fs.readFileSync(file, 'utf8') }
  } catch (e) { return { error: e.message } }
})

// ── Открыть ссылку в системном браузере ──────────────────────────────────────
ipcMain.handle('open-external', (_, url) => {
  shell.openExternal(url)
  return true
})

ipcMain.handle('open-external-system', (_, url) => {
  shell.openExternal(url)
  return true
})

// ── Терминал ─────────────────────────────────────────────────────────────────
ipcMain.handle('terminal-run', async (_, { command, cwd }) => {
  return new Promise((resolve) => {
    const workingDir = cwd || (fs.existsSync(os.homedir()) ? os.homedir() : process.cwd())
    const isWin = process.platform === 'win32'
    const sh = isWin ? 'cmd.exe' : '/bin/bash'
    const args = isWin ? ['/c', command] : ['-c', command]

    execFile(sh, args, { cwd: workingDir, timeout: 30000 }, (err, stdout, stderr) => {
      const output = (stdout || '') + (stderr || '')
      if (err && (err.code || stderr)) {
        resolve({ ok: false, output, error: stderr || err.message, code: err.code || 1 })
      } else {
        resolve({ ok: true, output, code: 0 })
      }
    })
  })
})

// ── Запуск и автоисправление кода ────────────────────────────────────────────
const RUNNERS = {
  python:     { cmd: 'python',  ext: '.py' },
  python3:    { cmd: 'python3', ext: '.py' },
  js:         { cmd: 'node',    ext: '.js' },
  javascript: { cmd: 'node',    ext: '.js' },
  node:       { cmd: 'node',    ext: '.js' }
}

function extractCode(text) {
  const m = text.match(/```(?:\w+)?\n?([\s\S]*?)```/)
  return m ? m[1].trim() : null
}

function runCode(lang, code) {
  return new Promise((resolve) => {
    const runner = RUNNERS[lang]
    if (!runner) return resolve({ ok: true, skipped: true })
    const tmp = path.join(os.tmpdir(), 'cakeai_test' + runner.ext)
    try {
      fs.writeFileSync(tmp, code, 'utf8')
    } catch (e) {
      return resolve({ ok: false, error: e.message })
    }
    execFile(runner.cmd, [tmp], { timeout: 10000, cwd: os.tmpdir() }, (err, stdout, stderr) => {
      if (err || stderr) resolve({ ok: false, output: stdout, error: stderr || err?.message || 'Ошибка' })
      else resolve({ ok: true, output: stdout })
    })
  })
}

async function callAI(prov, key, sys, messages, model) {
  if (prov === 'claude') {
    const claudeModel = await resolveModel('claude', key, model)
    const body = JSON.stringify({ model: claudeModel, max_tokens: 4096, system: sys, messages })
    const raw = await post('api.anthropic.com', '/v1/messages', { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body)
    const j = JSON.parse(raw)
    if (j.error) throw j.error.message
    return j.content[0].text
  } else if (prov === 'openai') {
    const openaiModel = await resolveModel('openai', key, model)
    const body = JSON.stringify({ model: openaiModel, max_tokens: 4096, messages: [{ role: 'system', content: sys }, ...messages] })
    const raw = await post('api.openai.com', '/v1/chat/completions', { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }, body)
    const j = JSON.parse(raw)
    if (j.error) throw j.error.message
    return j.choices[0].message.content
  } else if (prov === 'orcarouter') {
    const orcaModel = await resolveModel('orcarouter', key, model)
    const body = JSON.stringify({ model: orcaModel, max_tokens: 4096, messages: [{ role: 'system', content: sys }, ...messages] })
    const raw = await post('api.orcarouter.ai', '/v1/chat/completions', { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }, body)
    const j = JSON.parse(raw)
    if (j.error) throw j.error.message || j.error
    return j.choices[0].message.content
  } else if (prov === 'deepseek') {
    const deepseekModel = await resolveModel('deepseek', key, model)
    const body = JSON.stringify({ model: deepseekModel, max_tokens: 4096, messages: [{ role: 'system', content: sys }, ...messages] })
    const raw = await post('api.deepseek.com', '/v1/chat/completions', { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }, body)
    const j = JSON.parse(raw)
    if (j.error) throw j.error.message
    return j.choices[0].message.content
  } else if (prov === 'groq') {
    const groqModel = await resolveModel('groq', key, model)
    const body = JSON.stringify({ model: groqModel, max_tokens: 4096, messages: [{ role: 'system', content: sys }, ...messages] })
    const raw = await post('api.groq.com', '/openai/v1/chat/completions', { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }, body)
    const j = JSON.parse(raw)
    if (j.error) throw j.error.message
    return j.choices[0].message.content
  } else if (prov === 'kimi') {
    const kimiModel = await resolveModel('kimi', key, model)
    const body = JSON.stringify({ model: kimiModel, max_tokens: 8192, messages: [{ role: 'system', content: sys }, ...messages] })
    const raw = await post('api.moonshot.cn', '/v1/chat/completions', { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }, body)
    const j = JSON.parse(raw)
    if (j.error) throw j.error.message
    return j.choices[0].message.content
  }
  throw 'Провайдер не поддерживается'
}

ipcMain.handle('ai-run-check', async (_, { code, lang, msgs, key, provider, model }) => {
  const prov = provider || detectProvider(key)
  const sys = SYS.general
  let currentCode = code

  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await runCode(lang, currentCode)
    if (result.skipped) return { ok: true, code: currentCode, skipped: true }
    if (result.ok) return { ok: true, code: currentCode, output: result.output }
    try {
      const fixMsgs = [
        ...msgs,
        { role: 'assistant', content: '```' + lang + '\n' + currentCode + '\n```' },
        { role: 'user', content: 'Этот код выдаёт ошибку при проверке в терминале:\n\n' + result.error + '\n\nИсправь код, чтобы он работал без ошибок и выполнял поставленную задачу. Верни только исправленный код в блоке кода.' }
      ]
      const fixed = await callAI(prov, key, sys, fixMsgs, model)
      const newCode = extractCode(fixed)
      if (newCode) currentCode = newCode
      else return { ok: false, code: currentCode, error: result.error }
    } catch (e) {
      return { ok: false, code: currentCode, error: result.error }
    }
  }
  return { ok: false, code: currentCode, error: 'Не удалось исправить за 3 попытки' }
})
