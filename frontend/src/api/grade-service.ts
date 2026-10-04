import {
  applyDeviceStatus,
  countInterruptionHistory,
  existsConclusionInBatch,
  findDevice,
  isRetired,
  listCommunicationDevices,
  listRules,
  saveConclusion,
  syncInspectionCheck,
} from '@/data/grade-store'
import type {
  EntryRow,
  FaultLevel,
  GradeConclusion,
  GradeRule,
  GradeSource,
  GradeSuggestion,
} from '@/data/types'

export type SubmitResult =
  | { ok: true; conclusionId: number; level: FaultLevel; conflict: boolean; inspectionCreated: boolean; inspectionClosed: number; message: string }
  | { ok: false; rejected: boolean; message: string }

/** 信号读数解析：非数字 / 空值视为缺读 */
export function parseSignal(value: unknown): number | null {
  if (value === '' || value === null || value === undefined) {
    return null
  }
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** 最近通讯时刻解析：无法解析的时间视为缺读 */
export function parseSeenAt(value: unknown): Date | null {
  if (value === '' || value === null || value === undefined) {
    return null
  }
  const d = new Date(String(value))
  return Number.isNaN(d.getTime()) ? null : d
}

export function ruleForProtocol(protocol: string): GradeRule | undefined {
  return listRules().find((rule) => rule.通讯协议 === protocol)
}

/**
 * 自动判级：按协议阈值比对信号强度，并结合最近通讯时刻判断断联时长，
 * 再参考该设备历史中断次数给出中断或更换建议。
 * 历史缺读（信号或时刻缺失）不凭空下中断结论，只提示人工核查。
 */
export function autoSuggest(
  device: EntryRow,
  rule: GradeRule | undefined = ruleForProtocol(String(device['通讯协议'] ?? '')),
  now: Date = new Date(),
): GradeSuggestion {
  if (!rule) {
    return {
      level: '通讯正常',
      advice: '未配置该通讯协议的判级阈值，请先在规则区新增',
      reasons: [`通讯协议「${device['通讯协议']}」缺少阈值配置`],
      rule: {
        通讯协议: String(device['通讯协议'] ?? ''),
        弱信号阈值: 0,
        中断信号阈值: 0,
        断联超时小时: 0,
        中断累计更换次数: 0,
        更新时间: '',
      },
      needManual: true,
    }
  }

  const signal = parseSignal(device['信号强度'])
  const seenAt = parseSeenAt(device['最近通讯时刻'])
  const reasons: string[] = []

  if (signal === null || seenAt === null) {
    if (signal === null) reasons.push('信号强度为历史缺读')
    if (seenAt === null) reasons.push('最近通讯时刻为历史缺读')
    return {
      level: '通讯正常',
      advice: '历史缺读，证据不足，请人工补录读数后再判（迁移数据不自动下中断结论）',
      reasons,
      rule,
      needManual: true,
    }
  }

  let level: FaultLevel = '通讯正常'
  const silentHours = (now.getTime() - seenAt.getTime()) / 3_600_000

  if (signal <= rule.中断信号阈值) {
    level = '建议中断核查'
    reasons.push(`信号 ${signal}dBm 不高于中断阈值 ${rule.中断信号阈值}dBm`)
  } else if (signal <= rule.弱信号阈值) {
    level = '信号弱'
    reasons.push(`信号 ${signal}dBm 不高于弱信号阈值 ${rule.弱信号阈值}dBm`)
  } else {
    reasons.push(`信号 ${signal}dBm 高于弱信号阈值 ${rule.弱信号阈值}dBm`)
  }

  if (silentHours >= rule.断联超时小时) {
    level = '建议中断核查'
    reasons.push(`已 ${silentHours.toFixed(1)} 小时未通讯，超过 ${rule.断联超时小时} 小时断联阈值`)
  } else if (level !== '信号弱') {
    reasons.push(`最近通讯在 ${silentHours.toFixed(1)} 小时前，未超断联阈值`)
  }

  const historyInterruptions = countInterruptionHistory(String(device['设备编号']))
  if (level === '建议中断核查' && historyInterruptions >= rule.中断累计更换次数) {
    level = '建议更换'
    reasons.push(
      `历史中断结论累计 ${historyInterruptions} 次，达到 ${rule.中断累计更换次数} 次更换门槛`,
    )
  } else if (level === '建议中断核查') {
    reasons.push(`历史中断累计 ${historyInterruptions} 次，未达 ${rule.中断累计更换次数} 次更换门槛`)
  }

  const advice =
    level === '建议更换'
      ? '中断核查并启动设备更换流程'
      : level === '建议中断核查'
        ? '建议立即中断核查通信链路'
        : level === '信号弱'
          ? '信号偏弱，持续观察并安排现场检测'
          : '通信指标正常，无需处置'

  return { level, advice, reasons, rule, needManual: false }
}

/** 判级级别回写到通讯设备的状态 */
export function deviceStatusForLevel(level: FaultLevel): { status: string; abnormal: boolean } {
  switch (level) {
    case '建议中断核查':
      return { status: '通讯中断', abnormal: true }
    case '建议更换':
      return { status: '待更换', abnormal: true }
    case '信号弱':
      return { status: '信号弱', abnormal: true }
    case '通讯正常':
    default:
      return { status: '通讯正常', abnormal: false }
  }
}

function buildConclusion(
  device: EntryRow,
  suggestion: GradeSuggestion,
  source: GradeSource,
  finalLevel: FaultLevel,
  batch: string,
  operator: string,
): GradeConclusion {
  const advice =
    finalLevel === '建议更换'
      ? '中断核查并启动设备更换流程'
      : finalLevel === '建议中断核查'
        ? '建议立即中断核查通信链路'
        : finalLevel === '信号弱'
          ? '信号偏弱，持续观察并安排现场检测'
          : '通信指标正常，无需处置'
  return {
    id: 0,
    设备编号: String(device['设备编号']),
    所属站点: String(device['所属站点'] ?? ''),
    通讯协议: String(device['通讯协议'] ?? ''),
    信号强度: parseSignal(device['信号强度']),
    最近通讯时刻: String(device['最近通讯时刻'] ?? ''),
    级别: finalLevel,
    建议: source === '人工' ? `【人工判定】${advice}` : advice,
    来源: source,
    自动级别: suggestion.level,
    冲突: source === '人工' && finalLevel !== suggestion.level,
    规则快照: { ...suggestion.rule },
    上报批次: batch,
    判定时间: new Date().toISOString(),
    判定人: operator,
  }
}

/**
 * 接受一个判级结论（自动上报或人工判定走同一入口）。
 * 守卫顺序：停用设备 → 同批次同设备去重（并发只接受一个结论）→ 落库 + 回写 + 巡检联动。
 */
export function acceptConclusion(
  deviceCode: string,
  source: GradeSource,
  finalLevel: FaultLevel,
  suggestion: GradeSuggestion,
  batch: string,
  operator: string,
): SubmitResult {
  const device = findDevice(deviceCode)
  if (!device) {
    return { ok: false, rejected: true, message: `没有找到设备 ${deviceCode}` }
  }
  // 停用设备不允许保存新结论
  if (isRetired(device)) {
    return { ok: false, rejected: true, message: `设备 ${deviceCode} 已停用，不允许保存新结论` }
  }
  // 同一设备重复并发上报：同批次已有结论直接拒绝，只接受一个
  const duplicate = existsConclusionInBatch(deviceCode, batch)
  if (duplicate) {
    return {
      ok: false,
      rejected: true,
      message: `设备 ${deviceCode} 在本批次已有${duplicate.来源}结论 #${duplicate.id}，重复上报已忽略`,
    }
  }

  const conclusion = buildConclusion(device, suggestion, source, finalLevel, batch, operator)
  const conclusionId = saveConclusion(conclusion)
  const { status, abnormal } = deviceStatusForLevel(finalLevel)
  applyDeviceStatus(deviceCode, status, abnormal)
  const inspection = syncInspectionCheck(device, finalLevel, conclusionId)

  const conflictNote = conclusion.冲突 ? '（人工结论与自动建议冲突，以人工为准）' : ''
  const inspectionNote = inspection.created
    ? `，已在巡检记录生成通信核查事项`
    : inspection.closed > 0
      ? `，已关闭 ${inspection.closed} 条通信核查待办`
      : ''
  return {
    ok: true,
    conclusionId,
    level: finalLevel,
    conflict: conclusion.冲突,
    inspectionCreated: inspection.created,
    inspectionClosed: inspection.closed,
    message: `${deviceCode} 结论「${finalLevel}」已保存${conflictNote}${inspectionNote}`,
  }
}

/** 自动上报：只接受机判建议；缺读设备自动上报会被拦下转人工 */
export function submitAutoGrade(
  deviceCode: string,
  batch: string,
  operator: string,
  now: Date = new Date(),
): SubmitResult {
  const device = findDevice(deviceCode)
  if (!device) {
    return { ok: false, rejected: true, message: `没有找到设备 ${deviceCode}` }
  }
  const suggestion = autoSuggest(device, undefined, now)
  if (suggestion.needManual) {
    return {
      ok: false,
      rejected: true,
      message: `${deviceCode} ${suggestion.advice}`,
    }
  }
  return acceptConclusion(deviceCode, '自动', suggestion.level, suggestion, batch, operator)
}

/** 人工判级：人工选择即最终结论，与自动建议冲突时以人工为准 */
export function submitManualGrade(
  deviceCode: string,
  level: FaultLevel,
  batch: string,
  operator: string,
  now: Date = new Date(),
): SubmitResult {
  const device = findDevice(deviceCode)
  if (!device) {
    return { ok: false, rejected: true, message: `没有找到设备 ${deviceCode}` }
  }
  const suggestion = autoSuggest(device, undefined, now)
  return acceptConclusion(deviceCode, '人工', level, suggestion, batch, operator)
}

/** 规则台表格用：设备 + 自动建议的组合视图 */
export function gradeBoard(now: Date = new Date()) {
  return listCommunicationDevices().map((device) => {
    const rule = ruleForProtocol(String(device['通讯协议'] ?? ''))
    const suggestion = autoSuggest(device, rule, now)
    return {
      device,
      rule,
      suggestion,
      retired: isRetired(device),
      missing: suggestion.needManual && /缺读/.test(suggestion.advice),
    }
  })
}
