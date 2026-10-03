import { useMemo } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Badge, Button, Dropdown, Input, Option, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from '@fluentui/react-components'
import type { AppDispatch, RootState } from '../store'
import { setBatchFilter, setBatchStatus, setSelectedBatch, updateBatchStatus } from '../store/haccpSlice'
import type { BatchStatus } from '../types'
import { useCheckReleaseReadinessQuery, useLoadBatchSnapshotQuery } from '../services/api'
import { observationForBatch } from '../services/observation'
import { ObservationCard } from '../components/ObservationCard'

const statuses: Array<BatchStatus | '全部'> = ['全部', '生产中', '待复核', '待观察', '可放行', '隔离中', '已放行', '放行撤回', '已报废']
const statusColor = (status: BatchStatus) =>
  status === '隔离中' || status === '已报废' || status === '放行撤回' ? 'danger'
    : status === '已放行' ? 'success'
      : status === '待观察' ? 'important'
        : status === '可放行' ? 'brand' : 'warning'

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
  const linkedObservation = selected ? observationForBatch(state.observations, selected.id) : undefined
  const readinessArg = selected ? { batch: selected, deviations: state.deviations, observations: state.observations } : null
  const { data: readiness } = useCheckReleaseReadinessQuery(readinessArg as NonNullable<typeof readinessArg>, { skip: !readinessArg })

  return (
    <section className="page">
      <header className="page-head"><div><p>质量运营中心 / 批次控制</p><h1>生产批次与放行</h1></div><span className="sync-state">{isFetching ? '正在同步' : '批次快照已加载'}</span></header>
      <div className="metrics">
        <article><span>今日批次</span><strong>{state.batches.length}</strong><small>覆盖2条生产线</small></article>
        <article><span>隔离/撤回</span><strong>{state.batches.filter((item) => item.status === '隔离中' || item.status === '放行撤回').length}</strong><small>禁止放行</small></article>
        <article><span>待观察批次</span><strong>{state.batches.filter((item) => item.status === '待观察').length}</strong><small>纠偏效果确认中</small></article>
        <article><span>已放行</span><strong>{state.batches.filter((item) => item.status === '已放行').length}</strong><small>观察确认后签发</small></article>
      </div>
      <div className="toolbar">
        <Input value={state.batchFilter} onChange={(_, data) => dispatch(setBatchFilter(data.value))} placeholder="搜索批次、产品、产线" />
        <Dropdown value={state.batchStatus} selectedOptions={[state.batchStatus]} onOptionSelect={(_, data) => dispatch(setBatchStatus(data.optionValue as BatchStatus | '全部'))}>
          {statuses.map((status) => <Option key={status} value={status}>{status}</Option>)}
        </Dropdown>
        <span>复核通过先入待观察；连续合格达标且无同控制点新偏差才确认放行</span>
      </div>
      <div className="split-layout">
        <div className="table-panel">
          <Table size="small" aria-label="生产批次">
            <TableHeader><TableRow><TableHeaderCell>批次</TableHeaderCell><TableHeaderCell>产品</TableHeaderCell><TableHeaderCell>产线</TableHeaderCell><TableHeaderCell>状态</TableHeaderCell><TableHeaderCell>版本</TableHeaderCell></TableRow></TableHeader>
            <TableBody>
              {rows.map((batch) => <TableRow key={batch.id} onClick={() => dispatch(setSelectedBatch(batch.id))} className={batch.id === selected?.id ? 'selected-row' : ''}>
                <TableCell>{batch.id}</TableCell><TableCell>{batch.product}</TableCell><TableCell>{batch.line}</TableCell>
                <TableCell><Badge appearance="tint" color={statusColor(batch.status)}>{batch.status}</Badge></TableCell><TableCell>V{batch.version}</TableCell>
              </TableRow>)}
            </TableBody>
          </Table>
        </div>
        {selected && <aside className="record-panel">
          <div className="record-title"><div><span>{selected.id} · {selected.line}</span><h2>{selected.product}</h2></div><Badge color={statusColor(selected.status)}>{selected.status}</Badge></div>
          <dl><div><dt>生产数量</dt><dd>{selected.quantity.toLocaleString()} 件</dd></div><div><dt>隔离范围</dt><dd>{selected.isolationScope}</dd></div><div><dt>关联偏差</dt><dd>{selectedDeviations.length} 项</dd></div></dl>
          {selected.withdrawalReason && <p className="validation-text">放行已撤回：{selected.withdrawalReason}</p>}
          <h3>监测点结果</h3>
          <div className="monitoring-list">{selected.monitoring.map((item, index) => <div key={`${selected.id}-${item.stepId}-${index}`}><span>{state.processSteps.find((step) => step.id === item.stepId)?.controlPoint}</span><strong>{item.value} {item.unit}</strong><small>{item.operator} · {item.recordedAt.slice(11, 16)}</small></div>)}</div>

          {linkedObservation
            ? <ObservationCard windowName="批次详情窗口" batchId={selected.id} />
            : (
              <>
                <div className="record-actions">
                  <Button appearance="secondary" disabled={selectedDeviations.some((item) => item.status !== '已关闭')} onClick={() => dispatch(updateBatchStatus({ id: selected.id, status: '可放行' }))}>提交放行复核</Button>
                  <Button appearance="primary" disabled={selected.status !== '可放行'} onClick={() => dispatch(updateBatchStatus({ id: selected.id, status: '已放行' }))}>签字放行</Button>
                </div>
                {selectedDeviations.some((item) => item.status !== '已关闭') && <p className="validation-text">存在未关闭偏差，系统已阻止标记为可放行。</p>}
              </>
            )}
          {readiness && !readiness.ready && linkedObservation && (
            <p className="hint-text">放行检查：{readiness.reasons.join('；')}</p>
          )}
        </aside>}
      </div>
    </section>
  )
}
