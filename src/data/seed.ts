import type { AuditEntry, Batch, Deviation, EffectObservation, ProcessStep } from '../types'

export const processSteps: ProcessStep[] = [
  { id: 'P1', name: '原料验收', equipment: '冷藏收货台', hazard: '致病菌、温度失控', controlPoint: '原料中心温度', limit: '≤ 4 ℃', limitRange: { max: 4 }, unit: '℃', requiredConsecutive: 2, frequency: '每批', correctiveAction: '拒收并隔离供应商批次' },
  { id: 'P2', name: '巴氏杀菌', equipment: 'HTST-02', hazard: '致病菌残留', controlPoint: '杀菌温度', limit: '≥ 72 ℃ / 15 s', limitRange: { min: 72 }, unit: '℃', requiredConsecutive: 3, frequency: '连续记录', correctiveAction: '自动回流并触发偏差' },
  { id: 'P3', name: '金属探测', equipment: 'MD-06', hazard: '金属异物', controlPoint: 'Fe/SUS灵敏度', limit: 'Fe 1.5 mm / SUS 2.0 mm', limitRange: { max: 1.5 }, unit: 'mm Fe', requiredConsecutive: 4, frequency: '每半小时', correctiveAction: '隔离末次合格点以来产品' },
  { id: 'P4', name: '灌装封口', equipment: 'FILL-01', hazard: '密封不良', controlPoint: '封口压力', limit: '0.38-0.45 MPa', limitRange: { min: 0.38, max: 0.45 }, unit: 'MPa', requiredConsecutive: 2, frequency: '每小时', correctiveAction: '停机调机并复检留样' },
  { id: 'P5', name: '终产品冷却', equipment: '冷却隧道', hazard: '芽孢萌发', controlPoint: '冷却结束温度', limit: '≤ 10 ℃ / 2 h', limitRange: { max: 10 }, unit: '℃', requiredConsecutive: 2, frequency: '每批', correctiveAction: '延长冷却并观察质量' }
]

export const seedBatches: Batch[] = [
  {
    id: 'B260929-01', product: '低温鲜奶 950mL', line: 'L1', quantity: 3200, producedAt: '2026-09-29T06:20:00', status: '隔离中', isolationScope: '杀菌后至金属探测前全部在制品', version: 4,
    monitoring: [
      { stepId: 'P1', value: 3.4, unit: '℃', recordedAt: '2026-09-29T06:25:00', operator: '陈莉' },
      { stepId: 'P2', value: 70.8, unit: '℃', recordedAt: '2026-09-29T06:48:00', operator: '系统采集' },
      { stepId: 'P3', value: 1.5, unit: 'mm Fe', recordedAt: '2026-09-29T07:20:00', operator: '杨鸣' }
    ]
  },
  {
    id: 'B260929-02', product: '原味酸奶 200g', line: 'L2', quantity: 8600, producedAt: '2026-09-29T08:10:00', status: '待复核', isolationScope: 'FILL-01本次清洁后产品', version: 3,
    monitoring: [
      { stepId: 'P4', value: 0.36, unit: 'MPa', recordedAt: '2026-09-29T08:40:00', operator: '系统采集' },
      { stepId: 'P5', value: 8.2, unit: '℃', recordedAt: '2026-09-29T10:10:00', operator: '郑凯' }
    ]
  },
  {
    id: 'B260929-03', product: '高钙鲜奶 950mL', line: 'L1', quantity: 4200, producedAt: '2026-09-29T10:05:00', status: '待观察', isolationScope: '金属探测观察期内全部产品', version: 5,
    monitoring: [
      { stepId: 'P3', value: 1.8, unit: 'mm Fe', recordedAt: '2026-09-29T10:12:00', operator: '杨鸣' }
    ]
  },
  {
    id: 'B260928-07', product: '低脂牛奶 1L', line: 'L1', quantity: 5100, producedAt: '2026-09-28T16:20:00', status: '已放行', isolationScope: '无', version: 6,
    monitoring: processSteps.map((step, index) => ({ stepId: step.id, value: [3.0, 73.2, 1.2, 0.41, 7.8][index], unit: ['℃', '℃', 'mm Fe', 'MPa', '℃'][index], recordedAt: '2026-09-28T17:00:00', operator: '生产线记录' }))
  }
]

