'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { Client } = require('@modelcontextprotocol/sdk/client/index.js')
const { StdioClientTransport, getDefaultEnvironment } = require('@modelcontextprotocol/sdk/client/stdio.js')
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js')
const { SSEClientTransport } = require('@modelcontextprotocol/sdk/client/sse.js')

const MAX_SERVERS = 12
const MAX_TOOLS = 96
const CONNECT_TIMEOUT_MS = 20_000
const TOOL_TIMEOUT_MS = 120_000
const MAX_TOOL_RESULT_CHARS = 100_000

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseConfig(input) {
  if (typeof input !== 'string') return input
  try {
    return JSON.parse(input)
  } catch (error) {
    throw new Error('Некорректный JSON: ' + error.message)
  }
}

function stringMap(value, field, serverName) {
  if (value == null) return {}
  if (!isRecord(value)) throw new Error(`MCP «${serverName}»: ${field} должен быть объектом`)
  const out = {}
  for (const [key, item] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) {
      throw new Error(`MCP «${serverName}»: недопустимое имя ${field}.${key}`)
    }
    if (typeof item !== 'string') {
      throw new Error(`MCP «${serverName}»: ${field}.${key} должен быть строкой`)
    }
    out[String(key)] = item
  }
  return out
}

function normalizeMcpConfig(input) {
  const parsed = parseConfig(input)
  if (!isRecord(parsed)) throw new Error('MCP-конфигурация должна быть JSON-объектом')

  const rawServers = parsed.mcpServers == null ? {} : parsed.mcpServers
  if (!isRecord(rawServers)) throw new Error('Поле mcpServers должно быть объектом')
  const entries = Object.entries(rawServers)
  if (entries.length > MAX_SERVERS) throw new Error(`Можно подключить не больше ${MAX_SERVERS} MCP-серверов`)

  const mcpServers = {}
  for (const [rawName, raw] of entries) {
    const name = String(rawName).trim()
    if (!name) throw new Error('Имя MCP-сервера не может быть пустым')
    if (['__proto__', 'prototype', 'constructor'].includes(name)) throw new Error(`Недопустимое имя MCP-сервера: ${name}`)
    if (Object.prototype.hasOwnProperty.call(mcpServers, name)) throw new Error(`Повторяющееся имя MCP-сервера: ${name}`)
    if (name.length > 80) throw new Error(`Слишком длинное имя MCP-сервера: ${name}`)
    if (!isRecord(raw)) throw new Error(`MCP «${name}»: настройки должны быть объектом`)

    const enabled = raw.enabled !== false && raw.disabled !== true
    if (typeof raw.command === 'string' && raw.command.trim()) {
      const args = raw.args == null ? [] : raw.args
      if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string')) {
        throw new Error(`MCP «${name}»: args должен быть массивом строк`)
      }
      if (args.length > 100) throw new Error(`MCP «${name}»: слишком много аргументов`)
      if (raw.cwd != null && typeof raw.cwd !== 'string') {
        throw new Error(`MCP «${name}»: cwd должен быть строкой`)
      }
      mcpServers[name] = {
        enabled,
        transport: 'stdio',
        command: raw.command.trim(),
        args: args.slice(),
        env: stringMap(raw.env, 'env', name),
        ...(raw.cwd ? { cwd: raw.cwd } : {})
      }
      continue
    }

    if (typeof raw.url === 'string' && raw.url.trim()) {
      let url
      try { url = new URL(raw.url.trim()) } catch (_) { throw new Error(`MCP «${name}»: неверный URL`) }
      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error(`MCP «${name}»: поддерживаются только http/https URL`)
      }
      const requestedTransport = String(raw.transport || raw.type || '').toLowerCase()
      mcpServers[name] = {
        enabled,
        transport: requestedTransport === 'sse' ? 'sse' : 'http',
        url: url.toString(),
        headers: stringMap(raw.headers, 'headers', name)
      }
      continue
    }

    throw new Error(`MCP «${name}»: укажите command (stdio) или url (Streamable HTTP)`)
  }

  return {
    version: 1,
    enabled: parsed.enabled === true,
    mcpServers
  }
}

