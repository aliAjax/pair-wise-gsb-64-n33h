import type { AuditEntry, Batch, Deviation, ObservationChain, ProcessStep } from '../types'

export const processSteps: ProcessStep[] = [
  { id: 'P1', name: '原料验收', equipment: '冷藏收货台', hazard: '致病菌、温度失控', controlPoint: '原料中心温度', limit: '≤ 4 ℃', unit: '℃', minLimit: null, maxLimit: 4, frequency: '每批', correctiveAction: '拒收并隔离供应商批次', observationRequired: true, observationBatches: 2 },
  { id: 'P2', name: '巴氏杀菌', equipment: 'HTST-02', hazard: '致病菌残留', controlPoint: '杀菌温度', limit: '≥ 72 ℃ / 15 s', unit: '℃', minLimit: 72, maxLimit: null, frequency: '连续记录', correctiveAction: '自动回流并触发偏差', observationRequired: true, observationBatches: 3 },
  { id: 'P3', name: '金属探测', equipment: 'MD-06', hazard: '金属异物', controlPoint: 'Fe/SUS灵敏度', limit: 'Fe 1.5 mm / SUS 2.0 mm', unit: 'mm Fe', minLimit: null, maxLimit: 1.5, frequency: '每半小时', correctiveAction: '隔离末次合格点以来产品', observationRequired: true, observationBatches: 3 },
  { id: 'P4', name: '灌装封口', equipment: 'FILL-01', hazard: '密封不良', controlPoint: '封口压力', limit: '0.38-0.45 MPa', unit: 'MPa', minLimit: 0.38, maxLimit: 0.45, frequency: '每小时', correctiveAction: '停机调机并复检留样', observationRequired: false, observationBatches: 0 },
  { id: 'P5', name: '终产品冷却', equipment: '冷却隧道', hazard: '芽孢萌发', controlPoint: '冷却结束温度', limit: '≤ 10 ℃ / 2 h', unit: '℃', minLimit: null, maxLimit: 10, frequency: '每批', correctiveAction: '延长冷却并观察质量', observationRequired: false, observationBatches: 0 }
]