export const seedDeviations: Deviation[] = [
  {
    id: 'DEV-260929-01', batchId: 'B260929-01', stepId: 'P2', title: '杀菌温度低于关键限值', severity: '重大', status: '调查中', owner: '质量工程组', openedAt: '2026-09-29T06:55:00', dueDate: '2026-09-29', version: 3,
    investigation: { cause: '蒸汽调节阀响应滞后', evidence: '趋势图显示70.8℃持续42秒；阀门检修记录已上传', decision: '返工', reworkInstruction: '隔离产品全部回流至平衡槽，重新杀菌并留样验证' }, reviewNote: '', reviewer: ''
  },
  {
    id: 'DEV-260929-02', batchId: 'B260929-02', stepId: 'P4', title: '封口压力偏低', severity: '一般', status: '待复核', owner: '设备保障组', openedAt: '2026-09-29T08:52:00', dueDate: '2026-09-30', version: 2,
    investigation: { cause: '气缸密封圈磨损', evidence: '压力曲线、拆检照片、备件领用单', decision: '返工', reworkInstruction: '更换密封圈，返封隔离产品并恢复压力。' }, reviewNote: '', reviewer: ''
  },
  {
    id: 'DEV-260929-03', batchId: 'B260929-03', stepId: 'P3', title: '金属探测Fe灵敏度未达限值', severity: '重大', status: '已关闭', owner: '设备保障组', openedAt: '2026-09-29T10:15:00', dueDate: '2026-09-29', version: 4,
    investigation: { cause: '探测仪线圈受金属夹具干扰', evidence: '灵敏度校验卡复测记录、夹具移位整改照片、再校验合格单', decision: '返工', reworkInstruction: '隔离末次合格点以来产品全量过探，设备再校验合格后恢复生产。' }, reviewNote: '调查证据充分，纠偏措施可执行，进入观察期确认。', reviewer: '质量负责人 秦岚'
  }
]

export const seedObservations: EffectObservation[] = [
  {
    id: 'OBS-260929-03', deviationId: 'DEV-260929-03', batchId: 'B260929-03', stepId: 'P3', status: '待观察', requiredConsecutive: 4,
    approvedBy: '质量负责人 秦岚', startedAt: '2026-09-29T11:05:00', seq: 2, lastCompleteSeq: 2, releasedBatches: [], conflicts: [], version: 3,
    readings: [
      { clientToken: 'seed-r1', stepId: 'P3', batchId: 'B260929-03', value: 1.3, unit: 'mm Fe', qualified: true, operator: '杨鸣', recordedAt: '2026-09-29T11:30:00' },
      { clientToken: 'seed-r2', stepId: 'P3', batchId: 'B260929-04', value: 1.4, unit: 'mm Fe', qualified: true, operator: '杨鸣', recordedAt: '2026-09-29T12:00:00' }
    ]
  }
]

export const seedAudit: AuditEntry[] = [
  { id: 'AUD-1', entity: 'B260929-01', action: '自动创建偏差', operator: '监控系统', detail: '杀菌温度70.8℃低于限值72℃，批次已隔离', createdAt: '2026-09-29T06:55:00' },
  { id: 'AUD-2', entity: 'DEV-260929-01', action: '提交调查', operator: '质量工程组', detail: '记录蒸汽阀响应滞后与趋势证据', createdAt: '2026-09-29T08:15:00' },
  { id: 'AUD-3', entity: 'B260929-02', action: '状态流转', operator: '杨鸣', detail: '由生产中转为待复核', createdAt: '2026-09-29T08:52:00' },
  { id: 'AUD-4', entity: 'OBS-260929-03', action: '进入待观察', operator: '质量负责人 秦岚', detail: '金属探测纠偏复核通过，连续4批合格方可确认效果', createdAt: '2026-09-29T11:05:00' },
  { id: 'AUD-5', entity: 'OBS-260929-03', action: '观察读数', operator: '杨鸣', detail: 'B260929-03 Fe 1.3 mm（合格，连续1/4）', createdAt: '2026-09-29T11:30:00' },
  { id: 'AUD-6', entity: 'OBS-260929-03', action: '观察读数', operator: '杨鸣', detail: 'B260929-04 Fe 1.4 mm（合格，连续2/4）', createdAt: '2026-09-29T12:00:00' }
]
