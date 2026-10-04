import { listRows, saveRows } from './local-store'
import type { EntryRow, FaultLevel, GradeConclusion, GradeRule } from './types'

// 判级规则台的独立持久化：规则配置与历史结论不与通用业务条目混放。
const GRADE_STORAGE_KEY = 'hydrology-monitor-station:communication-grade'

export const COMMUNICATION_DEVICE_KEY = 'communication'
export const INSPECTION_KEY = 'inspection'

export const DEVICE_RETIRED_STATUS = '已停用'

export const DEFAULT_RULES: GradeRule[] = [
  { 通讯协议: '4G', 弱信号阈值: -95, 中断信号阈值: -105, 断联超时小时: 12, 中断累计更换次数: 3, 更新时间: '2026-09-01 09:00' },
  { 通讯协议: '5G', 弱信号阈值: -100, 中断信号阈值: -110, 断联超时小时: 6, 中断累计更换次数: 3, 更新时间: '2026-09-01 09:00' },
  { 通讯协议: '北斗', 弱信号阈值: -105, 中断信号阈值: -115, 断联超时小时: 24, 中断累计更换次数: 2, 更新时间: '2026-09-01 09:00' },
  { 通讯协议: '超短波', 弱信号阈值: -95, 中断信号阈值: -108, 断联超时小时: 24, 中断累计更换次数: 2, 更新时间: '2026-09-01 09:00' },
]

// COMM-0004 的两次历史中断：累计达到超短波协议的更换门槛，再次判级即给更换建议。
function seedConclusions(): GradeConclusion[] {
  const rule = DEFAULT_RULES.find((item) => item.通讯协议 === '超短波')!
  const mk = (id: number, time: string, signal: number): GradeConclusion => ({
    id,
    设备编号: 'COMM-0004',
    所属站点: '峡口水位站',
    通讯协议: '超短波',
    信号强度: signal,
    最近通讯时刻: time,
    级别: '建议中断核查',
    建议: '信号低于中断阈值且已超断联超时，建议立即中断核查链路',
    来源: '自动',
    自动级别: '建议中断核查',
    冲突: false,
    规则快照: { ...rule },
    上报批次: 'SEED',
    判定时间: time,
    判定人: '系统',
  })
  return [
    mk(1, '2026-09-12T06:20:00Z', -110),
    mk(2, '2026-09-28T11:40:00Z', -111),
  ]
}

export type GradeState = {
  rules: GradeRule[]
  conclusions: GradeConclusion[]
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function fallbackState(): GradeState {
  return { rules: clone(DEFAULT_RULES), conclusions: seedConclusions() }
}

let stateCache: GradeState | null = null

function readState(): GradeState {
  if (stateCache) {
    return stateCache
  }
  const fallback = fallbackState()
  if (typeof window === 'undefined' || !window.localStorage) {
    stateCache = fallback
    return fallback
  }
  const raw = window.localStorage.getItem(GRADE_STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(GRADE_STORAGE_KEY, JSON.stringify(fallback))
    stateCache = fallback
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Partial<GradeState>
    stateCache = {
      rules: Array.isArray(parsed.rules) && parsed.rules.length ? (parsed.rules as GradeRule[]) : fallback.rules,
      conclusions: Array.isArray(parsed.conclusions) ? (parsed.conclusions as GradeConclusion[]) : fallback.conclusions,
    }
    return stateCache
  } catch {
    stateCache = fallback
    return fallback
  }
}

function persist() {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(GRADE_STORAGE_KEY, JSON.stringify(stateCache))
  }
}

// ===== 规则配置 =====

export function listRules(): GradeRule[] {
  return readState().rules.map((item) => ({ ...item }))
}

export function saveRule(rule: GradeRule): void {
  const state = readState()
  const index = state.rules.findIndex((item) => item.通讯协议 === rule.通讯协议)
  const next: GradeRule = { ...rule, 更新时间: new Date().toLocaleString('sv-SE') }
  if (index >= 0) {
    state.rules[index] = next
  } else {
    state.rules.push(next)
  }
  persist()
}

// ===== 结论查询 =====

export function listConclusions(): GradeConclusion[] {
  return readState().conclusions
    .slice()
    .sort((a, b) => (a.判定时间 < b.判定时间 ? 1 : -1))
    .map((item) => ({ ...item }))
}

