import { useEffect, useState } from 'react'
import { Badge, Button, Checkbox, Field, Input, Spinner } from '@fluentui/react-components'
import { useDispatch, useSelector } from 'react-redux'
import type { AppDispatch, RootState } from '../store'
import { addObservationReading, confirmObservation, discardPendingWrite, recoverPendingWrite, releaseUnderObservation } from '../store/haccpSlice'
import { consecutiveQualified, hasNewSameStepDeviation, observationForBatch, observationForDeviation, observationReady } from '../services/observation'
import type { EffectObservation } from '../types'

const statusColor = (status: EffectObservation['status']) =>
  status === '已确认' ? 'success' : status === '已失效' ? 'danger' : 'important'

interface Props {
  /** 窗口名：批次详情 / 偏差工作台，冲突记录据此区分来源。 */
  windowName: string
  batchId?: string
  deviationId?: string
}

/**
 * 效果确认链唯一操作面板：批次详情与偏差工作台渲染同一组件、读取同一观察单，
 * 保证两处显示同一观察结果。
 */
export function ObservationCard({ windowName, batchId, deviationId }: Props) {
  const dispatch = useDispatch<AppDispatch>()
  const { observations, deviations, batches, processSteps, pendingWrite } = useSelector((root: RootState) => root.haccp)

  const byDeviation = deviationId ? observationForDeviation(observations, deviationId) : undefined
  const byBatch = batchId ? observationForBatch(observations, batchId) : undefined
  const obs = byDeviation ?? byBatch
  const step = processSteps.find((item) => item.id === obs?.stepId)

  // 本窗口持有的观察进度快照；obs.seq 变化即说明另一窗口有更新。
  const [syncedSeq, setSyncedSeq] = useState<number | null>(null)
  useEffect(() => { setSyncedSeq(null) }, [obs?.id])
  const baseSeq = syncedSeq ?? obs?.seq ?? 0
  const stale = !!obs && baseSeq !== obs.seq

  const [nextBatchId, setNextBatchId] = useState('')
  const [value, setValue] = useState('')
  const [simulateFailure, setSimulateFailure] = useState(false)

  useEffect(() => { setValue(step ? String(step.limitRange.min ?? step.limitRange.max ?? '') : '') }, [step?.id])

  if (!obs) return null
  const streak = consecutiveQualified(obs.readings)
  const ready = observationReady(obs) && !hasNewSameStepDeviation(obs, deviations)
  const pendingForThis = pendingWrite?.observationId === obs.id ? pendingWrite : null
  const targetBatchId = nextBatchId.trim() || obs.batchId
  const operator = windowName === '批次详情窗口' ? '班组值班长' : '质量复核员'

  const submitReading = (token: string, failure: boolean) => {
    const numeric = Number(value)
    if (Number.isNaN(numeric)) return
    dispatch(addObservationReading({ observationId: obs.id, stepId: obs.stepId, batchId: nextBatchId.trim() || undefined, value: numeric, operator, clientToken: token, simulateFailure: failure }))
  }

  return (
    <div className="observation-card">
      <div className="record-title">
        <div><span>纠偏效果确认链 · {windowName}</span><h2>{obs.id}</h2></div>
        <Badge appearance="tint" color={statusColor(obs.status)}>{obs.status}</Badge>
      </div>

      <dl>
        <div><dt>控制点</dt><dd>{step?.name} · {step?.controlPoint}</dd></div>
        <div><dt>复核通过人</dt><dd>{obs.approvedBy}</dd></div>
        <div><dt>连续合格</dt><dd><strong>{streak} / {obs.requiredConsecutive}</strong> 批</dd></div>
        <div><dt>已签发放行</dt><dd>{obs.releasedBatches.length ? obs.releasedBatches.join('、') : '暂无'}</dd></div>
      </dl>

      <div className="sync-band">
        <div>
          <strong>窗口进度快照 seq={baseSeq}</strong>
          <small>观察单最新 seq={obs.seq}{stale ? '（本窗口滞后）' : '（与最新一致）'}</small>
        </div>
        <Button size="small" appearance={stale ? 'primary' : 'subtle'} disabled={!stale} onClick={() => setSyncedSeq(obs.seq)}>
          {stale ? '拉取最新观察进度' : '已是最新'}
        </Button>
      </div>

      {obs.status === '待观察' && (
        <>
          <div className="progress-track">
            {Array.from({ length: obs.requiredConsecutive }, (_, i) =>
              <i key={i} className={i < streak ? 'ok' : ''}>{i < streak ? '✓' : i + 1}</i>
            )}
          </div>
          <div className="reading-form">
            <Field label="观察批次（留空为原批次）">
              <Input value={nextBatchId} onChange={(_, d) => setNextBatchId(d.value)} placeholder={`默认 ${obs.batchId}`} />
            </Field>
            <Field label={`${step?.controlPoint ?? '读数'}（${step?.unit ?? ''}，限值 ${step?.limit ?? '—'}）`}>
              <Input value={value} input={{ inputMode: 'decimal' }} onChange={(_, d) => setValue(d.value)} />
            </Field>
            <Checkbox checked={simulateFailure} onChange={(_, d) => setSimulateFailure(d.checked as boolean)} label="模拟本次写入失败" />
            <Button appearance="primary" disabled={value === '' || Number.isNaN(Number(value)) || !!pendingWrite}
              onClick={() => submitReading(`tok-${obs.id}-${Date.now()}-${Math.round(Number(value) * 100)}`, simulateFailure)}>
              提交观察批次
            </Button>
          </div>

          {pendingForThis && (
            <div className="recovery-band">
              <Spinner size="extra-tiny" label='' />
              <div>
                <strong>写入失败：观察批次未完整落盘</strong>
                <small>最后一个完整观察批次检查点 seq={pendingForThis.checkpointSeq}；重复提交不会重复计数。</small>
              </div>
              <Button size="small" appearance="primary" onClick={() => dispatch(recoverPendingWrite())}>从检查点恢复并重放</Button>
              <Button size="small" appearance="subtle" onClick={() => dispatch(discardPendingWrite({ reason: '人工放弃重放' }))}>放弃</Button>
            </div>
          )}

          <div className="record-actions">
            <Button appearance="primary" disabled={!ready}
              onClick={() => dispatch(confirmObservation({ id: obs.id, window: windowName, baseSeq, operator }))}>
              {ready ? '确认纠偏效果' : `连续合格未达标（${streak}/${obs.requiredConsecutive}）`}
            </Button>
            <Button disabled={batches.find((b) => b.id === targetBatchId)?.status === '已放行'}
              onClick={() => dispatch(releaseUnderObservation({ observationId: obs.id, batchId: targetBatchId, window: windowName, baseSeq, operator }))}>
              凭观察结果放行 {targetBatchId}
            </Button>
          </div>
          {!ready && streak < obs.requiredConsecutive && <p className="hint-text">复核通过仅进入待观察；连续{obs.requiredConsecutive}批合格且无同控制点新偏差后才能确认放行。</p>}
          {hasNewSameStepDeviation(obs, deviations) && <p className="validation-text">观察期内出现同控制点新偏差，待观察结果已失效，已签发放行同步撤回。</p>}
        </>
      )}

      {obs.status === '已确认' && (
        <div className="record-actions">
          <Button appearance="primary"
            disabled={batches.find((b) => b.id === targetBatchId)?.status === '已放行'}
            onClick={() => dispatch(releaseUnderObservation({ observationId: obs.id, batchId: targetBatchId, window: windowName, baseSeq, operator }))}>
            凭确认结果放行 {targetBatchId}
          </Button>
          <Field label="放行批次"><Input value={nextBatchId} onChange={(_, d) => setNextBatchId(d.value)} placeholder={`默认 ${obs.batchId}`} /></Field>
        </div>
      )}

      {obs.status === '已失效' && (
        <p className="validation-text">观察结果已于 {obs.invalidatedAt?.replace('T', ' ').slice(0, 16)} 失效：{obs.invalidationReason}<br />关联已放行批次已同步撤回（状态：放行撤回），需重新登记并复核偏差后开启新观察。</p>
      )}

      {stale && obs.status !== '已失效' && <p className="conflict-text">本窗口持有过期进度，直接提交确认/放行将被保留为冲突记录且不生效；请先拉取最新观察进度。</p>}
      {obs.conflicts.length > 0 && (
        <div className="conflict-list">
          <h3>冲突记录（{obs.conflicts.length}）</h3>
          {obs.conflicts.slice(0, 5).map((c) => (
            <div key={c.id}><Badge appearance="outline" color="warning">{c.window}</Badge><span>{c.action}提交基于 seq={c.basedOnSeq}，最新 seq={c.latestSeq}，{c.operator}</span><small>{c.createdAt.replace('T', ' ').slice(5, 16)}</small></div>
          ))}
        </div>
      )}

      <h3>观察批次读数</h3>
      <div className="obs-readings">
        {obs.readings.length === 0 && <small className="hint-text">尚无观察读数，复核通过后从下一批监测开始计数。</small>}
        {obs.readings.map((r) => (
          <div key={r.clientToken} className={r.qualified ? '' : 'bad'}>
            <span>{r.batchId ?? '后续批次'} · {r.value}{r.unit}</span>
            <Badge size="small" color={r.qualified ? 'success' : 'danger'}>{r.qualified ? '合格' : '不合格'}</Badge>
            <small>{r.operator} · {r.recordedAt.replace('T', ' ').slice(5, 16)}</small>
          </div>
        ))}
      </div>
    </div>
  )
}
