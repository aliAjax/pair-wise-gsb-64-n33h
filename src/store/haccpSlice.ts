import { createSlice, nanoid, type PayloadAction } from '@reduxjs/toolkit'
import { seedAudit, seedBatches, seedDeviations, seedObservations, processSteps } from '../data/seed'
import type { AuditEntry, Batch, BatchStatus, Deviation, DeviationStatus, EffectObservation, Investigation, PendingObservationWrite, ProcessStep } from '../types'
import { activeObservationsForStep, consecutiveQualified, isReadingQualified } from '../services/observation'

interface HaccpState {
  schemaVersion: number
  batches: Batch[]
  deviations: Deviation[]
  processSteps: ProcessStep[]
  observations: EffectObservation[]
  pendingWrite: PendingObservationWrite | null
  audit: AuditEntry[]
  batchFilter: string
  batchStatus: BatchStatus | '全部'
  selectedBatchId: string | null
}

const STORAGE_KEY = 'gsb64:haccp-platform'
const SCHEMA_VERSION = 2

/** 旧版本持久化状态补字段，保证升级后观察链可直接运行。 */
function migrate(raw: Partial<HaccpState>): HaccpState {
  const steps = (raw.processSteps ?? processSteps).map((step) => {
    const fallback = processSteps.find((item) => item.id === step.id)
    return {
      ...fallback,
      ...step,
      limitRange: step.limitRange ?? fallback?.limitRange ?? {},
      unit: step.unit ?? fallback?.unit ?? '',
      requiredConsecutive: step.requiredConsecutive ?? fallback?.requiredConsecutive ?? 2
    }
  })
  return {
    schemaVersion: SCHEMA_VERSION,
    batches: raw.batches ?? seedBatches,
    deviations: raw.deviations ?? seedDeviations,
    processSteps: steps,
    observations: raw.observations ?? [],
    pendingWrite: raw.pendingWrite ?? null,
    audit: raw.audit ?? seedAudit,
    batchFilter: raw.batchFilter ?? '',
    batchStatus: raw.batchStatus ?? '全部',
    selectedBatchId: raw.selectedBatchId ?? (raw.batches ?? seedBatches)[0]?.id ?? null
  }
}

function initialState(): HaccpState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return migrate(JSON.parse(raw))
  } catch {
    // Seed data remains available when local storage is unavailable or corrupt.
  }
  return { schemaVersion: SCHEMA_VERSION, batches: seedBatches, deviations: seedDeviations, processSteps, observations: seedObservations, pendingWrite: null, audit: seedAudit, batchFilter: '', batchStatus: '全部', selectedBatchId: seedBatches[0].id }
}

interface ReadingInput {
  observationId: string
  stepId: string
  batchId?: string
  value: number
  operator: string
  clientToken: string
  simulateFailure?: boolean
}

function log(state: HaccpState, entity: string, action: string, operator: string, detail: string) {
  state.audit.unshift({ id: nanoid(), entity, action, operator, detail, createdAt: new Date().toISOString() })
}

/** 待观察或已确认的观察结果失效，并同步撤回凭其签发的放行许可、补写原因。 */
function invalidateObservation(state: HaccpState, obs: EffectObservation, reason: string, operator: string) {
  if (obs.status === '已失效') return
  obs.status = '已失效'
  obs.invalidatedAt = new Date().toISOString()
  obs.invalidationReason = reason
  obs.seq += 1
  obs.version += 1
  for (const batchId of [obs.batchId, ...obs.releasedBatches]) {
    const batch = state.batches.find((item) => item.id === batchId)
    if (!batch) continue
    if (obs.releasedBatches.includes(batch.id)) {
      batch.status = '放行撤回'
      batch.withdrawalReason = reason
      batch.version += 1
      log(state, batch.id, '撤回放行', operator, `观察单${obs.id}失效，同步撤回已签发放行：${reason}`)
    } else if (batch.status === '待观察' || batch.status === '可放行') {
      batch.status = '隔离中'
      batch.withdrawalReason = reason
      batch.version += 1
      log(state, batch.id, '重新隔离', operator, `观察单${obs.id}失效，批次退出待观察：${reason}`)
    }
  }
  log(state, obs.id, '观察结果失效', operator, reason)
}

