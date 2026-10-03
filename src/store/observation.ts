import type { Batch, ObservationChain, ObservationStatus, ProcessStep } from '../types'

/** 依据控制矩阵限值判定读数是否合格（含端点） */
export function isReadingConforming(step: ProcessStep | undefined, value: number): boolean {
  if (!step) return true
  if (step.minLimit !== null && value < step.minLimit) return false
  if (step.maxLimit !== null && value > step.maxLimit) return false
  return true
}

/** 链上最后一个完整观察批次（按读数时间排序） */
export function lastCompleteRecord(chain: ObservationChain) {
  return [...chain.records].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt)).at(-1)
}

/** 某控制点当前生效中的观察链（同一控制点同时只允许一条激活链） */
export function activeChainForStep(chains: ObservationChain[], stepId: string) {
  return chains.find((chain) => chain.stepId === stepId && chain.status === '待观察')
}

export function chainsForBatch(chains: ObservationChain[], batchId: string) {
  return chains.filter(
    (chain) =>
      chain.sourceBatchId === batchId ||
      chain.records.some((record) => record.batchId === batchId) ||
      chain.releases.some((release) => release.batchId === batchId)
  )
}

export const observationStatusColor: Record<ObservationStatus, 'success' | 'warning' | 'danger'> = {
  待观察: 'warning',
  已确认: 'success',
  已失效: 'danger'
}

export interface ObservationViewModel {
  chain: ObservationChain
  remaining: number
  readyToConfirm: boolean
  /** 该批次在链上是否已有观察读数（重复提交不重复计数） */
  recordedBatches: string[]
  /** 该批次在观察期内已签发且仍有效的许可放行 */
  activeReleases: Array<{ id: string; batchId: string; signer: string; signedAt: string }>
  revokedReleases: NonNullable<ObservationChain['releases']>
}

/**
 * 三个视图（批次详情 / 偏差工作台 / 追溯导出）共用的同一观察结果口径。
 * 连续合格读数达标（streak >= requiredBatches）且没有同控制点新偏差时才 readyToConfirm；
 * 新偏差由链状态翻转为已失效表达，这里只按链状态计算。
 */
export function buildObservationView(
  chain: ObservationChain,
  step: ProcessStep | undefined,
  options?: { batchId?: string }
): ObservationViewModel {
  const required = chain.requiredBatches || step?.observationBatches || 0
  const sorted = [...chain.records].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
  const remaining = Math.max(0, required - sorted.length)
  const readyToConfirm = chain.status === '待观察' && sorted.length >= required
  const recordedBatches = Array.from(new Set(sorted.map((record) => record.batchId)))
  const activeReleases = chain.releases
    .filter((release) => !release.revoked && (!options?.batchId || release.batchId === options.batchId))
    .map((release) => ({ id: release.id, batchId: release.batchId, signer: release.signer, signedAt: release.signedAt }))
  const revokedReleases = chain.releases.filter((release) => release.revoked)
  return { chain, remaining, readyToConfirm, recordedBatches, activeReleases, revokedReleases }
}

/** 批次是否被生效观察链覆盖（源批次或已产生读数/放行的后续批次） */
export function batchObservationState(chains: ObservationChain[], batch: Batch) {
  const related = chainsForBatch(chains, batch.id)
  const active = related.find((chain) => chain.status === '待观察')
  const invalidated = related.filter((chain) => chain.status === '已失效')
  const activeRelease = active?.releases.find((release) => release.batchId === batch.id && !release.revoked)
  const revokedHere = related.flatMap((chain) =>
    chain.releases.filter((release) => release.batchId === batch.id && release.revoked).map((release) => ({ chain, release }))
  )
  return { related, active, invalidated, activeRelease, revokedHere }
}
