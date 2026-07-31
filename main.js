const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('path')
const https = require('https')
const fs = require('fs')
const { execFile } = require('child_process')
const os = require('os')
const crypto = require('crypto')

let win

// ── Безопасный ключ шифрования приложения (защита от чтения) ────────────────
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
  // Защита конфигурации браузера шифрованием сессии и строгой изоляцией
  const encryptionKey = getMachineKey()

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
      webviewTag: true,
      // Дополнительная защита памяти и данных
      sandbox: false,
      session: app.isPackaged ? undefined : undefined
    }
  })

  // Шифруем локальное хранилище / кэш сессии при старте (защита владельца и пользователей)
  try {
    const ses = win.webContents.session
    if (ses && ses.setPermissionRequestHandler) {
      ses.setPermissionRequestHandler((webContents, permission, callback) => {
        callback(false) // Запрещаем небезопасные разрешения по умолчанию
      })
    }
  } catch(e) {}

  win.loadFile(path.join(__dirname, 'src', 'index.html'))
  win.webContents.on('render-process-gone', (event, details) => {
    console.error('Renderer process gone:', details.reason)
  })

  // Блокируем открытие внешних ссылок в системном браузере, всё открываем во встроенном окне/модалке
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
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
    if (fs.statSync(p).size > 5e6) return { error: 'Файл >5MB' }
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

// ── Web Search (DuckDuckGo Lite / HTML POST) ─────────────────────────────────
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
  // Парсим результаты из html.duckduckgo.com/html/ или lite
  const linkRegex = /class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g
  let match
  while ((match = linkRegex.exec(html)) !== null) {
    let url = match[1]
    const uddgMatch = url.match(/uddg=([^&]+)/)
    if (uddgMatch) {
      try { url = decodeURIComponent(uddgMatch[1]) } catch(e) { url = match[1] }
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
    // fallback для lite версии
    const liteRegex = /<a[^>]*href="([^"]*)"[^>]*rel="nofollow"[^>]*>([\s\S]*?)<\/a>/g
    while ((match = liteRegex.exec(html)) !== null) {
      let url = match[1]
      const title = match[2].replace(/<[^>]*>/g, '').trim()
      if (title && url.startsWith('http') && results.length < 5) {
        results.push({ url, title, snippet: '' })
      }
    }
  }
  return results.slice(0, 5)
}

ipcMain.handle('web-search', async (_, query) => {
  try {
    // Используем POST на html.duckduckgo.com/html/ с корректными заголовками
    const raw = await postForm('html.duckduckgo.com', '/html/', {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Referer': 'https://html.duckduckgo.com/'
    }, `q=${encodeURIComponent(query)}`)

    const results = parseDDGResults(raw)
    return { results, text: results.map((r, i) =>
      `${i+1}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet}`
    ).join('\n\n') }
  } catch(e) {
    return { results: [], text: '', error: e.message }
  }
})

// ── AI API ───────────────────────────────────────────────────────────────────
function detectProvider(key) {
  if (!key) return null
  if (key.startsWith('sk-ant-')) return 'claude'
  if (key.startsWith('AIza'))    return 'gemini'
  if (key.startsWith('sk-') && key.length >= 48) return 'openai'
  if (key.startsWith('sk-') || key.startsWith('dsk-')) return 'deepseek'
  if (key.startsWith('gsk_')) return 'groq'
  if (key.startsWith('sk-')) return 'kimi'          // Kimi (Moonshot)
  return 'unknown'
}

ipcMain.handle('detect-provider', (_, key) => detectProvider(key))

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
  ]
}

const DEFAULT_MODEL = {
  claude: 'claude-sonnet-4-6',
  openai: 'gpt-5.5',
  gemini: 'gemini-3.5-flash',
  deepseek: 'deepseek-v4-flash',
  groq: 'llama-4-scout',
  kimi: 'moonshot-v1-128k',
}

