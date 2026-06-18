const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('path')
const https = require('https')
const fs = require('fs')
const { execFile } = require('child_process')
const os = require('os')

let win

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
      webviewTag: true
    }
  })
  win.loadFile(path.join(__dirname, 'src', 'index.html'))
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())

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
  } catch(e) { return { error: e.message } }
})

ipcMain.handle('read-file', (_, p) => {
  try {
    if (fs.statSync(p).size > 100e6) return { error: 'Файл >5MB' }
    return { content: fs.readFileSync(p, 'utf8') }
  } catch(e) { return { error: e.message } }
})

ipcMain.handle('write-file', (_, p, content) => {
  try { fs.writeFileSync(p, content, 'utf8'); return { ok: true } }
  catch(e) { return { error: e.message } }
})

ipcMain.handle('create-file', (_, dir, name) => {
  try {
    const fp = path.join(dir, name)
    if (fs.existsSync(fp)) return { error: 'Уже существует' }
    fs.writeFileSync(fp, '')
    return { path: fp }
  } catch(e) { return { error: e.message } }
})

ipcMain.handle('create-dir', (_, dir, name) => {
  try {
    const fp = path.join(dir, name)
    if (fs.existsSync(fp)) return { error: 'Уже существует' }
    fs.mkdirSync(fp, { recursive: true })
    return { path: fp }
  } catch(e) { return { error: e.message } }
})

ipcMain.handle('delete-entry', (_, p) => {
  try {
    fs.rmSync(p, { recursive: true, force: true })
    return { ok: true }
  } catch(e) { return { error: e.message } }
})

ipcMain.handle('rename-entry', (_, oldPath, newName) => {
  try {
    const newPath = path.join(path.dirname(oldPath), newName)
    fs.renameSync(oldPath, newPath)
    return { path: newPath }
  } catch(e) { return { error: e.message } }
})

ipcMain.handle('show-in-explorer', (_, p) => { shell.showItemInFolder(p); return true })

// ── AI API ───────────────────────────────────────────────────────────────────
function detectProvider(key) {
  if (!key) return null
  if (key.startsWith('sk-ant-')) return 'claude'
  if (key.startsWith('AIza'))    return 'gemini'
  if (key.startsWith('sk-') && key.length >= 48) return 'openai'
  if (key.startsWith('sk-') || key.startsWith('dsk-')) return 'deepseek'
  if (key.startsWith('gsk_')) return 'groq'
  return 'unknown'
}

ipcMain.handle('detect-provider', (_, key) => detectProvider(key))

const PREFERRED_MODELS = {
  claude:   ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-haiku-20240307'],
  openai:   ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  gemini:   ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-coder'],
  groq:     ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
}

const DEFAULT_MODEL = {
  claude: 'claude-3-5-haiku-20241022',
  openai: 'gpt-4o-mini',
  gemini: 'gemini-2.0-flash',
  deepseek: 'deepseek-chat',
  groq: 'llama-3.3-70b-versatile',
}

// ── Helper: обрезать историю до последних N сообщений ──────────────────────
function trimMsgs(msgs, maxCount) {
  if (msgs.length <= maxCount) return msgs;
  return msgs.slice(-maxCount);
}

function httpGet(hostname, path_, headers) {
  return new Promise((res, rej) => {
    const req = https.request({ hostname, path: path_, method: 'GET', headers }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => res(d))
    })
    req.on('error', rej); req.end()
  })
}

function sortModels(prov, available) {
  const preferred = PREFERRED_MODELS[prov] || []
  const sorted = []
  for (const p of preferred) { if (available.includes(p)) sorted.push(p) }
  for (const a of [...available].sort()) { if (!sorted.includes(a)) sorted.push(a) }
  return sorted
}

