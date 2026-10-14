const Terminal = (() => {
  const out = () => document.getElementById('terminalOutput')

  function log(text) {
    const el = out()
    if (!el) return
    el.textContent += text + '\n'
    el.scrollTop = el.scrollHeight
  }

  function clear() {
    const el = out()
    if (el) el.textContent = ''
  }

  function init() {
    const inp = document.getElementById('terminalInput')
    if (!inp) return
    inp.addEventListener('keydown', async e => {
      if (e.key !== 'Enter') return
      const cmd = inp.value.trim()
      if (!cmd) return
      inp.value = ''
      log('$ ' + cmd)
      if (!API.terminalRun) { log('(запуск команд пока не подключён)'); return }
      const res = await API.terminalRun({ command: cmd, cwd: Files.getRootPath?.() })
      log(res.output || res.error || '')
    })
  }

  return { log, clear, init }
})()
window.Terminal = Terminal