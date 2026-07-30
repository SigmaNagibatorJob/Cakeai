// ── Status helper ────────────────────────────────────────────────────────────
const Status = {
  set(text, state) {
    document.getElementById('statusText').textContent = text
    const dot = document.getElementById('statusDot')
    dot.className = 'status-dot'
    if (state === 'busy') dot.classList.add('busy')
    if (state === 'err')  dot.classList.add('err')
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // restore saved background / RGB (применяем на ВСЁ приложение)
  const savedBg = localStorage.getItem('cakeai_bg') || '#0d0f12'
  if (typeof Settings !== 'undefined' && Settings.applyBackground) {
    Settings.applyBackground(savedBg)
  } else {
    document.documentElement.style.setProperty('--bg0', savedBg)
  }

  // Применяем сохранённый язык
  const savedLang = localStorage.getItem('cakeai_lang') || 'ru'
  if (typeof Settings !== 'undefined' && Settings.applyLanguage) {
    Settings.applyLanguage(savedLang)
  }

  // restore saved key/provider
  const key  = localStorage.getItem('cakeai_key')
  const prov = localStorage.getItem('cakeai_provider')
  if (key) {
    const detected = prov || await API.detectProvider(key)
    Settings.updateProviderTag(detected)
  }

  // init history
  await History.init()

  // init terminal
  Terminal.init()

  // BUGFIX: восстанавливаем сохранённую папку без диалога
  const savedFolder = localStorage.getItem('cakeai_folder')
  if (savedFolder) {
    Files.restoreFolder(savedFolder)
  }

  // BUGFIX: восстанавливаем состояние чипов DeepThink / Search
  Chat.restoreChips()

  // Применяем язык интерфейса
  if (typeof Settings !== 'undefined' && Settings.initLanguage) {
    Settings.initLanguage()
  } else if (typeof Settings !== 'undefined' && Settings.applyLanguage) {
    const savedLang = localStorage.getItem('cakeai_lang') || 'ru'
    Settings.applyLanguage(savedLang)
  }

  // chat input auto-resize
  const inp = document.getElementById('chatInput')
  inp.addEventListener('input', function() {
    this.style.height = 'auto'
    this.style.height = Math.min(this.scrollHeight, 140) + 'px'
  })
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      Chat.send()
    }
  })
})
