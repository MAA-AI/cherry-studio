import type { ProcessingStatus } from '@types'

export type LoaderReturn = {
  entriesAdded: number
  uniqueId: string
  uniqueIds: string[]
  loaderType: string
  status?: ProcessingStatus
  message?: string
  messageSource?: 'preprocess' | 'embedding' | 'validation'
}

export type FileChangeEventType = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir' | 'refresh'

export type FileChangeEvent = {
  eventType: FileChangeEventType
  filePath: string
  watchPath: string
}

export type MCPProgressEvent = {
  callId: string
  progress: number // 0-1 range
}

export type MCPServerLogEntry = {
  timestamp: number
  level: 'debug' | 'info' | 'warn' | 'error' | 'stderr' | 'stdout'
  message: string
  data?: any
  source?: string
}

export type WebviewKeyEvent = {
  webviewId: number
  key: string
  control: boolean
  meta: boolean
  shift: boolean
  alt: boolean
}

export interface WebSocketStatusResponse {
  isRunning: boolean
  port?: number
  ip?: string
  clientConnected: boolean
}

export interface WebSocketCandidatesResponse {
  host: string
  interface: string
  priority: number
}

// MCP env (uv/bun) first-run init
export type McpEnvInitStage =
  | 'idle'
  | 'start-check'
  | 'check-uv'
  | 'check-bun'
  | 'need-install'
  | 'no-need-install'
  | 'start-install-uv'
  | 'installing-uv'
  | 'start-install-bun'
  | 'installing-bun'
  | 'env-ready'
  | 'failed'

export type McpEnvInitLogLevel = 'info' | 'warn' | 'error'

export type McpEnvInitLog = {
  ts: number
  level: McpEnvInitLogLevel
  message: string
  source?: 'uv' | 'bun' | 'system'
}

export type McpEnvInitError = {
  message: string
  command?: string
  exitCode?: number | null
  stderrTail?: string
  stdoutTail?: string
  suggestion?: string
}

export type McpEnvInitState = {
  stage: McpEnvInitStage
  uvInstalled: boolean
  bunInstalled: boolean
  installing: boolean
  done: boolean
  failed: boolean
  error?: McpEnvInitError
  logs: McpEnvInitLog[]
  updatedAt: number
}

export type McpEnvInitEvent =
  | { type: 'state'; state: McpEnvInitState }
  | { type: 'log'; log: McpEnvInitLog }
  | { type: 'stage'; stage: McpEnvInitStage; at: number }
