import reducer, {
  reviewDeviation, addObservationReading, confirmObservation, releaseUnderObservation,
  recoverPendingWrite, createDeviation, saveInvestigation
} from '../src/store/haccpSlice'
import { consecutiveQualified, observationForBatch, observationReady } from '../src/services/observation'

let state = reducer(undefined, { type: 'init' })
const audit = () => state.audit.map((a) => `${a.action}:${a.detail}`)
let passed = 0
const check = (name: string, cond: boolean) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) process.exitCode = 1; else passed++ }
const obsById = (id: string) => state.observations.find((o) => o.id === id)!
const batchById = (id: string) => state.batches.find((b) => b.id === id)!

// 1) 杀菌偏差（DEV-260929-01）提交调查 -> 复核通过 -> 进入待观察（不直接放行）
state = reducer(state, saveInvestigation({ id: 'DEV-260929-01', investigation: state.deviations.find((d) => d.id === 'DEV-260929-01')!.investigation }))
state = reducer(state, reviewDeviation({ id: 'DEV-260929-01', approved: true, note: 'ok进入观察', reviewer: '秦岚' }))
const p2id = state.observations.find((o) => o.stepId === 'P2' && o.status === '待观察')!.id
check('复核通过后批次进入待观察', batchById('B260929-01').status === '待观察')
check('复核通过创建观察单，需要连续3批(P2)', obsById(p2id).requiredConsecutive === 3)
check('观察单seq初始为0', obsById(p2id).seq === 0)

// 未达标时确认无效
state = reducer(state, confirmObservation({ id: p2id, window: '批次详情窗口', baseSeq: obsById(p2id).seq, operator: '班组值班长' }))
check('连续合格未达标时不能确认', obsById(p2id).status === '待观察')

// 2) 连续合格读数累计；重复token不重复计数
const token = (n: number) => `t-p2-${n}`
const add = (n: number, batch = `B260929-0${4 + n}`, v = 73) =>
  reducer(state, addObservationReading({ observationId: p2id, stepId: 'P2', batchId: batch, value: v, operator: '杨鸣', clientToken: token(n) }))
state = add(1, 'B260929-05', 72.5)
state = add(2, 'B260929-06', 73.1)
state = add(2, 'B260929-06', 73.1) // 重复提交
check('重复提交不重复计数（读数仍为2）', obsById(p2id).readings.length === 2 && consecutiveQualified(obsById(p2id).readings) === 2)
check('每批读数推进seq（seq=2）', obsById(p2id).seq === 2 && obsById(p2id).lastCompleteSeq === 2)

// 3) 双窗口：偏差工作台窗口持有seq=2快照；批次窗口推进到seq=3后，滞后确认记冲突
state = add(3, 'B260929-07', 74.0)
check('连续3批合格，达到确认门槛', observationReady(obsById(p2id)) && consecutiveQualified(obsById(p2id).readings) === 3)
state = reducer(state, confirmObservation({ id: p2id, window: '偏差工作台窗口', baseSeq: 2, operator: '质量复核员' }))
check('滞后窗口确认被保留为冲突且不生效', obsById(p2id).conflicts.length === 1 && obsById(p2id).conflicts[0].action === '确认' && obsById(p2id).status === '待观察')
// 最新窗口确认通过
state = reducer(state, confirmObservation({ id: p2id, window: '批次详情窗口', baseSeq: obsById(p2id).seq, operator: '班组值班长' }))
check('最新进度窗口确认通过', obsById(p2id).status === '已确认')

// 4) 凭确认结果签发放行观察批次；滞后放行记冲突
const seqAtConfirm = obsById(p2id).seq
state = reducer(state, releaseUnderObservation({ observationId: p2id, batchId: 'B260929-01', window: '批次详情窗口', baseSeq: seqAtConfirm, operator: '班组值班长' }))
check('凭确认结果签发放行', batchById('B260929-01').status === '已放行' && obsById(p2id).releasedBatches.includes('B260929-01'))
state = reducer(state, releaseUnderObservation({ observationId: p2id, batchId: 'B260929-01', window: '偏差工作台窗口', baseSeq: seqAtConfirm, operator: '质量复核员' }))
check('滞后窗口放行记冲突且不重复签发', obsById(p2id).conflicts.length === 2)

