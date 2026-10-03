import { createSlice, nanoid, type PayloadAction } from '@reduxjs/toolkit'
import { seedAudit, seedBatches, seedChains, seedDeviations, processSteps } from '../data/seed'
import type {
  AuditEntry, Batch, BatchStatus, Deviation, DeviationStatus, Investigation, ObservationAction,
  ObservationChain, ProcessStep, StagedObservation
} from '../types'
import { activeChainForStep, isReadingConforming, lastCompleteRecord } from './observation'

interface HaccpState {
  batches: Batch[]
  deviations: Deviation[]
  processSteps: ProcessStep[]
  observationChains: ObservationChain[]
  /** 写入失败后暂存的观察读数，恢复时从最后一个完整观察批次重放 */
  stagedObservations: StagedObservation[]
  audit: AuditEntry[]
  batchFilter: string
  batchStatus: BatchStatus | '全部'
  selectedBatchId: string | null
}

const STORAGE_KEY = 'gsb64:haccp-platform'

function migrate(raw: Partial<HaccpState>): HaccpState {
  const steps = (raw.processSteps ?? processSteps).map((step) => {
    const fallback = processSteps.find((item) => item.id === step.id)
    return {
      ...step,
      observationRequired: step.observationRequired ?? fallback?.observationRequired ?? false,
      observationBatches: step.observationBatches ?? fallback?.observationBatches ?? 0,
      unit: step.unit ?? fallback?.unit ?? '',
      minLimit: step.minLimit ?? fallback?.minLimit ?? null,
      maxLimit: step.maxLimit ?? fallback?.maxLimit ?? null
    } as ProcessStep
  })
  return {
    batches: raw.batches ?? seedBatches,
    deviations: raw.deviations ?? seedDeviations,
    processSteps: steps,
    observationChains: raw.observationChains ?? seedChains,
    stagedObservations: raw.stagedObservations ?? [],
    audit: raw.audit ?? seedAudit,
    batchFilter: raw.batchFilter ?? '',
    batchStatus: raw.batchStatus ?? '全部',
    selectedBatchId: raw.selectedBatchId ?? seedBatches[0].id
  }
}

function initialState(): HaccpState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return migrate(JSON.parse(raw))
  } catch {
    // Seed data remains available when local storage is unavailable or corrupt.
  }
  return migrate({ batches: seedBatches, deviations: seedDeviations, processSteps, observationChains: seedChains, stagedObservations: [], audit: seedAudit, batchFilter: '', batchStatus: '全部', selectedBatchId: seedBatches[0].id })
}

const nowIso = () => new Date().toISOString()

function log(state: HaccpState, entity: string, action: string, operator: string, detail: string, createdAt?: string) {
  state.audit.unshift({ id: nanoid(), entity, action, operator, detail, createdAt: createdAt ?? nowIso() })
}

/**
 * 待观察结果失效：链翻为已失效，观察期内已签发的放行许可全部同步撤回并补写原因，
 * 凭许可放行的后续批次重新隔离。
 */
function invalidateChain(state: HaccpState, chain: ObservationChain, reason: string, operator: string, at: string) {
  if (chain.status !== '待观察') return
  chain.status = '已失效'
  chain.invalidatedAt = at
  chain.invalidateReason = reason
  chain.version += 1
  log(state, chain.id, '待观察结果失效', operator, `${reason}；连续${chain.streak}组合格读数作废，确认链关闭`, at)
  for (const release of chain.releases) {
    if (release.revoked) continue
    release.revoked = true
    release.revokedAt = at
    release.revokeReason = reason
    const releasedBatch = state.batches.find((item) => item.id === release.batchId)
    if (releasedBatch && releasedBatch.status === '已放行') {
      releasedBatch.status = '隔离中'
      releasedBatch.isolationScope = `观察许可撤回（${chain.id}）：${reason}`
      releasedBatch.version += 1
    }
    log(state, release.batchId, '放行许可撤回', operator, `${chain.id}待观察结果失效（${reason}），${release.signer}于${release.signedAt.slice(5, 16)}签发的观察期放行同步撤回`, at)
  }
}

