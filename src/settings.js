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
    // FIX: убран мёртвый код с несуществующим #deepseekThinkingToggle
    updateCards()
    document.getElementById('settingsModal').style.display = 'flex'
  }

  function saveSystemPrompt(val) {
    if (val.trim()) localStorage.setItem('cakeai_systemprompt', val.trim())
    else localStorage.removeItem('cakeai_systemprompt')
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
    if (!val) return
    const p = await API.detectProvider(val)
    if (p && p !== 'unknown') {
      const el = document.getElementById('keyDetected')
      el.textContent = `✓ Определён: ${NAMES[p] || p}`
      el.style.display = 'block'
      highlightCard(p)
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

  // FIX: убрана мёртвая функция setDeepseekThinking (UI-элемента нет в DOM)

  return { open, close, onBgClick, onKeyChange, applyKey, pickProvider, openModelPicker, closeModelPicker, updateProviderTag, updateCards, saveSystemPrompt }
})()
window.Settings = Settings
