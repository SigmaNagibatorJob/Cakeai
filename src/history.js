const History = (() => {
  let allChats = []

  async function init() {
    const res = await API.historyLoad()
    if (res.error || !res.data) { renderSidebar(); return }
    const dec = await API.decrypt(res.data)
    if (dec.error) { renderSidebar(); return }
    try { allChats = JSON.parse(dec.data) } catch (e) { allChats = [] }
    renderSidebar()
  }

  // Если передан existingId и такой чат есть, он обновляется. Иначе создаётся новый.
  // Возвращает id чата.
  async function saveChat(messages, title, existingId) {
    if (!messages || !messages.length) return existingId || null

    const existing = existingId ? allChats.find(c => c.id === existingId) : null
    if (existing) {
      existing.messages = messages
      await persist()
      return existing.id
    }

    const id = Date.now().toString()
    const date = new Date().toLocaleDateString('ru', { day: '2-digit', month: '2-digit', year: 'numeric' })
    const label = title || (messages[0] && messages[0].content ? messages[0].content.slice(0, 40) : 'Чат')
    allChats.unshift({ id, title: label, date, messages })
    if (allChats.length > 50) allChats = allChats.slice(0, 50)
    await persist()
    renderSidebar()
    return id
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
    if (chat) Chat.loadHistory(chat.messages, chat.id)
  }

  function renderSidebar() {
    const list = document.getElementById('historyList')
    if (!list) return
    if (!allChats.length) {
      list.innerHTML = '<div class="hist-empty">' + (window.__lang === 'en' ? 'No saved chats' : 'Нет сохранённых чатов') + '</div>'
      return
    }
    list.innerHTML = allChats.map(c => `
      <div class="hist-item" onclick="History.loadChat('${escAttr(c.id)}')">
        <div class="hist-title">${esc(c.title)}</div>
        <div class="hist-meta">
          <span>${esc(c.date)}</span>
          <button class="hist-del" onclick="event.stopPropagation();History.deleteChat('${escAttr(c.id)}')" title="Удалить">✕</button>
        </div>
      </div>`).join('')
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  function escAttr(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  }

  function getAll() { return allChats }

  return { init, saveChat, deleteChat, loadChat, getAll }
})()
window.History = History