function registerDeviation(
  state: HaccpState,
  payload: { batchId: string; stepId: string; title: string; severity: '一般' | '重大'; owner: string; openedAt?: string }
): Deviation {
  const at = payload.openedAt ?? nowIso()
  const deviation: Deviation = {
    id: `DEV-${Date.now().toString().slice(-8)}-${Math.floor(Math.random() * 90 + 10)}`,
    batchId: payload.batchId, stepId: payload.stepId, title: payload.title, severity: payload.severity,
    status: '待调查', owner: payload.owner, openedAt: at,
    dueDate: new Date(at).toISOString().slice(0, 10), reviewNote: '', reviewer: '', version: 1,
    investigation: { cause: '', evidence: '', decision: '返工', reworkInstruction: '' }
  }
  state.deviations.unshift(deviation)
  const batch = state.batches.find((item) => item.id === payload.batchId)
  if (batch && batch.status !== '已报废') {
    batch.status = '隔离中'
    batch.version += 1
  }
  log(state, deviation.id, '创建偏差调查', payload.owner, `批次${payload.batchId}因${payload.title}进入隔离`, at)
  return deviation
}

/**
 * 复核通过后为控制点开启效果确认链（同控制点已有激活链时不重复开启）。
 */
function openObservationChain(state: HaccpState, deviation: Deviation, step: ProcessStep) {
  const existing = activeChainForStep(state.observationChains, step.id)
  if (existing) {
    log(state, existing.id, '待观察继续', deviation.reviewer, `偏差${deviation.id}复核通过，控制点${step.name}已有待观察链，沿用原观察进度（第${existing.streak}/${existing.requiredBatches}组）`)
    return existing
  }
  const chain: ObservationChain = {
    id: `OBS-${Date.now().toString().slice(-8)}`,
    stepId: step.id,
    sourceDeviationId: deviation.id,
    sourceBatchId: deviation.batchId,
    status: '待观察',
    requiredBatches: step.observationBatches,
    streak: 0,
    records: [],
    releases: [],
    conflicts: [],
    failedWrites: [],
    openedAt: nowIso(),
    version: 1
  }
  state.observationChains.unshift(chain)
  log(state, chain.id, '进入待观察', deviation.reviewer, `${step.name}纠偏措施复核通过，连续${step.observationBatches}组合格读数且无同控制点新偏差后方可确认效果`)
  return chain
}

function findChain(state: HaccpState, chainId: string) {
  return state.observationChains.find((item) => item.id === chainId)
}

/** 确认/放行到达时与最新观察进度比对，滞后提交只保留冲突记录，不改变进度版本 */
function registerConflict(
  state: HaccpState, chain: ObservationChain,
  info: { windowId: string; action: ObservationAction; baseStreak: number; baseVersion: number; leadingWindow: string; reason: string }
) {
  chain.conflicts.push({
    id: nanoid(), chainId: chain.id, windowId: info.windowId, action: info.action,
    baseStreak: info.baseStreak, baseVersion: info.baseVersion,
    leadingWindow: info.leadingWindow, leadingStreak: chain.streak,
    reason: info.reason, submittedAt: nowIso(), createdAt: nowIso()
  })
  log(state, chain.id, '并发提交冲突', info.windowId, `窗口「${info.windowId}」基于V${info.baseVersion}/第${info.baseStreak}组提交${info.action}：${info.reason}（最新进度V${chain.version}/第${chain.streak}组），滞后提交仅登记冲突，不重复计数`)
}

