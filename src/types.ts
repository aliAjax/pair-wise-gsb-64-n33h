export type BatchStatus = '生产中' | '待复核' | '待观察' | '可放行' | '隔离中' | '已放行' | '已报废'
export type DeviationStatus = '待调查' | '调查中' | '待复核' | '已关闭'
export type DecisionType = '返工' | '报废' | '让步接收'
export type ObservationStatus = '待观察' | '已确认' | '已失效'
export type ObservationAction = '确认' | '放行'

export interface ProcessStep {
  id: string
  name: string
  equipment: string
  hazard: string
  controlPoint: string
  limit: string
  /** 监测读数计量单位，用于效果确认链判定合格 */
  unit: string
  /** 合格区间（含端点），null 表示该侧不限制 */
  minLimit: number | null
  maxLimit: number | null
  frequency: string
  correctiveAction: string
  /** 纠偏复核通过后是否需要进入待观察效果确认 */
  observationRequired: boolean
  /** 连续合格读数组数，达标后方可确认效果 */
  observationBatches: number
}

export interface MonitoringValue {
  stepId: string
  value: number
  unit: string
  recordedAt: string
  operator: string
  conforming?: boolean
  /** 客户端幂等令牌，重复提交不重复计数 */
  clientToken?: string
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

/** 效果确认链上的一个完整观察批次读数 */
export interface ObservationRecord {
  id: string
  chainId: string
  batchId: string
  stepId: string
  value: number
  unit: string
  conforming: boolean
  recordedAt: string
  operator: string
  clientToken: string
}

/** 观察期内签发的放行，链失效时同步撤回 */
export interface ProvisionalRelease {
  id: string
  chainId: string
  batchId: string
  windowId: string
  signer: string
  signedAt: string
  revoked: boolean
  revokedAt?: string
  revokeReason?: string
}

/** 两个窗口同时提交时滞后一方保留的冲突记录 */
export interface ObservationConflict {
  id: string
  chainId: string
  windowId: string
  action: ObservationAction
  baseStreak: number
  baseVersion: number
  submittedAt: string
  leadingWindow: string
  leadingStreak: number
  reason: string
  createdAt: string
}

/** 写入失败后暂存、待恢复的观察读数 */
export interface StagedObservation {
  chainId: string
  batchId: string
  stepId: string
  value: number
  unit: string
  operator: string
  recordedAt: string
  clientToken: string
  failedAt: string
}

export interface ObservationChain {
  id: string
  stepId: string
  sourceDeviationId: string
  sourceBatchId: string
  status: ObservationStatus
  requiredBatches: number
  /** 连续合格读数计数，等于 records 长度（链激活期间） */
  streak: number
  records: ObservationRecord[]
  releases: ProvisionalRelease[]
  conflicts: ObservationConflict[]
  failedWrites: Array<{ clientToken: string; batchId: string; at: string; reason: string; recovered: boolean }>
  confirmedAt?: string
  confirmer?: string
  invalidatedAt?: string
  invalidateReason?: string
  openedAt: string
  /** 观察进度版本：仅读数推进/确认/失效时递增，冲突登记不改变版本 */
  version: number
}

export interface AuditEntry {
  id: string
  entity: string
  action: string
  operator: string
  detail: string
  createdAt: string
}
