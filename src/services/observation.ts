import type { Batch, Deviation, EffectObservation, ObservationReading, ProcessStep } from '../types'

/** 按控制矩阵限值判定读数是否合格；缺少数值限值时仅按记录存在计为合格。 */
export function isReadingQualified(step: ProcessStep | undefined, value: number): boolean {
  if (!step) return true
  const { min, max } = step.limitRange
  if (min !== undefined && value < min) return false
  if (max !== undefined && value > max) return false
  return true
}

/** 从末尾统计连续合格读数长度，任一不合格读数会使连续计数归零。 */
export function consecutiveQualified(readings: ObservationReading[]): number {
  let count = 0
  for (let i = readings.length - 1; i >= 0; i--) {
    if (readings[i].qualified) count += 1
    else break
  }
  return count
}

/** 效果确认门槛：观察仍在进行、连续合格读数达标。 */
export function observationReady(obs: EffectObservation): boolean {
  return obs.status === '待观察' && consecutiveQualified(obs.readings) >= obs.requiredConsecutive
}

/** 观察期内是否又出现同控制点的新偏差（排除开启本次观察的原偏差）。 */
export function hasNewSameStepDeviation(obs: EffectObservation, deviations: Deviation[]): boolean {
  return deviations.some((d) => d.stepId === obs.stepId && d.id !== obs.deviationId && d.openedAt >= obs.startedAt)
}

/** 批次关联的观察单：按批次本身、已签发放行批次匹配，取最新一条。 */
export function observationForBatch(observations: EffectObservation[], batchId: string | undefined): EffectObservation | undefined {
  if (!batchId) return undefined
  return observations
    .filter((o) => o.batchId === batchId || o.releasedBatches.includes(batchId))
    .sort((a, b) => b.seq - a.seq)[0]
}

export function observationForDeviation(observations: EffectObservation[], deviationId: string): EffectObservation | undefined {
  return [...observations].filter((o) => o.deviationId === deviationId).sort((a, b) => b.seq - a.seq)[0]
}

export function activeObservationsForStep(observations: EffectObservation[], stepId: string): EffectObservation[] {
  return observations.filter((o) => o.stepId === stepId && o.status !== '已失效')
}

/** 批次放行准备度：未关闭偏差与未确认的观察结果都会阻止放行。 */
export function releaseReadiness(
  batch: Batch,
  deviations: Deviation[],
  observations: EffectObservation[]
): { ready: boolean; reasons: string[] } {
  const reasons: string[] = []
  const open = deviations.filter((d) => d.batchId === batch.id && d.status !== '已关闭')
  if (open.length) reasons.push(`${batch.id}仍有${open.length}项未关闭偏差`)
  const linked = observations.filter((o) => o.batchId === batch.id || o.releasedBatches.includes(batch.id))
  for (const obs of linked) {
    if (obs.status === '待观察') reasons.push(`观察单${obs.id}仍在待观察，效果尚未确认`)
    if (obs.status === '已失效') reasons.push(`观察单${obs.id}已失效，放行许可已撤回：${obs.invalidationReason ?? ''}`)
  }
  if (batch.status === '已报废') reasons.push('批次已报废')
  return { ready: reasons.length === 0, reasons }
}

/** 追溯导出中批次/偏差共用的观察结果投影，保证三处显示一致。 */
export function observationSnapshot(obs: EffectObservation, steps: ProcessStep[]) {
  const step = steps.find((s) => s.id === obs.stepId)
  return {
    id: obs.id,
    deviationId: obs.deviationId,
    controlPoint: step ? `${step.name} · ${step.controlPoint}` : obs.stepId,
    status: obs.status,
    seq: obs.seq,
    requiredConsecutive: obs.requiredConsecutive,
    consecutiveQualified: consecutiveQualified(obs.readings),
    startedAt: obs.startedAt,
    confirmedAt: obs.confirmedAt,
    invalidatedAt: obs.invalidatedAt,
    invalidationReason: obs.invalidationReason,
    releasedBatches: obs.releasedBatches,
    readings: obs.readings,
    conflicts: obs.conflicts
  }
}