function resolveTemplate(value, secrets) {
  return String(value).replace(/\$\{(?:env:)?([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => {
    if (Object.prototype.hasOwnProperty.call(secrets || {}, name)) return String(secrets[name] || '')
    return String(process.env[name] || '')
  })
}

function resolveServerConfig(config, secrets) {
  if (config.transport === 'stdio') {
    const env = { ...getDefaultEnvironment() }
    for (const [key, value] of Object.entries(config.env || {})) {
      env[key] = resolveTemplate(value, secrets)
    }
    return {
      ...config,
      command: resolveTemplate(config.command, secrets),
      args: config.args.map(arg => resolveTemplate(arg, secrets)),
      env,
      ...(config.cwd ? { cwd: resolveTemplate(config.cwd, secrets) } : {})
    }
  }
  const headers = {}
  for (const [key, value] of Object.entries(config.headers || {})) {
    headers[key] = resolveTemplate(value, secrets)
  }
  return { ...config, url: resolveTemplate(config.url, secrets), headers }
}

function hash(value, length = 16) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, length)
}

function publicToolName(serverName, toolName) {
  const clean = value => String(value).replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'tool'
  const server = clean(serverName).slice(0, 16)
  const tool = clean(toolName).slice(0, 30)
  return `mcp_${server}_${tool}_${hash(serverName + '\0' + toolName, 8)}`.slice(0, 64)
}

function withTimeout(promise, timeoutMs, label) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label + ': таймаут')), timeoutMs)
    })
  ]).finally(() => clearTimeout(timer))
}

function contentBlockToText(block) {
  if (!isRecord(block)) return String(block == null ? '' : block)
  if (block.type === 'text') return String(block.text || '')
  if (block.type === 'resource_link') return `[Ресурс: ${block.name || block.uri || ''}]`
  if (block.type === 'resource') {
    const resource = block.resource || {}
    if (typeof resource.text === 'string') return resource.text
    return `[Ресурс: ${resource.uri || ''}]`
  }
  if (block.type === 'image' || block.type === 'audio') {
    return `[${block.type}: ${block.mimeType || 'binary'}]`
  }
  try { return JSON.stringify(block) } catch (_) { return String(block) }
}

function formatToolResult(result) {
  const parts = []
  if (result && Array.isArray(result.content)) {
    for (const block of result.content) {
      const text = contentBlockToText(block)
      if (text) parts.push(text)
    }
  }
  if (result && result.structuredContent != null) {
    try { parts.push(JSON.stringify(result.structuredContent)) } catch (_) {}
  }
  let text = parts.join('\n') || '(MCP-инструмент не вернул текст)'
  if (text.length > MAX_TOOL_RESULT_CHARS) {
    text = text.slice(0, MAX_TOOL_RESULT_CHARS) + '\n…[результат MCP обрезан]'
  }
  return { text, isError: Boolean(result && result.isError) }
}

function redactError(error, secrets) {
  let text = error instanceof Error ? error.message : String(error)
  for (const secret of Object.values(secrets || {})) {
    if (secret && String(secret).length >= 6) text = text.split(String(secret)).join('***')
  }
  return text.slice(0, 1000)
}

class MCPManager {
  constructor(configPath) {
    this.configPath = configPath
    this.connections = new Map()
    this.toolMap = new Map()
  }

  loadConfig() {
    if (!this.configPath || !fs.existsSync(this.configPath)) {
      return normalizeMcpConfig({ enabled: false, mcpServers: {} })
    }
    try {
      return normalizeMcpConfig(fs.readFileSync(this.configPath, 'utf8'))
    } catch (error) {
      return {
        ...normalizeMcpConfig({ enabled: false, mcpServers: {} }),
        loadError: error.message
      }
    }
  }

