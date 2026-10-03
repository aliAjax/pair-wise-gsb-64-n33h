import { useMemo, useState } from 'react'
import { Badge, Button, Dropdown, Field, Input, Option, Textarea } from '@fluentui/react-components'
import { useDispatch, useSelector } from 'react-redux'
import type { AppDispatch, RootState } from '../store'
import {
  clearConflictRecords, recoverObservation, revokeObservation,
  submitObservation, submitObservationPair
} from '../store/haccpSlice'
import type { ObservationAction } from '../types'
import { buildObservationView, observationStatusColor } from '../store/observation'

interface Props {
  chainId: string
  /** 当前焦点批次，放行目标默认取它 */
  batchId?: string
}

const fmt = (iso: string) => iso.replace('T', ' ').slice(0, 16)

export function ObservationPanel({ chainId, batchId }: Props) {
  const dispatch = useDispatch<AppDispatch>()
  const { chain, step, batches, view } = useSelector((root: RootState) => {
    const chain = root.haccp.observationChains.find((item) => item.id === chainId)
    return {
      chain,
      step: root.haccp.processSteps.find((item) => item.id === chain?.stepId),
      batches: root.haccp.batches,
      view: chain ? buildObservationView(chain, root.haccp.processSteps.find((item) => item.id === chain.stepId), { batchId }) : null
    }
  })
  const staged = useSelector((root: RootState) => root.haccp.stagedObservations.filter((item) => item.chainId === chainId))
  const [revokeReason, setRevokeReason] = useState('')
  const [winA, setWinA] = useState({ action: '确认' as ObservationAction, batchId: batchId ?? '', submittedAt: new Date().toISOString().slice(0, 19), operator: '班组 周磊' })
  const [winB, setWinB] = useState({ action: '放行' as ObservationAction, batchId: batchId ?? '', submittedAt: winA.submittedAt, operator: '质量值班 韩松' })

  const releaseTargets = useMemo(() => {
    if (!chain) return []
    const ids = new Set<string>([chain.sourceBatchId, ...chain.records.map((r) => r.batchId), ...batches.map((b) => b.id)])
    return batches.filter((b) => ids.has(b.id) && b.status !== '已报废')
  }, [chain, batches])

  if (!chain || !step || !view) return null
  const active = chain.status === '待观察'
  const singleConfirm = (windowId: string) =>
    dispatch(submitObservation({ chainId: chain.id, action: '确认', windowId, operator: windowId === '批次详情' ? '质量值班 韩松' : '质量负责人 秦岚', baseVersion: chain.version, baseStreak: chain.streak }))
  const singleRelease = (windowId: string, target: string) =>
    dispatch(submitObservation({ chainId: chain.id, action: '放行', windowId, batchId: target, operator: '班组 周磊', baseVersion: chain.version, baseStreak: chain.streak }))

  return (
    <div className="observation-panel">
      <div className="obs-head">
        <div>
          <span>效果确认链 · {chain.id} · 来源偏差 {chain.sourceDeviationId}</span>
          <h3>{step.name}（{step.controlPoint}）纠偏效果观察</h3>
        </div>
        <Badge appearance="tint" color={observationStatusColor[chain.status]}>{chain.status}</Badge>
      </div>

      <div className="obs-progress">
        <div className="progress-bar">
          {Array.from({ length: chain.requiredBatches }, (_, i) => <i key={i} className={i < chain.streak ? 'done' : ''} />)}
        </div>
        <strong>连续合格读数 {chain.streak}/{chain.requiredBatches} 组</strong>
        <small>当前进度 V{chain.version} · 开启于 {fmt(chain.openedAt)}</small>
        {view.readyToConfirm
          ? <p className="obs-ready">✔ 连续合格读数达标且未出现同控制点新偏差，可确认纠偏效果。</p>
          : active
            ? <p className="obs-waiting">观察期内班组不得直接放行后续批次；还需 {view.remaining} 组合格读数，期间出现同控制点新故障则全部作废。</p>
            : <p className="obs-failed">✖ {chain.invalidateReason}（{chain.invalidatedAt && fmt(chain.invalidatedAt)}）</p>}
      </div>

      <h4>观察批次读数</h4>
      <div className="obs-records">
        {chain.records.length === 0 && <small className="obs-empty">暂无入账读数</small>}
        {[...chain.records].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt)).map((record, index) => (
          <div key={record.id}>
            <b>第{index + 1}组</b>
            <span>{record.batchId}</span>
            <strong className="ok">{record.value} {record.unit}</strong>
            <small>{record.operator} · {fmt(record.recordedAt)}</small>
            <em title={record.clientToken}>幂等键 {record.clientToken.slice(0, 10)}</em>
          </div>
        ))}
      </div>

      <h4>观察期放行许可</h4>
      <div className="obs-releases">
        {chain.releases.length === 0 && <small className="obs-empty">观察期内尚未签发放行</small>}
        {chain.releases.map((release) => (
          <div key={release.id} className={release.revoked ? 'revoked' : ''}>
            <span>{release.batchId} · {release.signer}</span>
            {release.revoked
              ? <Badge color="danger">已撤回 {release.revokedAt && fmt(release.revokedAt)}</Badge>
              : <Badge color="success">许可有效</Badge>}
            <small>由「{release.windowId}」签发于 {fmt(release.signedAt)}</small>
            {release.revoked && <small className="revoke-reason">撤回原因：{release.revokeReason}</small>}
          </div>
        ))}
      </div>

      {active && <div className="obs-actions">
        <Button appearance="primary" disabled={!view.readyToConfirm} onClick={() => singleConfirm('偏差工作台')}>确认纠偏效果</Button>
        <Button disabled={!batchId || view.activeReleases.length > 0} onClick={() => batchId && singleRelease('批次详情', batchId)}>
          对当前批次签发观察放行
        </Button>
      </div>}

      {/* 写入失败与恢复 */}
      <h4>写入失败恢复</h4>
      <div className="obs-staging">
        {staged.length === 0 && chain.failedWrites.length === 0 && <small className="obs-empty">无失败暂存；在监测录入处勾选「模拟写入失败」可验证恢复。</small>}
        {staged.map((item) => <div key={item.clientToken} className="staged"><span>{item.batchId} · {item.value}{item.unit}</span><Badge color="warning">待恢复 · {fmt(item.failedAt)}</Badge></div>)}
        {chain.failedWrites.map((failure) => <div key={failure.clientToken} className={failure.recovered ? 'recovered' : ''}>
          <small>{failure.batchId} 写入失败（{fmt(failure.at)}）{failure.recovered ? ' —— 已从最后完整观察批次恢复并补写' : ''}</small>
        </div>)}
        {staged.length > 0 && <Button appearance="primary" onClick={() => dispatch(recoverObservation({ chainId: chain.id }))}>从最后一个完整观察批次恢复</Button>}
      </div>

      {/* 两个窗口同时提交 */}
      {active && <div className="obs-concurrency">
        <h4>两窗口同时提交（以最新观察进度为准）</h4>
        <div className="win-grid">
          {[{ label: '窗口A · 批次详情', value: winA, set: setWinA }, { label: '窗口B · 偏差工作台', value: winB, set: setWinB }].map(({ label, value, set }) => (
            <div key={label} className="win-col">
              <strong>{label}</strong>
              <Field label="动作">
                <Dropdown value={value.action} selectedOptions={[value.action]} onOptionSelect={(_, data) => set({ ...value, action: data.optionValue as ObservationAction })}>
                  <Option value="确认">确认</Option><Option value="放行">放行</Option>
                </Dropdown>
              </Field>
              <Field label="放行批次（放行时生效）">
                <Dropdown value={value.batchId} selectedOptions={[value.batchId]} onOptionSelect={(_, data) => set({ ...value, batchId: data.optionValue ?? '' })}>
                  {releaseTargets.map((b) => <Option key={b.id} value={b.id} text={`${b.id} ${b.product}`}>{b.id} {b.product}</Option>)}
                </Dropdown>
              </Field>
              <Field label="提交时刻">
                <Input value={value.submittedAt} onChange={(_, data) => set({ ...value, submittedAt: data.value })} />
              </Field>
            </div>
          ))}
        </div>
        <div className="record-actions">
          <Button appearance="primary" onClick={() => dispatch(submitObservationPair({
            chainId: chain.id,
            submissions: [
              { windowId: '窗口A · 批次详情', action: winA.action, batchId: winA.batchId || undefined, operator: winA.operator, submittedAt: winA.submittedAt.length === 19 ? `${winA.submittedAt}:00` : winA.submittedAt },
              { windowId: '窗口B · 偏差工作台', action: winB.action, batchId: winB.batchId || undefined, operator: winB.operator, submittedAt: winB.submittedAt.length === 19 ? `${winB.submittedAt}:00` : winB.submittedAt }
            ]
          }))}>两个窗口同时提交</Button>
          <span className="obs-hint">提交时刻相同则按窗口名排序；领先一方执行，滞后一方仅保留冲突记录。</span>
        </div>
      </div>}

      {/* 冲突记录 */}
      <h4>滞后窗口冲突记录（{chain.conflicts.length}）</h4>
      <div className="obs-conflicts">
        {chain.conflicts.length === 0 && <small className="obs-empty">暂无冲突</small>}
        {chain.conflicts.map((conflict) => (
          <div key={conflict.id}>
            <Badge color="danger">{conflict.windowId} · {conflict.action} 未生效</Badge>
            <small>基于 V{conflict.baseVersion}/第{conflict.baseStreak}组 · {fmt(conflict.submittedAt)}</small>
            <p>{conflict.reason}；领先方：{conflict.leadingWindow}（第{conflict.leadingStreak}组）</p>
          </div>
        ))}
        {chain.conflicts.length > 0 && <Button size="small" appearance="subtle" onClick={() => dispatch(clearConflictRecords({ chainId: chain.id }))}>归档冲突展示（审计保留）</Button>}
      </div>

      {/* 手工失效：补写原因 */}
      {active && <div className="obs-revoke">
        <Field label="新故障 / 主动撤回待观察结果（补写原因，已签发放行将同步撤回）">
          <Textarea value={revokeReason} onChange={(_, data) => setRevokeReason(data.value)} placeholder="例如：金属探测仪MD-06再次出现Fe试块漏报" />
        </Field>
        <Button disabled={!revokeReason.trim()} onClick={() => { dispatch(revokeObservation({ chainId: chain.id, reason: revokeReason, operator: '质量负责人 秦岚' })); setRevokeReason('') }}>宣告待观察结果失效并撤回放行</Button>
      </div>}

      {chain.confirmedAt && <p className="obs-confirm-line">✔ {chain.confirmer} 于 {fmt(chain.confirmedAt)} 确认纠偏措施有效，观察链关闭。</p>}
    </div>
  )
}
