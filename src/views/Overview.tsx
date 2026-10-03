import { useMemo, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import {
  Badge, Button, Dropdown, Input, Option, Table, TableBody, TableCell,
  TableHeader, TableHeaderCell, TableRow, Field
} from '@fluentui/react-components'
import type { AppDispatch, RootState } from '../store'
import { recordMonitoring, setBatchFilter, setBatchStatus, setSelectedBatch, updateBatchStatus } from '../store/haccpSlice'
import type { BatchStatus } from '../types'
import { useCheckReleaseReadinessQuery, useLoadBatchSnapshotQuery } from '../services/api'
import { batchObservationState, isReadingConforming } from '../store/observation'
import { ObservationPanel } from '../components/ObservationPanel'

const statuses: Array<BatchStatus | '全部'> = ['全部', '生产中', '待复核', '待观察', '可放行', '隔离中', '已放行', '已报废']
const statusColor = (status: BatchStatus) =>
  status === '隔离中' || status === '已报废' ? 'danger'
    : status === '已放行' ? 'success'
      : status === '可放行' ? 'important'
        : status === '待观察' ? 'severe' : 'warning'

export function Overview() {
  const dispatch = useDispatch<AppDispatch>()
  const state = useSelector((root: RootState) => root.haccp)
  const { isFetching } = useLoadBatchSnapshotQuery()
  const rows = useMemo(() => state.batches.filter((batch) => {
    const text = `${batch.id} ${batch.product} ${batch.line}`.toLowerCase()
    return (!state.batchFilter || text.includes(state.batchFilter.toLowerCase())) && (state.batchStatus === '全部' || batch.status === state.batchStatus)
  }), [state.batches, state.batchFilter, state.batchStatus])
  const selected = state.batches.find((item) => item.id === state.selectedBatchId) ?? rows[0]
  const selectedDeviations = state.deviations.filter((item) => item.batchId === selected?.id)
  const openDeviations = selectedDeviations.filter((item) => item.status !== '已关闭').length
  const { data: readiness } = useCheckReleaseReadinessQuery(
    selected ? { batchId: selected.id, openDeviations, chains: state.observationChains } : { batchId: '', openDeviations: 0, chains: [] },
    { skip: !selected }
  )

  const [stepId, setStepId] = useState(state.processSteps[1]?.id ?? 'P2')
  const [value, setValue] = useState('')
  const [operator, setOperator] = useState('杨鸣')
  const [forceFailure, setForceFailure] = useState(false)

  if (!selected) return null
  const obsState = batchObservationState(state.observationChains, selected)
  const recordingStep = state.processSteps.find((step) => step.id === stepId)
  const previewConforming = recordingStep && value !== '' ? isReadingConforming(recordingStep, Number(value)) : null
  const submitReading = () => {
    if (!recordingStep || value === '') return
    dispatch(recordMonitoring({
      batchId: selected.id, stepId: recordingStep.id, value: Number(value), operator,
      recordedAt: new Date().toISOString(), clientToken: `tok-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      forceFailure
    }))
    setValue('')
    setForceFailure(false)
  }

  return (
    <section className="page">
      <header className="page-head"><div><p>质量运营中心 / 批次控制</p><h1>生产批次与放行</h1></div><span className="sync-state">{isFetching ? '正在同步' : '批次快照已加载'}</span></header>
      <div className="metrics">
        <article><span>今日批次</span><strong>{state.batches.length}</strong><small>覆盖2条生产线</small></article>
        <article><span>待观察批次</span><strong>{state.batches.filter((item) => item.status === '待观察').length}</strong><small>效果确认未闭环</small></article>
        <article><span>未关闭偏差</span><strong>{state.deviations.filter((item) => item.status !== '已关闭').length}</strong><small>需调查或复核</small></article>
        <article><span>已放行</span><strong>{state.batches.filter((item) => item.status === '已放行').length}</strong><small>含观察许可放行</small></article>
      </div>
      <div className="toolbar">
        <Input value={state.batchFilter} onChange={(_, data) => dispatch(setBatchFilter(data.value))} placeholder="搜索批次、产品、产线" />
        <Dropdown value={state.batchStatus} selectedOptions={[state.batchStatus]} onOptionSelect={(_, data) => dispatch(setBatchStatus(data.optionValue as BatchStatus | '全部'))}>
          {statuses.map((status) => <Option key={status} value={status}>{status}</Option>)}
        </Dropdown>
        <span>点击批次查看监测点、观察链与偏差关系</span>
      </div>
      <div className="split-layout">
        <div className="table-panel">
          <Table size="small" aria-label="生产批次">
            <TableHeader><TableRow><TableHeaderCell>批次</TableHeaderCell><TableHeaderCell>产品</TableHeaderCell><TableHeaderCell>状态</TableHeaderCell><TableHeaderCell>观察链</TableHeaderCell><TableHeaderCell>版本</TableHeaderCell></TableRow></TableHeader>
            <TableBody>
              {rows.map((batch) => {
                const bObs = batchObservationState(state.observationChains, batch)
                return <TableRow key={batch.id} onClick={() => dispatch(setSelectedBatch(batch.id))} className={batch.id === selected?.id ? 'selected-row' : ''}>
                  <TableCell>{batch.id}</TableCell><TableCell>{batch.product}<small>{batch.line} 线</small></TableCell>
                  <TableCell><Badge appearance="tint" color={statusColor(batch.status)}>{batch.status}</Badge></TableCell>
                  <TableCell>
                    {bObs.active ? <Badge appearance="outline" color="warning">待观察 {bObs.active.streak}/{bObs.active.requiredBatches}</Badge>
                      : bObs.invalidated.length > 0 ? <Badge appearance="outline" color="danger">观察失效</Badge>
                        : bObs.related.some((c) => c.status === '已确认') ? <Badge appearance="outline" color="success">已确认</Badge> : '—'}
                    {bObs.activeRelease && <div><Badge color="success" size="small">观察许可</Badge></div>}
                    {bObs.revokedHere.length > 0 && <div><Badge color="danger" size="small">许可已撤回</Badge></div>}
                  </TableCell>
                  <TableCell>V{batch.version}</TableCell>
                </TableRow>
              })}
            </TableBody>
          </Table>
        </div>
        <aside className="record-panel">
          <div className="record-title"><div><span>{selected.id} · {selected.line}</span><h2>{selected.product}</h2></div><Badge color={statusColor(selected.status)}>{selected.status}</Badge></div>
          <dl><div><dt>生产数量</dt><dd>{selected.quantity.toLocaleString()} 件</dd></div><div><dt>隔离范围</dt><dd>{selected.isolationScope}</dd></div><div><dt>关联偏差</dt><dd>{selectedDeviations.length} 项（未关闭 {openDeviations}）</dd></div></dl>

          {obsState.active && <div className="obs-banner warning">
            效果确认链 <b>{obsState.active.id}</b>（{state.processSteps.find((s) => s.id === obsState.active!.stepId)?.name}）待观察 {obsState.active.streak}/{obsState.active.requiredBatches} 组：
            {obsState.activeRelease ? '本批次持有观察放行许可' : '复核通过不等于放行，连续合格读数达标方可确认'}
          </div>}
          {obsState.revokedHere.length > 0 && <div className="obs-banner danger">观察放行许可已撤回：{obsState.revokedHere[0].release.revokeReason}</div>}
          {readiness && !readiness.ready && <div className="obs-banner danger">{readiness.reasons.join('；')}</div>}

          <h3>监测点结果</h3>
          <div className="monitoring-list">{selected.monitoring.map((item) => {
            const step = state.processSteps.find((s) => s.id === item.stepId)
            const conforming = item.conforming ?? isReadingConforming(step, item.value)
            return <div key={`${selected.id}-${item.stepId}-${item.recordedAt}`} className={conforming ? '' : 'bad'}>
              <span>{step?.controlPoint}{conforming ? '' : ' · 超限'}</span>
              <strong>{item.value} {item.unit}</strong>
              <small>{item.operator} · {item.recordedAt.slice(5, 16)} <Badge size="small" color={conforming ? 'success' : 'danger'}>{conforming ? '合格' : '不合格'}</Badge></small>
            </div>
          })}</div>

          <h3>提交监测读数</h3>
          <div className="reading-form">
            <Field label="控制点">
              <Dropdown value={recordingStep?.name} selectedOptions={[stepId]} onOptionSelect={(_, data) => setStepId(data.optionValue ?? stepId)}>
                {state.processSteps.map((step) => <Option key={step.id} value={step.id} text={`${step.name}（${step.limit}）`}>{step.name}（{step.limit}）</Option>)}
              </Dropdown>
            </Field>
            <Field label={`读数（${recordingStep?.unit ?? ''}）`}>
              <Input type="number" value={value} onChange={(_, data) => setValue(data.value)} placeholder={`限值 ${recordingStep?.limit ?? ''}`} />
            </Field>
            <Field label="记录人"><Input value={operator} onChange={(_, data) => setOperator(data.value)} /></Field>
          </div>
          {previewConforming !== null && <p className={previewConforming ? 'validation-ok' : 'validation-text'}>
            该读数判定为{previewConforming ? '合格' : '不合格'}：{previewConforming ? '合格将入账激活中的观察链（重复令牌不重复计数）' : '不合格将立即失效待观察结果、撤回放行并登记偏差、隔离批次'}
          </p>}
          <div className="record-actions">
            <label className="fail-toggle"><input type="checkbox" checked={forceFailure} onChange={(e) => setForceFailure(e.target.checked)} /> 模拟写入失败（先暂存，事后恢复）</label>
            <Button appearance="primary" disabled={!recordingStep || value === ''} onClick={submitReading}>提交读数</Button>
          </div>

          <div className="record-actions">
            <Button appearance="secondary" disabled={!readiness?.ready && !obsState.activeRelease} onClick={() => dispatch(updateBatchStatus({ id: selected.id, status: '可放行' }))}>提交放行复核</Button>
            <Button appearance="primary" disabled={selected.status !== '可放行'} onClick={() => dispatch(updateBatchStatus({ id: selected.id, status: '已放行' }))}>签字放行</Button>
          </div>
          {!readiness?.ready && <p className="validation-text">系统已阻止直接放行：{readiness?.reasons.join('；')}</p>}
        </aside>
      </div>

      {obsState.active && <div className="chain-section">
        <ObservationPanel chainId={obsState.active.id} batchId={selected.id} />
      </div>}
      {!obsState.active && obsState.invalidated.length > 0 && <div className="chain-section">
        <ObservationPanel chainId={obsState.invalidated[0].id} batchId={selected.id} />
      </div>}
    </section>
  )
}