  async saveConfig(input) {
    const config = normalizeMcpConfig(input)
    if (!this.configPath) throw new Error('Путь MCP-конфигурации не задан')
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true })
    const temp = this.configPath + '.tmp'
    fs.writeFileSync(temp, JSON.stringify(config, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
    try { fs.chmodSync(temp, 0o600) } catch (_) {}
    try {
      fs.renameSync(temp, this.configPath)
    } catch (error) {
      // На Windows rename не всегда заменяет существующий файл.
      if (!['EEXIST', 'EPERM'].includes(error.code) || !fs.existsSync(this.configPath)) throw error
      fs.rmSync(this.configPath, { force: true })
      fs.renameSync(temp, this.configPath)
    }
    await this.closeAll()
    return config
  }

  async createTransport(config) {
    if (config.transport === 'stdio') {
      return new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: config.env,
        cwd: config.cwd,
        stderr: 'pipe'
      })
    }

    const requestInit = { headers: config.headers }
    if (config.transport === 'sse') {
      const headers = config.headers
      return new SSEClientTransport(new URL(config.url), {
        requestInit,
        eventSourceInit: {
          fetch: (url, init) => fetch(url, {
            ...init,
            headers: { ...(init && init.headers ? Object.fromEntries(new Headers(init.headers)) : {}), ...headers }
          })
        }
      })
    }
    return new StreamableHTTPClientTransport(new URL(config.url), { requestInit })
  }

  async connectServer(name, rawConfig, secrets) {
    const resolved = resolveServerConfig(rawConfig, secrets)
    const fingerprint = hash(JSON.stringify(resolved), 32)
    const current = this.connections.get(name)
    if (current && current.fingerprint === fingerprint) return current
    if (current) await this.closeConnection(name)

    const transport = await this.createTransport(resolved)
    let stderr = ''
    if (transport.stderr) {
      transport.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-4000) })
    }
    const client = new Client({ name: 'cakeai', version: '2.0.0' }, { capabilities: {} })
    try {
      await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, `MCP «${name}»`)
      const connection = { name, client, transport, fingerprint, stderr, tools: [] }
      this.connections.set(name, connection)
      return connection
    } catch (error) {
      try { await transport.close() } catch (_) {}
      const suffix = stderr.trim() ? ': ' + stderr.trim().slice(-500) : ''
      const redactions = { ...(secrets || {}) }
      for (const [key, value] of Object.entries(resolved.env || resolved.headers || {})) {
        if (/key|token|secret|password|authorization/i.test(key)) redactions[key] = value
      }
      const message = (error instanceof Error ? error.message : String(error)) + suffix
      throw new Error(redactError(message, redactions))
    }
  }

  async closeConnection(name) {
    const connection = this.connections.get(name)
    this.connections.delete(name)
    if (!connection) return
    try { await connection.client.close() } catch (_) {
      try { await connection.transport.close() } catch (_) {}
    }
  }

  async closeAll() {
    const names = [...this.connections.keys()]
    await Promise.allSettled(names.map(name => this.closeConnection(name)))
    this.toolMap.clear()
  }

  async listServerTools(connection) {
    const tools = []
    let cursor
    for (let page = 0; page < 10; page++) {
      const result = await connection.client.listTools(cursor ? { cursor } : undefined)
      tools.push(...(result.tools || []))
      cursor = result.nextCursor
      if (!cursor || tools.length >= MAX_TOOLS) break
    }
    return tools.slice(0, MAX_TOOLS)
  }

  async getTools(secrets = {}) {
    const config = this.loadConfig()
    this.toolMap.clear()
    if (!config.enabled) {
      await this.closeAll()
      return { enabled: false, tools: [], servers: [], error: config.loadError || null }
    }

    const activeNames = new Set(Object.entries(config.mcpServers).filter(([, item]) => item.enabled).map(([name]) => name))
    await Promise.allSettled([...this.connections.keys()]
      .filter(name => !activeNames.has(name))
      .map(name => this.closeConnection(name)))

    const servers = []
    const tools = []
    for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
      if (!serverConfig.enabled) {
        servers.push({ name, ok: false, disabled: true, tools: 0 })
        continue
      }
      try {
        const connection = await this.connectServer(name, serverConfig, secrets)
        const listed = await withTimeout(this.listServerTools(connection), CONNECT_TIMEOUT_MS, `MCP «${name}» tools/list`)
        connection.tools = listed
        let count = 0
        for (const tool of listed) {
          if (!tool || !tool.name || tools.length >= MAX_TOOLS) continue
          const publicName = publicToolName(name, tool.name)
          const descriptor = {
            name: publicName,
            server: name,
            originalName: tool.name,
            description: `[MCP: ${name}] ${tool.description || tool.title || tool.name}`.slice(0, 1000),
            inputSchema: isRecord(tool.inputSchema) ? tool.inputSchema : { type: 'object', properties: {} },
            annotations: tool.annotations || null
          }
          this.toolMap.set(publicName, { connection, descriptor })
          tools.push(descriptor)
          count++
        }
        servers.push({ name, ok: true, tools: count })
      } catch (error) {
        await this.closeConnection(name)
        servers.push({ name, ok: false, tools: 0, error: redactError(error, secrets) })
      }
    }
    return { enabled: true, tools, servers, error: config.loadError || null }
  }

  async callTool(publicName, args) {
    const target = this.toolMap.get(publicName)
    if (!target) throw new Error(`MCP-инструмент «${publicName}» не найден`)
    const payload = isRecord(args) ? args : {}
    const result = await withTimeout(
      target.connection.client.callTool({ name: target.descriptor.originalName, arguments: payload }),
      TOOL_TIMEOUT_MS,
      `MCP ${target.descriptor.server}/${target.descriptor.originalName}`
    )
    return {
      ...formatToolResult(result),
      server: target.descriptor.server,
      tool: target.descriptor.originalName
    }
  }
}

module.exports = {
  MCPManager,
  formatToolResult,
  normalizeMcpConfig,
  publicToolName,
  resolveTemplate
}