async function fetchAvailableModels(prov, key) {
  const fallback = PREFERRED_MODELS[prov] || []
  if (!key) return { models: fallback, fromApi: false }

  try {
    let available = []
    if (prov === 'claude') {
      const raw = await httpGet('api.anthropic.com', '/v1/models', { 'x-api-key': key, 'anthropic-version': '2023-06-01' })
      available = (JSON.parse(raw).data || []).map(m => m.id)
    } else if (prov === 'openai') {
      const raw = await httpGet('api.openai.com', '/v1/models', { 'Authorization': 'Bearer ' + key })
      available = (JSON.parse(raw).data || []).map(m => m.id).filter(id => id.startsWith('gpt-'))
    } else if (prov === 'gemini') {
      const raw = await httpGet('generativelanguage.googleapis.com', `/v1beta/models?key=${key}`, {})
      available = (JSON.parse(raw).models || [])
        .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
        .map(m => m.name.replace('models/', ''))
    } else if (prov === 'deepseek') {
      const raw = await httpGet('api.deepseek.com', '/models', { 'Authorization': 'Bearer ' + key })
      available = (JSON.parse(raw).data || []).map(m => m.id)
    } else if (prov === 'groq') {
      const raw = await httpGet('api.groq.com', '/openai/v1/models', { 'Authorization': 'Bearer ' + key })
      available = (JSON.parse(raw).data || []).map(m => m.id)
    }
    const sorted = sortModels(prov, available)
    return { models: sorted.length ? sorted : fallback, fromApi: sorted.length > 0 }
  } catch {
    return { models: fallback, fromApi: false }
  }
}

function pickBestModel(prov, available) {
  const preferred = PREFERRED_MODELS[prov] || []
  for (const p of preferred) { if (available.includes(p)) return p }
  return available[0] || DEFAULT_MODEL[prov]
}

async function resolveModel(prov, key, explicitModel) {
  if (explicitModel) return explicitModel
  const { models } = await fetchAvailableModels(prov, key)
  return pickBestModel(prov, models)
}

