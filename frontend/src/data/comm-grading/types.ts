/** 通讯设备故障判级规则台的领域类型。
 * 与既有 EntryRow 通用清单分开存放（独立 localStorage 键），换回后端时这一层可以整体替换为接口。 */

/** 判级等级：数值越大越严重，缺读数单独成级等待人工补录。 */
export type CommGradeLevel = '通讯正常' | '信号弱' | '建议中断核查' | '建议更换' | '缺读数待补'

/** 结论来源：自动判级 / 人工判断。冲突时以人工为准。 */
export type CommConclusionSource = 'auto' | 'manual'

/** 设备运行状态。停用设备不允许保存新结论。 */
export type CommDeviceStatus = '在用' | '停用'

/** 判级输入：按设备编号、所属站点、通讯协议、信号阈值和最近通讯时刻给出。 */
export type CommDevice = {
  id: number
  deviceCode: string
  station: string
  protocol: string
  deviceType: string
  /** 原始信号读数（dBm 文本或百分比）；空串表示缺读数。 */
  signalRaw: string
  /** 最近通讯时刻（ISO 字符串）；空串表示缺读数。 */
  lastCommAt: string
  maintainer: string
  status: CommDeviceStatus
  /** 数据来源：判级台建档 / 从旧通讯清单迁移。 */
  migratedFromLegacy: boolean
  note: string
}

/** 按通讯协议配置的信号阈值与离线时长阈值，台面上可调整。 */
export type ProtocolThreshold = {
  protocol: string
  /** 信号低于该值判「信号弱」（含），单位 dBm。 */
  weakDbm: number
  /** 信号低于该值判「建议更换」（含），单位 dBm。 */
  replaceDbm: number
  /** 最近通讯时刻距今超过该分钟数判「建议中断核查」。 */
  staleMinutes: number
  builtin: boolean
}

/** 一次判级结果。 */
export type GradeResult = {
  level: CommGradeLevel
  advice: string
  reasons: string[]
}

/** 结论记录：自动结果与人工判断都落库，人工结论在冲突时覆盖自动结论。 */
export type GradeConclusion = {
  id: number
  deviceId: number
  deviceCode: string
  level: CommGradeLevel
  source: CommConclusionSource
  advice: string
  reasons: string
  operator: string
  createdAt: string
  /** 判级批次（上报轮次）；同一轮次同一设备重复并发上报只接受一个结论。 */
  roundId: number
  /** auto 结论若与既有人工结论冲突，仅留痕，不生效。 */
  effective: boolean
}

/** 同步到巡检链路的通信核查事项。 */
export type CommCheckItem = {
  id: number
  deviceId: number
  deviceCode: string
  station: string
  level: CommGradeLevel
  title: string
  detail: string
  source: CommConclusionSource
  status: '待核查' | '已核查'
  createdAt: string
  closedAt: string
  conclusionId: number
}

/** 同一设备重复并发上报的占用锁（持久化，刷新后仍拦截）。 */
export type ReportLock = {
  deviceId: number
  roundId: number
  conclusionId: number
  /** 判级输入快照；同快照重复上报直接拒绝。 */
  snapshot: string
  /** 锁到期时间（ISO），到期自动放行新一轮。 */
  expiresAt: string
}

/** 历史缺读数迁移结果说明。 */
export type MigrationSummary = {
  migratedAt: string
  legacyTotal: number
  imported: number
  missingReadings: number
  note: string
}

export type CommGradingState = {
  version: number
  devices: CommDevice[]
  thresholds: ProtocolThreshold[]
  conclusions: GradeConclusion[]
  checkItems: CommCheckItem[]
  locks: ReportLock[]
  nextId: number
  roundId: number
  migration: MigrationSummary | null
}

export type AutoReportResult = {
  accepted: boolean
  message: string
  deviceCode: string
  level: CommGradeLevel | null
  /** 命中既有人工结论时返回，台面上据此提示「以人工为准」。 */
  overriddenByManual: boolean
}

/** 并发上报压测的单台结果。 */
export type ConcurrentReportOutcome = AutoReportResult & { duplicate: boolean }
