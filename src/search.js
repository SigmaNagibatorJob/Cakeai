const Search = (() => {
  let visible = false

  function open() {
    visible = true
    document.getElementById('searchOverlay').style.display = 'flex'
    document.getElementById('searchInput').value = ''
    document.getElementById('searchResults').innerHTML = ''
    document.getElementById('searchInput').focus()
    setTab('files')
  }

  function close() {
    visible = false
    document.getElementById('searchOverlay').style.display = 'none'
  }

  function onBgClick(e) {
    if (e.target === document.getElementById('searchOverlay')) close()
  }

  function setTab(tab) {
    document.querySelectorAll('.search-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab))
    document.getElementById('searchInput').placeholder =
      tab === 'files'   ? 'Поиск по файлам проекта...' :
      tab === 'history' ? 'Поиск по истории чатов...' :
                          'Поиск в интернете...'
    document.getElementById('searchResults').innerHTML = ''
    document.getElementById('searchInput').value = ''
    document.getElementById('searchInput').focus()
  }

  function activeTab() {
    return document.querySelector('.search-tab.active')?.dataset.tab || 'files'
  }

  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  }

  function highlight(text, query) {
    if (!query) return esc(text)
    const re = new RegExp('(' + query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi')
    return esc(text).replace(re, '<mark>$1</mark>')
  }

  // ── Поиск по файлам ──────────────────────────────────────────────────────
  async function searchFiles(query) {
    const res = document.getElementById('searchResults')
    if (!query.trim()) { res.innerHTML = ''; return }

    const rootPath = Files.getRootPath?.()
    if (!rootPath) {
      res.innerHTML = '<div class="search-empty">Сначала открой папку проекта</div>'
      return
    }

    res.innerHTML = '<div class="search-loading">Ищу...</div>'

    const allFiles = Files.getAllFiles?.() || []
    const results = []

    for (const f of allFiles) {
      const fileRes = await API.readFile(f.path)
      if (fileRes.error) continue
      const lines = fileRes.content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(query.toLowerCase())) {
          results.push({ file: f.name, path: f.path, line: i + 1, text: lines[i].trim() })
          if (results.length >= 100) break
        }
      }
      if (results.length >= 100) break
    }

    if (!results.length) {
      res.innerHTML = `<div class="search-empty">Ничего не найдено по «${esc(query)}»</div>`
      return
    }

    // группируем по файлам
    const byFile = {}
    results.forEach(r => {
      if (!byFile[r.path]) byFile[r.path] = { name: r.file, path: r.path, hits: [] }
      byFile[r.path].hits.push(r)
    })

    res.innerHTML = Object.values(byFile).map(f => `
      <div class="search-file-group">
        <div class="search-file-name">📄 ${esc(f.name)} <span class="search-count">${f.hits.length}</span></div>
        ${f.hits.map(h => `
          <div class="search-hit" onclick="Search.openHit('${esc(h.path)}','${esc(h.file)}',${h.line})">
            <span class="search-line">:${h.line}</span>
            <span class="search-text">${highlight(h.text.slice(0, 120), query)}</span>
          </div>`).join('')}
      </div>`).join('')
  }

  function openHit(path, name, line) {
    Files.openFile(path, name)
    close()
    // TODO: перейти на нужную строку когда редактор поддержит это
  }

  // ── Поиск по истории ─────────────────────────────────────────────────────
  function searchHistory(query) {
    const res = document.getElementById('searchResults')
    if (!query.trim()) { res.innerHTML = ''; return }

    const allChats = History.getAll?.() || []
    if (!allChats.length) {
      res.innerHTML = '<div class="search-empty">История пуста</div>'
      return
    }

    const q = query.toLowerCase()
    const results = []

    allChats.forEach(chat => {
      const titleMatch = chat.title?.toLowerCase().includes(q)
      const msgMatches = chat.messages.filter(m => m.content?.toLowerCase().includes(q))
      if (titleMatch || msgMatches.length) {
        results.push({ chat, msgMatches })
      }
    })

    if (!results.length) {
      res.innerHTML = `<div class="search-empty">Ничего не найдено по «${esc(query)}»</div>`
      return
    }

    res.innerHTML = results.map(r => `
      <div class="search-chat-item" onclick="Search.openChat('${r.chat.id}')">
        <div class="search-chat-title">${highlight(r.chat.title || 'Без названия', query)}</div>
        <div class="search-chat-meta">${r.chat.date} · ${r.msgMatches.length} совпадений в сообщениях</div>
        ${r.msgMatches.slice(0, 2).map(m => `
          <div class="search-chat-snippet">${highlight(m.content.slice(0, 100), query)}...</div>
        `).join('')}
      </div>`).join('')
  }

  function openChat(id) {
    History.loadChat(id)
    close()
  }

  // ── Поиск в интернете ────────────────────────────────────────────────────
  async function searchWeb(query) {
    const res = document.getElementById('searchResults')
    if (!query.trim()) { res.innerHTML = ''; return }

    const key  = localStorage.getItem('cakeai_key')
    const prov = localStorage.getItem('cakeai_provider') || null
    const model = prov ? (localStorage.getItem('cakeai_model_' + prov) || null) : null

    if (!key) {
      res.innerHTML = '<div class="search-empty">Нужен API ключ для поиска через AI</div>'
      return
    }

    res.innerHTML = '<div class="search-loading">Ищу в интернете через AI...</div>'

    try {
      const result = await API.aiSend({
        msgs: [{
          role: 'user',
          content: `Найди актуальную информацию по запросу: "${query}"\n\nДай краткий ответ (3-5 пунктов) с самым важным. Если знаешь конкретные ссылки — укажи их.`
        }],
        mode: 'general',
        key,
        provider: prov,
        model
      })

      res.innerHTML = `
        <div class="search-web-result">
          <div class="search-web-query">🌐 ${esc(query)}</div>
          <div class="search-web-answer">${formatWebAnswer(result.text || '')}</div>
          <div class="search-web-hint">Ответ сгенерирован AI · данные могут быть неточными</div>
        </div>`
    } catch(e) {
      res.innerHTML = `<div class="search-empty">Ошибка: ${esc(String(e))}</div>`
    }
  }

  function formatWebAnswer(t) {
    t = t.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
      `<pre><code>${escHtml(code.trim())}</code></pre>`)
    t = t.replace(/`([^`\n]+)`/g, '<code>$1</code>')
    t = t.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    t = t.replace(/\n/g, '<br>')
    return t
  }

  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  }

  // ── Диспетчер ─────────────────────────────────────────────────────────────
  let debounceTimer = null
  function onInput(val) {
    clearTimeout(debounceTimer)
    const tab = activeTab()
    debounceTimer = setTimeout(() => {
      if (tab === 'files')        searchFiles(val)
      else if (tab === 'history') searchHistory(val)
      else if (tab === 'web')     searchWeb(val)
    }, tab === 'web' ? 800 : 300)
  }

  // Глобальный хоткей Ctrl+F
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.key === 'f') { e.preventDefault(); open() }
    if (e.key === 'Escape' && visible) close()
  })

  return { open, close, onBgClick, setTab, onInput, openHit, openChat }
})()
window.Search = Search
