const Editor = (() => {
  let filePath = null
  let originalContent = null
  let dirty = false

  function load(path, name, content) {
    filePath = path
    originalContent = content
    dirty = false

    const ed = document.getElementById('codeEditor')
    ed.value = content

    document.getElementById('editorFileName').textContent = name
    document.getElementById('saveBtn').textContent = '💾 Сохранить'
    document.getElementById('editorPanel').style.display = 'flex'
  }

  function markDirty() {
    if (!dirty) {
      dirty = true
      document.getElementById('saveBtn').textContent = '💾 Сохранить *'
    }
  }

  async function save() {
    if (!filePath) return
    const content = document.getElementById('codeEditor').value
    const res = await API.writeFile(filePath, content)
    if (res.ok) {
      dirty = false
      originalContent = content
      document.getElementById('saveBtn').textContent = '💾 Сохранить'
      Status.set('Сохранено', 'ok')
    } else {
      Status.set('Ошибка сохранения: ' + res.error, 'err')
    }
  }

  function discard() {
    if (!originalContent) return
    document.getElementById('codeEditor').value = originalContent
    dirty = false
    document.getElementById('saveBtn').textContent = '💾 Сохранить'
  }

  function getContent() {
    return document.getElementById('codeEditor').value
  }

  function getPath() { return filePath }

  // Keyboard shortcuts
  document.addEventListener('DOMContentLoaded', () => {
    const ed = document.getElementById('codeEditor')
    ed.addEventListener('keydown', e => {
      if (e.ctrlKey && e.key === 's') { e.preventDefault(); save(); return }
      if (e.key === 'Tab') {
        e.preventDefault()
        const s = ed.selectionStart
        ed.value = ed.value.slice(0, s) + '  ' + ed.value.slice(ed.selectionEnd)
        ed.selectionStart = ed.selectionEnd = s + 2
      }
    })
    ed.addEventListener('input', () => markDirty())
  })

  return { load, save, discard, getContent, getPath }
})()
window.Editor = Editor