/** 该设备历史上落定为中断建议的次数（更换门槛依据） */
export function countInterruptionHistory(设备编号: string): number {
  return readState().conclusions.filter(
    (item) => item.设备编号 === 设备编号 && item.级别 === '建议中断核查',
  ).length
}

/** 同一上报批次里同一设备是否已有结论：并发重复上报只接受一个结论 */
export function existsConclusionInBatch(设备编号: string, batch: string): GradeConclusion | undefined {
  return readState().conclusions.find((item) => item.设备编号 === 设备编号 && item.上报批次 === batch)
}

export function saveConclusion(conclusion: GradeConclusion): number {
  const state = readState()
  const id = conclusion.id || state.conclusions.reduce((max, item) => Math.max(max, item.id), 0) + 1
  state.conclusions.push({ ...conclusion, id })
  persist()
  return id
}

// ===== 通讯设备 / 巡检链路读写（与规则台共用 entries 存储） =====

export function listCommunicationDevices(): EntryRow[] {
  return listRows(COMMUNICATION_DEVICE_KEY)
}

export function findDevice(设备编号: string): EntryRow | undefined {
  return listCommunicationDevices().find((row) => String(row['设备编号']) === 设备编号)
}

export function isRetired(device: EntryRow): boolean {
  return String(device.status) === DEVICE_RETIRED_STATUS
}

/** 判级落定时回写通讯设备状态；结论被人工恢复正常时同步恢复 */
export function applyDeviceStatus(设备编号: string, status: string, abnormal: boolean): void {
  const rows = listRows(COMMUNICATION_DEVICE_KEY)
  const next = rows.map((row) =>
    String(row['设备编号']) === 设备编号
      ? { ...row, status, pending: status !== DEVICE_RETIRED_STATUS, abnormal }
      : row,
  )
  saveRows(COMMUNICATION_DEVICE_KEY, next)
}

/**
 * 其他巡检链路同步生成通信核查事项：中断/更换结论落地时，向巡检记录模块追加一条
 * 「通信核查」事项；同一设备已有待办核查事项时不重复生成。恢复正常时关闭待办事项。
 */
export function syncInspectionCheck(
  device: EntryRow,
  level: FaultLevel,
  conclusionId: number,
): { created: boolean; closed: number; recordId: string } {
  const rows = listRows(INSPECTION_KEY)
  const site = String(device['所属站点'] ?? '')
  const code = String(device['设备编号'] ?? '')
  const keyword = `通信核查-${code}`
  const openItem = rows.find(
    (row) =>
      String(row['检查项目'] ?? '') === keyword &&
      !['已处置'].includes(String(row.status)),
  )

  if (level === '通讯正常') {
    let closed = 0
    const next = rows.map((row) => {
      if (String(row['检查项目'] ?? '') === keyword && String(row.status) !== '已处置') {
        closed += 1
        return { ...row, status: '已处置', pending: false, abnormal: false }
      }
      return row
    })
    saveRows(INSPECTION_KEY, next)
    return { created: false, closed, recordId: keyword }
  }

  if (level !== '建议中断核查' && level !== '建议更换') {
    return { created: false, closed: 0, recordId: keyword }
  }
  if (openItem) {
    return { created: false, closed: 0, recordId: String(openItem['记录编号'] ?? keyword) }
  }

  const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const seq = String(nextId).padStart(4, '0')
  const item: EntryRow = {
    id: nextId,
    status: '发现故障',
    pending: true,
    abnormal: true,
    记录编号: `INSP-C${seq}`,
    站点编号: site,
    巡检日期: new Date().toISOString().slice(0, 10),
    巡检人员: String(device['维护人员'] ?? '通信值班'),
    检查项目: keyword,
    发现问题: `设备 ${code} 故障判级为「${level}」（结论 #${conclusionId}），需现场核查通信链路`,
    处理措施: level === '建议更换' ? '安排备机更换' : '现场排查天线、供电与SIM/信道',
    巡检状态: '待核查',
  }
  saveRows(INSPECTION_KEY, [...rows, item])
  return { created: true, closed: 0, recordId: String(item.记录编号) }
}