function commitReading(state: HaccpState, obs: EffectObservation, input: Omit<ReadingInput, 'simulateFailure'>, now: string) {
  const step = state.processSteps.find((item) => item.id === input.stepId)
  const qualified = isReadingQualified(step, input.value)
  obs.readings.push({
    clientToken: input.clientToken,
    stepId: input.stepId,
    batchId: input.batchId,
    value: input.value,
    unit: step?.unit ?? '',
    qualified,
    operator: input.operator,
    recordedAt: now
  })
  obs.seq += 1
  obs.lastCompleteSeq = obs.seq
  obs.version += 1
  if (input.batchId) {
    const monitored = state.batches.find((item) => item.id === input.batchId)
    if (monitored) {
      monitored.monitoring.push({ stepId: input.stepId, value: input.value, unit: step?.unit ?? '', recordedAt: now, operator: input.operator })
      monitored.version += 1
    }
  }
  const streak = consecutiveQualified(obs.readings)
  log(state, obs.id, '观察读数', input.operator, `${input.batchId ?? '后续批次'} ${step?.controlPoint ?? input.stepId} ${input.value}${step?.unit ?? ''}（${qualified ? '合格' : '不合格'}，连续${streak}/${obs.requiredConsecutive}）`)
  if (!qualified) {
    const targetBatchId = input.batchId ?? obs.batchId
    const deviation: Deviation = {
      id: `DEV-${Date.now().toString().slice(-8)}`,
      batchId: targetBatchId,
      stepId: input.stepId,
      title: `观察期${step?.controlPoint ?? input.stepId}读数${input.value}${step?.unit ?? ''}超出限值`,
      severity: '重大',
      status: '待调查',
      owner: '监控系统',
      openedAt: now,
      dueDate: now.slice(0, 10),
      investigation: { cause: '', evidence: '', decision: '返工', reworkInstruction: '' },
      reviewNote: '',
      reviewer: '',
      version: 1
    }
    state.deviations.unshift(deviation)
    log(state, deviation.id, '自动创建偏差', '监控系统', `观察期监测读数不合格，${targetBatchId}进入隔离，待观察结果失效`)
    invalidateObservation(state, obs, `监测读数${input.value}${step?.unit ?? ''}超出关键限值（${step?.limit ?? ''}），观察期出现新故障`, '监控系统')
  }
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
      if (index >= 0) state.processSteps[index] = action.payload
      log(state, action.payload.id, '修改控制措施', '质量主管', `更新${action.payload.name}关键限值或连续确认要求（${action.payload.requiredConsecutive}批）`)
    },
    updateBatchStatus(state, action: PayloadAction<{ id: string; status: BatchStatus }>) {
      const batch = state.batches.find((item) => item.id === action.payload.id)
      if (!batch) return
      const blocking = state.deviations.some((item) => item.batchId === batch.id && item.status !== '已关闭')
      const observationBlocking = state.observations.some((item) => (item.batchId === batch.id || item.releasedBatches.includes(batch.id)) && item.status !== '已确认')
      if ((action.payload.status === '可放行' || action.payload.status === '已放行') && (blocking || observationBlocking)) return
      batch.status = action.payload.status
      if (action.payload.status === '已放行') batch.withdrawalReason = undefined
      batch.version += 1
      log(state, batch.id, '批次状态流转', '质量主管', `状态更新为${action.payload.status}`)
    },
    createDeviation(state, action: PayloadAction<{ batchId: string; stepId: string; title: string; severity: '一般' | '重大'; owner: string }>) {
      const batch = state.batches.find((item) => item.id === action.payload.batchId)
      if (!batch) return
      const now = new Date().toISOString()
      const deviation: Deviation = {
        id: `DEV-${Date.now().toString().slice(-8)}`, ...action.payload, status: '待调查', openedAt: now,
        dueDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10), reviewNote: '', reviewer: '', version: 1,
        investigation: { cause: '', evidence: '', decision: '返工', reworkInstruction: '' }
      }
      state.deviations.unshift(deviation)
      batch.status = '隔离中'
      batch.version += 1
      log(state, deviation.id, '创建偏差调查', '当前用户', `批次${batch.id}因${action.payload.title}进入隔离`)
      // 同控制点任何未失效观察（待观察或已确认）立即失效，并撤回已签发放行。
      for (const obs of activeObservationsForStep(state.observations, action.payload.stepId)) {
        invalidateObservation(state, obs, `观察期内同控制点（${state.processSteps.find((s) => s.id === action.payload.stepId)?.name ?? action.payload.stepId}）新增偏差：${action.payload.title}`, action.payload.owner)
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
        // 复核通过不直接放行：先开效果观察单，批次进入待观察。
        const step = state.processSteps.find((item) => item.id === deviation.stepId)
        const now = new Date().toISOString()
        const observation: EffectObservation = {
          id: `OBS-${Date.now().toString().slice(-8)}`,
          deviationId: deviation.id,
          batchId: deviation.batchId,
          stepId: deviation.stepId,
          status: '待观察',
          requiredConsecutive: step?.requiredConsecutive ?? 2,
          approvedBy: action.payload.reviewer,
          startedAt: now,
          readings: [],
          seq: 0,
          lastCompleteSeq: 0,
          releasedBatches: [],
          conflicts: [],
          version: 1
        }
        state.observations.unshift(observation)
        if (batch && !state.deviations.some((item) => item.batchId === batch.id && item.status !== '已关闭' && item.id !== deviation.id)) {
          batch.status = deviation.investigation.decision === '报废' ? '已报废' : '待观察'
          batch.version += 1
        }
        log(state, deviation.id, '复核通过', action.payload.reviewer, action.payload.note || '纠偏措施复核通过')
        log(state, observation.id, '进入待观察', action.payload.reviewer, `${step?.name ?? deviation.stepId}纠偏进入观察期，连续${observation.requiredConsecutive}批合格且无同控制点新偏差方可确认`)
      } else {
        log(state, deviation.id, '退回补证', action.payload.reviewer, action.payload.note || '退回调查')
      }
    },
    /** 提交观察批次读数；幂等（clientToken 去重），失败时保留待重放载荷。 */
    addObservationReading(state, action: PayloadAction<ReadingInput>) {
      const input = action.payload
      if (state.pendingWrite) return // 必须先从最后一个完整观察批次恢复，才能继续写入
      const obs = state.observations.find((item) => item.id === input.observationId)
      if (!obs || obs.status !== '待观察') return
      if (obs.readings.some((item) => item.clientToken === input.clientToken)) return // 重复提交不重复计数
      const now = new Date().toISOString()
      if (input.simulateFailure) {
        state.pendingWrite = {
          clientToken: input.clientToken,
          observationId: obs.id,
          stepId: input.stepId,
          batchId: input.batchId,
          value: input.value,
          operator: input.operator,
          failedAt: now,
          checkpointSeq: obs.lastCompleteSeq
        }
        log(state, obs.id, '读数写入失败', input.operator, `监测更新未完整落盘，保留检查点seq=${obs.lastCompleteSeq}，需从最后一个完整观察批次恢复`)
        return
      }
      commitReading(state, obs, input, now)
    },
    /** 从最后一个完整观察批次恢复：幂等重放失败载荷，成功后清除待写状态。 */
    recoverPendingWrite(state) {
      const pending = state.pendingWrite
      if (!pending) return
      const obs = state.observations.find((item) => item.id === pending.observationId)
      state.pendingWrite = null
      if (!obs || obs.status !== '待观察') {
        log(state, pending.observationId, '恢复终止', pending.operator, '观察单已不存在或已失效，待写载荷不再重放')
        return
      }
      if (obs.readings.some((item) => item.clientToken === pending.clientToken)) {
        log(state, obs.id, '恢复跳过', pending.operator, '该观察批次此前已完整落盘，重复提交不重复计数')
        return
      }
      if (obs.lastCompleteSeq !== pending.checkpointSeq) {
        log(state, obs.id, '恢复中止', pending.operator, `检查点已前进（${pending.checkpointSeq}→${obs.lastCompleteSeq}），需重新拉取最新观察进度`)
        return
      }
      commitReading(state, obs, {
        observationId: obs.id,
        stepId: pending.stepId,
        batchId: pending.batchId,
        value: pending.value,
        operator: pending.operator,
        clientToken: pending.clientToken
      }, new Date().toISOString())
      log(state, obs.id, '观察恢复完成', pending.operator, `已从检查点seq=${pending.checkpointSeq}恢复并重放最后一个观察批次`)
    },
    discardPendingWrite(state, action: PayloadAction<{ reason: string }>) {
      const pending = state.pendingWrite
      if (!pending) return
      state.pendingWrite = null
      log(state, pending.observationId, '放弃待写读数', pending.operator, `放弃检查点seq=${pending.checkpointSeq}的观察批次：${action.payload.reason}`)
    },
    /** 确认效果：连续合格达标且无同控制点新偏差；滞后窗口的提交只记冲突。 */
    confirmObservation(state, action: PayloadAction<{ id: string; window: string; baseSeq: number; operator: string }>) {
      const obs = state.observations.find((item) => item.id === action.payload.id)
      if (!obs || obs.status === '已失效') return
      if (action.payload.baseSeq !== obs.seq) {
        obs.conflicts.push({
          id: nanoid(), window: action.payload.window, action: '确认', basedOnSeq: action.payload.baseSeq, latestSeq: obs.seq,
          operator: action.payload.operator, detail: `基于过期进度seq=${action.payload.baseSeq}提交确认，最新进度seq=${obs.seq}`, createdAt: new Date().toISOString()
        })
        obs.version += 1
        log(state, obs.id, '确认冲突', action.payload.operator, `${action.payload.window}基于seq=${action.payload.baseSeq}滞后提交，最新为seq=${obs.seq}，以最新观察进度为准`)
        return
      }
      const freshDeviation = state.deviations.some((d) => d.stepId === obs.stepId && d.id !== obs.deviationId && d.openedAt >= obs.startedAt)
      if (obs.status !== '待观察' || consecutiveQualified(obs.readings) < obs.requiredConsecutive || freshDeviation) {
        log(state, obs.id, '确认被阻止', action.payload.operator, freshDeviation ? '观察期存在同控制点新偏差' : `连续合格读数未达${obs.requiredConsecutive}批`)
        return
      }
      obs.status = '已确认'
      obs.confirmedAt = new Date().toISOString()
      obs.seq += 1
      obs.version += 1
      log(state, obs.id, '效果确认通过', action.payload.operator, `连续${obs.requiredConsecutive}批合格且无同控制点新偏差，纠偏效果确认`)
    },
    /** 凭已确认观察签发放行（可针对观察批次或后续批次）；滞后提交只记冲突。 */
    releaseUnderObservation(state, action: PayloadAction<{ observationId: string; batchId: string; window: string; baseSeq: number; operator: string }>) {
      const { batchId, window, baseSeq, operator } = action.payload
      const obs = state.observations.find((item) => item.id === action.payload.observationId)
      if (!obs || obs.status === '已失效') return
      if (baseSeq !== obs.seq) {
        obs.conflicts.push({
          id: nanoid(), window, action: '放行', basedOnSeq: baseSeq, latestSeq: obs.seq,
          operator, detail: `基于过期进度seq=${baseSeq}提交放行，最新进度seq=${obs.seq}`, createdAt: new Date().toISOString()
        })
        obs.version += 1
        log(state, obs.id, '放行冲突', operator, `${window}基于seq=${baseSeq}滞后提交，最新为seq=${obs.seq}，放行未生效`)
        return
      }
      const batch = state.batches.find((item) => item.id === batchId)
      if (!batch) return
      const blocking = state.deviations.some((d) => d.batchId === batch.id && d.status !== '已关闭')
      if (obs.status !== '已确认' || blocking || batch.status === '已报废' || batch.status === '已放行') {
        log(state, obs.id, '放行被阻止', operator, blocking ? `批次${batch.id}仍有未关闭偏差` : '观察效果尚未确认')
        return
      }
      batch.status = '已放行'
      batch.withdrawalReason = undefined
      batch.version += 1
      if (!obs.releasedBatches.includes(batch.id)) obs.releasedBatches.push(batch.id)
      obs.seq += 1
      obs.version += 1
      log(state, batch.id, '观察期签发放行', operator, `依据观察单${obs.id}的确认结果放行；观察单seq更新为${obs.seq}`)
    },
    resetDemo() {
      return { schemaVersion: SCHEMA_VERSION, batches: structuredClone(seedBatches), deviations: structuredClone(seedDeviations), processSteps: structuredClone(processSteps), observations: structuredClone(seedObservations), pendingWrite: null, audit: structuredClone(seedAudit), batchFilter: '', batchStatus: '全部' as const, selectedBatchId: seedBatches[0].id }
    }
  }
})

export const {
  setBatchFilter, setBatchStatus, setSelectedBatch, updateProcessStep, updateBatchStatus,
  createDeviation, saveInvestigation, reviewDeviation,
  addObservationReading, recoverPendingWrite, discardPendingWrite, confirmObservation, releaseUnderObservation,
  resetDemo
} = slice.actions
export default slice.reducer
