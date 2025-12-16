import { loggerService } from '@logger'
import { isWin } from '@main/constant'
import { getResourcePath } from '@main/utils'
import { isBinaryExists, spawnNodeScriptStreaming } from '@main/utils/process'
import { IpcChannel } from '@shared/IpcChannel'
import type {
  McpEnvInitError,
  McpEnvInitEvent,
  McpEnvInitLog,
  McpEnvInitLogLevel,
  McpEnvInitStage,
  McpEnvInitState
} from '@shared/config/types'
import type { WebContents } from 'electron'
import path from 'node:path'
import { t, initLocale } from '../utils/locale'

const logger = loggerService.withContext('McpEnvInitService')

const MAX_LOGS = 500
const TAIL_MAX = 4000

function tailText(text: string, max = TAIL_MAX) {
  if (!text) return ''
  return text.length > max ? text.slice(text.length - max) : text
}

function summarizeFailure(stderr: string, stdout: string): string | undefined {
  const s = `${stderr}\n${stdout}`.toLowerCase()

  // 网络/代理
  if (
    s.includes('enotfound') ||
    s.includes('econnrefused') ||
    s.includes('etimedout') ||
    s.includes('timed out') ||
    s.includes('network is unreachable') ||
    s.includes('could not resolve')
  ) {
    return t('mcp.envInit.errorSummary.networkIssue')
  }

  // 证书
  if (s.includes('certificate') || s.includes('self signed') || s.includes('unable to get local issuer')) {
    return t('mcp.envInit.errorSummary.certificateIssue')
  }

  // 权限
  if (s.includes('eacces') || s.includes('eperm') || s.includes('permission denied') || s.includes('access is denied')) {
    return isWin
      ? t('mcp.envInit.errorSummary.permissionWindows')
      : t('mcp.envInit.errorSummary.permissionUnix')
  }

  return undefined
}

function now() {
  return Date.now()
}

function defaultState(): McpEnvInitState {
  return {
    stage: 'idle',
    uvInstalled: false,
    bunInstalled: false,
    installing: false,
    done: false,
    failed: false,
    logs: [],
    updatedAt: now()
  }
}

export class McpEnvInitService {
  private state: McpEnvInitState = defaultState()
  private running: Promise<McpEnvInitState> | null = null

  constructor() {
    // Initialize locale when service is created
    initLocale()
  }

  public getState(): McpEnvInitState {
    return this.state
  }

  public async start(sender: WebContents): Promise<McpEnvInitState> {
    // 幂等：已经完成且环境就绪，直接回传状态
    if (this.state.done && !this.state.failed && this.state.uvInstalled && this.state.bunInstalled) {
      this.emit(sender, { type: 'state', state: this.state })
      return this.state
    }

    // 幂等：正在运行则复用
    if (this.running) {
      this.emit(sender, { type: 'state', state: this.state })
      return this.running
    }

    // reset transient flags but keep logs for context
    this.state = {
      ...this.state,
      failed: false,
      done: false,
      error: undefined,
      installing: false,
      updatedAt: now()
    }

    this.setStage(sender, 'start-check')
    this.info(sender, t('mcp.envInit.messages.startCheck'), 'system')

    this.running = this.run(sender)
      .catch((err) => {
        const e = err instanceof Error ? err : new Error(String(err))
        this.fail(sender, {
          message: e.message
        })
        return this.state
      })
      .finally(() => {
        this.running = null
      })

    return this.running
  }

  private emit(sender: WebContents, event: McpEnvInitEvent) {
    try {
      sender.send(IpcChannel.McpEnv_InitEvent, event)
    } catch (error) {
      logger.warn('Failed to send init event to renderer', { error })
    }
  }

  private pushLog(sender: WebContents, level: McpEnvInitLogLevel, message: string, source?: McpEnvInitLog['source']) {
    const logEntry: McpEnvInitLog = {
      ts: now(),
      level,
      message,
      source
    }

    this.state.logs = [...this.state.logs, logEntry].slice(-MAX_LOGS)
    this.state.updatedAt = now()

    this.emit(sender, { type: 'log', log: logEntry })
    this.emit(sender, { type: 'state', state: this.state })
  }

