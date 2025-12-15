import { loggerService } from '@logger'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { addMCPServer, setIsBunInstalled, setIsUvInstalled, updateMCPServer } from '@renderer/store/mcp'
import { createMaaMcpServer, MAA_MCP_SERVER_NAME } from '@renderer/services/mcp/maaMcp'
import type { MCPServer } from '@renderer/types'
import type { McpEnvInitEvent, McpEnvInitState, McpEnvInitStage } from '@shared/config/types'
import { Alert, Button, Card, Collapse, Divider, List, Progress, Space, Steps, Typography } from 'antd'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('McpEnvInitPanel')

type ActivationStage = 'idle' | 'activating' | 'done' | 'failed'

function stageToStepIndex(stage: McpEnvInitStage, activationStage: ActivationStage): number {
  if (activationStage === 'activating') return 4
  if (activationStage === 'done') return 5
  if (activationStage === 'failed') return 4

  switch (stage) {
    case 'idle':
      return 0
    case 'start-check':
      return 0
    case 'check-uv':
      return 1
    case 'check-bun':
      return 2
    case 'need-install':
    case 'no-need-install':
      return 3
    case 'start-install-uv':
    case 'installing-uv':
    case 'start-install-bun':
    case 'installing-bun':
      return 3
    case 'env-ready':
      return 4
    case 'failed':
      return 0
    default:
      return 0
  }
}

function stageToPercent(stage: McpEnvInitStage, activationStage: ActivationStage): number {
  if (activationStage === 'activating') return 90
  if (activationStage === 'done') return 100
  if (activationStage === 'failed') return 90

  switch (stage) {
    case 'idle':
      return 0
    case 'start-check':
      return 5
    case 'check-uv':
      return 20
    case 'check-bun':
      return 35
    case 'need-install':
    case 'no-need-install':
      return 45
    case 'start-install-uv':
    case 'installing-uv':
    case 'start-install-bun':
    case 'installing-bun':
      return 70
    case 'env-ready':
      return 85
    case 'failed':
      return 0
    default:
      return 0
  }
}

function withTimeout<T>(p: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: any
  const timeout = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs)
  })
  return Promise.race([p.finally(() => clearTimeout(timer)), timeout])
}

