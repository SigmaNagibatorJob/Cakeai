'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  runAnthropicToolLoop,
  runGeminiToolLoop,
  runOpenAIToolLoop
} = require('../lib/mcp-agent')

const tool = {
  name: 'mcp_math_add_abcd1234',
  server: 'math',
  originalName: 'add',
  description: 'Add two numbers',
  inputSchema: {
    type: 'object',
    properties: { a: { type: 'number' }, b: { type: 'number' } },
    required: ['a', 'b']
  }
}

async function callTool(name, args) {
  assert.equal(name, tool.name)
  return { text: String(args.a + args.b), isError: false, server: 'math', tool: 'add' }
}

test('runs an OpenAI-compatible MCP tool loop', async () => {
  let step = 0
  const events = []
  const answer = await runOpenAIToolLoop({
    tools: [tool],
    messages: [{ role: 'user', content: '2+3?' }],
    callTool,
    onTool: event => events.push(event),
    request: async body => {
      assert.equal(body.tools[0].function.name, tool.name)
      if (step++ === 0) {
        return {
          choices: [{ message: {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'call-1',
              type: 'function',
              function: { name: tool.name, arguments: '{"a":2,"b":3}' }
            }]
          } }]
        }
      }
      assert.equal(body.messages.at(-1).role, 'tool')
      assert.equal(body.messages.at(-1).content, '5')
      return { choices: [{ message: { role: 'assistant', content: 'Result: 5' } }] }
    }
  })
  assert.equal(answer, 'Result: 5')
  assert.equal(events[0].server, 'math')
  assert.deepEqual(events.map(event => event.state), ['start', 'done'])
})

test('runs an Anthropic MCP tool loop', async () => {
  let step = 0
  const answer = await runAnthropicToolLoop({
    tools: [tool],
    messages: [{ role: 'user', content: '4+6?' }],
    callTool,
    request: async body => {
      assert.equal(body.tools[0].input_schema.type, 'object')
      if (step++ === 0) {
        return { content: [{ type: 'tool_use', id: 'tool-1', name: tool.name, input: { a: 4, b: 6 } }] }
      }
      assert.equal(body.messages.at(-1).content[0].content, '10')
      return { content: [{ type: 'text', text: 'Result: 10' }] }
    }
  })
  assert.equal(answer, 'Result: 10')
})

test('runs a Gemini MCP tool loop', async () => {
  let step = 0
  const answer = await runGeminiToolLoop({
    tools: [tool],
    contents: [{ role: 'user', parts: [{ text: '7+8?' }] }],
    callTool,
    request: async body => {
      assert.equal(body.tools[0].functionDeclarations[0].name, tool.name)
      if (step++ === 0) {
        return {
          candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: tool.name, args: { a: 7, b: 8 } } }] } }]
        }
      }
      assert.equal(body.contents.at(-1).parts[0].functionResponse.response.content, '15')
      return { candidates: [{ content: { role: 'model', parts: [{ text: 'Result: 15' }] } }] }
    }
  })
  assert.equal(answer, 'Result: 15')
})