ipcMain.handle('list-models', async (_, { provider, key }) => {
  return fetchAvailableModels(provider, key)
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

const SYS_BASE = `Ты — Lungskull, умный ассистент созданный Cakein228.
Отвечай на русском языке, коротко и по делу — без воды и лишних предисловий.
Если спрашивают кто ты — говори что ты Lungskull, создан Cakein228. Не упоминай что основан на другом AI.
Помогай с любыми вопросами без ограничений — код, жизнь, философия, наука, игры — всё что угодно.`

const SYS_CODE = `${SYS_BASE}

СТИЛЬ ДЛЯ КОДА:
- Давай сразу готовый рабочий код, без объяснений если не просят
- Пиши чистый код с понятными именами переменных
- Если код длинный — добавь короткие комментарии на русском
- Если в вопросе есть ошибка — сначала покажи исправление, потом объясни что было не так
- Пример хорошего ответа на вопрос про код:
  Вопрос: "как сделать таймер в lua"
  Ответ: (сразу код с комментариями, без вводных фраз)

СТИЛЬ ДЛЯ ОБЪЯСНЕНИЙ:
- Объясняй просто, как другу, без академического стиля
- Используй аналогии и примеры из реальной жизни
- Сложные темы разбивай на маленькие понятные шаги
- Пример хорошего ответа на вопрос про объяснение:
  Вопрос: "что такое рекурсия"
  Ответ: короткое объяснение своими словами + пример кода если нужен`

const SYS = {
  lua:     SYS_CODE,
  fnf:     SYS_CODE,
  general: SYS_CODE,
  code:    SYS_CODE,
}

ipcMain.handle('ai-send', async (_, { msgs, mode, key, provider, model, fileCtx }) => {
  const prov = provider || detectProvider(key)
  const sys = SYS[mode] + (fileCtx ? '\n\n' + fileCtx.slice(0, 12000) : '')

  if (prov === 'unknown' || !prov) {
    return { text: '⚠️ Извиняюсь, я не знаю такого ключа. В будущем будет добавлена поддержка новых провайдеров.\n\nПоддерживаемые:\n• **Claude** — `sk-ant-...`\n• **ChatGPT** — `sk-...` (длинный)\n• **Gemini** — `AIza...`\n• **DeepSeek** — `sk-...` (короткий) или `dsk-...`' }
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
      const body = JSON.stringify({ model: openaiModel, max_tokens: 8192, messages: [{ role: 'system', content: sys }, ...msgs] })
      const raw = await post('api.openai.com', '/v1/chat/completions', { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }, body)
      const j = JSON.parse(raw)
      if (j.error) throw j.error.message
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
  } catch(e) {
    throw String(e)
  }
})

// ── AI Stream ────────────────────────────────────────────────────────────────
ipcMain.handle('ai-stream', async (event, { msgs, mode, key, provider, model, fileCtx, customPrompt, deepthinkEnabled, webSearch }) => {
  const prov = provider || detectProvider(key)
  const webNote = webSearch ? '\n\nПользователь включил режим поиска. Если вопрос требует актуальных данных — честно скажи что твои знания ограничены датой обучения и предложи конкретные сайты.' : ''
  let sys = (SYS[mode] || SYS.general) + (customPrompt ? '\n\n' + customPrompt : '') + webNote + (fileCtx ? '\n\n' + fileCtx.slice(0, 12000) : '')

  if (deepthinkEnabled) {
    sys += '\n\n⚠️ Режим глубокого размышления. Подробно объясняй ход мыслей.'
  }

  const safeMsgs = prov === 'groq' ? trimMsgs(msgs, 8) : msgs

  const chunk = (text) => {
    try { win.webContents.send('stream-chunk', text) } catch(e) {}
  }
  const done = (err) => {
    try { win.webContents.send('stream-done', err || null) } catch(e) {}
  }

  function streamSSE(hostname, path_, headers, body) {
    return new Promise((resolve, reject) => {
      const buf = Buffer.from(body)
      const req = https.request({ hostname, path: path_, method: 'POST', headers: { ...headers, 'Content-Length': buf.length } }, res => {
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
              const t = j.choices?.[0]?.delta?.content
              const a = j.delta?.text
              if (t) chunk(t)
              else if (a) chunk(a)
            } catch(e) {}
          }
        })
        res.on('end', () => resolve())
        res.on('error', reject)
      })
      req.on('error', reject)
      req.end(buf)
    })
  }

  try {
    if (prov === 'claude') {
      const claudeModel = await resolveModel('claude', key, model)
      const body = JSON.stringify({ model: claudeModel, max_tokens: deepthinkEnabled ? 16384 : 8192, stream: true, system: sys, messages: safeMsgs })
      await streamSSE('api.anthropic.com', '/v1/messages', { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body)
    } else if (prov === 'openai') {
      const openaiModel = await resolveModel('openai', key, model)
      const body = JSON.stringify({ model: openaiModel, max_tokens: deepthinkEnabled ? 16384 : 8192, stream: true, messages: [{ role: 'system', content: sys }, ...safeMsgs] })
      await streamSSE('api.openai.com', '/v1/chat/completions', { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }, body)
    } else if (prov === 'deepseek') {
      const deepseekModel = await resolveModel('deepseek', key, model)
      const isReasoner = deepseekModel === 'deepseek-reasoner'
      const bodyObj = { model: deepseekModel, max_tokens: deepthinkEnabled ? 16384 : 8192, stream: true, messages: [{ role: 'system', content: sys }, ...safeMsgs] }
      if (isReasoner) bodyObj.thinking = { type: 'enabled', budget_tokens: 4096 }
      const body = JSON.stringify(bodyObj)
      await streamSSE('api.deepseek.com', '/v1/chat/completions', { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }, body)
    } else if (prov === 'groq') {
      const groqModel = await resolveModel('groq', key, model)
      const body = JSON.stringify({ model: groqModel, max_tokens: 4096, stream: true, messages: [{ role: 'system', content: sys }, ...safeMsgs] })
      await streamSSE('api.groq.com', '/openai/v1/chat/completions', { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }, body)
    } else if (prov === 'gemini') {
      const geminiModel = await resolveModel('gemini', key, model)
      const contents = safeMsgs.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
      const body = JSON.stringify({ system_instruction: { parts: [{ text: sys }] }, contents, generationConfig: { maxOutputTokens: 65536 } })
      const raw = await post('generativelanguage.googleapis.com', `/v1beta/models/${geminiModel}:generateContent?key=${key}`, { 'Content-Type': 'application/json' }, body)
      const j = JSON.parse(raw)
      if (j.error) throw j.error.message || j.error.status
      chunk(j.candidates[0].content.parts[0].text)
    } else {
      throw 'Неизвестный провайдер'
    }
    done(null)
  } catch(e) {
    done(String(e))
  }
})

