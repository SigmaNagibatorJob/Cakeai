const Files = (() => {
  let rootPath = null
  let folderStructure = [] // flat list of all visible files/folders

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
    rootPath = p
    localStorage.setItem('cakeai_folder', p)
    document.getElementById('statusFolder').style.display = 'inline'
    document.getElementById('statusFolderName').textContent = p.split(/[/\\]/).pop()
    document.getElementById('btn-newfile').style.display   = 'flex'
    document.getElementById('btn-newfolder').style.display = 'flex'
    document.getElementById('btn-refresh').style.display   = 'flex'
    folderStructure = []
    await collectStructure(rootPath, 0)
    await renderTree(rootPath, document.getElementById('fileTree'), 0)
  }

  async function collectStructure(dirPath, depth) {
    if (depth > 3) return // не уходим глубже 3 уровней
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

  async function newFile() {
    if (!rootPath) return
    const name = prompt('Имя файла (с расширением):')
    if (!name) return
    const res = await API.createFile(rootPath, name)
    if (res.error) { Status.set(res.error, 'err'); return }
    await refresh()
    openFile(res.path, name)
  }

  async function newFolder() {
    if (!rootPath) return
    const name = prompt('Имя папки:')
    if (!name) return
    const res = await API.createDir(rootPath, name)
    if (res.error) { Status.set(res.error, 'err'); return }
    folderStructure = []
    await collectStructure(rootPath, 0)
    await refresh()
  }

  async function deleteEntry(filePath, name) {
    if (!confirm(`Удалить "${name}"?`)) return
    const res = await API.deleteEntry(filePath)
    if (!res.ok) { Status.set('Ошибка: ' + res.error, 'err'); return }
    Workspace.closeFileTab(filePath)
    folderStructure = folderStructure.filter(e => e.name !== name)
    await refresh()
    Status.set('Удалено: ' + name, 'ok')
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

  return { openFolder, openFile, newFile, newFolder, deleteEntry, refresh, getFolderContext, getRootPath, getAllFiles }
})()
window.Files = Files
