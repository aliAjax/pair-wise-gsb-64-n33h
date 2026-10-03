import { useState } from 'react'
import { Badge, Button, Input, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from '@fluentui/react-components'
import { useSelector } from 'react-redux'
import type { RootState } from '../store'
import { consecutiveQualified, observationSnapshot } from '../services/observation'

const obsColor = (status: string) => status === '已确认' ? 'success' : status === '已失效' ? 'danger' : 'important'

export function AuditTrail() {
  const { audit, observations, processSteps, batches, deviations } = useSelector((root: RootState) => root.haccp)
  const [keyword, setKeyword] = useState('')
  const rows = audit.filter((item) => `${item.entity} ${item.action} ${item.operator} ${item.detail}`.includes(keyword))
  const exportAudit = () => {
    const pack = {
      exportedAt: new Date().toISOString(),
      effectConfirmationChain: observations.map((obs) => observationSnapshot(obs, processSteps)),
      batches: batches.map((b) => ({ id: b.id, status: b.status, version: b.version, withdrawalReason: b.withdrawalReason ?? null })),
      deviations: deviations.map((d) => ({ id: d.id, batchId: d.batchId, stepId: d.stepId, status: d.status, version: d.version })),
      audit: audit
    }
    const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'HACCP追溯审计.json'; anchor.click(); URL.revokeObjectURL(url)
  }
  return <section className="page">
    <header className="page-head"><div><p>批次 / 控制点 / 偏差 / 观察确认 / 签字</p><h1>完整追溯审计</h1></div><Button appearance="primary" onClick={exportAudit}>导出追溯包</Button></header>

    <h3 className="section-title">效果确认链状态（批次详情、偏差工作台与本导出共用同一观察结果）</h3>
    <div className="table-panel">
      <Table size="small">
        <TableHeader><TableRow><TableHeaderCell>观察单</TableHeaderCell><TableHeaderCell>控制点</TableHeaderCell><TableHeaderCell>连续合格</TableHeaderCell><TableHeaderCell>状态</TableHeaderCell><TableHeaderCell>已放行批次</TableHeaderCell><TableHeaderCell>冲突</TableHeaderCell><TableHeaderCell>失效/撤回原因</TableHeaderCell></TableRow></TableHeader>
        <TableBody>{observations.map((obs) => {
          const step = processSteps.find((s) => s.id === obs.stepId)
          return <TableRow key={obs.id}>
            <TableCell>{obs.id}</TableCell>
            <TableCell>{step?.name} · {step?.controlPoint}</TableCell>
            <TableCell>{consecutiveQualified(obs.readings)}/{obs.requiredConsecutive}</TableCell>
            <TableCell><Badge appearance="tint" color={obsColor(obs.status)}>{obs.status}</Badge></TableCell>
            <TableCell>{obs.releasedBatches.length ? obs.releasedBatches.join('、') : '—'}</TableCell>
            <TableCell>{obs.conflicts.length}</TableCell>
            <TableCell>{obs.invalidationReason ?? '—'}</TableCell>
          </TableRow>
        })}</TableBody>
      </Table>
    </div>

    <div className="toolbar"><Input value={keyword} onChange={(_, data) => setKeyword(data.value)} placeholder="搜索实体、动作、操作人" /><span>共{rows.length}条可追溯事件</span></div>
    <div className="table-panel"><Table size="small"><TableHeader><TableRow><TableHeaderCell>时间</TableHeaderCell><TableHeaderCell>实体</TableHeaderCell><TableHeaderCell>动作</TableHeaderCell><TableHeaderCell>操作人</TableHeaderCell><TableHeaderCell>说明</TableHeaderCell></TableRow></TableHeader><TableBody>{rows.map((item) => <TableRow key={item.id}><TableCell>{item.createdAt.replace('T', ' ').slice(0, 16)}</TableCell><TableCell>{item.entity}</TableCell><TableCell>{item.action}</TableCell><TableCell>{item.operator}</TableCell><TableCell>{item.detail}</TableCell></TableRow>)}</TableBody></Table></div>
  </section>
}
