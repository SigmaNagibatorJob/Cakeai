const Settings = (() => {
  const NAMES = {
    claude: 'Claude', openai: 'ChatGPT', gemini: 'Gemini', deepseek: 'DeepSeek', groq: 'Groq'
  }

  let pickerProvider = null

  function getSelectedModel(provider) {
    return localStorage.getItem('cakeai_model_' + provider) || null
  }

  function open() {
    const key = localStorage.getItem('cakeai_key') || ''
    document.getElementById('keyInput').value = key
    document.getElementById('keyDetected').style.display = 'none'
    document.getElementById('keyUnknown').style.display  = 'none'
    const sp = document.getElementById('systemPromptInput')
    if (sp) sp.value = localStorage.getItem('cakeai_systemprompt') || ''

    // Восстанавливаем сохраненный фон / RGB
    const savedBg = localStorage.getItem('cakeai_bg') || '#0d0f12'
    const bgPicker = document.getElementById('bgColorPicker')
    if (bgPicker) bgPicker.value = savedBg
    applyBackground(savedBg)

    // Восстанавливаем язык в select
    const savedLang = localStorage.getItem('cakeai_lang') || 'ru'
    const langSelect = document.getElementById('langSelect')
    if (langSelect) {
      langSelect.value = savedLang
      // Принудительно применяем язык при открытии настроек
      Settings.setLanguage(savedLang)
    }

    updateCards()
    document.getElementById('settingsModal').style.display = 'flex'
    switchTab('providers')
  }

  function switchTab(tabName) {
    document.querySelectorAll('.settings-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tabName)
    })
    document.querySelectorAll('.settings-pane').forEach(p => {
      p.style.display = p.id === 'pane-' + tabName ? 'flex' : 'none'
    })
  }

  function saveSystemPrompt(val) {
    if (val.trim()) localStorage.setItem('cakeai_systemprompt', val.trim())
    else localStorage.removeItem('cakeai_systemprompt')
  }

  function setBackground(val) {
    localStorage.setItem('cakeai_bg', val)
    applyBackground(val)
  }

  function applyBackground(val) {
    const root = document.documentElement
    root.style.setProperty('--bg0', val)

    // Делаем производные цвета для ВСЕГО приложения
    const hex = val.replace('#', '')
    const r = parseInt(hex.substring(0, 2), 16)
    const g = parseInt(hex.substring(2, 4), 16)
    const b = parseInt(hex.substring(4, 6), 16)

    const bg1 = `rgb(${Math.min(r + 8, 255)}, ${Math.min(g + 8, 255)}, ${Math.min(b + 12, 255)})`
    const bg2 = `rgb(${Math.min(r + 22, 255)}, ${Math.min(g + 22, 255)}, ${Math.min(b + 28, 255)})`
    const bg3 = `rgb(${Math.min(r + 34, 255)}, ${Math.min(g + 34, 255)}, ${Math.min(b + 42, 255)})`
    const bg4 = `rgb(${Math.min(r + 48, 255)}, ${Math.min(g + 48, 255)}, ${Math.min(b + 60, 255)})`

    root.style.setProperty('--bg1', bg1)
    root.style.setProperty('--bg2', bg2)
    root.style.setProperty('--bg3', bg3)
    root.style.setProperty('--bg4', bg4)

    // === Улучшаем контраст текста автоматически ===
    const brightness = (r * 299 + g * 587 + b * 114) / 1000
    if (brightness < 80) {
      // Тёмный фон → светлый текст
      root.style.setProperty('--t0', '#f1f5f9')
      root.style.setProperty('--t1', '#cbd5e1')
      root.style.setProperty('--t2', '#94a3b8')
    } else {
      // Светлый фон → тёмный текст
      root.style.setProperty('--t0', '#1e2937')
      root.style.setProperty('--t1', '#475569')
      root.style.setProperty('--t2', '#64748b')
    }

    // Принудительно обновляем основные контейнеры
    document.body.style.background = val
    const chatPanel = document.getElementById('chatPanel')
    if (chatPanel) chatPanel.style.background = val
    const workspace = document.querySelector('.workspace')
    if (workspace) workspace.style.background = val
  }

  function setLanguage(lang) {
    localStorage.setItem('cakeai_lang', lang)
    const langSelect = document.getElementById('langSelect')
    if (langSelect) langSelect.value = lang

    applyLanguage(lang)

    const msg = lang === 'ru' ? 'Язык изменён на Русский' : 'Language changed to English'
    Status.set(msg, 'ok')
    setTimeout(() => Status.set('Готов', 'ok'), 1800)
  }

  function applyLanguage(lang) {
    const chatInput = document.getElementById('chatInput')
    const statusText = document.getElementById('statusText')
    const welcomeSub = document.querySelector('.welcome-sub')
    const histEmpty = document.querySelector('.hist-empty')
    const treeEmpty = document.querySelector('.tree-empty')
    const openFolderBtns = document.querySelectorAll('.open-folder-btn')

    // Sidebar labels
    const sidebarLabels = document.querySelectorAll('.sidebar-label')
    const tabChat = document.getElementById('tab-chat')

    if (lang === 'en') {
      // === ENGLISH ===
      document.querySelectorAll('.hdr-btn').forEach(btn => {
        const txt = btn.textContent.trim().toLowerCase()
        if (txt.includes('новый') || txt.includes('new chat')) btn.textContent = '+ New chat'
        if (txt.includes('поиск') || txt.includes('search')) btn.textContent = '🔍 Search'
        if (txt.includes('настройки') || txt.includes('settings')) btn.textContent = '⚙ Settings'
      })

      // Left sidebar "Новый чат" button (bottom of history)
      document.querySelectorAll('button.open-folder-btn').forEach(btn => {
        const txt = btn.textContent.trim().toLowerCase()
        if (txt.includes('новый') || txt.includes('new chat')) {
          btn.textContent = '+ New chat'
        }
      })

      // Extra safety: translate all open-folder-btn that say "Новый чат"
      document.querySelectorAll('.open-folder-btn').forEach(el => {
        if (el.textContent.includes('Новый чат') || el.textContent.includes('＋ Новый')) {
          el.textContent = '+ New chat'
        }
      })

      if (chatInput) chatInput.placeholder = 'Ask anything...'
      if (statusText) statusText.textContent = 'Ready'
      if (welcomeSub) welcomeSub.textContent = 'Open a project folder on the left or ask a question right now.'

      // Sidebar
      if (histEmpty) histEmpty.textContent = 'No saved chats'
      if (treeEmpty) treeEmpty.textContent = 'No folder opened'
      sidebarLabels.forEach(el => {
        if (el.textContent.includes('ИСТОРИЯ') || el.textContent.includes('HISTORY')) el.textContent = 'HISTORY'
        if (el.textContent.includes('ПРОЕКТ') || el.textContent.includes('PROJECT')) el.textContent = 'PROJECT'
      })
      if (tabChat) tabChat.textContent = '💬 Chat'

      openFolderBtns.forEach(btn => {
        const txt = btn.textContent.toLowerCase()
        if (txt.includes('открыть') || txt.includes('open')) {
          btn.innerHTML = '📂 Open folder'
        }
      })

      // New chat welcome
      const newChatWelcome = document.querySelector('.welcome-sub')
      if (newChatWelcome) newChatWelcome.textContent = 'New chat. Ask a question.'

      window.__lang = 'en'

    } else {
      // === RUSSIAN (default) ===
      document.querySelectorAll('.hdr-btn').forEach(btn => {
        const txt = btn.textContent.trim().toLowerCase()
        if (txt.includes('new chat')) btn.textContent = '＋ Новый чат'
        if (txt.includes('search')) btn.textContent = '🔍 Поиск'
        if (txt.includes('settings')) btn.textContent = '⚙ Настройки'
      })

      if (chatInput) chatInput.placeholder = 'Спроси что угодно...'
      if (statusText) statusText.textContent = 'Готов'
      if (welcomeSub) welcomeSub.textContent = 'Открой папку проекта слева или задай вопрос прямо сейчас.'

      if (histEmpty) histEmpty.textContent = 'Нет сохранённых чатов'
      if (treeEmpty) treeEmpty.textContent = 'Папка не открыта'

      sidebarLabels.forEach(el => {
        if (el.textContent.includes('HISTORY')) el.textContent = 'ИСТОРИЯ'
        if (el.textContent.includes('PROJECT')) el.textContent = 'ПРОЕКТ'
      })
      if (tabChat) tabChat.textContent = '💬 Чат'

      openFolderBtns.forEach(btn => {
        const txt = btn.textContent.toLowerCase()
        if (txt.includes('open folder')) {
          btn.innerHTML = '📂 Открыть папку'
        }
      })

      window.__lang = 'ru'
    }
  }

  // Применяем язык при старте
  function initLanguage() {
    const savedLang = localStorage.getItem('cakeai_lang') || 'ru'
    const langSelect = document.getElementById('langSelect')
    if (langSelect) langSelect.value = savedLang
    applyLanguage(savedLang)
  }

  function close() {
    closeModelPicker()
    document.getElementById('settingsModal').style.display = 'none'
  }

  function onBgClick(e) {
    if (e.target === document.getElementById('settingsModal')) close()
  }

  async function onKeyChange(val) {
    document.getElementById('keyDetected').style.display = 'none'
    document.getElementById('keyUnknown').style.display  = 'none'
    const warningEl = document.getElementById('providerMismatchWarning')
    if (warningEl) warningEl.remove()

    if (!val) return
    const detected = await API.detectProvider(val)
    const currentActiveProvider = localStorage.getItem('cakeai_provider')

    if (detected && detected !== 'unknown') {
      const el = document.getElementById('keyDetected')
      el.textContent = `✓ Определён: ${NAMES[detected] || detected}`
      el.style.display = 'block'
      highlightCard(detected)

      // Проверка на несоответствие выбранного провайдера и введенного ключа
      if (currentActiveProvider && currentActiveProvider !== detected) {
        const warn = document.createElement('div')
        warn.id = 'providerMismatchWarning'
        warn.className = 'key-unknown'
        warn.style.marginTop = '8px'
        warn.innerHTML = `⚠️ <b>Внимание!</b> Введённый ключ принадлежит провайдеру <b>${NAMES[detected] || detected}</b>.<br>
        Сейчас выбран провайдер <b>${NAMES[currentActiveProvider] || currentActiveProvider}</b>.<br>
        <b>Смени провайдер на ${NAMES[detected] || detected}</b> (нажми на карточку выше).`
        el.insertAdjacentElement('afterend', warn)
      }
    } else if (val.length > 8) {
      document.getElementById('keyUnknown').style.display = 'block'
      highlightCard(null)
    }
  }

  async function applyKey() {
    const val = document.getElementById('keyInput').value.trim()
    if (!val) return
    const p = await API.detectProvider(val)
    localStorage.setItem('cakeai_key', val)
    if (p && p !== 'unknown') {
      localStorage.setItem('cakeai_provider', p)
    }
    updateProviderTag(p || 'unknown')
    updateCards()
    if (p && p !== 'unknown') close()
  }

  function pickProvider(p) {
    localStorage.setItem('cakeai_provider', p)
    updateProviderTag(p)
    updateCards()
  }

  function pickModel(provider, modelId) {
    localStorage.setItem('cakeai_model_' + provider, modelId)
    updateModelLabels()
    if (pickerProvider === provider) {
      document.querySelectorAll('#modelPickerList .model-item').forEach(el => {
        el.classList.toggle('active', el.textContent === modelId)
      })
    }
  }

  async function openModelPicker(provider, event) {
    pickerProvider = provider
    const picker = document.getElementById('modelPicker')
    const list = document.getElementById('modelPickerList')
    const title = document.getElementById('modelPickerTitle')
    const hint = document.getElementById('modelPickerHint')

    title.textContent = `Модели ${NAMES[provider]}`
    list.innerHTML = '<div class="model-loading">Загрузка...</div>'
    hint.textContent = ''

    const btn = event.currentTarget
    const rect = btn.getBoundingClientRect()
    picker.style.top = (rect.bottom + 4) + 'px'
    picker.style.left = Math.min(rect.left, window.innerWidth - 300) + 'px'
    picker.style.display = 'block'

    const key = localStorage.getItem('cakeai_key') || ''
    const detectedProv = key ? await API.detectProvider(key) : null
    const useKey = detectedProv === provider ? key : ''

    const result = await API.listModels({ provider, key: useKey })
    const selected = getSelectedModel(provider)

    list.innerHTML = ''
    if (!result.models.length) {
      list.innerHTML = '<div class="model-empty">Нет доступных моделей</div>'
    } else {
      for (const m of result.models) {
        const item = document.createElement('div')
        item.className = 'model-item' + (m === selected ? ' active' : '')
        item.textContent = m
        item.onclick = (e) => { e.stopPropagation(); pickModel(provider, m) }
        list.appendChild(item)
      }
    }
    hint.textContent = result.fromApi
      ? '✓ Список получен с API'
      : 'Стандартный список (вставь ключ для актуальных моделей)'
  }

  function closeModelPicker() {
    pickerProvider = null
    const picker = document.getElementById('modelPicker')
    if (picker) picker.style.display = 'none'
  }

  function updateProviderTag(p) {
    const tag = document.getElementById('providerTag')
    tag.className = 'provider-tag ' + (p || '')
    tag.textContent = NAMES[p] || (p === 'unknown' ? '?' : 'Нет ключа')
  }

  function highlightCard(p) {
    document.querySelectorAll('.provider-card').forEach(c => {
      c.classList.toggle('active', c.dataset.p === p)
    })
  }

  function updateModelLabels() {
    document.querySelectorAll('.p-model').forEach(el => {
      const p = el.dataset.p
      const model = getSelectedModel(p)
      el.textContent = model ? `Модель: ${model}` : ''
      el.style.display = model ? 'block' : 'none'
    })
  }

  function updateCards() {
    const p = localStorage.getItem('cakeai_provider')
    highlightCard(p)
    updateModelLabels()
  }

  document.addEventListener('click', e => {
    const picker = document.getElementById('modelPicker')
    if (!picker || picker.style.display === 'none') return
    if (picker.contains(e.target) || e.target.closest('.provider-gear')) return
    closeModelPicker()
  })

  return { open, close, switchTab, onBgClick, onKeyChange, applyKey, pickProvider, openModelPicker, closeModelPicker, updateProviderTag, updateCards, saveSystemPrompt, setBackground, setLanguage }
})()
window.Settings = Settings
