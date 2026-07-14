const Workspace = (() => {
  let openTabs = [] // { path, name }

  function showChat() {
    document.getElementById('chatPanel').style.display   = 'flex'
    document.getElementById('editorPanel').style.display = 'none'
    document.querySelectorAll('.tab').forEach(t => {
      t.classList.toggle('active', t.id === 'tab-chat')
    })
  }

  function showFileTab(path) {
    document.getElementById('chatPanel').style.display   = 'none'
    document.getElementById('editorPanel').style.display = 'flex'
    document.querySelectorAll('.tab').forEach(t => {
      t.classList.toggle('active', t.dataset.path === path)
    })
  }

  function openFileTab(path, name) {
    if (!openTabs.find(t => t.path === path)) {
      openTabs.push({ path, name })
      renderTabs()
    }
    showFileTab(path)
  }

  function closeFileTab(path) {
    openTabs = openTabs.filter(t => t.path !== path)
    renderTabs()
    showChat()
  }

  function renderTabs() {
    const bar = document.getElementById('tabbar')
    // keep chat tab
    bar.innerHTML = `<div class="tab active" id="tab-chat" onclick="Workspace.showChat()">💬 Чат</div>`
    openTabs.forEach(t => {
      const div = document.createElement('div')
      div.className = 'tab'
      div.dataset.path = t.path
      // BUGFIX: экранируем путь для onclick
      div.innerHTML = `📄 ${esc(t.name)} <button class="tab-close" onclick="event.stopPropagation();Workspace.closeFileTab('${escAttr(t.path)}')">✕</button>`
      div.addEventListener('click', () => {
        Files.openFile(t.path, t.name)
      })
      bar.appendChild(div)
    })
  }

  function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }
  function escAttr(s) { return s.replace(/\\/g,'\\\\').replace(/'/g,"\\'") }

  return { showChat, showFileTab, openFileTab, closeFileTab }
})()
window.Workspace = Workspace
