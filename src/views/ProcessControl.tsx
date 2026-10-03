import { useState } from 'react'
import { Button, Field, Input, Switch, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from '@fluentui/react-components'
import { useDispatch, useSelector } from 'react-redux'
import type { AppDispatch, RootState } from '../store'
import { updateProcessStep } from '../store/haccpSlice'
import type { ProcessStep } from '../types'

export function ProcessControl() {
  const dispatch = useDispatch<AppDispatch>()
  const steps = useSelector((root: RootState) => root.haccp.processSteps)
  const [editing, setEditing] = useState<ProcessStep | null>(null)
  const save = () => { if (editing) dispatch(updateProcessStep(editing)); setEditing(null) }
  return (
    <section className="page">
      <header className="page-head"><div><p>危害分析 / 关键控制点 / 效果确认要求</p><h1>HACCP控制矩阵</h1></div></header>
      <div className="process-flow">{steps.map((step, index) => <div key={step.id}><b>{index + 1}</b><span>{step.name}</span><small>{step.equipment}</small></div>)}</div>
      <div className="table-panel">
        <Table size="small">
          <TableHeader><TableRow>
            <TableHeaderCell>步骤</TableHeaderCell><TableHeaderCell>控制点</TableHeaderCell><TableHeaderCell>关键限值</TableHeaderCell>
            <TableHeaderCell>合格区间（读数判定）</TableHeaderCell><TableHeaderCell>监控频率</TableHeaderCell>
            <TableHeaderCell>纠偏后效果确认</TableHeaderCell><TableHeaderCell />
          </TableRow></TableHeader>
          <TableBody>{steps.map((step) => <TableRow key={step.id}>
            <TableCell>{step.name}<small>{step.equipment}</small></TableCell>
            <TableCell>{step.controlPoint}</TableCell>
            <TableCell><strong>{step.limit}</strong></TableCell>
            <TableCell>{step.minLimit ?? '−∞'} ~ {step.maxLimit ?? '+∞'} {step.unit}</TableCell>
            <TableCell>{step.frequency}</TableCell>
            <TableCell>{step.observationRequired
              ? <span className="obs-required">待观察 · 连续 {step.observationBatches} 组合格</span>
              : <span className="obs-off">不启用观察</span>}</TableCell>
            <TableCell><Button size="small" appearance="subtle" onClick={() => setEditing(structuredClone(step))}>编辑</Button></TableCell>
          </TableRow>)}</TableBody>
        </Table>
      </div>
      {editing && <div className="edit-panel">
        <h3>{editing.name} · 控制参数</h3>
        <div className="edit-grid">
          <Field label="关键限值（描述）"><Input value={editing.limit} onChange={(_, data) => setEditing({ ...editing, limit: data.value })} /></Field>
          <Field label="读数单位"><Input value={editing.unit} onChange={(_, data) => setEditing({ ...editing, unit: data.value })} /></Field>
          <Field label="合格下限（可空）"><Input type="number" value={editing.minLimit === null ? '' : String(editing.minLimit)} onChange={(_, data) => setEditing({ ...editing, minLimit: data.value === '' ? null : Number(data.value) })} /></Field>
          <Field label="合格上限（可空）"><Input type="number" value={editing.maxLimit === null ? '' : String(editing.maxLimit)} onChange={(_, data) => setEditing({ ...editing, maxLimit: data.value === '' ? null : Number(data.value) })} /></Field>
          <Field label="监控频率"><Input value={editing.frequency} onChange={(_, data) => setEditing({ ...editing, frequency: data.value })} /></Field>
          <Field label="连续合格组数"><Input type="number" disabled={!editing.observationRequired} value={String(editing.observationBatches)} onChange={(_, data) => setEditing({ ...editing, observationBatches: Math.max(1, Number(data.value) || 1) })} /></Field>
          <Field label="纠偏措施"><Input value={editing.correctiveAction} onChange={(_, data) => setEditing({ ...editing, correctiveAction: data.value })} /></Field>
          <Field label="复核通过后进入待观察效果确认"><Switch checked={editing.observationRequired} onChange={(_, data) => setEditing({ ...editing, observationRequired: data.checked, observationBatches: data.checked ? editing.observationBatches || 3 : 0 })} label={editing.observationRequired ? '启用' : '关闭'} /></Field>
        </div>
        <div className="record-actions"><Button onClick={() => setEditing(null)}>取消</Button><Button appearance="primary" disabled={!editing.limit || !editing.correctiveAction || (editing.observationRequired && editing.observationBatches < 1)} onClick={save}>保存并审计</Button></div>
      </div>}
      <div className="rule-band"><strong>控制矩阵 → 效果确认链</strong><span>启用观察的控制点（如杀菌、金属探测），纠偏复核通过后批次进入待观察；连续合格读数达到配置组数且无同控制点新偏差才能确认效果，观察期故障自动失效链并撤回放行。</span></div>
    </section>
  )
}
