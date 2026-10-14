const Chat = (() => {
  let messages = []
  let loading = false
  let stoppedByUser = false
  let currentChatId = null
  let currentRun = 0      // номер текущего запроса (чтобы старые ответы не попадали в новый чат)
  let epoch = 0           // меняется при смене чата
  let autoScroll = true
  let fileCtxContent = null
  let fileCtxName = null

  let thinkEnabled = localStorage.getItem('cakeai_deepthink') === '1'
  let webSearchEnabled = localStorage.getItem('cakeai_websearch') === '1'

  const $ = id => document.getElementById(id)
  const isEn = () => window.__lang === 'en'
  const tr = (ru, en) => (isEn() ? en : ru)

  // @@MD-BEGIN
  // ── Markdown ───────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  function renderMarkdown(src) {
    const blocks = []
    const codes = []
    const links = []
    let t = String(src == null ? '' : src).replace(/\r\n/g, '\n')

    const hasEditor = (typeof Editor !== 'undefined' && Editor.getPath && Editor.getPath())
    const edBtn = hasEditor ? '<button class="editor-btn" data-act="editor">→ редактор</button>' : ''
    const codeBlockHtml = (b) => {
      const lang = (b.lang || '').toLowerCase()
      return '<pre><span class="code-lang">' + esc(lang) + '</span><button class="cpy-btn" data-act="copy">copy</button>' +
        edBtn + '<code class="lang-' + esc(lang) + '">' + esc(b.code) + '</code></pre>'
    }

    // 1) блоки кода (в том числе ещё не закрытый, пока идёт стрим)
    t = t.replace(/```([\w+#.-]*)[^\n]*\n([\s\S]*?)(?:```|$)/g, (_, lang, code) => {
      blocks.push({ lang, code: code.replace(/\n$/, '') })
      return '\u0000B' + (blocks.length - 1) + '\u0000'
    })
    // 2) инлайн-код
    t = t.replace(/`([^`\n]+)`/g, (_, c) => {
      codes.push(c)
      return '\u0000C' + (codes.length - 1) + '\u0000'
    })
    // 3) экранируем HTML (защита от инъекций)
    t = esc(t)

    const fmt = (x) => x
      .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_\n]+?)__/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?![*\w])/g, '$1<em>$2</em>')
      .replace(/(^|[^_\w])_([^_\s][^_\n]*?)_(?![_\w])/g, '$1<em>$2</em>')
      .replace(/~~([^~\n]+?)~~/g, '<del>$1</del>')

    const safeUrl = (u) => u.replace(/"/g, '%22').replace(/'/g, '%27')

    const inline = (s) => {
      s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, text, url) => {
        links.push('<a href="' + safeUrl(url) + '" target="_blank" rel="noopener">' + fmt(text) + '</a>')
        return '\u0000L' + (links.length - 1) + '\u0000'
      })
      s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]*[^\s<).,;:!?])/g, (_, pre, url) => {
        links.push('<a href="' + safeUrl(url) + '" target="_blank" rel="noopener">' + url + '</a>')
        return pre + '\u0000L' + (links.length - 1) + '\u0000'
      })
      return fmt(s)
    }

    const lines = t.split('\n')
    const listItemRe = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
    const isHr = l => /^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(l)
    const isQuote = l => /^\s*&gt;/.test(l)
    const isHead = l => /^#{1,6}\s+/.test(l)
    const isPh = l => /^\u0000B\d+\u0000$/.test(l.trim())
    const isTableSep = l => l.includes('|') && l.includes('-') && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l)
    const isTableStart = (i) => lines[i].includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])
    const isBlockStart = (i) => {
      const l = lines[i]
      return isHead(l) || isHr(l) || isQuote(l) || isPh(l) || listItemRe.test(l) || isTableStart(i)
    }

    function parseList(idx, baseIndent) {
      let j = idx
      const first = lines[j].match(listItemRe)
      const ordered = /\d/.test(first[2])
      const startNum = ordered ? parseInt(first[2], 10) : 1
      let html = ordered ? '<ol' + (startNum !== 1 ? ' start="' + startNum + '"' : '') + '>' : '<ul>'
      let open = false
      while (j < lines.length) {
        const ln = lines[j]
        if (!ln.trim()) {
          let k = j + 1
          while (k < lines.length && !lines[k].trim()) k++
          const nm = k < lines.length ? lines[k].match(listItemRe) : null
          if (nm && (nm[1].length > baseIndent || (nm[1].length === baseIndent && /\d/.test(nm[2]) === ordered))) { j = k; continue }
          break
        }
        const m = ln.match(listItemRe)
        if (!m) break
        const indent = m[1].length
        if (indent < baseIndent) break
        if (indent === baseIndent && /\d/.test(m[2]) !== ordered) break
        if (indent > baseIndent) {
          const sub = parseList(j, indent)
          html += sub[0]
          j = sub[1]
          continue
        }
        if (open) html += '</li>'
        html += '<li>' + inline(m[3])
        open = true
        j++
      }
      if (open) html += '</li>'
      html += ordered ? '</ol>' : '</ul>'
      return [html, j]
    }

    const out = []
    let i = 0
    while (i < lines.length) {
      const line = lines[i]
      if (!line.trim()) { i++; continue }

      if (isPh(line)) { out.push(line.trim()); i++; continue }

      let m = line.match(/^(#{1,6})\s+(.*)$/)
      if (m) {
        const n = m[1].length
        out.push('<h' + n + '>' + inline(m[2].replace(/\s+#+\s*$/, '')) + '</h' + n + '>')
        i++
        continue
      }

      if (isHr(line)) { out.push('<hr>'); i++; continue }

      if (isTableStart(i)) {
        const split = r => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
        const head = split(lines[i])
        i += 2
        const rows = []
        while (i < lines.length && lines[i].trim() && lines[i].includes('|')) { rows.push(split(lines[i])); i++ }
        out.push('<div class="md-table"><table><thead><tr>' +
          head.map(c => '<th>' + inline(c) + '</th>').join('') +
          '</tr></thead><tbody>' +
          rows.map(r => '<tr>' + r.map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') +
          '</tbody></table></div>')
        continue
      }

      if (isQuote(line)) {
        const q = []
        while (i < lines.length && isQuote(lines[i])) { q.push(lines[i].replace(/^\s*&gt;\s?/, '')); i++ }
        out.push('<blockquote>' + inline(q.join('\n')).replace(/\n/g, '<br>') + '</blockquote>')
        continue
      }

      const lm = line.match(listItemRe)
      if (lm) {
        const res = parseList(i, lm[1].length)
        out.push(res[0])
        i = res[1]
        continue
      }

      const para = []
      while (i < lines.length && lines[i].trim() && !(para.length && isBlockStart(i))) { para.push(lines[i]); i++ }
      out.push('<p>' + inline(para.join('\n')).replace(/\n/g, '<br>') + '</p>')
    }

    let html = out.join('\n')
    html = html.replace(/\u0000L(\d+)\u0000/g, (_, n) => links[+n])
    html = html.replace(/\u0000C(\d+)\u0000/g, (_, n) => '<code>' + esc(codes[+n]) + '</code>')
    html = html.replace(/\u0000B(\d+)\u0000/g, (_, n) => codeBlockHtml(blocks[+n]))
    return html
  }
  // @@MD-END

  // ── Пасхалка ───────────────────────────────────────────────────────────────
  function showEasterEgg() {
    document.getElementById('easterEggOverlay')?.remove()
    const overlay = document.createElement('div')
    overlay.id = 'easterEggOverlay'
    overlay.style.cssText = 'position: fixed; inset: 0; z-index: 9999; background: #000; display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer;'
    const video = document.createElement('video')
    video.src = window.API?.getAssetPath ? window.API.getAssetPath('0xteam.mp4') : './assets/0xteam.mp4'
    video.autoplay = true; video.loop = true
    video.style.cssText = 'max-width: 100%; max-height: 90vh; border-radius: 8px;'
    video.volume = 0.8
    const hint = document.createElement('div')
    hint.textContent = 'Нажми в любом месте чтобы закрыть'
    hint.style.cssText = 'color: #555; font-size: 12px; margin-top: 12px; font-family: monospace;'
    overlay.appendChild(video); overlay.appendChild(hint)
    document.body.appendChild(overlay)
    overlay.addEventListener('click', () => overlay.remove())
  }

  // ── Чипы DeepThink / Search ────────────────────────────────────────────────
  function toggleThink() {
    thinkEnabled = !thinkEnabled
    $('chipThink').classList.toggle('active', thinkEnabled)
    if (thinkEnabled) {
      localStorage.setItem('cakeai_deepthink', '1')
      Status.set(tr('DeepThink включён: ответ будет дольше и расходует больше токенов, но точнее', 'DeepThink on: slower and uses more tokens, but more accurate'), 'ok')
      setTimeout(() => Status.set(tr('Готов', 'Ready'), 'ok'), 5000)
    } else {
      localStorage.removeItem('cakeai_deepthink')
      Status.set(tr('DeepThink выключен', 'DeepThink off'), 'ok')
      setTimeout(() => Status.set(tr('Готов', 'Ready'), 'ok'), 2000)
    }
  }

  function toggleWebSearch() {
    webSearchEnabled = !webSearchEnabled
    $('chipSearch').classList.toggle('active', webSearchEnabled)
    if (webSearchEnabled) {
      localStorage.setItem('cakeai_websearch', '1')
      Status.set(tr('Поиск включён: буду искать в интернете', 'Search on: I will search the web'), 'ok')
    } else {
      localStorage.removeItem('cakeai_websearch')
      Status.set(tr('Поиск выключен', 'Search off'), 'ok')
    }
    setTimeout(() => Status.set(tr('Готов', 'Ready'), 'ok'), 2000)
  }

  function restoreChips() {
    $('chipThink').classList.toggle('active', thinkEnabled)
    $('chipSearch').classList.toggle('active', webSearchEnabled)
  }

  // ── Контекст файла ─────────────────────────────────────────────────────────
  function setFileCtx(name, content) {
    fileCtxContent = content
    fileCtxName = name
    $('filePillName').textContent = name
    $('filePill').style.display = 'flex'
  }

  function clearFileCtx() {
    fileCtxContent = null
    fileCtxName = null
    $('filePill').style.display = 'none'
  }

  function askAboutFile() {
    Workspace.showChat()
    const inp = $('chatInput')
    inp.focus()
    inp.placeholder = tr('Спроси про ' + (fileCtxName || 'файл') + '...', 'Ask about ' + (fileCtxName || 'the file') + '...')
  }

  async function buildContext(userText) {
    const parts = []
    const folderCtx = Files.getFolderContext?.()
    if (folderCtx) parts.push(folderCtx)
    if (fileCtxContent && fileCtxName) {
      parts.push('Открытый файл: ' + fileCtxName + '\n```\n' + fileCtxContent.slice(0, 8000) + '\n```')
    }
    const rootPath = Files.getRootPath?.()
    if (rootPath && userText) {
      const folderFiles = Files.getAllFiles?.() || []
      for (const f of folderFiles) {
        if (userText.toLowerCase().includes(f.name.toLowerCase()) && f.name !== fileCtxName) {
          const res = await API.readFile(f.path)
          if (!res.error) {
            parts.push('Файл ' + f.name + ':\n```\n' + res.content.slice(0, 6000) + '\n```')
          }
        }
      }
    }
    return parts.length ? parts.join('\n\n') : null
  }

  // ── Состояние кнопки отправки ──────────────────────────────────────────────
  function setLoading(v) {
    loading = v
    const b = $('sendBtn')
    if (!b) return
    b.disabled = false
    b.classList.toggle('stop', v)
    b.textContent = v ? '■' : '▶'
    b.title = v ? tr('Остановить', 'Stop') : ''
  }

  // ── DOM сообщений ──────────────────────────────────────────────────────────
  function welcomeHTML(sub) {
    return '<div class="welcome" id="welcomeScreen"><div class="welcome-logo">Cake<em>AI</em></div><div class="welcome-sub">' + sub + '</div></div>'
  }

  function scrollIfAuto() {
    if (!autoScroll) return
    const c = $('chatMessages')
    c.scrollTop = c.scrollHeight
  }

  function appendUser(text) {
    $('welcomeScreen')?.remove()
    const div = document.createElement('div')
    div.className = 'msg user'
    div.innerHTML =
      '<div class="msg-avatar">' + tr('Я', 'Me') + '</div>' +
      '<div class="msg-body"><div class="msg-role">' + tr('Вы', 'You') + '</div><div class="bubble md"></div></div>'
    div.querySelector('.bubble').innerHTML = renderMarkdown(text)
    $('chatMessages').appendChild(div)
    scrollIfAuto()
  }

  function createAIMsg(streaming) {
    $('welcomeScreen')?.remove()
    const div = document.createElement('div')
    div.className = 'msg ai'
    div.innerHTML =
      '<div class="msg-avatar">AI</div>' +
      '<div class="msg-body">' +
        '<div class="msg-role">Lungskull</div>' +
        '<div class="think-block" hidden>' +
          '<div class="think-head" data-act="think"><span class="think-icon">💭</span><span class="think-title"></span><span class="think-arrow">▾</span></div>' +
          '<div class="think-body"></div>' +
        '</div>' +
        '<div class="bubble md"' + (streaming ? ' hidden' : '') + '></div>' +
      '</div>'
    return {
      div,
      thinkBlock: div.querySelector('.think-block'),
      thinkTitle: div.querySelector('.think-title'),
      thinkBody: div.querySelector('.think-body'),
      bubble: div.querySelector('.bubble')
    }
  }

  function appendAIStatic(text, idx) {
    const u = createAIMsg(false)
    u.bubble.innerHTML = renderMarkdown(text)
    u.div._raw = text
    u.div._idx = idx
    $('chatMessages').appendChild(u.div)
    return u.div
  }

  function showTyping() {
    $('welcomeScreen')?.remove()
    hideTyping()
    const d = document.createElement('div')
    d.className = 'msg ai'
    d.id = 'typing-msg'
    d.innerHTML =
      '<div class="msg-avatar">AI</div>' +
      '<div class="msg-body"><div class="msg-role">Lungskull</div>' +
      '<div class="typing-bubble"><span class="td"></span><span class="td"></span><span class="td"></span></div></div>'
    $('chatMessages').appendChild(d)
    scrollIfAuto()
  }

  function hideTyping() {
    document.getElementById('typing-msg')?.remove()
  }

  function sourcesHTML(list) {
    return '<div class="search-sources"><div style="font-size:10px;color:var(--t2);margin-bottom:4px">📚 ' + tr('Источники', 'Sources') + ':</div>' +
      list.map(s => {
        const url = /^https?:\/\//i.test(s.url || '') ? String(s.url).replace(/"/g, '%22') : '#'
        return '<div style="margin:2px 0"><a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(s.title || url) + '</a></div>'
      }).join('') + '</div>'
  }

  // ── Запуск кода из ответа ──────────────────────────────────────────────────
  function findRunnable(text) {
    const re = /```(\w+)[^\n]*\n([\s\S]*?)```/g
    let m
    while ((m = re.exec(text || ''))) {
      let lang = m[1].toLowerCase()
      if (lang === 'py') lang = 'python'
      if (['python', 'python3', 'js', 'javascript', 'node'].includes(lang)) {
        return { lang, code: m[2].trim(), full: m[0] }
      }
    }
    return null
  }

  function addTools(div, text, opts) {
    div.querySelector('.msg-tools')?.remove()
    const tools = document.createElement('div')
    tools.className = 'msg-tools'
    let html = ''
    if (opts.copy) html += '<button class="tool-btn" data-act="copy-msg">📋 ' + tr('Копировать', 'Copy') + '</button>'
    if (opts.regen) html += '<button class="tool-btn tool-regen" data-act="regen">↻ ' + tr('Повторить', 'Retry') + '</button>'
    if (opts.copy && findRunnable(text)) html += '<button class="tool-btn" data-act="run">▶ ' + tr('Запустить код', 'Run code') + '</button>'
    tools.innerHTML = html
    div.querySelector('.msg-body').appendChild(tools)
  }'

  const RISKY_RE = /\b(rm\s+-|rmtree|os\.remove|os\.unlink|os\.rmdir|os\.system|subprocess|shutil|child_process|execSync|spawn|eval\(|exec\(|__import__|winreg|powershell|requests\.|urllib|socket|fetch\(|fs\.(rm|unlink|rmdir|writeFile|appendFile))/i
  const INTERACTIVE_RE = /\b(input\s*\(|readline|while\s+True|while\s*\(\s*true\s*\)|\.listen\(|app\.run\(|tkinter|pygame|setInterval)/i
  let autotestEnabled = localStorage.getItem('cakeai_autotest') !== '0'

  function canAutoRun(text) {
    const m = findRunnable(text)
    return !!m && !RISKY_RE.test(m.code) && !INTERACTIVE_RE.test(m.code)
  }

  function toggleAutotest() {
    autotestEnabled = !autotestEnabled
    localStorage.setItem('cakeai_autotest', autotestEnabled ? '1' : '0')
    $('chipAutotest')?.classList.toggle('active', autotestEnabled)
    Status.set(autotestEnabled
      ? tr('Автотест включён: код будет запускаться и проверяться', 'Auto-test on: code will be run and checked')
      : tr('Автотест выключен', 'Auto-test off'), 'ok')
    setTimeout(() => Status.set(tr('Готов', 'Ready'), 'ok'), 2500)
  }

  async function runCode(msgEl, btn) {
    const m = findRunnable(msgEl._raw || '')
    if (!m) return
    const key = localStorage.getItem('cakeai_key')
    if (!key) { Settings.open(); return }

    const old = btn.textContent
    btn.disabled = true
    btn.textContent = '⏳ ' + tr('Запускаю...', 'Running...')
    Status.set(tr('Тестирую код...', 'Testing code...'), 'busy')
    msgEl.querySelector('.code-check-result')?.remove()

    const prov = localStorage.getItem('cakeai_provider') || null
    const model = prov ? (localStorage.getItem('cakeai_model_' + prov) || null) : null
    const idx = typeof msgEl._idx === 'number' ? msgEl._idx : messages.length

    let res
    try {
      res = await API.aiRunCheck({
        code: m.code, lang: m.lang,
        msgs: messages.slice(0, idx).map(x => ({ role: x.role, content: x.content })),
        key, provider: prov, model
      })
    } catch (e) {
      res = { ok: false, code: m.code, error: String(e) }
    }

    btn.disabled = false
    btn.textContent = old

    const box = document.createElement('div')
    const label = document.createElement('div')
    box.appendChild(label)

    if (res.skipped) {
      box.className = 'code-check-result code-fail'
      label.textContent = '⚠️ ' + tr('Этот язык нельзя запустить', 'This language cannot be run')
    } else if (res.ok) {
      const fixed = res.code && res.code !== m.code
      box.className = 'code-check-result ' + (fixed ? 'code-fixed' : 'code-ok')
      label.textContent = fixed
        ? '🔧 ' + tr('Код исправлен ИИ и запущен: теперь работает', 'Code fixed by AI and executed: works now')
        : '✅ ' + tr('Код запущен: работает', 'Code executed: works')
      if (res.output) {
        const out = document.createElement('div')
        out.className = 'code-output'
        out.textContent = res.output.slice(0, 1000)
        box.appendChild(out)
      }
      if (fixed) {
        const newRaw = msgEl._raw.replace(m.full, () => '```' + m.lang + '\n' + res.code + '\n```')
        msgEl._raw = newRaw
        if (idx < messages.length) messages[idx].content = newRaw
        msgEl.querySelector('.bubble').innerHTML = renderMarkdown(newRaw)
        autoSave()
      }
    } else {
      box.className = 'code-check-result code-fail'
      label.textContent = '⚠️ ' + tr('Ошибка при запуске: ', 'Run error: ') + String(res.error || '').slice(0, 300)
    }
    msgEl.querySelector('.msg-body').appendChild(box)
    try { Terminal.log('[AI-TESTER] ' + (res.ok ? 'OK' : 'ERR') + '\n' + (res.output || res.error || '')) } catch (e) {}
    Status.set(tr('Готов', 'Ready'), 'ok')
  }

  // ── Клики внутри чата ──────────────────────────────────────────────────────
  function copyText(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
      const old = btn.textContent
      btn.textContent = '✓ ok'
      setTimeout(() => { btn.textContent = old }, 1500)
    }).catch(() => {})
  }

  function setThinkCollapsed(block, collapsed) {
    if (!block) return
    block.classList.toggle('collapsed', collapsed)
    block.dataset.collapsed = collapsed ? '1' : '0'
    const body = block.querySelector('.think-body')
    const arrow = block.querySelector('.think-arrow')
    if (body) body.style.display = collapsed ? 'none' : ''
    if (arrow) arrow.style.transform = collapsed ? 'rotate(-90deg)' : ''
  }

  function onChatClick(e) {
    const btn = e.target.closest('[data-act]')
    if (!btn) return
    const act = btn.dataset.act
    const msgEl = btn.closest('.msg')

    if (act === 'think') {
      const block = btn.closest('.think-block')
      setThinkCollapsed(block, block.dataset.collapsed !== '1')
    } else if (act === 'copy') {
      const code = btn.closest('pre')?.querySelector('code')
      if (code) copyText(code.textContent, btn)
    } else if (act === 'editor') {
      const code = btn.closest('pre')?.querySelector('code')?.textContent || ''
      if (!Editor.getPath()) { Status.set(tr('Сначала открой файл в редакторе', 'Open a file in the editor first'), 'err'); return }
      $('codeEditor').value = code
      Editor.markDirty?.()
      Workspace.showFileTab(Editor.getPath())
    } else if (act === 'copy-msg') {
      copyText(msgEl?._raw || '', btn)
    } else if (act === 'regen') {
      regenerate()
    } else if (act === 'run') {
      if (msgEl) runCode(msgEl, btn)
    }
  }

  // ── Сообщения для API ──────────────────────────────────────────────────────
  // Склеиваем подряд идущие сообщения одной роли (бывает после ошибки)
  function apiMessages() {
    const out = []
    for (const m of messages) {
      const last = out[out.length - 1]
      if (last && last.role === m.role) last.content += '\n\n' + m.content
      else out.push({ role: m.role, content: m.content })
    }
    return out
  }

  // ── Автосохранение ─────────────────────────────────────────────────────────
  async function autoSave() {
    if (!messages.length) return
    const myEpoch = epoch
    try {
      const id = await History.saveChat(
        messages.map(m => ({ role: m.role, content: m.content })),
        (messages[0].content || '').slice(0, 40),
        currentChatId
      )
      if (myEpoch === epoch) currentChatId = id
    } catch (e) {}
  }

  async function saveCurrentChat() {
    if (!messages.length) { Status.set(tr('Нечего сохранять', 'Nothing to save'), 'ok'); return }
    await autoSave()
    Status.set(tr('Чат сохранён 🔐', 'Chat saved 🔐'), 'ok')
  }

  // ── Остановка / сброс ──────────────────────────────────────────────────────
  function stop() {
    if (!loading) return
    stoppedByUser = true
    try { API.aiStop?.() } catch (e) {}
  }

  function invalidateRun() {
    currentRun++
    try { API.offStream() } catch (e) {}
    if (loading) { try { API.aiStop?.() } catch (e) {} }
    stoppedByUser = false
    setLoading(false)
    hideTyping()
  }

  function newChat() {
    invalidateRun()
    epoch++
    messages = []
    currentChatId = null
    $('chatMessages').innerHTML = welcomeHTML(tr('Новый чат. Задай вопрос.', 'New chat. Ask a question.'))
    Workspace.showChat()
    Status.set(tr('Готов', 'Ready'), 'ok')
  }

  function loadHistory(msgs, id) {
    invalidateRun()
    epoch++
    messages = (msgs || []).map(m => ({ role: m.role, content: m.content }))
    currentChatId = id || null
    const container = $('chatMessages')
    container.innerHTML = ''
    let lastAi = null
    messages.forEach((m, i) => {
      if (m.role === 'user') appendUser(m.content)
      else lastAi = { el: appendAIStatic(m.content, i), idx: i, text: m.content }
    })
    // инструменты у всех ответов, «Повторить» только у последнего
    container.querySelectorAll('.msg.ai').forEach(el => {
      const isLast = lastAi && el === lastAi.el && lastAi.idx === messages.length - 1
      addTools(el, el._raw || '', { copy: true, regen: isLast })
    })
    Workspace.showChat()
    autoScroll = true
    container.scrollTop = container.scrollHeight
    Status.set(tr('Готов', 'Ready'), 'ok')
  }

  function quick(text) {
    $('chatInput').value = text
    send()
  }

  // ── Отправка ───────────────────────────────────────────────────────────────
  async function send() {
    if (loading) return
    const inp = $('chatInput')
    const text = inp.value.trim()
    if (!text) return

    if (text.toLowerCase() === '0xteam') {
      inp.value = ''
      showEasterEgg()
      return
    }

    const key = localStorage.getItem('cakeai_key')
    if (!key) { Settings.open(); return }

    inp.value = ''
    inp.style.height = 'auto'
    inp.placeholder = tr('Спроси что угодно...', 'Ask anything...')
    autoScroll = true

    messages.push({ role: 'user', content: text })
    appendUser(text)
    await streamAnswer()
  }

  async function regenerate() {
    if (loading) return
    if (!localStorage.getItem('cakeai_key')) { Settings.open(); return }

    const aiEls = document.querySelectorAll('#chatMessages .msg.ai')
    const lastAi = aiEls[aiEls.length - 1]
    if (messages.length && messages[messages.length - 1].role === 'assistant') {
      messages.pop()
      lastAi?.remove()
    } else if (lastAi && lastAi.classList.contains('msg-error')) {
      lastAi.remove()
    }
    if (!messages.length) return
    autoScroll = true
    await streamAnswer()
  }

  async function streamAnswer() {
    const runId = ++currentRun
    const key = localStorage.getItem('cakeai_key')
    stoppedByUser = false
    setLoading(true)
    Status.set(tr('Думаю...', 'Thinking...'), 'busy')
    Workspace.showChat()
    showTyping()

    const prov = localStorage.getItem('cakeai_provider') || null
    const model = prov ? (localStorage.getItem('cakeai_model_' + prov) || null) : null
    const lastUser = [...messages].reverse().find(m => m.role === 'user')
    const fileCtx = await buildContext(lastUser ? lastUser.content : '')
    if (runId !== currentRun) return

    let ui = null
    let streamText = ''
    let reasoningText = ''
    let thinkStarted = false
    let thinkActive = false
    let thinkStart = 0
    let thinkTimer = null
    let answerStarted = false
    let sources = null
    let renderQueued = false
    let finished = false

    const ensureUI = () => {
      if (ui) return ui
      hideTyping()
      ui = createAIMsg(true)
      $('chatMessages').appendChild(ui.div)
      return ui
    }

    const startThinking = () => {
      const u = ensureUI()
      u.thinkBlock.hidden = false
      u.thinkBlock.classList.add('thinking')
      u.thinkBlock.classList.remove('collapsed')
      thinkActive = true
      thinkStart = Date.now()
      const tick = () => {
        const s = Math.round((Date.now() - thinkStart) / 1000)
        u.thinkTitle.textContent = tr('Думаю… ' + s + ' с', 'Thinking… ' + s + ' s')
      }
      tick()
      thinkTimer = setInterval(tick, 1000)
    }

    // Размышления закончились: сворачиваем блок в одну строку, ответ идёт в том же сообщении
    const finishThinking = () => {
      if (!thinkActive) return
      thinkActive = false
      clearInterval(thinkTimer)
      const sec = Math.max(1, Math.round((Date.now() - thinkStart) / 1000))
      ui.thinkTitle.textContent = tr('Думал ' + sec + ' с', 'Thought for ' + sec + ' s')
      ui.thinkBlock.classList.remove('thinking')
      setThinkCollapsed(ui.thinkBlock, true)
    }

    const queueRender = () => {
      if (renderQueued) return
      renderQueued = true
      requestAnimationFrame(() => {
        renderQueued = false
        if (finished || !ui) return
        ui.bubble.innerHTML = renderMarkdown(streamText)
        scrollIfAuto()
      })
    }

    API.offStream()

    API.onSearchSources(s => {
      if (runId !== currentRun) return
      sources = s
    })

    API.onStreamReasoning(chunk => {
      if (runId !== currentRun) return
      if (!thinkStarted) { thinkStarted = true; startThinking() }
      reasoningText += chunk
      ui.thinkBody.textContent = reasoningText
      ui.thinkBody.scrollTop = ui.thinkBody.scrollHeight
      scrollIfAuto()
    })

    API.onStreamChunk(chunk => {
      if (runId !== currentRun) return
      const u = ensureUI()
      if (!answerStarted) {
        answerStarted = true
        u.bubble.hidden = false
        finishThinking()
        Status.set(tr('Пишу ответ...', 'Writing...'), 'busy')
      }
      streamText += chunk
      queueRender()
    })

    const finish = (err) => {
      if (finished || runId !== currentRun) return
      finished = true
      API.offStream()
      hideTyping()
      finishThinking()

      if (err) {
        const u = ensureUI()
        u.div.classList.add('msg-error')
        u.bubble.hidden = false
        u.bubble.innerHTML = (streamText ? renderMarkdown(streamText) : '') +
          '<div class="err-line">⚠️ ' + tr('Ошибка', 'Error') + ': ' + esc(String(err)) + '</div>'
        addTools(u.div, '', { copy: false, regen: true })
        Status.set(tr('Ошибка: ', 'Error: ') + String(err).slice(0, 120), 'err')
      } else if (!streamText.trim()) {
        if (stoppedByUser) {
          if (ui && !reasoningText) ui.div.remove()
        } else {
          const u = ensureUI()
          u.div.classList.add('msg-error')
          u.bubble.hidden = false
          u.bubble.innerHTML = '<div class="err-line">⚠️ ' + tr('Модель вернула пустой ответ', 'The model returned an empty answer') + '</div>'
          addTools(u.div, '', { copy: false, regen: true })
        }
        Status.set(tr('Готов', 'Ready'), 'ok')
      } else {
        const u = ensureUI()
        messages.push({ role: 'assistant', content: streamText })
        u.div._raw = streamText
        u.div._idx = messages.length - 1
        u.bubble.hidden = false
        u.bubble.innerHTML = renderMarkdown(streamText) +
          (stoppedByUser ? '<div class="stopped-line">⏹ ' + tr('Остановлено', 'Stopped') + '</div>' : '')
        if (sources && sources.length) u.bubble.insertAdjacentHTML('afterend', sourcesHTML(sources))
        document.querySelectorAll('#chatMessages .tool-regen').forEach(b => b.remove())
        addTools(u.div, streamText, { copy: true, regen: true })
        scrollIfAuto()
        Status.set(tr('Готов', 'Ready'), 'ok')
        autoSave()
        if (autotestEnabled && !stoppedByUser && canAutoRun(streamText)) {
          const runBtn = u.div.querySelector('[data-act="run"]')
          if (runBtn) runCode(u.div, runBtn)
        }
      }

      stoppedByUser = false
      setLoading(false)
    }

    API.onStreamDone(err => finish(err))

    if (stoppedByUser) { finish(null); return }

    try {
      const customPrompt = localStorage.getItem('cakeai_systemprompt') || ''
      await API.aiStream({
        msgs: apiMessages(),
        mode: 'general',
        key,
        provider: prov,
        model,
        fileCtx,
        customPrompt: customPrompt || undefined,
        deepthinkEnabled: localStorage.getItem('cakeai_deepthink') === '1',
        webSearch: localStorage.getItem('cakeai_websearch') === '1'
      })
      // страховка: если событие завершения почему-то не пришло
      setTimeout(() => { if (!finished && runId === currentRun) finish(null) }, 1500)
    } catch (e) {
      finish(String(e))
    }
  }

  // ── Инициализация ──────────────────────────────────────────────────────────
  function init() {
    const container = $('chatMessages')
    if (!container) return
    container.addEventListener('scroll', () => {
      autoScroll = container.scrollHeight - container.scrollTop - container.clientHeight < 80
    })
    container.addEventListener('click', onChatClick)
    const sb = $('sendBtn')
    if (sb) sb.onclick = () => (loading ? stop() : send())
    const chips = document.querySelector('.input-chips')
    if (chips && !$('chipAutotest')) {
      const b = document.createElement('button')
      b.className = 'input-chip' + (autotestEnabled ? ' active' : '')
      b.id = 'chipAutotest'
      b.title = tr('Автоматически запускать и проверять код', 'Automatically run and test code')
      b.textContent = '🧪 Auto-test'
      b.onclick = toggleAutotest
      chips.appendChild(b)
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()

  return {
    setFileCtx, clearFileCtx, newChat, quick, askAboutFile, send, stop, regenerate,
    saveCurrentChat, loadHistory, toggleThink, toggleWebSearch, restoreChips
  }
})()
window.Chat = Chat