// 5) 观察期再出同控制点新偏差 -> 已确认观察失效 -> 已签发放行撤回并补写原因
state = reducer(state, createDeviation({ batchId: 'B260929-03', stepId: 'P2', title: '杀菌温度再次低于限值', severity: '重大', owner: '当前用户' }))
check('新同控制点偏差使观察失效', obsById(p2id).status === '已失效' && !!obsById(p2id).invalidationReason)
check('已签发放行同步撤回（放行撤回+原因）', batchById('B260929-01').status === '放行撤回' && !!batchById('B260929-01').withdrawalReason)
check('审计包含撤回放行记录', audit().some((a) => a.startsWith('撤回放行')))
check('追溯选择器指向同一观察结果', observationForBatch(state.observations, 'B260929-01')?.id === p2id)

// 6) 金属探测种子观察（OBS-260929-03）：写入失败 -> 从最后完整观察批次恢复，重放不重复计数
const p3id = 'OBS-260929-03'
const beforeSeq = obsById(p3id).seq
state = reducer(state, addObservationReading({ observationId: p3id, stepId: 'P3', batchId: 'B260929-08', value: 1.4, operator: '杨鸣', clientToken: 'fail-tok', simulateFailure: true }))
check('模拟写入失败：读数不计数，保留待写载荷', obsById(p3id).readings.length === 2 && obsById(p3id).seq === beforeSeq && state.pendingWrite?.clientToken === 'fail-tok')
state = reducer(state, addObservationReading({ observationId: p3id, stepId: 'P3', batchId: 'B260929-09', value: 1.2, operator: '杨鸣', clientToken: 'blocked-tok' }))
check('失败未恢复前拒绝新读数写入', obsById(p3id).readings.length === 2)
state = reducer(state, recoverPendingWrite())
check('恢复后失败批次恰好补记一次（seq+1）', obsById(p3id).readings.length === 3 && obsById(p3id).readings.some((r) => r.clientToken === 'fail-tok') && obsById(p3id).lastCompleteSeq === beforeSeq + 1)
state = reducer(state, recoverPendingWrite()) // 无pending，幂等
check('重复恢复不产生重复计数', obsById(p3id).readings.length === 3)

// 7) 观察期出现不合格监测读数 -> 自动开偏差、观察失效
const p4dev = state.deviations.find((d) => d.id === 'DEV-260929-02')!
state = reducer(state, saveInvestigation({ id: p4dev.id, investigation: p4dev.investigation }))
state = reducer(state, reviewDeviation({ id: p4dev.id, approved: true, note: 'ok观察', reviewer: '秦岚' }))
const p4id = state.observations.find((o) => o.stepId === 'P4' && o.status === '待观察')!.id
state = reducer(state, addObservationReading({ observationId: p4id, stepId: 'P4', batchId: 'B260929-10', value: 0.30, operator: '系统采集', clientToken: 'bad-1' }))
check('观察期不合格读数自动创建偏差', state.deviations.some((d) => d.stepId === 'P4' && d.status === '待调查'))
check('不合格读数使待观察结果失效', obsById(p4id).status === '已失效' && consecutiveQualified(obsById(p4id).readings) === 0)
const n = obsById(p4id).readings.length
state = reducer(state, addObservationReading({ observationId: p4id, stepId: 'P4', value: 0.4, operator: 'x', clientToken: 'x1' }))
check('失效后不能再提交读数', obsById(p4id).readings.length === n)

// 8) 通用放行闸：观察链批次不能绕过观察直接放行（updateBatchStatus被observationBlocking拦截）
import { updateBatchStatus } from '../src/store/haccpSlice'
state = reducer(state, updateBatchStatus({ id: 'B260929-03', status: '已放行' }))
check('观察链批次无法绕过观察直接放行', batchById('B260929-03').status !== '已放行')
check('追溯选择器对观察批次返回同一观察结果', observationForBatch(state.observations, 'B260929-03')?.id === p3id)

console.log(`\n${passed} 项通过`)
