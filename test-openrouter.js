/**
 * Проверка интеграции OpenRouter в CakeAI.
 * Запуск:  node test-openrouter.js
 * С ключом (реальный запрос к модели):  OPENROUTER_API_KEY=sk-or-v1-... node test-openrouter.js
 *
 * Скрипт не требует Electron: он вытаскивает нужные функции из main.js.
 */
const fs = require('fs')
const path = require('path')
const https = require('https')

const src = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8')

// Вырезаем чистые функции из main.js, чтобы тестировать именно боевой код
function extract(name, kind = 'function') {
  const start = src.indexOf(`${kind} ${name}`)
  if (start === -1) throw new Error('Не найдено в main.js: ' + name)
  let i = src.indexOf('{', start), depth = 0
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1) }
  }
  throw new Error('Не удалось разобрать: ' + name)
}

function extractConst(name) {
  const re = new RegExp(`const ${name} = [\\s\\S]*?\\n\\}`, 'm')
  const m = src.match(re)
  if (!m) throw new Error('Не найдена константа: ' + name)
  return m[0]
}

const sandbox = {}
const code = [
  extractConst('PREFERRED_MODELS'),
  extractConst('DEFAULT_MODEL'),
  `const OPENROUTER_HOST = 'openrouter.ai'`,
  `const OPENROUTER_PATH = '/api/v1/chat/completions'`,
  extract('openrouterHeaders'),
  extract('isFreeModel'),
  extract('detectProvider'),
  extract('sortModels'),
  extract('pickBestModel'),
  'module.exports = { PREFERRED_MODELS, DEFAULT_MODEL, openrouterHeaders, isFreeModel, detectProvider, sortModels, pickBestModel }'
].join('\n\n')

const mod = { exports: {} }
new Function('module', 'exports', code)(mod, mod.exports)
const M = mod.exports

let pass = 0, fail = 0
function check(name, cond, extra = '') {
  if (cond) { console.log(`  ✓ ${name}`); pass++ }
  else { console.log(`  ✗ ${name} ${extra}`); fail++ }
}

console.log('\n=== 1. Определение провайдера по ключу ===')
check('sk-or-v1-... → openrouter', M.detectProvider('sk-or-v1-' + 'a'.repeat(64)) === 'openrouter',
  '→ ' + M.detectProvider('sk-or-v1-' + 'a'.repeat(64)))
check('короткий sk-or- → openrouter', M.detectProvider('sk-or-abc123') === 'openrouter')
check('sk-ant-... остался claude', M.detectProvider('sk-ant-' + 'a'.repeat(40)) === 'claude')
check('длинный sk-... остался openai', M.detectProvider('sk-' + 'a'.repeat(60)) === 'openai')
check('gsk_... остался groq', M.detectProvider('gsk_' + 'a'.repeat(40)) === 'groq')
check('AIza... остался gemini', M.detectProvider('AIzaSyABC123') === 'gemini')
check('пустой ключ → null', M.detectProvider('') === null)
check('мусор → unknown', M.detectProvider('hello-world-123') === 'unknown')

console.log('\n=== 2. Фильтр бесплатных моделей ===')
check('id с :free → бесплатная', M.isFreeModel({ id: 'z-ai/glm-5.2:free', pricing: { prompt: '0', completion: '0' } }))
check('нулевая цена → бесплатная', M.isFreeModel({ id: 'stealth/ox-alpha', pricing: { prompt: '0', completion: '0' } }))
check('платная → отсеивается', M.isFreeModel({ id: 'openai/gpt-4o', pricing: { prompt: '0.0000025', completion: '0.00001' } }) === false)
check('платный prompt → отсеивается', M.isFreeModel({ id: 'x/y', pricing: { prompt: '0.0000001', completion: '0' } }) === false)
check('null → не падает', M.isFreeModel(null) === false)

console.log('\n=== 3. Дефолтная модель и список ===')
check('openrouter есть в PREFERRED_MODELS', Array.isArray(M.PREFERRED_MODELS.openrouter) && M.PREFERRED_MODELS.openrouter.length > 0)
check('все запасные модели бесплатные (:free)',
  M.PREFERRED_MODELS.openrouter.every(m => m.endsWith(':free')),
  '→ ' + M.PREFERRED_MODELS.openrouter.filter(m => !m.endsWith(':free')).join(', '))
check('DEFAULT_MODEL.openrouter задан и бесплатный', M.DEFAULT_MODEL.openrouter.endsWith(':free'))
check('pickBestModel выбирает приоритетную',
  M.pickBestModel('openrouter', ['google/gemma-4-31b-it:free', 'z-ai/glm-5.2:free']) === 'z-ai/glm-5.2:free')
check('pickBestModel с пустым списком → дефолт',
  M.pickBestModel('openrouter', []) === M.DEFAULT_MODEL.openrouter)

console.log('\n=== 4. Заголовки запроса ===')
const h = M.openrouterHeaders('sk-or-v1-test')
check('Authorization: Bearer', h.Authorization === 'Bearer sk-or-v1-test')
check('без ключа нет пустого Authorization', M.openrouterHeaders('').Authorization === undefined)
check('Content-Type: application/json', h['Content-Type'] === 'application/json')
check('HTTP-Referer присутствует', !!h['HTTP-Referer'])
check('X-Title присутствует', !!h['X-Title'])

