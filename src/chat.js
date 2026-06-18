const Chat = (() => {
  let messages = []
  let loading = false
  let fileCtxContent = null
  let fileCtxName = null

  function showEasterEgg() {
    document.getElementById('easterEggOverlay')?.remove()

    const overlay = document.createElement('div')
    overlay.id = 'easterEggOverlay'
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 9999;
      background: #000;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      cursor: pointer;
    `

    const video = document.createElement('video')
    video.src = window.API?.getAssetPath ? window.API.getAssetPath('0xteam.mp4') : './assets/0xteam.mp4'
    video.autoplay = true
    video.loop = true
    video.style.cssText = 'max-width: 100%; max-height: 90vh; border-radius: 8px;'
    video.volume = 0.8

    const hint = document.createElement('div')
    hint.textContent = 'Нажми в любом месте чтобы закрыть'
    hint.style.cssText = 'color: #555; font-size: 12px; margin-top: 12px; font-family: monospace;'

    overlay.appendChild(video)
    overlay.appendChild(hint)
    document.body.appendChild(overlay)

    overlay.addEventListener('click', () => overlay.remove())
  }

  let thinkEnabled = false
  let webSearchEnabled = false

  function toggleThink() {
    thinkEnabled = !thinkEnabled;
    document.getElementById('chipThink').classList.toggle('active', thinkEnabled);
    if (thinkEnabled) {
      if (!confirm('Внимание: глубокое размышление потребляет много токенов. Продолжить?')) {
        thinkEnabled = false;
        document.getElementById('chipThink').classList.remove('active');
        return;
      }
      localStorage.setItem('cakeai_deepthink', '1');
      Status.set('DeepThink включён (все провайдеры)', 'ok');
    } else {
      localStorage.removeItem('cakeai_deepthink');
      Status.set('DeepThink выключен', 'ok');
    }
    setTimeout(() => Status.set('Готов', 'ok'), 2000);
  }

  function toggleWebSearch() {
    webSearchEnabled = !webSearchEnabled
    document.getElementById('chipSearch').classList.toggle('active', webSearchEnabled)
    Status.set(webSearchEnabled ? 'Поиск включён' : 'Поиск выключен', 'ok')
    setTimeout(() => Status.set('Готов', 'ok'), 2000)
  }

  function setFileCtx(name, content) {
    fileCtxContent = content
    fileCtxName = name
    document.getElementById('filePillName').textContent = name
    document.getElementById('filePill').style.display = 'flex'
  }

  function clearFileCtx() {
    fileCtxContent = null
    fileCtxName = null
    document.getElementById('filePill').style.display = 'none'
  }

  function newChat() {
    messages = []
    const container = document.getElementById('chatMessages')
    container.innerHTML = `
      <div class="welcome" id="welcomeScreen">
        <div class="welcome-logo">Cake<em>AI</em></div>
        <div class="welcome-sub">Новый чат. Задай вопрос.</div>
      </div>`
    Workspace.showChat()
  }

  function quick(text) {
    document.getElementById('chatInput').value = text
    send()
  }

  function askAboutFile() {
    Workspace.showChat()
    const inp = document.getElementById('chatInput')
    inp.focus()
    inp.placeholder = `Спроси про ${fileCtxName || 'файл'}...`
  }

  async function buildContext(userText) {
    const parts = []

    const folderCtx = Files.getFolderContext?.()
    if (folderCtx) parts.push(folderCtx)

    if (fileCtxContent && fileCtxName) {
      parts.push(`Открытый файл: ${fileCtxName}\n\`\`\`\n${fileCtxContent.slice(0, 8000)}\n\`\`\``)
    }

    const rootPath = Files.getRootPath?.()
    if (rootPath && userText) {
      const folderFiles = Files.getAllFiles?.() || []
      for (const f of folderFiles) {
        if (userText.toLowerCase().includes(f.name.toLowerCase()) && f.name !== fileCtxName) {
          const res = await API.readFile(f.path)
          if (!res.error) {
            parts.push(`Файл ${f.name}:\n\`\`\`\n${res.content.slice(0, 6000)}\n\`\`\``)
          }
        }
      }
    }

    return parts.length ? parts.join('\n\n') : null
  }

  function appendMsg(role, text) {
    document.getElementById('welcomeScreen')?.remove()

    const container = document.getElementById('chatMessages')
    const div = document.createElement('div')
    div.className = 'msg ' + role

    const avatar = role === 'user' ? 'Я' : 'AI'
    const label  = role === 'user' ? 'Вы' : 'Lungskull'

    div.innerHTML = `
      <div class="msg-avatar">${avatar}</div>
      <div class="msg-body">
        <div class="msg-role">${label}</div>
        <div class="bubble">${formatText(text)}</div>
      </div>`

    div.querySelectorAll('pre').forEach(pre => {
      const cp = document.createElement('button')
      cp.className = 'cpy-btn'
      cp.textContent = 'copy'
      cp.onclick = () => {
        const code = pre.querySelector('code')?.textContent || pre.textContent
        navigator.clipboard.writeText(code)
        cp.textContent = '✓ ok'
        setTimeout(() => cp.textContent = 'copy', 1500)
      }
      pre.appendChild(cp)

      if (Editor.getPath()) {
        const eb = document.createElement('button')
        eb.className = 'editor-btn'
        eb.textContent = '→ редактор'
        eb.onclick = () => {
          const code = pre.querySelector('code')?.textContent || pre.textContent
          document.getElementById('codeEditor').value = code
          Editor.markDirty?.()
          Workspace.showFileTab(Editor.getPath())
        }
        pre.appendChild(eb)
      }
    })

    container.appendChild(div)
    container.scrollTop = container.scrollHeight
  }

  function showTyping() {
    document.getElementById('welcomeScreen')?.remove()
    const container = document.getElementById('chatMessages')
    const d = document.createElement('div')
    d.className = 'msg ai'; d.id = 'typing-msg'
    d.innerHTML = `
      <div class="msg-avatar">AI</div>
      <div class="msg-body">
        <div class="msg-role">Lungskull</div>
        <div class="typing-bubble"><span class="td"></span><span class="td"></span><span class="td"></span></div>
      </div>`
    container.appendChild(d)
    container.scrollTop = container.scrollHeight
  }

  function hideTyping() {
    document.getElementById('typing-msg')?.remove()
  }

  function formatText(t) {
    t = t.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
      `<pre><code class="lang-${lang}">${esc(code.trim())}</code></pre>`)
    t = t.replace(/`([^`\n]+)`/g, '<code>$1</code>')
    t = t.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    t = t.replace(/\n/g, '<br>')
    return t
  }

  function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }

  async function send() {
    if (loading) return

    const inp = document.getElementById('chatInput')
    const text = inp.value.trim()
    if (!text) return

    if (text.toLowerCase() === '0xteam') {
      inp.value = ''
      showEasterEgg()
      return
    }

    const key = localStorage.getItem('cakeai_key')
    if (!key) { Settings.open(); return }

    inp.value = ''
    inp.style.height = 'auto'
    inp.placeholder = 'Спроси что угодно...'
    loading = true
    document.getElementById('sendBtn').disabled = true
    Status.set('Думаю...', 'busy')
    Workspace.showChat()

    messages.push({ role: 'user', content: text })
    appendMsg('user', text)
    showTyping()

    const prov = localStorage.getItem('cakeai_provider') || null
    const model = prov ? (localStorage.getItem('cakeai_model_' + prov) || null) : null
    const fileCtx = await buildContext(text)

    let streamBubble = null
    let streamText = ''

    API.offStream()

    API.onStreamChunk(chunk => {
      if (!streamBubble) {
        hideTyping()
        document.getElementById('welcomeScreen')?.remove()
        const container = document.getElementById('chatMessages')
        const div = document.createElement('div')
        div.className = 'msg ai'
        div.innerHTML = `
          <div class="msg-avatar">AI</div>
          <div class="msg-body">
            <div class="msg-role">Lungskull</div>
            <div class="bubble stream-bubble"></div>
          </div>`
        container.appendChild(div)
        streamBubble = div.querySelector('.stream-bubble')
      }
      streamText += chunk
      streamBubble.innerHTML = formatText(streamText)
      const container = document.getElementById('chatMessages')
      container.scrollTop = container.scrollHeight
    })

    API.onStreamDone(async err => {
      API.offStream()
      hideTyping()

      if (err) {
        if (!streamBubble) appendMsg('ai', '⚠️ Ошибка: ' + err)
        else streamBubble.innerHTML = formatText('⚠️ Ошибка: ' + err)
        Status.set('Ошибка', 'err')
      } else {
        if (streamBubble) {
          const parent = streamBubble.closest('.msg')
          parent.querySelectorAll('pre').forEach(pre => {
            if (pre.querySelector('.cpy-btn')) return
            const cp = document.createElement('button')
            cp.className = 'cpy-btn'; cp.textContent = 'copy'
            cp.onclick = () => {
              navigator.clipboard.writeText(pre.querySelector('code')?.textContent || pre.textContent)
              cp.textContent = '✓ ok'; setTimeout(() => cp.textContent = 'copy', 1500)
            }
            pre.appendChild(cp)
            if (Editor.getPath()) {
              const eb = document.createElement('button')
              eb.className = 'editor-btn'; eb.textContent = '→ редактор'
              eb.onclick = () => {
                document.getElementById('codeEditor').value = pre.querySelector('code')?.textContent || pre.textContent
                Editor.markDirty?.(); Workspace.showFileTab(Editor.getPath())
              }
              pre.appendChild(eb)
            }
          })
        }
        messages.push({ role: 'assistant', content: streamText })

        const lang = streamText.match(/```(\w+)/)?.[1]?.toLowerCase()
        const code = streamText.match(/```(?:\w+)?\n?([\s\S]*?)```/)?.[1]?.trim()
        const runnable = ['python','python3','js','javascript','node']
        if (lang && code && runnable.includes(lang)) {
          Status.set('Проверяю код...', 'busy')
          const key = localStorage.getItem('cakeai_key')
          const prov = localStorage.getItem('cakeai_provider') || null
          const model = prov ? (localStorage.getItem('cakeai_model_' + prov) || null) : null
          const res = await API.aiRunCheck({ code, lang, msgs: messages.slice(0,-1), key, provider: prov, model })
          if (!res.skipped && res.ok && res.code !== code) {
            const fixed = streamText.replace(/```(?:\w+)?\n?[\s\S]*?```/, '```' + lang + '\n' + res.code + '\n```')
            streamText = fixed
            messages[messages.length-1].content = fixed
            if (streamBubble) streamBubble.innerHTML = formatText(fixed)
          } else if (!res.skipped && !res.ok) {
            if (streamBubble) {
              const warn = document.createElement('div')
              warn.className = 'code-warn'
              warn.textContent = '⚠️ Код может не работать: ' + (res.error || '').slice(0, 120)
              streamBubble.appendChild(warn)
            }
          }
        }

        Status.set('Готов', 'ok')
      }

      loading = false
      document.getElementById('sendBtn').disabled = false
    })

    try {
      const customPrompt = localStorage.getItem('cakeai_systemprompt') || ''
      const deepthinkEnabled = localStorage.getItem('cakeai_deepthink') === '1';
      const webSearchEnabled = localStorage.getItem('cakeai_websearch') === '1'; // или ваша переменная
      await API.aiStream({
        msgs: messages.map(m => ({ role: m.role, content: m.content })),
        mode: 'general',
        key,
        provider: prov,
        model,
        fileCtx,
        customPrompt: customPrompt || undefined,
        deepthinkEnabled: deepthinkEnabled,
        webSearch: webSearchEnabled
      })
    } catch(e) {
      API.offStream()
      hideTyping()
      appendMsg('ai', '⚠️ Ошибка: ' + e)
      Status.set('Ошибка', 'err')
      loading = false
      document.getElementById('sendBtn').disabled = false
    }
  }

  async function saveCurrentChat() {
    if (!messages.length) { Status.set('Нечего сохранять', 'ok'); return }
    await History.saveChat(messages, messages[0]?.content?.slice(0, 40))
    Status.set('Чат сохранён 🔐', 'ok')
  }

  function loadHistory(msgs) {
    messages = [...msgs]
    const container = document.getElementById('chatMessages')
    container.innerHTML = ''
    messages.forEach(m => appendMsg(m.role === 'assistant' ? 'ai' : m.role, m.content))
    Workspace.showChat()
  }

  return { setFileCtx, clearFileCtx, newChat, quick, askAboutFile, send, saveCurrentChat, loadHistory, toggleThink, toggleWebSearch }
})()
window.Chat = Chat