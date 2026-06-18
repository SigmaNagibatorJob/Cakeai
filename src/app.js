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
  // restore saved key/provider
  const key  = localStorage.getItem('cakeai_key')
  const prov = localStorage.getItem('cakeai_provider')
  if (key) {
    const detected = prov || await API.detectProvider(key)
    Settings.updateProviderTag(detected)
  }

  // init history
  await History.init()

  // restore last folder
  const savedFolder = localStorage.getItem('cakeai_folder')
  if (savedFolder) Files.openFolder()  // will re-prompt, or you can call internal

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