  private info(sender: WebContents, message: string, source?: McpEnvInitLog['source']) {
    this.pushLog(sender, 'info', message, source)
  }

  private warn(sender: WebContents, message: string, source?: McpEnvInitLog['source']) {
    this.pushLog(sender, 'warn', message, source)
  }

  private error(sender: WebContents, message: string, source?: McpEnvInitLog['source']) {
    this.pushLog(sender, 'error', message, source)
  }

  private setStage(sender: WebContents, stage: McpEnvInitStage) {
    this.state.stage = stage
    this.state.updatedAt = now()
    this.emit(sender, { type: 'stage', stage, at: this.state.updatedAt })
    this.emit(sender, { type: 'state', state: this.state })
  }

  private fail(sender: WebContents, error: McpEnvInitError) {
    this.state.failed = true
    this.state.done = true
    this.state.installing = false
    this.state.error = error
    this.state.stage = 'failed'
    this.state.updatedAt = now()

    this.emit(sender, { type: 'state', state: this.state })
    this.error(sender, `${t('mcp.envInit.messages.initFailed')}${error.message}`, 'system')
    if (error.suggestion) {
      this.warn(sender, `${t('mcp.envInit.errors.suggestion')}${error.suggestion}`, 'system')
    }
  }

  private async run(sender: WebContents): Promise<McpEnvInitState> {
    // 1) check uv/uvx
    this.setStage(sender, 'check-uv')
    this.info(sender, t('mcp.envInit.messages.checkingUv'), 'uv')

    const uvOk = (await isBinaryExists('uvx')) || (await isBinaryExists('uv'))
    this.state.uvInstalled = uvOk
    this.emit(sender, { type: 'state', state: this.state })
    this.info(sender, uvOk ? t('mcp.envInit.messages.uvInstalled') : t('mcp.envInit.messages.uvNotInstalled'), 'uv')

    // 2) check bun
    this.setStage(sender, 'check-bun')
    this.info(sender, t('mcp.envInit.messages.checkingBun'), 'bun')

    const bunOk = await isBinaryExists('bun')
    this.state.bunInstalled = bunOk
    this.emit(sender, { type: 'state', state: this.state })
    this.info(sender, bunOk ? t('mcp.envInit.messages.bunInstalled') : t('mcp.envInit.messages.bunNotInstalled'), 'bun')

    const needUv = !uvOk
    const needBun = !bunOk
    if (!needUv && !needBun) {
      this.setStage(sender, 'no-need-install')
      this.info(sender, t('mcp.envInit.messages.noNeedInstall'), 'system')
      this.setStage(sender, 'env-ready')
      this.state.done = true
      this.state.installing = false
      this.state.failed = false
      this.emit(sender, { type: 'state', state: this.state })
      return this.state
    }

    this.setStage(sender, 'need-install')
    this.warn(sender, `${t('mcp.envInit.messages.needInstall')}${[needUv ? 'uv' : null, needBun ? 'bun' : null].filter(Boolean).join(', ')}`, 'system')

    // 3) install uv then bun (sequential)
    this.state.installing = true
    this.emit(sender, { type: 'state', state: this.state })

    if (needUv) {
      await this.installUv(sender)
    }

    if (needBun) {
      await this.installBun(sender)
    }

    // 4) re-check
    this.setStage(sender, 'start-check')
    this.info(sender, t('mcp.envInit.messages.recheckAfterInstall'), 'system')
    const uvOk2 = (await isBinaryExists('uvx')) || (await isBinaryExists('uv'))
    const bunOk2 = await isBinaryExists('bun')
    this.state.uvInstalled = uvOk2
    this.state.bunInstalled = bunOk2

    if (!uvOk2 || !bunOk2) {
      this.fail(sender, {
        message: t('mcp.envInit.messages.installScriptCompletedButRecheckFailed'),
        suggestion: t('mcp.envInit.messages.checkSecuritySoftware')
      })
      return this.state
    }

    this.setStage(sender, 'env-ready')
    this.state.done = true
    this.state.failed = false
    this.state.installing = false
    this.state.updatedAt = now()
    this.emit(sender, { type: 'state', state: this.state })
    this.info(sender, t('mcp.envInit.messages.initComplete'), 'system')
    return this.state
  }

