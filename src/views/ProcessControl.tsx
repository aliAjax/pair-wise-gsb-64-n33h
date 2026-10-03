import { useState } from 'react'
import { Button, Field, Input, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from '@fluentui/react-components'
import { useDispatch, useSelector } from 'react-redux'
import type { AppDispatch, RootState } from '../store'
import { updateProcessStep } from '../store/haccpSlice'
import type { ProcessStep } from '../types'

export function ProcessControl() {
  const dispatch = useDispatch<AppDispatch>()
  const steps = useSelector((root: RootState) => root.haccp.processSteps)
  const [editing, setEditing] = useState<ProcessStep | null>(null)
  const save = () => { if (editing && editing.requiredConsecutive >= 1) dispatch(updateProcessStep(editing)); setEditing(null) }
  return (
    <section className="page">
      <header className="page-head"><div><p>危害分析 / 关键控制点</p><h1>HACCP控制矩阵</h1></div></header>
      <div className="process-flow">{steps.map((step, index) => <div key={step.id}><b>{index + 1}</b><span>{step.name}</span><small>{step.equipment}</small></div>)}</div>
      <div className="table-panel">
        <Table size="small">
          <TableHeader><TableRow><TableHeaderCell>步骤</TableHeaderCell><TableHeaderCell>潜在危害</TableHeaderCell><TableHeaderCell>控制点</TableHeaderCell><TableHeaderCell>关键限值</TableHeaderCell><TableHeaderCell>监控频率</TableHeaderCell><TableHeaderCell>效果确认连续合格批次</TableHeaderCell><TableHeaderCell /></TableRow></TableHeader>
          <TableBody>{steps.map((step) => <TableRow key={step.id}><TableCell>{step.name}</TableCell><TableCell>{step.hazard}</TableCell><TableCell>{step.controlPoint}</TableCell><TableCell><strong>{step.limit}</strong></TableCell><TableCell>{step.frequency}</TableCell><TableCell><BadgeLike value={step.requiredConsecutive} /></TableCell><TableCell><Button size="small" appearance="subtle" onClick={() => setEditing(structuredClone(step))}>编辑</Button></TableCell></TableRow>)}</TableBody>
        </Table>
      </div>
      {editing && <div className="edit-panel">
        <h3>{editing.name} · 控制参数</h3>
        <div className="edit-grid">
          <Field label="关键限值"><Input value={editing.limit} onChange={(_, data) => setEditing({ ...editing, limit: data.value })} /></Field>
          <Field label="监控频率"><Input value={editing.frequency} onChange={(_, data) => setEditing({ ...editing, frequency: data.value })} /></Field>
          <Field label="纠偏措施"><Input value={editing.correctiveAction} onChange={(_, data) => setEditing({ ...editing, correctiveAction: data.value })} /></Field>
          <Field label="效果确认连续合格批次（≥1）"><Input type="number" value={String(editing.requiredConsecutive)} onChange={(_, data) => setEditing({ ...editing, requiredConsecutive: Math.max(1, Number(data.value) || 1) })} /></Field>
        </div>
        <div className="record-actions"><Button onClick={() => setEditing(null)}>取消</Button><Button appearance="primary" disabled={!editing.limit || !editing.correctiveAction || editing.requiredConsecutive < 1} onClick={save}>保存并审计</Button></div>
      </div>}
      <div className="rule-band"><strong>控制矩阵约束</strong><span>关键限值、监控频率与纠偏措施不得为空；“连续合格批次”是纠偏复核通过后的观察达标阈值，阈值变更版本化留痕并驱动效果确认链。</span></div>
    </section>
  )
}

function BadgeLike({ value }: { value: number }) {
  return <span className="threshold-pill">连续 {value} 批</span>
}
