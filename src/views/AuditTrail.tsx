import { useMemo, useState } from 'react'
import { Badge, Button, Input, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from '@fluentui/react-components'
import { useSelector } from 'react-redux'
import type { RootState } from '../store'
import { buildObservationView, observationStatusColor } from '../store/observation'

const fmt = (iso: string) => iso.replace('T', ' ').slice(0, 16)

export function AuditTrail() {
  const state = useSelector((root: RootState) => root.haccp)
  const [keyword, setKeyword] = useState('')
  const rows = state.audit.filter((item) => `${item.entity} ${item.action} ${item.operator} ${item.detail}`.includes(keyword))

  const exportRows = useMemo(() => state.audit.filter((item) => `${item.entity} ${item.action} ${item.operator} ${item.detail}`.includes(keyword)), [state.audit, keyword])

  const exportAudit = () => {
    // 追溯包与批次详情、偏差工作台共用同一份观察结果口径
    const observationPackage = state.observationChains.map((chain) => {
      const step = state.processSteps.find((item) => item.id === chain.stepId)
      const view = buildObservationView(chain, step)
      return {
        chainId: chain.id,
        controlPoint: step?.name,
        sourceDeviation: chain.sourceDeviationId,
        status: chain.status,
        rule: `连续${chain.requiredBatches}组合格读数且无同控制点新偏差方可确认`,
        consecutiveConformingStreak: chain.streak,
        requiredBatches: chain.requiredBatches,
        readyToConfirm: view.readyToConfirm,
        openedAt: chain.openedAt,
        confirmedAt: chain.confirmedAt ?? null,
        confirmer: chain.confirmer ?? null,
        invalidatedAt: chain.invalidatedAt ?? null,
        invalidateReason: chain.invalidateReason ?? null,
        records: chain.records,
        provisionalReleases: chain.releases,
        conflicts: chain.conflicts,
        failedWrites: chain.failedWrites,
        version: chain.version
      }
    })
    const payload = {
      exportedAt: new Date().toISOString(),
      batches: state.batches,
      deviations: state.deviations,
      processSteps: state.processSteps,
      observationChains: observationPackage,
      stagedObservations: state.stagedObservations,
      audit: exportRows
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'HACCP追溯审计.json'; anchor.click(); URL.revokeObjectURL(url)
  }

  return <section className="page">
    <header className="page-head"><div><p>批次 / 控制点 / 偏差 / 观察确认 / 签字撤回</p><h1>完整追溯审计</h1></div><Button appearance="primary" onClick={exportAudit}>导出追溯包</Button></header>

    <h2 className="section-title">效果确认链（与批次详情、偏差工作台同一观察结果）</h2>
    <div className="table-panel" style={{ marginBottom: 16 }}>
      <Table size="small">
        <TableHeader><TableRow>
          <TableHeaderCell>确认链</TableHeaderCell><TableHeaderCell>控制点</TableHeaderCell><TableHeaderCell>来源偏差</TableHeaderCell>
          <TableHeaderCell>观察结果</TableHeaderCell><TableHeaderCell>连续合格</TableHeaderCell><TableHeaderCell>放行许可</TableHeaderCell>
          <TableHeaderCell>冲突</TableHeaderCell><TableHeaderCell>失效/确认时间</TableHeaderCell>
        </TableRow></TableHeader>
        <TableBody>{state.observationChains.map((chain) => {
          const step = state.processSteps.find((item) => item.id === chain.stepId)
          const activeReleases = chain.releases.filter((r) => !r.revoked).length
          const revokedReleases = chain.releases.filter((r) => r.revoked).length
          return <TableRow key={chain.id}>
            <TableCell>{chain.id}<small>V{chain.version}</small></TableCell>
            <TableCell>{step?.name}</TableCell>
            <TableCell>{chain.sourceDeviationId}</TableCell>
            <TableCell><Badge appearance="tint" color={observationStatusColor[chain.status]}>{chain.status}</Badge>
              {chain.status === '已失效' && <small className="revoke-reason">{chain.invalidateReason}</small>}</TableCell>
            <TableCell>{chain.streak}/{chain.requiredBatches} 组</TableCell>
            <TableCell>
              {activeReleases > 0 && <Badge color="success" size="small">有效 {activeReleases}</Badge>}
              {revokedReleases > 0 && <Badge color="danger" size="small">撤回 {revokedReleases}</Badge>}
              {chain.releases.length === 0 && '—'}
            </TableCell>
            <TableCell>{chain.conflicts.length > 0 ? <Badge color="warning">{chain.conflicts.length} 条滞后冲突</Badge> : '—'}</TableCell>
            <TableCell><small>{chain.confirmedAt ? `确认 ${fmt(chain.confirmedAt)}` : chain.invalidatedAt ? `失效 ${fmt(chain.invalidatedAt)}` : `开启 ${fmt(chain.openedAt)}`}</small></TableCell>
          </TableRow>
        })}</TableBody>
      </Table>
    </div>

    <div className="toolbar"><Input value={keyword} onChange={(_, data) => setKeyword(data.value)} placeholder="搜索实体、动作、操作人" /><span>共{rows.length}条可追溯事件（观察入账、许可撤回、并发冲突、失败恢复均留痕）</span></div>
    <div className="table-panel"><Table size="small"><TableHeader><TableRow><TableHeaderCell>时间</TableHeaderCell><TableHeaderCell>实体</TableHeaderCell><TableHeaderCell>动作</TableHeaderCell><TableHeaderCell>操作人</TableHeaderCell><TableHeaderCell>说明</TableHeaderCell></TableRow></TableHeader><TableBody>{rows.map((item) => <TableRow key={item.id}><TableCell>{item.createdAt.replace('T', ' ').slice(0, 16)}</TableCell><TableCell>{item.entity}</TableCell><TableCell>{item.action}</TableCell><TableCell>{item.operator}</TableCell><TableCell>{item.detail}</TableCell></TableRow>)}</TableBody></Table></div>
  </section>
}
