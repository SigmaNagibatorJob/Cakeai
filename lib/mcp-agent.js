'use strict'

const MAX_TOOL_ROUNDS = 8
const MAX_TOOL_CALLS = 24

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseArguments(value) {
  if (isRecord(value)) return value
  if (typeof value !== 'string' || !value.trim()) return {}
  const parsed = JSON.parse(value)
  if (!isRecord(parsed)) throw new Error('аргументы инструмента должны быть JSON-объектом')
  return parsed
}

function messageText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(part => {
    if (typeof part === 'string') return part
    if (part && (part.type === 'text' || part.type === 'output_text')) return part.text || ''
    return ''
  }).join('')
}

function cleanJsonSchema(value, depth = 0) {
  if (depth > 20 || value == null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(item => cleanJsonSchema(item, depth + 1))
  const out = {}
  for (const [key, item] of Object.entries(value)) {
    if (['$schema', '$id', 'examples', 'default'].includes(key)) continue
    if (key === 'const') {
      out.enum = [cleanJsonSchema(item, depth + 1)]
      continue
    }
    out[key] = cleanJsonSchema(item, depth + 1)
  }
  if (!out.type && (out.properties || out.required)) out.type = 'object'
  return out
}

function toOpenAITools(tools) {
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description || tool.name,
      parameters: tool.inputSchema || { type: 'object', properties: {} }
    }
  }))
}

function toAnthropicTools(tools) {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description || tool.name,
    input_schema: tool.inputSchema || { type: 'object', properties: {} }
  }))
}

function toGeminiTools(tools) {
  return [{
    functionDeclarations: tools.map(tool => ({
      name: tool.name,
      description: tool.description || tool.name,
      parameters: cleanJsonSchema(tool.inputSchema || { type: 'object', properties: {} })
    }))
  }]
}

async function executeTool(callTool, call, onTool, tools) {
  const descriptor = (tools || []).find(tool => tool.name === call.name)
  const info = {
    name: call.name,
    ...(descriptor ? { server: descriptor.server, tool: descriptor.originalName } : {})
  }
  try {
    const args = parseArguments(call.arguments)
    if (onTool) onTool({ ...info, state: 'start' })
    const result = await callTool(call.name, args)
    if (onTool) onTool({ ...info, server: result.server, tool: result.tool, state: result.isError ? 'error' : 'done' })
    return result
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    if (onTool) onTool({ ...info, state: 'error', error: text.slice(0, 300) })
    return { text: 'Ошибка MCP-инструмента: ' + text, isError: true }
  }
}

async function runOpenAIToolLoop(options) {
  const { request, callTool, onTool, onReasoning } = options
  const tools = toOpenAITools(options.tools)
  const messages = options.messages.map(item => ({ ...item }))
  let totalCalls = 0

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await request({ messages, tools })
    const message = response && response.choices && response.choices[0] && response.choices[0].message
    if (!message) throw new Error('Модель вернула некорректный ответ для MCP')
    if (message.reasoning_content && onReasoning) onReasoning(message.reasoning_content)

    const calls = Array.isArray(message.tool_calls) ? message.tool_calls.filter(call => call && call.function && call.function.name) : []
    if (!calls.length) return messageText(message.content)
    totalCalls += calls.length
    if (totalCalls > MAX_TOOL_CALLS) throw new Error('MCP остановлен: модель запросила слишком много инструментов')

    const assistantMessage = {
      role: 'assistant',
      content: message.content == null ? null : message.content,
      tool_calls: calls.map(call => ({
        id: call.id,
        type: 'function',
        function: {
          name: call.function.name,
          arguments: typeof call.function.arguments === 'string'
            ? call.function.arguments
            : JSON.stringify(call.function.arguments || {})
        }
      }))
    }
    // Некоторые reasoning-модели требуют вернуть их reasoning-поля вместе с
    // assistant tool_calls на следующем шаге.
    for (const field of ['reasoning_content', 'reasoning', 'reasoning_details']) {
      if (message[field] != null) assistantMessage[field] = message[field]
    }
    messages.push(assistantMessage)

    const results = await Promise.all(calls.map(call => executeTool(callTool, {
      name: call.function.name,
      arguments: call.function.arguments
    }, onTool, options.tools)))
    calls.forEach((call, index) => {
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: results[index].text
      })
    })
  }
  throw new Error('MCP остановлен после максимального числа шагов')
}

async function runAnthropicToolLoop(options) {
  const { request, callTool, onTool, onReasoning } = options
  const tools = toAnthropicTools(options.tools)
  const messages = options.messages.map(item => ({ ...item }))
  let totalCalls = 0

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await request({ messages, tools })
    const content = Array.isArray(response && response.content) ? response.content : []
    const calls = content.filter(block => block && block.type === 'tool_use' && block.name)
    const thinking = content.filter(block => block && (block.type === 'thinking' || block.type === 'redacted_thinking'))
    for (const block of thinking) {
      if (block.thinking && onReasoning) onReasoning(block.thinking)
    }
    if (!calls.length) {
      return content.filter(block => block && block.type === 'text').map(block => block.text || '').join('')
    }

    totalCalls += calls.length
    if (totalCalls > MAX_TOOL_CALLS) throw new Error('MCP остановлен: модель запросила слишком много инструментов')
    messages.push({ role: 'assistant', content })
    const results = await Promise.all(calls.map(call => executeTool(callTool, {
      name: call.name,
      arguments: call.input || {}
    }, onTool, options.tools)))
    messages.push({
      role: 'user',
      content: calls.map((call, index) => ({
        type: 'tool_result',
        tool_use_id: call.id,
        content: results[index].text,
        is_error: results[index].isError
      }))
    })
  }
  throw new Error('MCP остановлен после максимального числа шагов')
}

async function runGeminiToolLoop(options) {
  const { request, callTool, onTool } = options
  const tools = toGeminiTools(options.tools)
  const contents = options.contents.map(item => ({ ...item, parts: [...item.parts] }))
  let totalCalls = 0

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await request({ contents, tools })
    const candidate = response && response.candidates && response.candidates[0]
    const modelContent = candidate && candidate.content
    const parts = Array.isArray(modelContent && modelContent.parts) ? modelContent.parts : []
    const calls = parts.filter(part => part && part.functionCall && part.functionCall.name)
    if (!calls.length) return parts.map(part => part.text || '').join('')

    totalCalls += calls.length
    if (totalCalls > MAX_TOOL_CALLS) throw new Error('MCP остановлен: модель запросила слишком много инструментов')
    contents.push({ role: 'model', parts })
    const results = await Promise.all(calls.map(part => executeTool(callTool, {
      name: part.functionCall.name,
      arguments: part.functionCall.args || {}
    }, onTool, options.tools)))
    contents.push({
      role: 'user',
      parts: calls.map((part, index) => ({
        functionResponse: {
          name: part.functionCall.name,
          response: {
            content: results[index].text,
            isError: results[index].isError
          }
        }
      }))
    })
  }
  throw new Error('MCP остановлен после максимального числа шагов')
}

module.exports = {
  cleanJsonSchema,
  runAnthropicToolLoop,
  runGeminiToolLoop,
  runOpenAIToolLoop,
  toAnthropicTools,
  toGeminiTools,
  toOpenAITools
}
