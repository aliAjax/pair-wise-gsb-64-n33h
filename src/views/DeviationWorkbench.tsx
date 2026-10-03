import { useMemo, useState } from 'react'
import { Badge, Button, Dropdown, Field, Input, Option, Textarea } from '@fluentui/react-components'
import { useDispatch, useSelector } from 'react-redux'
import type { AppDispatch, RootState } from '../store'
import { createDeviation, reviewDeviation, saveInvestigation } from '../store/haccpSlice'
import type { DecisionType, Deviation, Investigation } from '../types'
import { activeChainForStep, observationStatusColor } from '../store/observation'
import { ObservationPanel } from '../components/ObservationPanel'

export function DeviationWorkbench() {
  const dispatch = useDispatch<AppDispatch>()
  const state = useSelector((root: RootState) => root.haccp)
  const [status, setStatus] = useState<Deviation['status'] | '全部'>('全部')
  const [selectedId, setSelectedId] = useState(state.deviations[0]?.id ?? '')
  const [showCreate, setShowCreate] = useState(false)
  const [newDeviation, setNewDeviation] = useState({ batchId: state.batches[0]?.id ?? '', stepId: state.processSteps[0]?.id ?? '', title: '', severity: '一般' as const, owner: '质量工程组' })
  const rows = useMemo(() => state.deviations.filter((item) => status === '全部' || item.status === status), [state.deviations, status])
  const selected = state.deviations.find((item) => item.id === selectedId) ?? rows[0]
  const [investigation, setInvestigation] = useState<Investigation | null>(null)
  const activeInvestigation = investigation?.cause === selected?.investigation.cause ? investigation : selected?.investigation

  const relatedChain = selected
    ? state.observationChains.find((chain) => chain.sourceDeviationId === selected.id) ?? activeChainForStep(state.observationChains, selected.stepId)
    : undefined

  return (
    <section className="page">
      <header className="page-head"><div><p>关键限值偏离 / 调查与复核 / 效果确认</p><h1>偏差处置工作台</h1></div><Button appearance="primary" onClick={() => setShowCreate(true)}>登记偏差</Button></header>
      <div className="toolbar"><Dropdown value={status} selectedOptions={[status]} onOptionSelect={(_, data) => setStatus(data.optionValue as typeof status)}>{['全部', '待调查', '调查中', '待复核', '已关闭'].map((item) => <Option key={item} value={item}>{item}</Option>)}</Dropdown><span>复核通过后先进入待观察：连续合格读数达标且无同控制点新偏差才确认；登记同控制点新偏差将使观察结果失效。</span></div>
      <div className="split-layout">
        <div className="deviation-list">{rows.map((item) => {
          const chain = state.observationChains.find((c) => c.sourceDeviationId === item.id) ?? activeChainForStep(state.observationChains, item.stepId)
          return <button key={item.id} className={item.id === selected?.id ? 'active' : ''} onClick={() => { setSelectedId(item.id); setInvestigation(null) }}>
            <div><Badge color={item.severity === '重大' ? 'danger' : 'warning'}>{item.severity}</Badge><small>{item.id}</small></div>
            <strong>{item.title}</strong>
            <span>{item.batchId} · {item.owner}</span>
            <footer>
              <Badge appearance="tint">{item.status}</Badge>
              {chain && <Badge appearance="outline" color={observationStatusColor[chain.status]}>{chain.status} {chain.streak}/{chain.requiredBatches}</Badge>}
              <span>{item.dueDate} 截止</span>
            </footer>
          </button>
        })}</div>
        {selected && <div className="record-panel">
          <div className="record-title"><div><span>{selected.id} · V{selected.version}</span><h2>{selected.title}</h2></div><Badge color={selected.severity === '重大' ? 'danger' : 'warning'}>{selected.status}</Badge></div>
          <Field label="原因判断"><Textarea value={activeInvestigation?.cause ?? ''} onChange={(_, data) => setInvestigation({ ...(activeInvestigation ?? selected.investigation), cause: data.value })} /></Field>
          <Field label="证据摘要"><Textarea value={activeInvestigation?.evidence ?? ''} onChange={(_, data) => setInvestigation({ ...(activeInvestigation ?? selected.investigation), evidence: data.value })} /></Field>
          <Field label="处置分支"><Dropdown value={activeInvestigation?.decision} selectedOptions={[activeInvestigation?.decision ?? '返工']} onOptionSelect={(_, data) => setInvestigation({ ...(activeInvestigation ?? selected.investigation), decision: data.optionValue as DecisionType })}>{['返工', '报废', '让步接收'].map((item) => <Option key={item} value={item} text={item}>{item}</Option>)}</Dropdown></Field>
          <Field label="返工或报废指令"><Textarea value={activeInvestigation?.reworkInstruction ?? ''} onChange={(_, data) => setInvestigation({ ...(activeInvestigation ?? selected.investigation), reworkInstruction: data.value })} /></Field>
          <div className="record-actions">
            <Button disabled={!activeInvestigation?.cause || !activeInvestigation?.evidence} onClick={() => dispatch(saveInvestigation({ id: selected.id, investigation: activeInvestigation! }))}>提交调查</Button>
            <Button appearance="primary" disabled={selected.status !== '待复核'} onClick={() => dispatch(reviewDeviation({ id: selected.id, approved: true, note: state.processSteps.find((s) => s.id === selected.stepId)?.observationRequired ? '调查证据充分，纠偏措施可执行，复核通过后进入待观察效果确认。' : '调查证据充分，纠偏措施可执行。', reviewer: '质量负责人 秦岚' }))}>复核通过</Button>
          </div>
          <Button appearance="subtle" disabled={selected.status !== '待复核'} onClick={() => dispatch(reviewDeviation({ id: selected.id, approved: false, note: '需补充设备故障诊断记录。', reviewer: '质量负责人 秦岚' }))}>退回补充证据</Button>
          {selected.status === '已关闭' && relatedChain && <p className="validation-ok">复核已通过，纠偏措施效果确认链 {relatedChain.id} 当前状态：{relatedChain.status}（连续合格 {relatedChain.streak}/{relatedChain.requiredBatches} 组），与批次详情、追溯导出显示同一结果。</p>}
        </div>}
      </div>
      {relatedChain && <div className="chain-section">
        <ObservationPanel chainId={relatedChain.id} batchId={relatedChain.sourceBatchId} />
      </div>}
      {showCreate && <div className="edit-panel">
        <h3>登记关键限值偏差（同控制点新偏差将使待观察结果失效并撤回放行）</h3>
        <div className="edit-grid">
          <Field label="批次"><Dropdown value={newDeviation.batchId} selectedOptions={[newDeviation.batchId]} onOptionSelect={(_, data) => setNewDeviation({ ...newDeviation, batchId: data.optionValue ?? '' })}>{state.batches.map((item) => <Option key={item.id} value={item.id} text={`${item.id} ${item.product}`}>{item.id} {item.product}</Option>)}</Dropdown></Field>
          <Field label="控制点"><Dropdown value={newDeviation.stepId} selectedOptions={[newDeviation.stepId]} onOptionSelect={(_, data) => setNewDeviation({ ...newDeviation, stepId: data.optionValue ?? '' })}>{state.processSteps.map((item) => <Option key={item.id} value={item.id} text={item.name}>{item.name}{item.observationRequired ? '（观察控制点）' : ''}</Option>)}</Dropdown></Field>
          <Field label="偏差标题"><Input value={newDeviation.title} onChange={(_, data) => setNewDeviation({ ...newDeviation, title: data.value })} /></Field>
        </div>
        <div className="record-actions"><Button onClick={() => setShowCreate(false)}>取消</Button><Button appearance="primary" disabled={!newDeviation.title || !newDeviation.batchId} onClick={() => { dispatch(createDeviation(newDeviation)); setShowCreate(false) }}>创建并隔离批次</Button></div>
      </div>}
    </section>
  )
}