  private async installUv(sender: WebContents) {
    this.setStage(sender, 'start-install-uv')
    this.warn(sender, t('mcp.envInit.messages.startInstallUv'), 'uv')

    const script = path.join(getResourcePath(), 'scripts', 'install-uv.js')
    const command = `${process.execPath} ${script}`

    this.setStage(sender, 'installing-uv')

    try {
      const { exitCode, stderr, stdout } = await spawnNodeScriptStreaming(script, {
        onStdoutChunk: (chunk) => {
          for (const line of chunk.split(/\r?\n/)) {
            const msg = line.trim()
            if (msg) this.info(sender, msg, 'uv')
          }
        },
        onStderrChunk: (chunk) => {
          for (const line of chunk.split(/\r?\n/)) {
            const msg = line.trim()
            if (msg) this.warn(sender, msg, 'uv')
          }
        }
      })

      if (exitCode !== 0) {
        this.fail(sender, {
          message: t('mcp.envInit.messages.uvInstallFailed'),
          command,
          exitCode,
          stderrTail: tailText(stderr),
          stdoutTail: tailText(stdout),
          suggestion: summarizeFailure(stderr, stdout)
        })
        throw new Error('uv install failed')
      }

      this.info(sender, t('mcp.envInit.messages.uvInstallScriptCompleted'), 'uv')
    } catch (error) {
      if (!this.state.failed) {
        const e = error instanceof Error ? error : new Error(String(error))
        this.fail(sender, {
          message: `${t('mcp.envInit.messages.uvInstallException')}${e.message}`,
          command,
          suggestion: isWin
            ? t('mcp.envInit.messages.checkPowerShellFirewall')
            : t('mcp.envInit.messages.checkNetworkProxy')
        })
      }
      throw error
    }
  }

  private async installBun(sender: WebContents) {
    this.setStage(sender, 'start-install-bun')
    this.warn(sender, t('mcp.envInit.messages.startInstallBun'), 'bun')

    const script = path.join(getResourcePath(), 'scripts', 'install-bun.js')
    const command = `${process.execPath} ${script}`

    this.setStage(sender, 'installing-bun')

    try {
      const { exitCode, stderr, stdout } = await spawnNodeScriptStreaming(script, {
        onStdoutChunk: (chunk) => {
          for (const line of chunk.split(/\r?\n/)) {
            const msg = line.trim()
            if (msg) this.info(sender, msg, 'bun')
          }
        },
        onStderrChunk: (chunk) => {
          for (const line of chunk.split(/\r?\n/)) {
            const msg = line.trim()
            if (msg) this.warn(sender, msg, 'bun')
          }
        }
      })

      if (exitCode !== 0) {
        this.fail(sender, {
          message: t('mcp.envInit.messages.bunInstallFailed'),
          command,
          exitCode,
          stderrTail: tailText(stderr),
          stdoutTail: tailText(stdout),
          suggestion: summarizeFailure(stderr, stdout)
        })
        throw new Error('bun install failed')
      }

      this.info(sender, t('mcp.envInit.messages.bunInstallScriptCompleted'), 'bun')
    } catch (error) {
      if (!this.state.failed) {
        const e = error instanceof Error ? error : new Error(String(error))
        this.fail(sender, {
          message: `${t('mcp.envInit.messages.bunInstallException')}${e.message}`,
          command,
          suggestion: summarizeFailure('', e.message) || t('mcp.envInit.messages.checkNetworkPermissionCert')
        })
      }
      throw error
    }
  }
}

export const mcpEnvInitService = new McpEnvInitService()

