import { nanoid } from '@reduxjs/toolkit'
import type { MCPServer } from '@renderer/types'

export const MAA_MCP_SERVER_NAME = 'maa-mcp'

export function createMaaMcpServer(): MCPServer {
  return {
    id: nanoid(),
    name: MAA_MCP_SERVER_NAME,
    type: 'stdio',
    command: 'uvx',
    args: ['maa-mcp'],
    isActive: false,
    provider: 'MAA',
    installSource: 'manual',
    isTrusted: true,
    installedAt: Date.now()
  }
}

