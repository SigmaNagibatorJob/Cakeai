const Files = (() => {
  let rootPath = null
  let folderStructure = []

  const ICONS = {
    '.lua': '🔶', '.luau': '🔶', '.py': '🐍', '.js': '📜', '.ts': '📘',
    '.json': '📋', '.html': '🌐', '.css': '🎨', '.md': '📝',
    '.txt': '📄', '.hx': '🎮', '.xml': '📰',
    '.png': '🖼', '.jpg': '🖼', '.gif': '🖼',
    '.ogg': '🎵', '.mp3': '🎵', '.wav': '🎵'
  }

  function getIcon(e) {
    if (e.isDir) return '📁'
    return ICONS[e.ext] || '📄'
  }

  function getRootPath() { return rootPath }

  function getFolderContext() {
    if (!rootPath) return null
    const name = rootPath.split(/[/\\]/).pop()
    const lines = [`Открытая папка проекта: ${name}`, 'Структура файлов:']
    folderStructure.forEach(e => {
      const indent = '  '.repeat(e.depth)
      lines.push(indent + (e.isDir ? '📁 ' : '📄 ') + e.name)
    })
    return lines.join('\n')
  }

  async function openFolder() {
    const p = await API.openFolder()
    if (!p) return
    await restoreFolder(p)
  }

  async function restoreFolder(p) {
    rootPath = p
    localStorage.setItem('cakeai_folder', p)
    document.getElementById('statusFolder').style.display = 'inline'
    document.getElementById('statusFolderName').textContent = p.split(/[/\\]/).pop()
    const btnNewFile = document.getElementById('btn-newfile')
    const btnNewFolder = document.getElementById('btn-newfolder')
    const btnRefresh = document.getElementById('btn-refresh')
    if (btnNewFile) btnNewFile.style.display = 'flex'
    if (btnNewFolder) btnNewFolder.style.display = 'flex'
    if (btnRefresh) btnRefresh.style.display = 'flex'
    folderStructure = []
    await collectStructure(rootPath, 0)
    await renderTree(rootPath, document.getElementById('fileTree'), 0)
  }

  async function collectStructure(dirPath, depth) {
    if (depth > 3) return
    const entries = await API.readDir(dirPath)
    if (!Array.isArray(entries)) return
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === '__pycache__') continue
      folderStructure.push({ name: e.name, isDir: e.isDir, depth, fullPath: e.path })
      if (e.isDir && depth < 2) await collectStructure(e.path, depth + 1)
    }
  }

  async function renderTree(dirPath, container, depth) {
    container.innerHTML = ''
    const entries = await API.readDir(dirPath)
    if (!Array.isArray(entries)) {
      container.innerHTML = `<div class="tree-empty">Ошибка: ${entries.error}</div>`
      return
    }

    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === '__pycache__') continue

      const row = document.createElement('div')
      row.className = 'tree-item'
      row.style.paddingLeft = (10 + depth * 14) + 'px'
      row.dataset.path = e.path
      row.dataset.isdir = e.isDir

      row.innerHTML = `
        <span class="tree-icon">${getIcon(e)}</span>
        <span class="tree-name">${e.name}</span>
        <span class="tree-actions">
          ${!e.isDir ? `<button class="edit" title="Открыть" onclick="event.stopPropagation();Files.openFile('${esc(e.path)}','${esc(e.name)}')">✎</button>` : ''}
          <button title="Удалить" onclick="event.stopPropagation();Files.deleteEntry('${esc(e.path)}','${esc(e.name)}')">✕</button>
        </span>`

      if (e.isDir) {
        let expanded = false
        let subContainer = null
        row.addEventListener('click', async () => {
          if (!expanded) {
            expanded = true
            row.querySelector('.tree-icon').textContent = '📂'
            subContainer = document.createElement('div')
            subContainer.dataset.sub = '1'
            row.insertAdjacentElement('afterend', subContainer)
            await renderTree(e.path, subContainer, depth + 1)
          } else {
            expanded = false
            row.querySelector('.tree-icon').textContent = '📁'
            if (subContainer) { subContainer.remove(); subContainer = null }
          }
        })
      } else {
        row.addEventListener('click', () => openFile(e.path, e.name))
      }

      container.appendChild(row)
    }
  }

  async function openFile(filePath, name) {
    const res = await API.readFile(filePath)
    if (res.error) { Status.set('Ошибка: ' + res.error, 'err'); return }
    Editor.load(filePath, name, res.content)
    Workspace.openFileTab(filePath, name)
    Chat.setFileCtx(name, res.content)
    document.getElementById('statusFile').style.display = 'inline'
    document.getElementById('statusFileName').textContent = name
    document.querySelectorAll('.tree-item').forEach(i => i.classList.remove('selected'))
    document.querySelectorAll(`.tree-item[data-path]`).forEach(i => {
      if (i.dataset.path === filePath) i.classList.add('selected')
    })
  }

  // ── КАСТОМНЫЕ МОДАЛКИ (вместо prompt() который не работает в Electron) ──

  function showPromptModal(title, placeholder) {
    return new Promise((resolve) => {
      // Удаляем существующую модалку если есть
      document.getElementById('promptModal')?.remove()

      const overlay = document.createElement('div')
      overlay.id = 'promptModal'
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:9999;'

      const box = document.createElement('div')
      box.style.cssText = 'width:340px;background:var(--bg1);border:1px solid var(--border);border-radius:10px;padding:20px;display:flex;flex-direction:column;gap:14px;'

      const label = document.createElement('div')
      label.textContent = title
      label.style.cssText = 'font-size:14px;font-weight:600;color:var(--t0);'

      const input = document.createElement('input')
      input.type = 'text'
      input.placeholder = placeholder
      input.style.cssText = 'background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:9px 12px;font-size:13px;outline:none;color:var(--t0);font-family:Consolas,monospace;width:100%;box-sizing:border-box;'
      input.addEventListener('focus', () => { input.style.borderColor = 'var(--accent)' })
      input.addEventListener('blur', () => { input.style.borderColor = 'var(--border)' })

      const btns = document.createElement('div')
      btns.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;'

      const cancelBtn = document.createElement('button')
      cancelBtn.textContent = 'Отмена'
      cancelBtn.style.cssText = 'padding:7px 16px;border-radius:6px;font-size:12px;background:var(--bg3);border:1px solid var(--border);color:var(--t2);cursor:pointer;'

      const okBtn = document.createElement('button')
      okBtn.textContent = 'Создать'
      okBtn.style.cssText = 'padding:7px 16px;border-radius:6px;font-size:12px;font-weight:700;background:var(--accent);color:#0d0f12;border:none;cursor:pointer;'

      const submit = () => {
        const val = input.value.trim()
        overlay.remove()
        resolve(val || null)
      }
      const cancel = () => {
        overlay.remove()
        resolve(null)
      }

      okBtn.onclick = submit
      cancelBtn.onclick = cancel
      overlay.onclick = (e) => { if (e.target === overlay) cancel() }

      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); submit() }
        if (e.key === 'Escape') { e.preventDefault(); cancel() }
      })

      btns.appendChild(cancelBtn)
      btns.appendChild(okBtn)
      box.appendChild(label)
      box.appendChild(input)
      box.appendChild(btns)
      overlay.appendChild(box)
      document.body.appendChild(overlay)

      // Фокус после добавления в DOM
      setTimeout(() => { input.focus() }, 10)
    })
  }

  async function newFile() {
    if (!rootPath) { Status.set('Сначала открой папку проекта', 'err'); return }
    const name = await showPromptModal('Имя файла (с расширением):', 'например: main.py')
    if (!name) return
    Status.set('Создаю файл...', 'busy')
    const res = await API.createFile(rootPath, name)
    if (res.error) { Status.set(res.error, 'err'); return }
    await refresh()
    openFile(res.path, name)
    Status.set('Файл создан: ' + name, 'ok')
    setTimeout(() => Status.set('Готов', 'ok'), 2000)
  }

  async function newFolder() {
    if (!rootPath) { Status.set('Сначала открой папку проекта', 'err'); return }
    const name = await showPromptModal('Имя папки:', 'например: src')
    if (!name) return
    Status.set('Создаю папку...', 'busy')
    const res = await API.createDir(rootPath, name)
    if (res.error) { Status.set(res.error, 'err'); return }
    await refresh()
    Status.set('Папка создана: ' + name, 'ok')
    setTimeout(() => Status.set('Готов', 'ok'), 2000)
  }

  async function deleteEntry(filePath, name) {
    if (!confirm(`Удалить "${name}"?`)) return
    const res = await API.deleteEntry(filePath)
    if (!res.ok) { Status.set('Ошибка: ' + res.error, 'err'); return }
    Workspace.closeFileTab(filePath)
    folderStructure = folderStructure.filter(e => e.fullPath !== filePath)
    await refresh()
    Status.set('Удалено: ' + name, 'ok')
    setTimeout(() => Status.set('Готов', 'ok'), 2000)
  }

  async function refresh() {
    if (rootPath) {
      folderStructure = []
      await collectStructure(rootPath, 0)
      await renderTree(rootPath, document.getElementById('fileTree'), 0)
    }
  }

  function esc(s) { return s.replace(/\\/g,'\\\\').replace(/'/g,"\\'") }

  function getAllFiles() {
    return folderStructure.filter(e => !e.isDir).map(e => ({
      name: e.name,
      path: e.fullPath
    })).filter(e => e.path)
  }

  return { openFolder, restoreFolder, openFile, newFile, newFolder, deleteEntry, refresh, getFolderContext, getRootPath, getAllFiles }
})()
window.Files = Files
