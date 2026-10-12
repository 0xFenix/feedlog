export function mcpClientDisplay(id: string, rawName: string | null) {
  const name = rawName?.trim() || 'Unnamed application'
  const normalized = name.toLowerCase()
  const type = /claude[\s_-]*code/.test(normalized) ? 'claude-code'
    : /codex/.test(normalized) ? 'codex'
      : /chatgpt/.test(normalized) ? 'chatgpt'
        : /cursor/.test(normalized) ? 'cursor'
          : /claude/.test(normalized) ? 'claude' : 'other'
  return { id, name, type }
}