function applyObservationDecision(
  state: HaccpState, chain: ObservationChain,
  submission: { windowId: string; action: ObservationAction; batchId?: string; operator: string; at: string }
): { applied: boolean; reason?: string } {
  if (chain.status !== '待观察') return { applied: false, reason: `确认链已${chain.status}，提交不生效` }
  if (submission.action === '确认') {
    if (chain.streak < chain.requiredBatches) {
      return { applied: false, reason: `连续合格读数未达标（${chain.streak}/${chain.requiredBatches}）` }
    }
    chain.status = '已确认'
    chain.confirmedAt = submission.at
    chain.confirmer = submission.operator
    chain.version += 1
    log(state, chain.id, '效果确认通过', submission.operator, `连续${chain.streak}组合格读数达标且观察期内无同控制点新偏差，纠偏措施效果确认`, submission.at)
    const source = state.batches.find((item) => item.id === chain.sourceBatchId)
    if (source && source.status === '待观察' && !state.deviations.some((d) => d.batchId === source.id && d.status !== '已关闭')) {
      source.status = '可放行'
      source.version += 1
      log(state, source.id, '批次状态流转', submission.operator, '观察链确认通过，源批次恢复正常放行流程', submission.at)
    }
    return { applied: true }
  }
  // 放行：观察期许可签发（链失效时自动撤回）
  const batchId = submission.batchId
  if (!batchId) return { applied: false, reason: '缺少放行批次' }
  const existing = chain.releases.find((release) => release.batchId === batchId && !release.revoked)
  if (existing) return { applied: false, reason: `批次${batchId}已持有观察放行许可，重复签发不重复计数` }
  const batch = state.batches.find((item) => item.id === batchId)
  chain.releases.push({
    id: nanoid(), chainId: chain.id, batchId, windowId: submission.windowId,
    signer: submission.operator, signedAt: submission.at, revoked: false
  })
  chain.version += 1
  if (batch && batch.status !== '已报废') {
    batch.status = '已放行'
    batch.version += 1
  }
  log(state, batchId, '观察许可放行', submission.operator, `窗口「${submission.windowId}」在${chain.id}待观察期内（${chain.streak}/${chain.requiredBatches}组）签发临时放行，链确认后转为正式放行；链失效将自动撤回`, submission.at)
  return { applied: true }
}