console.log('\n=== 5. Проводка провайдера по всему коду ===')
for (const marker of [
  "if (prov === 'openrouter')",           // ai-send
  "} else if (prov === 'openrouter') {",  // ai-stream + callAI
  "prov === 'openrouter'",                // fetchAvailableModels
]) {
  check(`main.js содержит: ${marker.slice(0, 40)}...`, src.includes(marker))
}
check('ai-stream использует streamSSE для OpenRouter',
  /openrouter[\s\S]{0,600}streamSSE\(OPENROUTER_HOST/.test(src))
check('запрос списка моделей идёт с max_price=0', src.includes('/api/v1/models?max_price=0'))
check('httpGet определён (был вызов без объявления)', /function httpGet\(/.test(src))
check('web-search больше не вызывает ipcMain.handle как функцию',
  !src.includes("await ipcMain.handle('web-search'"))
check('SSE парсит delta.reasoning (OpenRouter)', src.includes('delta?.reasoning'))

console.log('\n=== 6. Интеграция в UI ===')
const html = fs.readFileSync(path.join(__dirname, 'src', 'index.html'), 'utf8')
const settings = fs.readFileSync(path.join(__dirname, 'src', 'settings.js'), 'utf8')
const preload = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8')
check('карточка OpenRouter в index.html', html.includes('data-p="openrouter"'))
check('кнопка выбора модели у OpenRouter', html.includes("Settings.openModelPicker('openrouter'"))
check('ссылка на получение ключа', html.includes('openrouter.ai/settings/keys'))
check('имя провайдера в settings.js', settings.includes("openrouter: 'OpenRouter'"))
check('preload отдаёт onStreamReasoning', preload.includes('onStreamReasoning'))
check('preload отдаёт onSearchSources', preload.includes('onSearchSources'))

// ── 7. Живая проверка API ────────────────────────────────────────────────────
function httpsGet(host, p, headers) {
  return new Promise((res, rej) => {
    const req = https.request({ hostname: host, path: p, method: 'GET', headers }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => res({ status: r.statusCode, body: d }))
    })
    req.on('error', rej); req.setTimeout(20000, () => req.destroy(new Error('timeout'))); req.end()
  })
}

function httpsPost(host, p, headers, body) {
  return new Promise((res, rej) => {
    const buf = Buffer.from(body)
    const req = https.request({ hostname: host, path: p, method: 'POST',
      headers: { ...headers, 'Content-Length': buf.length } }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => res({ status: r.statusCode, body: d, headers: r.headers }))
    })
    req.on('error', rej); req.setTimeout(60000, () => req.destroy(new Error('timeout'))); req.end(buf)
  })
}

;(async () => {
  console.log('\n=== 7. Живой запрос к OpenRouter ===')
  try {
    const r = await httpsGet('openrouter.ai', '/api/v1/models?max_price=0', {})
    if (r.status !== 200) {
      console.log(`  ⚠ список моделей недоступен (HTTP ${r.status}) — пропускаем`)
    } else {
      const all = JSON.parse(r.body).data || []
      const free = all.filter(M.isFreeModel)
      check('API вернул модели', all.length > 0)
      check('все прошли фильтр бесплатности', free.length === all.length, `${free.length}/${all.length}`)
      console.log(`  → доступно бесплатных моделей: ${free.length}`)
      const sorted = M.sortModels('openrouter', free.map(m => m.id))
      console.log(`  → топ-5 после сортировки: ${sorted.slice(0, 5).join(', ')}`)
      const stale = M.PREFERRED_MODELS.openrouter.filter(m => !free.some(f => f.id === m))
      if (stale.length) console.log(`  ⚠ в запасном списке уже недоступны: ${stale.join(', ')}`)
      else console.log('  ✓ весь запасной список актуален')
    }
  } catch (e) {
    console.log('  ⚠ нет сети — проверка API пропущена (' + e.message + ')')
  }

  const key = process.env.OPENROUTER_API_KEY
  if (!key) {
    console.log('\n  ℹ OPENROUTER_API_KEY не задан — реальный запрос к модели пропущен.')
    console.log('    Запусти:  OPENROUTER_API_KEY=sk-or-v1-... node test-openrouter.js')
  } else {
    console.log('\n=== 8. Реальный чат-запрос (стриминг) ===')
    check('ключ распознан как openrouter', M.detectProvider(key) === 'openrouter')
    const model = M.DEFAULT_MODEL.openrouter
    try {
      const r = await httpsPost('openrouter.ai', '/api/v1/chat/completions', M.openrouterHeaders(key),
        JSON.stringify({ model, max_tokens: 64, stream: true,
          messages: [{ role: 'user', content: 'Скажи ровно одно слово: привет' }] }))
      check(`HTTP 200 от ${model}`, r.status === 200, `→ ${r.status} ${r.body.slice(0, 200)}`)
      const isSSE = (r.headers['content-type'] || '').includes('text/event-stream')
      check('ответ в формате SSE', isSSE)
      let text = ''
      for (const line of r.body.split('\n')) {
        if (!line.startsWith('data: ')) continue
        const d = line.slice(6).trim()
        if (d === '[DONE]') continue
        try { text += JSON.parse(d).choices?.[0]?.delta?.content || '' } catch (e) {}
      }
      check('модель вернула текст', text.trim().length > 0, `→ "${text.slice(0, 80)}"`)
      console.log(`  → ответ модели: "${text.trim().slice(0, 120)}"`)
    } catch (e) {
      check('запрос выполнен', false, '→ ' + e.message)
    }
  }

  console.log(`\n${'='.repeat(46)}`)
  console.log(`Итог: ${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})()