export const seedBatches: Batch[] = [
  {
    id: 'B260929-01', product: '低温鲜奶 950mL', line: 'L1', quantity: 3200, producedAt: '2026-09-29T06:20:00', status: '隔离中', isolationScope: '杀菌后至金属探测前全部在制品', version: 4,
    monitoring: [
      { stepId: 'P1', value: 3.4, unit: '℃', recordedAt: '2026-09-29T06:25:00', operator: '陈莉', conforming: true },
      { stepId: 'P2', value: 70.8, unit: '℃', recordedAt: '2026-09-29T06:48:00', operator: '系统采集', conforming: false },
      { stepId: 'P3', value: 1.5, unit: 'mm Fe', recordedAt: '2026-09-29T07:20:00', operator: '杨鸣', conforming: true }
    ]
  },
  {
    id: 'B260929-02', product: '原味酸奶 200g', line: 'L2', quantity: 8600, producedAt: '2026-09-29T08:10:00', status: '待复核', isolationScope: 'FILL-01本次清洁后产品', version: 3,
    monitoring: [
      { stepId: 'P4', value: 0.36, unit: 'MPa', recordedAt: '2026-09-29T08:40:00', operator: '系统采集', conforming: false },
      { stepId: 'P5', value: 8.2, unit: '℃', recordedAt: '2026-09-29T10:10:00', operator: '郑凯', conforming: true }
    ]
  },
  {
    id: 'B260928-07', product: '低脂牛奶 1L', line: 'L1', quantity: 5100, producedAt: '2026-09-28T16:20:00', status: '已放行', isolationScope: '无', version: 6,
    monitoring: processSteps.map((step, index) => ({ stepId: step.id, value: [3.0, 73.2, 1.2, 0.41, 7.8][index], unit: step.unit, recordedAt: '2026-09-28T17:00:00', operator: '生产线记录', conforming: true }))
  },
  // 杀菌纠偏复核通过后的后续批次（观察链 OBS-260929-02）
  {
    id: 'B260930-11', product: '低温鲜奶 950mL', line: 'L1', quantity: 3350, producedAt: '2026-09-30T06:10:00', status: '待观察', isolationScope: '无（观察期内放行需挂观察许可）', version: 2,
    monitoring: [
      { stepId: 'P2', value: 73.6, unit: '℃', recordedAt: '2026-09-30T06:40:00', operator: '系统采集', conforming: true, clientToken: 'seed-obs2-1' }
    ]
  },
  {
    id: 'B260930-12', product: '低脂牛奶 1L', line: 'L1', quantity: 4900, producedAt: '2026-09-30T09:30:00', status: '待观察', isolationScope: '无（观察期内放行需挂观察许可）', version: 1,
    monitoring: []
  },
  {
    id: 'B260930-13', product: '低温鲜奶 950mL', line: 'L1', quantity: 3100, producedAt: '2026-09-30T12:40:00', status: '生产中', isolationScope: '无', version: 1,
    monitoring: []
  },
  // 金属探测纠偏复核后的后续批次（观察链 OBS-260929-01）
  {
    id: 'B260930-21', product: '原味酸奶 200g', line: 'L2', quantity: 8200, producedAt: '2026-09-30T07:15:00', status: '已放行', isolationScope: '无（观察许可临时放行）', version: 3,
    monitoring: [
      { stepId: 'P3', value: 1.3, unit: 'mm Fe', recordedAt: '2026-09-30T07:45:00', operator: '杨鸣', conforming: true, clientToken: 'seed-obs1-1' },
      { stepId: 'P3', value: 1.2, unit: 'mm Fe', recordedAt: '2026-09-30T08:15:00', operator: '杨鸣', conforming: true, clientToken: 'seed-obs1-2' }
    ]
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
  // 金属探测：纠偏措施已复核通过，效果确认链进行中
  {
    id: 'DEV-260929-03', batchId: 'B260928-07', stepId: 'P3', title: '金属探测Fe灵敏度试块报警异常', severity: '一般', status: '已关闭', owner: '设备保障组', openedAt: '2026-09-28T17:20:00', dueDate: '2026-09-29', version: 4,
    investigation: { cause: '探测仪传送导轨震动导致试块偏移', evidence: '灵敏度验证记录、导轨紧固扭矩记录、连续3次试块测试合格', decision: '返工', reworkInstruction: '紧固导轨并重新校准，隔离段全部过机复检。' }, reviewNote: '纠偏有效，后续批次进入观察确认，连续3组合格读数后关闭确认链。', reviewer: '质量负责人 秦岚'
  },
  // 杀菌：纠偏措施已复核通过，效果确认链刚进入待观察
  {
    id: 'DEV-260929-04', batchId: 'B260929-01', stepId: 'P2', title: '杀菌温度低于关键限值（阀门更换后复核）', severity: '重大', status: '已关闭', owner: '质量工程组', openedAt: '2026-09-29T11:05:00', dueDate: '2026-09-29', version: 5,
    investigation: { cause: '蒸汽调节阀响应滞后（阀杆卡滞）', evidence: '更换阀门检修单、73.5℃验证曲线、首件微生物留样合格', decision: '返工', reworkInstruction: '更换蒸汽调节阀，隔离产品全部回流重新杀菌。' }, reviewNote: '纠偏措施复核通过，后续批次进入待观察，连续3批合格且无同控制点新偏差方可确认。', reviewer: '质量负责人 秦岚'
  }
]

export const seedChains: ObservationChain[] = [
  {
    id: 'OBS-260929-01', stepId: 'P3', sourceDeviationId: 'DEV-260929-03', sourceBatchId: 'B260928-07',
    status: '待观察', requiredBatches: 3, streak: 2,
    records: [
      { id: 'OBSR-0101', chainId: 'OBS-260929-01', batchId: 'B260930-21', stepId: 'P3', value: 1.3, unit: 'mm Fe', conforming: true, recordedAt: '2026-09-30T07:45:00', operator: '杨鸣', clientToken: 'seed-obs1-1' },
      { id: 'OBSR-0102', chainId: 'OBS-260929-01', batchId: 'B260930-21', stepId: 'P3', value: 1.2, unit: 'mm Fe', conforming: true, recordedAt: '2026-09-30T08:15:00', operator: '杨鸣', clientToken: 'seed-obs1-2' }
    ],
    releases: [
      { id: 'REL-0101', chainId: 'OBS-260929-01', batchId: 'B260930-21', windowId: '批次详情', signer: '班组 周磊', signedAt: '2026-09-30T08:40:00', revoked: false }
    ],
    conflicts: [], failedWrites: [],
    openedAt: '2026-09-29T18:05:00', version: 3
  },
  {
    id: 'OBS-260929-02', stepId: 'P2', sourceDeviationId: 'DEV-260929-04', sourceBatchId: 'B260929-01',
    status: '待观察', requiredBatches: 3, streak: 1,
    records: [
      { id: 'OBSR-0201', chainId: 'OBS-260929-02', batchId: 'B260930-11', stepId: 'P2', value: 73.6, unit: '℃', conforming: true, recordedAt: '2026-09-30T06:40:00', operator: '系统采集', clientToken: 'seed-obs2-1' }
    ],
    releases: [], conflicts: [], failedWrites: [],
    openedAt: '2026-09-29T16:30:00', version: 2
  }
]

export const seedAudit: AuditEntry[] = [
  { id: 'AUD-1', entity: 'B260929-01', action: '自动创建偏差', operator: '监控系统', detail: '杀菌温度70.8℃低于限值72℃，批次已隔离', createdAt: '2026-09-29T06:55:00' },
  { id: 'AUD-2', entity: 'DEV-260929-01', action: '提交调查', operator: '质量工程组', detail: '记录蒸汽阀响应滞后与趋势证据', createdAt: '2026-09-29T08:15:00' },
  { id: 'AUD-3', entity: 'B260929-02', action: '状态流转', operator: '杨鸣', detail: '由生产中转为待复核', createdAt: '2026-09-29T08:52:00' },
  { id: 'AUD-4', entity: 'DEV-260929-03', action: '复核通过', operator: '质量负责人 秦岚', detail: '金属探测纠偏措施复核通过，效果确认链OBS-260929-01进入待观察', createdAt: '2026-09-29T18:05:00' },
  { id: 'AUD-5', entity: 'OBS-260929-01', action: '观察许可放行', operator: '班组 周磊', detail: 'B260930-21在待观察期内凭连续2组合格读数临时放行，许可待确认链确认', createdAt: '2026-09-30T08:40:00' },
  { id: 'AUD-6', entity: 'DEV-260929-04', action: '复核通过', operator: '质量负责人 秦岚', detail: '杀菌纠偏措施复核通过，效果确认链OBS-260929-02进入待观察（连续3批）', createdAt: '2026-09-29T16:30:00' }
]