const slice = createSlice({
  name: 'haccp',
  initialState,
  reducers: {
    setBatchFilter(state, action: PayloadAction<string>) { state.batchFilter = action.payload },
    setBatchStatus(state, action: PayloadAction<BatchStatus | '全部'>) { state.batchStatus = action.payload },
    setSelectedBatch(state, action: PayloadAction<string | null>) { state.selectedBatchId = action.payload },

    updateProcessStep(state, action: PayloadAction<ProcessStep>) {
      const index = state.processSteps.findIndex((item) => item.id === action.payload.id)
      if (index < 0) return
      state.processSteps[index] = action.payload
      log(state, action.payload.id, '修改控制措施', '质量主管', `更新${action.payload.name}限值/监控/纠偏措施；观察要求：${action.payload.observationRequired ? `启用，连续${action.payload.observationBatches}组` : '不启用'}`)
    },

    updateBatchStatus(state, action: PayloadAction<{ id: string; status: BatchStatus }>) {
      const batch = state.batches.find((item) => item.id === action.payload.id)
      if (!batch) return
      const blocking = state.deviations.some((item) => item.batchId === batch.id && item.status !== '已关闭')
      if (action.payload.status === '可放行' && blocking) {
        log(state, batch.id, '放行被阻止', '质量主管', '存在未关闭偏差，系统阻止标记为可放行')
        return
      }
      // 处于效果观察链覆盖下的批次不得绕过观察许可直接放行
      const activeChain = state.observationChains.find(
        (chain) => chain.status === '待观察' &&
          (chain.sourceBatchId === batch.id || chain.records.some((r) => r.batchId === batch.id))
      )
      const hasPermit = activeChain?.releases.some((release) => release.batchId === batch.id && !release.revoked)
      if ((action.payload.status === '可放行' || action.payload.status === '已放行') && activeChain && !hasPermit) {
        log(state, batch.id, '放行被阻止', '质量主管', `效果确认链${activeChain.id}处于待观察（${activeChain.streak}/${activeChain.requiredBatches}组），须先完成观察确认或签发观察许可`)
        return
      }
      batch.status = action.payload.status
      batch.version += 1
      log(state, batch.id, '批次状态流转', '质量主管', `状态更新为${action.payload.status}`)
    },

    createDeviation(state, action: PayloadAction<{ batchId: string; stepId: string; title: string; severity: '一般' | '重大'; owner: string }>) {
      const deviation = registerDeviation(state, action.payload)
      // 同控制点出现新偏差：待观察结果立即失效，已签发放行同步撤回
      const chain = activeChainForStep(state.observationChains, action.payload.stepId)
      if (chain) {
        const step = state.processSteps.find((item) => item.id === action.payload.stepId)
        invalidateChain(state, chain, `同控制点${step?.name ?? action.payload.stepId}发生新偏差${deviation.id}（${action.payload.title}）`, deviation.owner, deviation.openedAt)
      }
    },

    saveInvestigation(state, action: PayloadAction<{ id: string; investigation: Investigation }>) {
      const deviation = state.deviations.find((item) => item.id === action.payload.id)
      if (!deviation || !action.payload.investigation.cause.trim() || !action.payload.investigation.evidence.trim()) return
      deviation.investigation = action.payload.investigation
      deviation.status = '待复核'
      deviation.version += 1
      log(state, deviation.id, '提交偏差调查', deviation.owner, `处置分支：${deviation.investigation.decision}`)
    },

    reviewDeviation(state, action: PayloadAction<{ id: string; approved: boolean; note: string; reviewer: string }>) {
      const deviation = state.deviations.find((item) => item.id === action.payload.id)
      if (!deviation) return
      if (action.payload.approved && !action.payload.note.trim()) return
      deviation.reviewNote = action.payload.note
      deviation.reviewer = action.payload.reviewer
      deviation.status = action.payload.approved ? '已关闭' : '调查中'
      deviation.version += 1
      const batch = state.batches.find((item) => item.id === deviation.batchId)
      if (action.payload.approved) {
        const step = state.processSteps.find((item) => item.id === deviation.stepId)
        // 复核通过不直接放行：进入待观察，连续合格读数达标且无同控制点新偏差才确认
        let chain: ObservationChain | undefined
        if (step?.observationRequired && deviation.investigation.decision !== '报废') {
          chain = openObservationChain(state, deviation, step)
        }
        const otherOpen = state.deviations.some((item) => item.batchId === deviation.batchId && item.status !== '已关闭' && item.id !== deviation.id)
        if (batch && !otherOpen) {
          if (deviation.investigation.decision === '报废') {
            batch.status = '已报废'
          } else if (chain) {
            batch.status = '待观察'
          } else {
            batch.status = '待复核'
          }
          batch.version += 1
        }
        log(state, deviation.id, '复核通过', action.payload.reviewer, chain ? `纠偏措施复核通过，批次进入待观察（确认链${chain.id}），班组不得直接放行后续批次` : action.payload.note)
      } else {
        log(state, deviation.id, '退回补证', action.payload.reviewer, action.payload.note || '退回调查')
      }
    },

    /**
     * 提交监测读数。
     * - 合格读数自动喂给该控制点激活中的观察链（同一 clientToken 或同一批次同一时刻重复提交不重复计数）；
     * - 不合格读数/故障：待观察结果失效、放行撤回，并自动登记同控制点偏差、批次隔离；
     * - forceFailure 模拟写入失败：主数据完全不写入，读数进入暂存区，事后从最后一个完整观察批次恢复。
     */
    recordMonitoring(state, action: PayloadAction<{
      batchId: string; stepId: string; value: number; operator: string
      recordedAt: string; clientToken: string; forceFailure?: boolean
    }>) {
      const p = action.payload
      const batch = state.batches.find((item) => item.id === p.batchId)
      const step = state.processSteps.find((item) => item.id === p.stepId)
      if (!batch || !step) return
      const conforming = isReadingConforming(step, p.value)
      const chain = activeChainForStep(state.observationChains, p.stepId)

      if (p.forceFailure) {
        // 事务失败：链、批次均不写入，仅暂存待恢复
        if (!chain) {
          log(state, p.batchId, '监测写入失败', p.operator, `${step.controlPoint}读数${p.value}${step.unit}写入失败且无激活观察链，读数丢弃待补录`)
          return
        }
        if (chain.records.some((r) => r.clientToken === p.clientToken) || state.stagedObservations.some((s) => s.clientToken === p.clientToken)) {
          log(state, chain.id, '重复提交忽略', p.operator, `令牌${p.clientToken.slice(0, 8)}的失败读数已暂存，重复提交不重复计数`)
          return
        }
        state.stagedObservations.push({
          chainId: chain.id, batchId: p.batchId, stepId: p.stepId, value: p.value, unit: step.unit,
          operator: p.operator, recordedAt: p.recordedAt, clientToken: p.clientToken, failedAt: nowIso()
        })
        chain.failedWrites.push({ clientToken: p.clientToken, batchId: p.batchId, at: nowIso(), reason: '模拟存储写入失败', recovered: false })
        log(state, chain.id, '观察读数写入失败', p.operator, `批次${p.batchId}的${step.controlPoint}读数${p.value}${step.unit}未写入确认链（第${chain.streak}/${chain.requiredBatches}组保持不变），可从最后一个完整观察批次${lastCompleteRecord(chain)?.batchId ?? '无'}恢复`)
        return
      }

      // 主数据：批次监测记录 upsert（同一时刻同一控制点视为同一条读数）
      const existingIdx = batch.monitoring.findIndex((m) => m.stepId === p.stepId && m.recordedAt === p.recordedAt)
      if (existingIdx >= 0) {
        batch.monitoring[existingIdx] = { ...batch.monitoring[existingIdx], value: p.value, operator: p.operator, conforming, clientToken: p.clientToken }
      } else {
        batch.monitoring.push({ stepId: p.stepId, value: p.value, unit: step.unit, recordedAt: p.recordedAt, operator: p.operator, conforming, clientToken: p.clientToken })
      }
      batch.version += 1
      log(state, batch.id, conforming ? '监测读数更新' : '关键限值偏离报警', p.operator, `${step.controlPoint}读数${p.value}${step.unit}（限值${step.limit}）`, p.recordedAt)

      if (!conforming) {
        // 新故障：待观察结果失效 + 已签发放行撤回（补写原因）+ 自动登记偏差
        const deviation = registerDeviation(state, {
          batchId: p.batchId, stepId: p.stepId, severity: '重大', owner: p.operator || '监控系统',
          title: `${step.name}读数${p.value}${step.unit}超出关键限值`, openedAt: p.recordedAt
        })
        if (chain) {
          invalidateChain(state, chain, `监测更新：批次${p.batchId}${step.controlPoint}读数${p.value}${step.unit}超出限值（${step.limit}），偏差${deviation.id}`, p.operator || '监控系统', p.recordedAt)
        }
        // 故障读数不进入观察计数
        state.stagedObservations = state.stagedObservations.filter((s) => s.clientToken !== p.clientToken)
        return
      }

      if (!chain || chain.status !== '待观察') return

      // 幂等：同一 clientToken 重复提交 / 同一批次同一时刻读数重复提交，均不重复计数
      const tokenRecord = chain.records.find((r) => r.clientToken === p.clientToken)
      const duplicate = chain.records.find((r) => r.batchId === p.batchId && r.recordedAt === p.recordedAt)
      if (tokenRecord || duplicate) {
        const target = tokenRecord ?? duplicate!
        target.value = p.value
        target.conforming = true
        log(state, chain.id, '重复提交忽略', p.operator, `批次${p.batchId}读数重复提交（令牌${p.clientToken.slice(0, 8)}），观察计数保持第${chain.streak}/${chain.requiredBatches}组，不重复计数`, p.recordedAt)
        return
      }
      chain.records.push({
        id: nanoid(), chainId: chain.id, batchId: p.batchId, stepId: p.stepId,
        value: p.value, unit: step.unit, conforming: true,
        recordedAt: p.recordedAt, operator: p.operator, clientToken: p.clientToken
      })
      chain.streak = chain.records.length
      chain.version += 1
      log(state, chain.id, '观察读数入账', p.operator, `批次${p.batchId}合格读数入账，连续合格进度第${chain.streak}/${chain.requiredBatches}组`, p.recordedAt)
    },

    /** 单窗口提交确认或放行；基于过期观察进度时保留冲突记录，不生效、不改版本 */
    submitObservation(state, action: PayloadAction<{
      chainId: string; action: ObservationAction; windowId: string; batchId?: string
      operator: string; baseVersion: number; baseStreak: number
    }>) {
      const chain = findChain(state, action.payload.chainId)
      if (!chain) return
      const s = action.payload
      if (s.baseVersion !== chain.version || s.baseStreak !== chain.streak) {
        registerConflict(state, chain, {
          windowId: s.windowId, action: s.action, baseStreak: s.baseStreak, baseVersion: s.baseVersion,
          leadingWindow: '最新观察进度',
          reason: `窗口进度已滞后于最新观察读数（V${chain.version}/第${chain.streak}组）`
        })
        return
      }
      const result = applyObservationDecision(state, chain, { windowId: s.windowId, action: s.action, batchId: s.batchId, operator: s.operator, at: nowIso() })
      if (!result.applied) log(state, chain.id, `${s.action}被拒绝`, s.windowId, result.reason ?? '条件不满足')
    },

    /**
     * 两个窗口同时提交确认或放行：统一按提交时刻（再按窗口名）排序，
     * 以最新观察进度为准执行领先一方；滞后一方保留冲突记录，不重复计数。
     */
    submitObservationPair(state, action: PayloadAction<{
      chainId: string
      submissions: Array<{ windowId: string; action: ObservationAction; batchId?: string; operator: string; submittedAt: string }>
    }>) {
      const chain = findChain(state, action.payload.chainId)
      if (!chain || chain.status !== '待观察') return
      const ordered = [...action.payload.submissions].sort((a, b) =>
        a.submittedAt.localeCompare(b.submittedAt) || a.windowId.localeCompare(b.windowId)
      )
      const [leader, ...laggards] = ordered
      const beforeStreak = chain.streak
      const beforeVersion = chain.version
      const leaderResult = applyObservationDecision(state, chain, {
        windowId: leader.windowId, action: leader.action, batchId: leader.batchId,
        operator: leader.operator, at: leader.submittedAt
      })
      if (!leaderResult.applied) {
        log(state, chain.id, '并发提交未生效', leader.windowId, `领先提交「${leader.windowId}·${leader.action}」被拒绝：${leaderResult.reason}`)
      }
      for (const laggard of laggards) {
        registerConflict(state, chain, {
          windowId: laggard.windowId, action: laggard.action,
          baseStreak: beforeStreak, baseVersion: beforeVersion,
          leadingWindow: leader.windowId,
          reason: `与窗口「${leader.windowId}·${leader.action}」同时提交，「${leader.windowId}」按最新观察进度（提交时刻${leader.submittedAt.slice(11, 19)}）先执行，本窗口${laggard.action}不生效`
        })
      }
    },

    /** 写入失败后的恢复：从最后一个完整观察批次重放暂存读数，重复令牌不重复计数 */
    recoverObservation(state, action: PayloadAction<{ chainId: string }>) {
      const chain = findChain(state, action.payload.chainId)
      if (!chain) return
      const staged = state.stagedObservations.filter((item) => item.chainId === chain.id)
      if (staged.length === 0) {
        log(state, chain.id, '恢复无操作', '系统', '暂存区为空，最后一个完整观察批次之后无待恢复读数')
        return
      }
      const checkpoint = lastCompleteRecord(chain)
      let recovered = 0
      const skipped: string[] = []
      for (const item of staged.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))) {
        if (chain.status !== '待观察') {
          skipped.push(`${item.batchId}(链已${chain.status})`)
          continue
        }
        if (chain.records.some((r) => r.clientToken === item.clientToken)) {
          skipped.push(`${item.batchId}(重复令牌)`)
          continue
        }
        const step = state.processSteps.find((s) => s.id === item.stepId)
        if (!isReadingConforming(step, item.value)) {
          // 恢复重放期间遇到故障读数：链失效并登记偏差，其余暂存不再入账
          const deviation = registerDeviation(state, {
            batchId: item.batchId, stepId: item.stepId, severity: '重大', owner: item.operator,
            title: `${step?.name ?? item.stepId}读数${item.value}${item.unit}超出关键限值（恢复重放）`, openedAt: item.recordedAt
          })
          invalidateChain(state, chain, `恢复重放时批次${item.batchId}读数${item.value}${item.unit}超出限值，偏差${deviation.id}`, item.operator, item.recordedAt)
          skipped.push('其余暂存读数随链失效作废')
          break
        }
        chain.records.push({
          id: nanoid(), chainId: chain.id, batchId: item.batchId, stepId: item.stepId,
          value: item.value, unit: item.unit, conforming: true,
          recordedAt: item.recordedAt, operator: item.operator, clientToken: item.clientToken
        })
        // 同步回补批次监测记录（失败时主数据未写入），同一时刻同一控制点做幂等更新
        const targetBatch = state.batches.find((b) => b.id === item.batchId)
        if (targetBatch) {
          const idx = targetBatch.monitoring.findIndex((m) => m.stepId === item.stepId && m.recordedAt === item.recordedAt)
          const recoveredReading = { stepId: item.stepId, value: item.value, unit: item.unit, recordedAt: item.recordedAt, operator: item.operator, conforming: true, clientToken: item.clientToken }
          if (idx >= 0) targetBatch.monitoring[idx] = recoveredReading
          else targetBatch.monitoring.push(recoveredReading)
          targetBatch.version += 1
        }
        recovered += 1
      }
      chain.streak = chain.records.length
      if (chain.status === '待观察') chain.version += 1
      for (const failure of chain.failedWrites) failure.recovered = true
      state.stagedObservations = state.stagedObservations.filter((item) => item.chainId !== chain.id)
      log(
        state, chain.id, '观察链恢复', '系统',
        `从最后一个完整观察批次${checkpoint ? `${checkpoint.batchId}（${checkpoint.recordedAt.slice(5, 16)}）` : '空链'}恢复，补写${recovered}组合格读数，进度恢复至第${chain.streak}/${chain.requiredBatches}组${skipped.length ? `；跳过：${skipped.join('、')}` : ''}`
      )
    },

    /** 手工撤回待观察结果（补写原因），已签发放行同步撤回 */
    revokeObservation(state, action: PayloadAction<{ chainId: string; reason: string; operator: string }>) {
      const chain = findChain(state, action.payload.chainId)
      if (!chain || chain.status !== '待观察' || !action.payload.reason.trim()) return
      invalidateChain(state, chain, action.payload.reason.trim(), action.payload.operator, nowIso())
    },

    clearConflictRecords(state, action: PayloadAction<{ chainId: string }>) {
      const chain = findChain(state, action.payload.chainId)
      if (!chain) return
      const count = chain.conflicts.length
      chain.conflicts = []
      log(state, chain.id, '冲突记录归档', '质量主管', `归档${count}条滞后窗口冲突记录（仅归档展示，审计保留）`)
    },

    resetDemo() {
      return migrate({
        batches: structuredClone(seedBatches), deviations: structuredClone(seedDeviations),
        processSteps: structuredClone(processSteps), observationChains: structuredClone(seedChains),
        stagedObservations: [], audit: structuredClone(seedAudit),
        batchFilter: '', batchStatus: '全部', selectedBatchId: seedBatches[0].id
      })
    }
  }
})

export const {
  setBatchFilter, setBatchStatus, setSelectedBatch, updateProcessStep, updateBatchStatus,
  createDeviation, saveInvestigation, reviewDeviation, recordMonitoring,
  submitObservation, submitObservationPair, recoverObservation, revokeObservation,
  clearConflictRecords, resetDemo
} = slice.actions
export default slice.reducer
