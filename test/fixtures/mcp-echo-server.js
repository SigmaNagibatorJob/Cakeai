'use strict'

const readline = require('readline')

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n')
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
lines.on('line', line => {
  let message
  try { message = JSON.parse(line) } catch (_) { return }
  if (message.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: message.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'cakeai-test-mcp', version: '1.0.0' }
      }
    })
    return
  }
  if (message.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        tools: [{
          name: 'echo',
          description: 'Echo text and a secret supplied through the process environment',
          inputSchema: {
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text']
          }
        }]
      }
    })
    return
  }
  if (message.method === 'tools/call') {
    const text = message.params && message.params.arguments && message.params.arguments.text
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        content: [{ type: 'text', text: String(text || '') + ':' + String(process.env.TEST_SECRET || '') }]
      }
    })
    return
  }
  if (message.id != null) {
    send({ jsonrpc: '2.0', id: message.id, result: {} })
  }
})
