import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query/react'
import { seedBatches } from '../data/seed'
import type { Batch, ObservationChain } from '../types'

export interface ReadinessArgs {
  batchId: string
  openDeviations: number
  chains?: ObservationChain[]
}

export const haccpApi = createApi({
  reducerPath: 'haccpApi',
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    loadBatchSnapshot: builder.query<Batch[], void>({
      queryFn: async () => ({ data: structuredClone(seedBatches) })
    }),
    checkReleaseReadiness: builder.query<{ ready: boolean; reasons: string[] }, ReadinessArgs>({
      queryFn: async ({ batchId, openDeviations, chains = [] }) => {
        const reasons: string[] = []
        if (openDeviations > 0) reasons.push(`${batchId}仍有${openDeviations}项未关闭偏差`)
        const active = chains.find(
          (chain) =>
            chain.status === '待观察' &&
            (chain.sourceBatchId === batchId || chain.records.some((record) => record.batchId === batchId))
        )
        const hasPermit = active?.releases.some((release) => release.batchId === batchId && !release.revoked)
        if (active && !hasPermit) {
          reasons.push(`效果确认链${active.id}待观察中（连续合格${active.streak}/${active.requiredBatches}组），须确认通过或签发观察许可`)
        }
        const invalidated = chains.filter(
          (chain) => chain.status === '已失效' && chain.releases.some((release) => release.batchId === batchId && release.revoked)
        )
        for (const chain of invalidated) {
          reasons.push(`观察链${chain.id}已失效，批次放行许可已撤回：${chain.invalidateReason ?? '待观察期间出现新故障'}`)
        }
        return { data: { ready: reasons.length === 0, reasons } }
      }
    })
  })
})

export const { useLoadBatchSnapshotQuery, useCheckReleaseReadinessQuery } = haccpApi
