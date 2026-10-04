/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

// ===== 通讯设备故障判级规则台 =====

/** 判级结论级别：更换建议重于中断建议 */
export type FaultLevel = '通讯正常' | '信号弱' | '建议中断核查' | '建议更换'

/** 结论来源：自动机判 / 人工判级（冲突时以人工为准） */
export type GradeSource = '自动' | '人工'

/** 按通讯协议配置的判级阈值：信号不高于弱信号阈值判弱，不高于中断阈值判中断；断联超时判中断 */
export type GradeRule = {
  通讯协议: string
  弱信号阈值: number
  中断信号阈值: number
  断联超时小时: number
  中断累计更换次数: number
  更新时间: string
}

/** 故障判级结论记录 */
export type GradeConclusion = {
  id: number
  设备编号: string
  所属站点: string
  通讯协议: string
  信号强度: number | null
  最近通讯时刻: string
  /** 本次实际落定的级别：人工判级时以人工选择为准 */
  级别: FaultLevel
  建议: string
  来源: GradeSource
  /** 自动机判级别，人工与自动不一致时用于展示冲突 */
  自动级别: FaultLevel
  冲突: boolean
  /** 判级时使用的阈值快照，规则之后被调整也不影响历史结论追溯 */
  规则快照: GradeRule
  上报批次: string
  判定时间: string
  判定人: string
}

/** 自动判级结果（尚未落库） */
export type GradeSuggestion = {
  level: FaultLevel
  advice: string
  reasons: string[]
  rule: GradeRule
  /** 历史缺读等证据不足场景：只提示人工核查，不直接落中断 */
  needManual: boolean
}
