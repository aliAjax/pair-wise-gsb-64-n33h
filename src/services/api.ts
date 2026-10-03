import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query/react'
import { seedBatches } from '../data/seed'
import type { Batch, Deviation, EffectObservation } from '../types'
import { releaseReadiness } from './observation'

export const haccpApi = createApi({
  reducerPath: 'haccpApi',
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    loadBatchSnapshot: builder.query<Batch[], void>({
      queryFn: async () => ({ data: structuredClone(seedBatches) })
    }),
    checkReleaseReadiness: builder.query<
      { ready: boolean; reasons: string[] },
      { batch: Batch; deviations: Deviation[]; observations: EffectObservation[] }
    >({
      queryFn: async ({ batch, deviations, observations }) => ({
        data: releaseReadiness(batch, deviations, observations)
      })
    })
  })
})

export const { useLoadBatchSnapshotQuery, useCheckReleaseReadinessQuery } = haccpApi