export default function McpEnvInitPanel(): React.ReactElement | null {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const servers = useAppSelector((s) => s.mcp.servers)

  const [envState, setEnvState] = useState<McpEnvInitState | null>(null)
  const [activationStage, setActivationStage] = useState<ActivationStage>('idle')
  const [activationError, setActivationError] = useState<string | null>(null)
  const [visible, setVisible] = useState(false)

  const activationRunningRef = useRef(false)

  const mergedLogs = useMemo(() => {
    return (envState?.logs || []).slice().reverse()
  }, [envState?.logs])

  const shouldShow = visible

  const stepIndex = useMemo(() => {
    return stageToStepIndex(envState?.stage || 'idle', activationStage)
  }, [activationStage, envState?.stage])

  const percent = useMemo(() => {
    return stageToPercent(envState?.stage || 'idle', activationStage)
  }, [activationStage, envState?.stage])

  const ensureMaaServer = () => {
    const existing = servers.find((s) => s.name === MAA_MCP_SERVER_NAME)
    if (existing) return existing

    const server = createMaaMcpServer()
    dispatch(addMCPServer(server))
    return server
  }

  const shouldAutoOpenForState = (state: McpEnvInitState) => {
    // 只在真正需要用户关注时才自动弹出：需要安装/失败
    // 避免首次渲染读取到 main 进程默认 state（idle + uv/bun=false）导致每次启动闪现。
    if (state.stage === 'idle') return false

    const installingStages: McpEnvInitStage[] = [
      'need-install',
      'start-install-uv',
      'installing-uv',
      'start-install-bun',
      'installing-bun',
      'failed'
    ]

    if (state.failed) return true
    if (installingStages.includes(state.stage)) return true
    return false
  }

  const activateMaaMcp = async () => {
    if (activationRunningRef.current) return
    activationRunningRef.current = true

    try {
      setActivationStage('activating')
      setActivationError(null)

      const server = ensureMaaServer()

      // 避免重复激活：已标记 active 则先尝试快速连通性确认
      if (server.isActive) {
        const ok = await withTimeout(
          window.api.mcp.checkMcpConnectivity(server),
          12_000,
          t('mcp.envInit.errors.connectionTimeout')
        )
        if (ok) {
          setActivationStage('done')
          return
        }
      }

      // 激活：将 isActive 置为 true 并等待 listTools 确认
      const activatingServer: MCPServer = { ...server, isActive: true }
      dispatch(updateMCPServer(activatingServer))

      const ok = await withTimeout(
        window.api.mcp.checkMcpConnectivity(activatingServer),
        30_000,
        t('mcp.envInit.errors.activateTimeout')
      )

      if (!ok) {
        dispatch(updateMCPServer({ ...activatingServer, isActive: false }))
        setActivationStage('failed')
        setActivationError(
          t('mcp.envInit.errors.cannotConnectMaaMcp')
        )
        setVisible(true)
        return
      }

      setActivationStage('done')
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      logger.error('Activate maa-mcp failed', err)
      setActivationStage('failed')
      setActivationError(
        t('mcp.envInit.errors.activateFailed', { error: err.message })
      )
      setVisible(true)

      // 回滚 active 标记
      const server = servers.find((s) => s.name === MAA_MCP_SERVER_NAME)
      if (server?.isActive) {
        dispatch(updateMCPServer({ ...server, isActive: false }))
      }
    } finally {
      activationRunningRef.current = false
    }
  }

  const startInit = async () => {
    setActivationStage('idle')
    setActivationError(null)
    const state = await window.api.mcpEnv.startInit()
    setEnvState(state)
    if (shouldAutoOpenForState(state)) {
      setVisible(true)
    }
  }

  useEffect(() => {
    let unsub: (() => void) | null = null

    const applyEvent = (event: McpEnvInitEvent) => {
      if (event.type === 'state') {
        setEnvState(event.state)
        dispatch(setIsUvInstalled(event.state.uvInstalled))
        dispatch(setIsBunInstalled(event.state.bunInstalled))

        if (shouldAutoOpenForState(event.state)) {
          setVisible(true)
        }
      }
      if (event.type === 'log') {
        // state 已包含日志，这里仅兜底
        setEnvState((prev) => {
          if (!prev) return prev
          return { ...prev, logs: [...prev.logs, event.log].slice(-500), updatedAt: Date.now() }
        })
      }
    }

    ;(async () => {
      try {
        const current = await window.api.mcpEnv.getState()
        setEnvState(current)
        if (current && shouldAutoOpenForState(current)) {
          setVisible(true)
        }
      } catch (e) {
        logger.warn('Failed to get initial env init state', { e })
      }

      unsub = window.api.mcpEnv.onEvent(applyEvent)

      // 应用启动自动触发
      await startInit()
    })()

    return () => {
      unsub?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!envState) return
    if (envState.failed) return
    if (!envState.done) return
    if (!(envState.uvInstalled && envState.bunInstalled)) return

    // 环境就绪后自动激活 maa-mcp
    void activateMaaMcp()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envState?.done, envState?.failed, envState?.uvInstalled, envState?.bunInstalled])

  if (!shouldShow) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24
      }}
    >
      <Card style={{ width: 880, maxWidth: '95vw' }}>
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>
              {t('mcp.envInit.title')}
            </Typography.Title>
            <Typography.Text type="secondary">{t('mcp.envInit.description')}</Typography.Text>
          </div>

          <Steps
            current={stepIndex}
            items={[
              { title: t('mcp.envInit.steps.startCheck') },
              { title: t('mcp.envInit.steps.checkUv') },
              { title: t('mcp.envInit.steps.checkBun') },
              { title: t('mcp.envInit.steps.install') },
              { title: t('mcp.envInit.steps.activateMaaMcp') },
              { title: t('mcp.envInit.steps.complete') }
            ]}
          />

          <Progress percent={percent} />

          {envState?.failed && (
            <Alert
              type="error"
              showIcon
              message={t('mcp.envInit.errors.initFailed')}
              description={
                <div style={{ whiteSpace: 'pre-wrap' }}>
                  {envState.error?.message || t('mcp.envInit.errors.unknownError')}
                  {envState.error?.command ? `\n${t('mcp.envInit.errors.command')}${envState.error.command}` : ''}
                  {typeof envState.error?.exitCode === 'number' ? `\n${t('mcp.envInit.errors.exitCode')}${envState.error.exitCode}` : ''}
                  {envState.error?.stderrTail ? `\n\n${t('mcp.envInit.errors.stderrTail')}\n${envState.error.stderrTail}` : ''}
                  {envState.error?.stdoutTail ? `\n\n${t('mcp.envInit.errors.stdoutTail')}\n${envState.error.stdoutTail}` : ''}
                  {envState.error?.suggestion ? `\n\n${t('mcp.envInit.errors.suggestion')}${envState.error.suggestion}` : ''}
                </div>
              }
            />
          )}

          {!envState?.failed && activationStage === 'failed' && (
            <Alert
              type="error"
              showIcon
              message={t('mcp.envInit.errors.maaMcpActivateFailed')}
              description={<div style={{ whiteSpace: 'pre-wrap' }}>{activationError}</div>}
            />
          )}

          <Space wrap>
            <Button type="primary" onClick={startInit} disabled={envState?.stage?.includes('installing') || false}>
              {t('mcp.envInit.buttons.retryInit')}
            </Button>
            <Button
              onClick={() => {
                void activateMaaMcp()
              }}
              disabled={!envState?.done || envState?.failed || activationStage === 'activating'}
            >
              {t('mcp.envInit.buttons.retryActivate')}
            </Button>
            <Button
              onClick={() => {
                // 由用户手动关闭（不自动关闭）
                setVisible(false)
              }}
            >
              {t('mcp.envInit.buttons.close')}
            </Button>
          </Space>

          <Divider style={{ margin: '8px 0' }} />

          <Collapse
            defaultActiveKey={['logs']}
            items={[
              {
                key: 'logs',
                label: t('mcp.envInit.logs.title'),
                children: (
                  <List
                    size="small"
                    bordered
                    style={{ maxHeight: 260, overflow: 'auto' }}
                    dataSource={mergedLogs}
                    renderItem={(item) => {
                      const color = item.level === 'error' ? '#d32029' : item.level === 'warn' ? '#d46b08' : undefined
                      const prefix = `[${new Date(item.ts).toLocaleTimeString()}]${item.source ? `[${item.source}]` : ''}[${
                        item.level
                      }] `
                      return (
                        <List.Item style={{ padding: '6px 10px' }}>
                          <Typography.Text style={{ whiteSpace: 'pre-wrap', color }}>
                            {prefix}
                            {item.message}
                          </Typography.Text>
                        </List.Item>
                      )
                    }}
                  />
                )
              }
            ]}
          />
        </Space>
      </Card>
    </div>
  )
}