// ── Crypto (AES-256-GCM, auto key) ──────────────────────────────────────────
const crypto = require('crypto')
const { app: electronApp } = require('electron')

// Get or generate a persistent machine key stored in userData
function getMachineKey() {
  const keyFile = path.join(electronApp.getPath('userData'), 'machine.key')
  if (fs.existsSync(keyFile)) {
    return fs.readFileSync(keyFile)
  }
  const key = crypto.randomBytes(32)
  fs.writeFileSync(keyFile, key)
  return key
}

ipcMain.handle('crypto-encrypt', (_, data) => {
  try {
    const key    = getMachineKey()
    const iv     = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
    const enc    = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()])
    const tag    = cipher.getAuthTag()
    const result = Buffer.concat([iv, tag, enc])
    return { data: result.toString('base64') }
  } catch(e) { return { error: e.message } }
})

ipcMain.handle('crypto-decrypt', (_, data) => {
  try {
    const key     = getMachineKey()
    const buf     = Buffer.from(data, 'base64')
    const iv      = buf.slice(0, 12)
    const tag     = buf.slice(12, 28)
    const enc     = buf.slice(28)
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    const dec = Buffer.concat([decipher.update(enc), decipher.final()])
    return { data: dec.toString('utf8') }
  } catch(e) { return { error: e.message } }
})

// ── History file ──────────────────────────────────────────────────────────────
ipcMain.handle('history-save', (_, encryptedData) => {
  try {
    fs.writeFileSync(path.join(electronApp.getPath('userData'), 'history.enc'), encryptedData, 'utf8')
    return { ok: true }
  } catch(e) { return { error: e.message } }
})

ipcMain.handle('history-load', () => {
  try {
    const file = path.join(electronApp.getPath('userData'), 'history.enc')
    if (!fs.existsSync(file)) return { data: null }
    return { data: fs.readFileSync(file, 'utf8') }
  } catch(e) { return { error: e.message } }
})

// ── Open external link ──────────────────────────────────────────────────────
ipcMain.handle('open-external', (_, url) => {
  shell.openExternal(url);
  return true;
});

// ── Code Runner ──────────────────────────────────────────────────────────────
const RUNNERS = {
  python:     { cmd: 'python',  ext: '.py' },
  python3:    { cmd: 'python3', ext: '.py' },
  js:         { cmd: 'node',    ext: '.js' },
  javascript: { cmd: 'node',    ext: '.js' },
  node:       { cmd: 'node',    ext: '.js' },
}

function detectLang(text) {
  const m = text.match(/```(\w+)/)
  return m ? m[1].toLowerCase() : null
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
    fs.writeFileSync(tmp, code, 'utf8')
    execFile(runner.cmd, [tmp], { timeout: 10000 }, (err, stdout, stderr) => {
      if (err || stderr) resolve({ ok: false, error: stderr || err?.message || 'Ошибка' })
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
        { role: 'user', content: 'Этот код выдаёт ошибку:\n\n' + result.error + '\n\nИсправь. Верни только исправленный код в блоке кода.' }
      ]
      const fixed = await callAI(prov, key, sys, fixMsgs, model)
      const newCode = extractCode(fixed)
      if (newCode) currentCode = newCode
      else return { ok: false, code: currentCode, error: result.error }
    } catch(e) {
      return { ok: false, code: currentCode, error: result.error }
    }
  }
  return { ok: false, code: currentCode, error: 'Не удалось исправить за 3 попытки' }
})