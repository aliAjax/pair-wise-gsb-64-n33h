export type BatchStatus = '生产中' | '待复核' | '待观察' | '可放行' | '隔离中' | '已放行' | '已报废' | '放行撤回'
export type DeviationStatus = '待调查' | '调查中' | '待复核' | '已关闭'
export type DecisionType = '返工' | '报废' | '让步接收'
export type ObservationStatus = '待观察' | '已确认' | '已失效'

export interface LimitRange {
  min?: number
  max?: number
}

export interface ProcessStep {
  id: string
  name: string
  equipment: string
  hazard: string
  controlPoint: string
  limit: string
  limitRange: LimitRange
  unit: string
  /** 纠偏效果确认所需的连续合格观察批次数。 */
  requiredConsecutive: number
  frequency: string
  correctiveAction: string
}

export interface MonitoringValue {
  stepId: string
  value: number
  unit: string
  recordedAt: string
  operator: string
}

export interface Batch {
  id: string
  product: string
  line: string
  quantity: number
  producedAt: string
  status: BatchStatus
  isolationScope: string
  monitoring: MonitoringValue[]
  /** 放行被观察结果失效连带撤回时补写的原因。 */
  withdrawalReason?: string
  version: number
}

export interface Investigation {
  cause: string
  evidence: string
  decision: DecisionType
  reworkInstruction: string
}

export interface Deviation {
  id: string
  batchId: string
  stepId: string
  title: string
  severity: '一般' | '重大'
  status: DeviationStatus
  owner: string
  openedAt: string
  dueDate: string
  investigation: Investigation
  reviewNote: string
  reviewer: string
  version: number
}

/** 观察期内的单批监测读数，是连续合格判定与恢复的最小完整单元。 */
export interface ObservationReading {
  clientToken: string
  stepId: string
  batchId?: string
  value: number
  unit: string
  qualified: boolean
  operator: string
  recordedAt: string
}

/** 滞后窗口（基于过期观察进度提交）留下的冲突记录。 */
export interface ObservationConflict {
  id: string
  window: string
  action: '确认' | '放行'
  basedOnSeq: number
  latestSeq: number
  operator: string
  detail: string
  createdAt: string
}

/** 纠偏措施效果确认单：串联控制矩阵、批次监测、偏差处置与追溯审计。 */
export interface EffectObservation {
  id: string
  deviationId: string
  batchId: string
  stepId: string
  status: ObservationStatus
  requiredConsecutive: number
  approvedBy: string
  startedAt: string
  readings: ObservationReading[]
  /** 观察进度序号：任何有效推进（读数/确认/失效/放行）都会递增，作为窗口乐观锁。 */
  seq: number
  /** 最后一个完整落盘的观察批次序号，写入失败后的恢复点。 */
  lastCompleteSeq: number
  confirmedAt?: string
  invalidatedAt?: string
  invalidationReason?: string
  /** 凭本观察结果签发放行的批次，失效时需同步撤回。 */
  releasedBatches: string[]
  conflicts: ObservationConflict[]
  version: number
}

/** 模拟监测读数写入失败时保留的待重放载荷。 */
export interface PendingObservationWrite {
  clientToken: string
  observationId: string
  stepId: string
  batchId?: string
  value: number
  operator: string
  failedAt: string
  checkpointSeq: number
}

export interface AuditEntry {
  id: string
  entity: string
  action: string
  operator: string
  detail: string
  createdAt: string
}
