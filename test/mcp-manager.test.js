'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const {
  MCPManager,
  normalizeMcpConfig,
  publicToolName,
  resolveTemplate
} = require('../lib/mcp-manager')

const fixture = path.join(__dirname, 'fixtures', 'mcp-echo-server.js')

test('normalizes standard stdio and HTTP MCP configs', () => {
  const config = normalizeMcpConfig({
    enabled: true,
    mcpServers: {
      local: { command: 'node', args: ['server.js'], env: { TOKEN: '${TOKEN}' } },
      remote: { url: 'https://example.com/mcp', headers: { Authorization: 'Bearer ${TOKEN}' } }
    }
  })
  assert.equal(config.enabled, true)
  assert.equal(config.mcpServers.local.transport, 'stdio')
  assert.equal(config.mcpServers.remote.transport, 'http')
  assert.equal(resolveTemplate('Bearer ${TOKEN}', { TOKEN: 'secret' }), 'Bearer secret')
  assert.match(publicToolName('my server', 'echo.value'), /^mcp_my_server_echo_value_/)
})

test('rejects invalid MCP server definitions', () => {
  assert.throws(
    () => normalizeMcpConfig({ enabled: true, mcpServers: { bad: { args: [] } } }),
    /command.*url/
  )
  assert.throws(
    () => normalizeMcpConfig({ enabled: true, mcpServers: { bad: { command: 'node', args: [1] } } }),
    /массивом строк/
  )
  assert.throws(
    () => normalizeMcpConfig('{"enabled":true,"mcpServers":{"__proto__":{"command":"node"}}}'),
    /Недопустимое имя/
  )
})

test('connects to a stdio server, lists tools and calls one', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cakeai-mcp-'))
  const configPath = path.join(dir, 'mcp-config.json')
  const manager = new MCPManager(configPath)
  t.after(async () => {
    await manager.closeAll()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  await manager.saveConfig({
    enabled: true,
    mcpServers: {
      echo: {
        command: process.execPath,
        args: [fixture],
        env: { TEST_SECRET: '${TEST_SECRET}' }
      }
    }
  })

  const state = await manager.getTools({ TEST_SECRET: 'resolved' })
  assert.equal(state.enabled, true)
  assert.deepEqual(state.servers.map(item => ({ name: item.name, ok: item.ok, tools: item.tools })), [
    { name: 'echo', ok: true, tools: 1 }
  ])
  assert.equal(state.tools.length, 1)
  assert.equal(state.tools[0].server, 'echo')
  assert.equal(state.tools[0].originalName, 'echo')

  const result = await manager.callTool(state.tools[0].name, { text: 'hello' })
  assert.equal(result.text, 'hello:resolved')
  assert.equal(result.isError, false)
})

test('connects to a Streamable HTTP server with templated headers', async t => {
  let receivedHeader = ''
  const server = http.createServer((request, response) => {
    if (request.method === 'DELETE') {
      response.writeHead(200).end()
      return
    }
    if (request.method !== 'POST') {
      response.writeHead(405).end()
      return
    }
    let raw = ''
    request.on('data', chunk => { raw += chunk })
    request.on('end', () => {
      receivedHeader = String(request.headers['x-test-token'] || '')
      const message = JSON.parse(raw)
      if (message.id == null) {
        response.writeHead(202).end()
        return
      }
      let result
      if (message.method === 'initialize') {
        result = {
          protocolVersion: message.params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: 'http-test', version: '1.0.0' }
        }
      } else if (message.method === 'tools/list') {
        result = {
          tools: [{
            name: 'remote_echo',
            description: 'Remote echo',
            inputSchema: { type: 'object', properties: { text: { type: 'string' } } }
          }]
        }
      } else if (message.method === 'tools/call') {
        result = { content: [{ type: 'text', text: 'remote:' + message.params.arguments.text }] }
      } else {
        result = {}
      }
      const body = JSON.stringify({ jsonrpc: '2.0', id: message.id, result })
      response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
      response.end(body)
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cakeai-mcp-http-'))
  const manager = new MCPManager(path.join(dir, 'mcp-config.json'))
  t.after(async () => {
    await manager.closeAll()
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections?.() })
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const address = server.address()
  await manager.saveConfig({
    enabled: true,
    mcpServers: {
      remote: {
        url: `http://127.0.0.1:${address.port}/mcp`,
        headers: { 'X-Test-Token': '${HTTP_TEST_TOKEN}' }
      }
    }
  })
  const state = await manager.getTools({ HTTP_TEST_TOKEN: 'header-ok' })
  assert.equal(state.servers[0].ok, true)
  assert.equal(state.tools.length, 1)
  assert.equal(receivedHeader, 'header-ok')
  const result = await manager.callTool(state.tools[0].name, { text: 'hello' })
  assert.equal(result.text, 'remote:hello')
})

test('connects to a legacy SSE MCP server', async t => {
  let eventStream = null
  let receivedHeader = ''
  const server = http.createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/sse') {
      receivedHeader = String(request.headers['x-sse-token'] || '')
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      })
      response.write('event: endpoint\ndata: /messages\n\n')
      eventStream = response
      return
    }
    if (request.method === 'POST' && request.url === '/messages') {
      let raw = ''
      request.on('data', chunk => { raw += chunk })
      request.on('end', () => {
        receivedHeader = String(request.headers['x-sse-token'] || '')
        const message = JSON.parse(raw)
        response.writeHead(202).end('Accepted')
        if (message.id == null || !eventStream) return
        let result
        if (message.method === 'initialize') {
          result = {
            protocolVersion: message.params.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: 'sse-test', version: '1.0.0' }
          }
        } else if (message.method === 'tools/list') {
          result = {
            tools: [{
              name: 'sse_echo',
              description: 'SSE echo',
              inputSchema: { type: 'object', properties: { text: { type: 'string' } } }
            }]
          }
        } else if (message.method === 'tools/call') {
          result = { content: [{ type: 'text', text: 'sse:' + message.params.arguments.text }] }
        } else {
          result = {}
        }
        eventStream.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n\n`)
      })
      return
    }
    response.writeHead(404).end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cakeai-mcp-sse-'))
  const manager = new MCPManager(path.join(dir, 'mcp-config.json'))
  t.after(async () => {
    await manager.closeAll()
    if (eventStream) eventStream.end()
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections?.() })
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const address = server.address()
  await manager.saveConfig({
    enabled: true,
    mcpServers: {
      legacy: {
        url: `http://127.0.0.1:${address.port}/sse`,
        transport: 'sse',
        headers: { 'X-SSE-Token': '${SSE_TEST_TOKEN}' }
      }
    }
  })
  const state = await manager.getTools({ SSE_TEST_TOKEN: 'sse-header-ok' })
  assert.equal(state.servers[0].ok, true)
  assert.equal(state.tools.length, 1)
  assert.equal(receivedHeader, 'sse-header-ok')
  const result = await manager.callTool(state.tools[0].name, { text: 'hello' })
  assert.equal(result.text, 'sse:hello')
})