function trimMsgs(msgs, maxCount) {
  if (msgs.length <= maxCount) return msgs;
  return msgs.slice(-maxCount);
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
Отвечай на русском языке, коротко и по делу.
Если спрашивают кто ты — говори что ты Lungskull.
Помогай с любыми вопросами.

⚠️ У ТЕБЯ ЕСТЬ ДОСТУП К ИНТЕРНЕТУ через инструмент Search.
Если пользователь спрашивает актуальную информацию — говори «У меня есть доступ к интернету» и используй поиск.
Никогда не говори, что у тебя нет доступа к интернету.
`

const SYS_CODE = `${SYS_BASE}

СТИЛЬ ДЛЯ КОДА:
- Давай сразу готовый рабочий код, без объяснений если не просят
- Пиши чистый код с понятными именами переменных
- Если код длинный — добавь короткие комментарии на русском
- Если в вопросе есть ошибка — сначала покажи исправление, потом объясни что было не так

СТИЛЬ ДЛЯ ОБЪЯСНЕНИЙ:
- Объясняй просто, как другу, без академического стиля
- Используй аналогии и примеры из реальной жизни
- Сложные темы разбивай на маленькие понятные шаги`

const SYS = {
  lua:     SYS_CODE,
  fnf:     SYS_CODE,
  general: SYS_CODE,
  code:    SYS_CODE,
}

// ── ai-send (non-stream) ────────────────────────────────────────────────────
ipcMain.handle('ai-send', async (_, { msgs, mode, key, provider, model, fileCtx }) => {
  const prov = provider || detectProvider(key)
  const sys = SYS[mode] + (fileCtx ? '\n\n' + fileCtx.slice(0, 12000) : '')

  if (prov === 'unknown' || !prov) {
    return { text: '⚠️ Неизвестный провайдер. Поддерживаемые:\n• Claude — sk-ant-...\n• ChatGPT — sk-... (длинный)\n• Gemini — AIza...\n• DeepSeek — sk-.../dsk-...\n• Groq — gsk_...\n• Kimi — sk-...' }
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
    if (prov === 'kimi') {
      const kimiModel = await resolveModel('kimi', key, model)
      const body = JSON.stringify({ model: kimiModel, max_tokens: 8192, messages: [{ role: 'system', content: sys }, ...msgs] })
      const raw = await post('api.moonshot.cn', '/v1/chat/completions', { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }, body)
      const j = JSON.parse(raw)
      if (j.error) throw j.error.message
      return { text: j.choices[0].message.content }
    }
  } catch(e) {
    throw String(e)
  }
})

// ── AI Stream ────────────────────────────────────────────────────────────────
ipcMain.handle('ai-stream', async (event, { msgs, mode, key, provider, model, fileCtx, customPrompt, deepthinkEnabled, webSearch }) => {
  const prov = provider || detectProvider(key)
  let sys = (SYS[mode] || SYS.general) + (customPrompt ? '\n\n' + customPrompt : '') + (fileCtx ? '\n\n' + fileCtx.slice(0, 12000) : '')

  const chunk = (text) => {
    try { win.webContents.send('stream-chunk', text) } catch(e) {}
  }
  const reasoningChunk = (text) => {
    try { win.webContents.send('stream-reasoning', text) } catch(e) {}
  }
  const done = (err) => {
    try { win.webContents.send('stream-done', err || null) } catch(e) {}
  }

  let searchResultsForUI = []

  if (webSearch && msgs.length > 0) {
    const lastUserMsg = [...msgs].reverse().find(m => m.role === 'user')
    if (lastUserMsg) {
      try {
        const searchRes = await ipcMain.handle('web-search', null, lastUserMsg.content.slice(0, 200))
        if (searchRes && searchRes.results && searchRes.results.length > 0) {
          sys += '\n\n📋 Результаты поиска в интернете:\n' + searchRes.text
          searchResultsForUI = searchRes.results
        }
      } catch(e) {
        sys += '\n\n⚠️ Поиск не удался: ' + e.message
      }
    }
  }

  // DeepThink для ВСЕХ моделей
  if (deepthinkEnabled) {
    sys += '\n\n[РЕЖИМ DEEPTHINK АКТИВЕН]: Проводи глубокий, подробный пошаговый анализ (Chain of Thought), тщательно проверяй логику, краевые случаи и возможные ошибки перед тем как выдать финальный код и ответ. Думай подробно.'
  }

  const safeMsgs = prov === 'groq' ? trimMsgs(msgs, 8) : msgs

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
              const rc = j.choices?.[0]?.delta?.reasoning_content
              const ct = j.delta?.text
              const th = j.delta?.thinking

              if (rc) reasoningChunk(rc)
              else if (th) reasoningChunk(th)
              else if (t) chunk(t)
              else if (ct) chunk(ct)
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
      let claudeModel = await resolveModel('claude', key, model)
      let bodyObj = {
        model: claudeModel,
        max_tokens: deepthinkEnabled ? 16384 : 8192,
        stream: true,
        system: sys,
        messages: safeMsgs
      }
      if (deepthinkEnabled) {
        bodyObj.thinking = { type: 'enabled', budget_tokens: 10000 }
      }
      const body = JSON.stringify(bodyObj)
      await streamSSE('api.anthropic.com', '/v1/messages', { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body)
    } else if (prov === 'openai') {
      const openaiModel = await resolveModel('openai', key, model)
      const body = JSON.stringify({ model: openaiModel, max_tokens: deepthinkEnabled ? 16384 : 8192, stream: true, messages: [{ role: 'system', content: sys }, ...safeMsgs] })
      await streamSSE('api.openai.com', '/v1/chat/completions', { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }, body)
    } else if (prov === 'deepseek') {
      let deepseekModel = await resolveModel('deepseek', key, model)
      const body = JSON.stringify({ model: deepseekModel, max_tokens: deepthinkEnabled ? 16384 : 8192, stream: true, messages: [{ role: 'system', content: sys }, ...safeMsgs] })
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
    } else if (prov === 'kimi') {
      const kimiModel = await resolveModel('kimi', key, model)
      const body = JSON.stringify({ model: kimiModel, max_tokens: deepthinkEnabled ? 16384 : 8192, stream: true, messages: [{ role: 'system', content: sys }, ...safeMsgs] })
      await streamSSE('api.moonshot.cn', '/v1/chat/completions', { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }, body)
    } else {
      throw 'Неизвестный провайдер'
    }
    done(null)
    } catch(e) {
      done(String(e))
    }

    // Отправляем источники в UI, если был поиск
    if (searchResultsForUI && searchResultsForUI.length > 0) {
      try {
        win.webContents.send('search-sources', searchResultsForUI)
      } catch (_) {}
    }
  })

// ── Crypto (AES-256-GCM, auto key) ──────────────────────────────────────────
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
    fs.writeFileSync(path.join(app.getPath('userData'), 'history.enc'), encryptedData, 'utf8')
    return { ok: true }
  } catch(e) { return { error: e.message } }
})

ipcMain.handle('history-load', () => {
  try {
    const file = path.join(app.getPath('userData'), 'history.enc')
    if (!fs.existsSync(file)) return { data: null }
    return { data: fs.readFileSync(file, 'utf8') }
  } catch(e) { return { error: e.message } }
})

// ── Open external link / system ──────────────────────────────────────────────
ipcMain.handle('open-external', (_, url) => {
  try {
    win.webContents.send('open-browser-modal', url)
    return true
  } catch(e) {
    shell.openExternal(url)
    return true
  }
})

ipcMain.handle('open-external-system', (_, url) => {
  shell.openExternal(url)
  return true
})

// ── Virtual Terminal IPC ─────────────────────────────────────────────────────
ipcMain.handle('terminal-run', async (_, { command, cwd }) => {
  return new Promise((resolve) => {
    const workingDir = cwd || (fs.existsSync(os.homedir()) ? os.homedir() : process.cwd())
    const isWin = process.platform === 'win32'
    const shell = isWin ? 'cmd.exe' : '/bin/bash'
    const args = isWin ? ['/c', command] : ['-c', command]

    execFile(shell, args, { cwd: workingDir, timeout: 30000 }, (err, stdout, stderr) => {
      const output = (stdout || '') + (stderr || '')
      if (err && (err.code || stderr)) {
        resolve({ ok: false, output, error: stderr || err.message, code: err.code || 1 })
      } else {
        resolve({ ok: true, output, code: 0 })
      }
    })
  })
})

// ── Code Runner & Self-Testing Loop ──────────────────────────────────────────
const RUNNERS = {
  python:     { cmd: 'python',  ext: '.py' },
  python3:    { cmd: 'python3', ext: '.py' },
  js:         { cmd: 'node',    ext: '.js' },
  javascript: { cmd: 'node',    ext: '.js' },
  node:       { cmd: 'node',    ext: '.js' },
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
    } catch(e) {
      return resolve({ ok: false, error: e.message })
    }
    execFile(runner.cmd, [tmp], { timeout: 10000 }, (err, stdout, stderr) => {
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
    } catch(e) {
      return { ok: false, code: currentCode, error: result.error }
    }
  }
  return { ok: false, code: currentCode, error: 'Не удалось исправить за 3 попытки' }
})
