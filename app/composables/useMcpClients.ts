import claude from '~/components/mcp/assets/claude.svg?url'
import claudeCode from '~/components/mcp/assets/claude-code.svg?url'
import cursor from '~/components/mcp/assets/cursor.svg?url'
import chatgpt from '~/components/mcp/assets/chatgpt.svg?url'
import codex from '~/components/mcp/assets/codex.svg?url'

export const mcpClientLogos: Record<string, string> = { claude, 'claude-code': claudeCode, cursor, chatgpt, codex }
export function useMcpClients(serverUrl: Ref<string>) {
  const { t } = useI18n()
  return computed(() => [
    { id: 'claude', name: 'Claude', instructions: t('mcp.clients.claude'), note: t('mcp.clients.claudeNote'), docs: 'https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp' },
    { id: 'chatgpt', name: 'ChatGPT', instructions: t('mcp.clients.chatgpt'), note: t('mcp.clients.chatgptNote'), docs: 'https://developers.openai.com/api/docs/guides/custom-mcp-server' },
    { id: 'claude-code', name: 'Claude Code', instructions: t('mcp.clients.claudeCode'), command: `claude mcp add --transport http --scope user feedlog ${serverUrl.value}\nclaude mcp login feedlog`, docs: 'https://code.claude.com/docs/en/mcp#authenticate-with-remote-mcp-servers' },
    { id: 'codex', name: 'Codex', instructions: t('mcp.clients.codex'), command: `codex mcp add feedlog --url ${serverUrl.value}\ncodex mcp login feedlog`, docs: 'https://developers.openai.com/codex/mcp' },
    { id: 'cursor', name: 'Cursor', instructions: t('mcp.clients.cursor'), install: `https://cursor.com/en/install-mcp?name=feedlog&config=${encodeURIComponent(btoa(JSON.stringify({ url: serverUrl.value })))}`, docs: 'https://cursor.com/docs/mcp' },
    { id: 'other', name: t('mcp.otherClients'), instructions: t('mcp.clients.other'), configuration: JSON.stringify({ mcpServers: { feedlog: { url: serverUrl.value } } }, null, 2) },
  ])
}
