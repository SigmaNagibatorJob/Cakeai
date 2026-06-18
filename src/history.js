const History = (() => {
  let allChats = []

  async function init() {
    const res = await API.historyLoad()
    if (res.error || !res.data) { renderSidebar(); return }
    const dec = await API.decrypt(res.data)
    if (dec.error) { renderSidebar(); return }
    try { allChats = JSON.parse(dec.data) } catch(e) { allChats = [] }
    renderSidebar()
  }

  async function generateTitle(messages) {
    try {
      const key  = localStorage.getItem('cakeai_key')
      const prov = localStorage.getItem('cakeai_provider') || null
      if (!key) throw 'no key'
      const snippet = messages.slice(0, 3).map(m => `${m.role === 'user' ? 'Юзер' : 'AI'}: ${m.content.slice(0, 200)}`).join('\n')
      const res = await API.aiSend({
        msgs: [{ role: 'user', content: `Придумай короткое название (3-6 слов) для этого диалога. Только название, без кавычек и пояснений.\n\n${snippet}` }],
        mode: 'general',
        key,
        provider: prov
      })
      return res.text?.trim().slice(0, 50) || null
    } catch(e) { return null }
  }

  async function saveChat(messages, title) {
    if (!messages.length) return
    const id   = Date.now().toString()
    const date = new Date().toLocaleDateString('ru', { day:'2-digit', month:'2-digit', year:'numeric' })
    const tempLabel = messages[0]?.content?.slice(0, 40) || 'Чат'
    allChats.unshift({ id, title: tempLabel, date, messages })
    if (allChats.length > 50) allChats = allChats.slice(0, 50)
    await persist()
    renderSidebar()
    const aiTitle = title || await generateTitle(messages)
    if (aiTitle) {
      const chat = allChats.find(c => c.id === id)
      if (chat) { chat.title = aiTitle; await persist(); renderSidebar() }
    }
  }

  async function persist() {
    const enc = await API.encrypt(JSON.stringify(allChats))
    if (enc.error) { Status.set('Ошибка сохранения', 'err'); return }
    await API.historySave(enc.data)
  }

  async function deleteChat(id) {
    allChats = allChats.filter(c => c.id !== id)
    await persist()
    renderSidebar()
  }

  function loadChat(id) {
    const chat = allChats.find(c => c.id === id)
    if (chat) Chat.loadHistory(chat.messages)
  }

  function renderSidebar() {
    const list = document.getElementById('historyList')
    if (!list) return
    if (!allChats.length) {
      list.innerHTML = '<div class="hist-empty">Нет сохранённых чатов</div>'
      return
    }
    list.innerHTML = allChats.map(c => `
      <div class="hist-item" onclick="History.loadChat('${c.id}')">
        <div class="hist-title">${esc(c.title)}</div>
        <div class="hist-meta">
          <span>${c.date}</span>
          <button class="hist-del" onclick="event.stopPropagation();History.deleteChat('${c.id}')" title="Удалить">✕</button>
        </div>
      </div>`).join('')
  }

  function esc(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  }

  function getAll() { return allChats }

  return { init, saveChat, deleteChat, loadChat, getAll }
})()
window.History = History
