import type { CommDevice, CommGradeLevel, GradeResult, ProtocolThreshold } from './types'

/**
 * 故障判级规则：按设备编号、所属站点、通讯协议、信号阈值和最近通讯时刻给出中断或更换建议。
 * 规则集中在这里，页面组件不做业务判断；阈值由规则台按协议维护。
 */

/** 旧清单迁移过来、协议未登记阈值时使用的兜底阈值。 */
export const FALLBACK_THRESHOLD: Omit<ProtocolThreshold, 'protocol' | 'builtin'> = {
  weakDbm: -95,
  replaceDbm: -105,
  staleMinutes: 120,
}

/** 内置通讯协议阈值：4G/5G、NB-IoT 对弱信号更敏感，北斗卫星与超短波允许更长离线窗口。 */
export const BUILTIN_THRESHOLDS: Omit<ProtocolThreshold, 'builtin'>[] = [
  { protocol: '4G', weakDbm: -95, replaceDbm: -110, staleMinutes: 30 },
  { protocol: '5G', weakDbm: -100, replaceDbm: -113, staleMinutes: 30 },
  { protocol: 'NB-IoT', weakDbm: -105, replaceDbm: -115, staleMinutes: 180 },
  { protocol: '北斗卫星', weakDbm: -100, replaceDbm: -110, staleMinutes: 240 },
  { protocol: '超短波', weakDbm: -90, replaceDbm: -105, staleMinutes: 120 },
]

/** 解析信号读数：接受 -95、-95dBm、60% 这类文本；非法/空值返回 null（按缺读数处理）。 */
export function parseSignal(raw: string): { dbm: number } | null {
  const text = raw.trim()
  if (!text) {
    return null
  }
  const dbmMatch = text.match(/^(-?\d+(?:\.\d+)?)\s*dBm$/i)
  if (dbmMatch) {
    return { dbm: Number(dbmMatch[1]) }
  }
  if (/^-?\d+(?:\.\d+)?$/.test(text)) {
    return { dbm: Number(text) }
  }
  const percentMatch = text.match(/^(\d+(?:\.\d+)?)\s*%$/)
  if (percentMatch) {
    const percent = Math.min(100, Math.max(0, Number(percentMatch[1])))
    // 百分比信号折算到常见 dBm 区间 -113（0%）～ -55（100%），仅用于阈值比较。
    return { dbm: Math.round(-113 + (percent / 100) * 58) }
  }
  return null
}

function parseTime(raw: string): number | null {
  const text = raw.trim()
  if (!text) {
    return null
  }
  const time = Date.parse(text)
  return Number.isNaN(time) ? null : time
}

export function resolveThreshold(
  protocol: string,
  thresholds: ProtocolThreshold[],
): ProtocolThreshold {
  const found = thresholds.find((item) => item.protocol === protocol)
  if (found) {
    return found
  }
  return { protocol, builtin: false, ...FALLBACK_THRESHOLD }
}

export function gradeDevice(
  device: CommDevice,
  thresholds: ProtocolThreshold[],
  now: number = Date.now(),
): GradeResult {
  const signal = parseSignal(device.signalRaw)
  const lastComm = parseTime(device.lastCommAt)
  const rule = resolveThreshold(device.protocol, thresholds)

  // 历史缺读数不参与自动判级：信号或最近通讯时刻读不出来，转人工补录，避免误判中断/更换。
  if (!signal || lastComm === null) {
    const missing: string[] = []
    if (!signal) {
      missing.push(`信号阈值读数缺失或不可解析（原值：${device.signalRaw || '空'}）`)
    }
    if (lastComm === null) {
      missing.push(`最近通讯时刻缺失或不可解析（原值：${device.lastCommAt || '空'}）`)
    }
    return {
      level: '缺读数待补',
      advice: '读数缺失，暂不自动判级：请人工补录信号强度与最近通讯时刻后重新判级。',
      reasons: missing,
    }
  }

  const silentMinutes = Math.max(0, Math.round((now - lastComm) / 60000))
  const reasons: string[] = []

  // 离线时长优先级最高：长时间无通讯优先判中断核查。
  if (silentMinutes > rule.staleMinutes) {
    reasons.push(
      `最近通讯距今 ${silentMinutes} 分钟，超过「${device.protocol}」协议离线阈值 ${rule.staleMinutes} 分钟`,
    )
    return {
      level: '建议中断核查',
      advice: '建议中断核查：核实链路是否中断、天线与供电是否正常，必要时下站排查并登记处置。',
      reasons,
    }
  }

  reasons.push(`最近通讯距今 ${silentMinutes} 分钟，未超过离线阈值 ${rule.staleMinutes} 分钟`)

  if (signal.dbm <= rule.replaceDbm) {
    reasons.push(`信号 ${signal.dbm}dBm 低于/等于更换阈值 ${rule.replaceDbm}dBm`)
    return {
      level: '建议更换',
      advice: '建议更换：信号长期低于更换阈值，通信模块疑似老化或损坏，建议更换设备。',
      reasons,
    }
  }

  if (signal.dbm <= rule.weakDbm) {
    reasons.push(`信号 ${signal.dbm}dBm 低于/等于弱信号阈值 ${rule.weakDbm}dBm`)
    return {
      level: '信号弱',
      advice: '信号偏弱：建议调整天线朝向、检查馈线接头，持续观察后再决定是否中断或更换。',
      reasons,
    }
  }

  reasons.push(`信号 ${signal.dbm}dBm 高于弱信号阈值 ${rule.weakDbm}dBm`)
  return {
    level: '通讯正常',
    advice: '通讯正常：信号与最近通讯时刻均在阈值内，维持现有巡检频次。',
    reasons,
  }
}

/** 需要同步生成通信核查事项的等级。 */
export const CHECK_ITEM_LEVELS: CommGradeLevel[] = ['建议中断核查', '建议更换']

export function needsCheckItem(level: CommGradeLevel): boolean {
  return CHECK_ITEM_LEVELS.includes(level)
}
