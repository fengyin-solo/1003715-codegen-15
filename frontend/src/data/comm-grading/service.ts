import { useSessionStore } from '@/stores/session'
import { cloneState, gradingState, resetGradingState, saveGradingState } from './store'
import { gradeDevice, needsCheckItem, resolveThreshold } from './rules'
import type {
  AutoReportResult,
  CommCheckItem,
  CommDevice,
  CommGradeLevel,
  CommGradingState,
  ConcurrentReportOutcome,
  GradeConclusion,
  GradeResult,
  ProtocolThreshold,
} from './types'

/**
 * 通讯设备故障判级规则台服务：所有业务规则都在这里，页面组件只做渲染。
 * 关键约束：
 * 1) 自动结果与人工判断冲突时，以人工为准，自动结论仅留痕不生效；
 * 2) 停用设备不允许保存任何新结论（自动、人工都拦截）；
 * 3) 建议中断核查 / 建议更换 的生效结论同步生成巡检链路通信核查事项；
 * 4) 同一设备同一判级轮次重复并发上报，只接受一个结论（上报锁持久化，刷新仍拦截）。
 */

const LOCK_TTL_MS = 10 * 60 * 1000

function operatorName(): string {
  try {
    return useSessionStore().operator
  } catch {
    return '值班管理员'
  }
}

function nextId(state: CommGradingState): number {
  const id = state.nextId
  state.nextId += 1
  return id
}

function findDevice(state: CommGradingState, deviceId: number): CommDevice | undefined {
  return state.devices.find((device) => device.id === deviceId)
}

function pruneLocks(state: CommGradingState, now: number): void {
  state.locks = state.locks.filter((lock) => Date.parse(lock.expiresAt) > now)
}

function snapshotOf(device: CommDevice): string {
  return [device.deviceCode, device.protocol, device.signalRaw, device.lastCommAt, device.status].join('|')
}

function latestManualConclusion(state: CommGradingState, deviceId: number): GradeConclusion | undefined {
  for (let i = state.conclusions.length - 1; i >= 0; i -= 1) {
    const item = state.conclusions[i]
    if (item.deviceId === deviceId && item.source === 'manual') {
      return item
    }
  }
  return undefined
}

function effectiveConclusion(state: CommGradingState, deviceId: number): GradeConclusion | undefined {
  for (let i = state.conclusions.length - 1; i >= 0; i -= 1) {
    const item = state.conclusions[i]
    if (item.deviceId === deviceId && item.effective) {
      return item
    }
  }
  return undefined
}

function activeLock(state: CommGradingState, deviceId: number, now: number) {
  pruneLocks(state, now)
  return state.locks.find((lock) => lock.deviceId === deviceId)
}

function pushConclusion(
  state: CommGradingState,
  data: Omit<GradeConclusion, 'id' | 'createdAt'>,
): GradeConclusion {
  const conclusion: GradeConclusion = {
    ...data,
    id: nextId(state),
    createdAt: new Date().toISOString(),
  }
  state.conclusions.push(conclusion)
  return conclusion
}

/** 生效结论同步到巡检链路：同设备同等级只保留一个待核查事项，等级变化先关旧项再开新项。 */
function syncCheckItem(
  state: CommGradingState,
  device: CommDevice,
  level: CommGradeLevel,
  conclusion: GradeConclusion,
  advice: string,
): void {
  const openItems = state.checkItems.filter(
    (item) => item.deviceId === device.id && item.status === '待核查',
  )
  const sameLevel = openItems.find((item) => item.level === level)
  if (sameLevel) {
    // 同一设备重复结论不重复生成核查事项，只补充来源说明。
    sameLevel.detail = `${sameLevel.detail}；${conclusion.source === 'manual' ? '人工' : '自动'}结论再次确认（结论#${conclusion.id}）`
    sameLevel.conclusionId = conclusion.id
    return
  }
  for (const item of openItems) {
    item.status = '已核查'
    item.closedAt = new Date().toISOString()
    item.detail = `${item.detail}；等级变更为「${level}」，旧事项关闭（结论#${conclusion.id}）`
  }
  const item: CommCheckItem = {
    id: nextId(state),
    deviceId: device.id,
    deviceCode: device.deviceCode,
    station: device.station,
    level,
    title: `通信核查：${device.deviceCode}（${device.station}）${level}`,
    detail: `${advice}；来源：${conclusion.source === 'manual' ? '人工判断' : '自动判级'}（结论#${conclusion.id}）`,
    source: conclusion.source,
    status: '待核查',
    createdAt: new Date().toISOString(),
    closedAt: '',
    conclusionId: conclusion.id,
  }
  state.checkItems.push(item)
}

/** 人工判为非中断/更换时，关闭该设备所有待核查事项。 */
function closeOpenItemsByManual(
  state: CommGradingState,
  device: CommDevice,
  level: CommGradeLevel,
  conclusionId: number,
): void {
  for (const item of state.checkItems) {
    if (item.deviceId === device.id && item.status === '待核查') {
      item.status = '已核查'
      item.closedAt = new Date().toISOString()
      item.detail = `${item.detail}；人工判定为「${level}」，无需中断/更换核查，人工关闭（结论#${conclusionId}）`
    }
  }
}

export type DeviceView = CommDevice & {
  grade: GradeResult
  manual: GradeConclusion | undefined
  effective: GradeConclusion | undefined
  locked: boolean
}

export function listDevices(filters: { keyword?: string; status?: string } = {}): DeviceView[] {
  const state = gradingState()
  const now = Date.now()
  pruneLocks(state, now)
  const keyword = filters.keyword?.trim() ?? ''
  return state.devices
    .filter((device) => {
      if (filters.status && device.status !== filters.status) {
        return false
      }
      if (!keyword) {
        return true
      }
      return [device.deviceCode, device.station, device.protocol, device.deviceType]
        .join(' ')
        .includes(keyword)
    })
    .map((device) => {
      const lock = state.locks.find((item) => item.deviceId === device.id)
      return {
        ...device,
        grade: gradeDevice(device, state.thresholds, now),
        manual: latestManualConclusion(state, device.id),
        effective: effectiveConclusion(state, device.id),
        locked: Boolean(lock),
      }
    })
}

/** 自动判级上报：同一设备重复并发上报只接受一个结论。 */
export function submitAutoReport(deviceId: number): AutoReportResult {
  const state = cloneState()
  const device = findDevice(state, deviceId)
  if (!device) {
    return { accepted: false, message: '没有找到该通讯设备', deviceCode: '-', level: null, overriddenByManual: false }
  }
  if (device.status === '停用') {
    return {
      accepted: false,
      message: `${device.deviceCode} 已停用，停用设备不允许保存新结论`,
      deviceCode: device.deviceCode,
      level: null,
      overriddenByManual: false,
    }
  }

  const now = Date.now()
  const lock = activeLock(state, deviceId, now)
  if (lock) {
    return {
      accepted: false,
      message:
        lock.snapshot === snapshotOf(device)
          ? `${device.deviceCode} 本判级轮次已有结论生效（结论#${lock.conclusionId}），重复并发上报已丢弃`
          : `${device.deviceCode} 本判级轮次已有上报在处理（结论#${lock.conclusionId}），并发上报只接受一个结论`,
      deviceCode: device.deviceCode,
      level: null,
      overriddenByManual: false,
    }
  }

  const result = gradeDevice(device, state.thresholds, now)
  const manual = latestManualConclusion(state, deviceId)

  // 自动结果与人工判断冲突时以人工为准：自动结论留痕但不生效，也不再生成核查事项。
  if (manual) {
    if (manual.level === result.level) {
      return {
        accepted: false,
        message: `自动判级为「${result.level}」，与人工判断一致，沿用人工结论（结论#${manual.id}），不重复保存`,
        deviceCode: device.deviceCode,
        level: result.level,
        overriddenByManual: false,
      }
    }
    pushConclusion(state, {
      deviceId: device.id,
      deviceCode: device.deviceCode,
      level: result.level,
      source: 'auto',
      advice: result.advice,
      reasons: result.reasons.join('；'),
      operator: '判级规则台',
      roundId: state.roundId,
      effective: false,
    })
    saveGradingState(state)
    return {
      accepted: false,
      message: `自动判级为「${result.level}」，与人工判断「${manual.level}」冲突，以人工为准：自动结论仅留痕不生效`,
      deviceCode: device.deviceCode,
      level: result.level,
      overriddenByManual: true,
    }
  }

  const conclusion = pushConclusion(state, {
    deviceId: device.id,
    deviceCode: device.deviceCode,
    level: result.level,
    source: 'auto',
    advice: result.advice,
    reasons: result.reasons.join('；'),
    operator: '判级规则台',
    roundId: state.roundId,
    effective: true,
  })
  state.locks.push({
    deviceId: device.id,
    roundId: state.roundId,
    conclusionId: conclusion.id,
    snapshot: snapshotOf(device),
    expiresAt: new Date(now + LOCK_TTL_MS).toISOString(),
  })
  if (needsCheckItem(result.level)) {
    syncCheckItem(state, device, result.level, conclusion, result.advice)
  }
  saveGradingState(state)
  return {
    accepted: true,
    message: `自动判级完成：${device.deviceCode} → ${result.level}${needsCheckItem(result.level) ? '，已同步生成巡检链路通信核查事项' : ''}`,
    deviceCode: device.deviceCode,
    level: result.level,
    overriddenByManual: false,
  }
}

/** 并发上报压测：同一设备连续重复上报，验证只有第一个结论被接受。 */
export function simulateConcurrentReports(deviceId: number, times: number): ConcurrentReportOutcome[] {
  const outcomes: ConcurrentReportOutcome[] = []
  for (let i = 0; i < times; i += 1) {
    const result = submitAutoReport(deviceId)
    outcomes.push({ ...result, duplicate: i > 0 || !result.accepted })
  }
  return outcomes
}

/** 一键对全部在用设备跑一轮自动判级。 */
export function reportAllDevices(): AutoReportResult[] {
  const state = gradingState()
  return state.devices
    .filter((device) => device.status === '在用')
    .map((device) => submitAutoReport(device.id))
}

export type ManualJudgmentInput = {
  deviceId: number
  level: CommGradeLevel
  advice: string
}

/** 人工判断：冲突时以人工为准，并覆盖此前生效的自动结论。 */
export function saveManualJudgment(input: ManualJudgmentInput): AutoReportResult {
  const state = cloneState()
  const device = findDevice(state, input.deviceId)
  if (!device) {
    return { accepted: false, message: '没有找到该通讯设备', deviceCode: '-', level: null, overriddenByManual: false }
  }
  if (device.status === '停用') {
    return {
      accepted: false,
      message: `${device.deviceCode} 已停用，停用设备不允许保存新结论`,
      deviceCode: device.deviceCode,
      level: null,
      overriddenByManual: false,
    }
  }

  const auto = gradeDevice(device, state.thresholds)
  const conflict = auto.level !== input.level
  const previousEffective = effectiveConclusion(state, input.deviceId)

  // 人工结论生效后，此前生效结论（通常是自动结论）转为不生效。
  for (const conclusion of state.conclusions) {
    if (conclusion.deviceId === input.deviceId && conclusion.effective) {
      conclusion.effective = false
    }
  }
  const conclusion = pushConclusion(state, {
    deviceId: device.id,
    deviceCode: device.deviceCode,
    level: input.level,
    source: 'manual',
    advice: input.advice,
    reasons: `自动判级参考：${auto.level}（${auto.reasons.join('；')}）`,
    operator: operatorName(),
    roundId: state.roundId,
    effective: true,
  })
  // 人工操作不受并发上报锁限制，同时清掉该设备在途自动上报锁。
  state.locks = state.locks.filter((lock) => lock.deviceId !== device.id)

  if (needsCheckItem(input.level)) {
    syncCheckItem(state, device, input.level, conclusion, input.advice)
  } else {
    closeOpenItemsByManual(state, device, input.level, conclusion.id)
  }
  saveGradingState(state)

  const base = `人工结论已保存：${device.deviceCode} → ${input.level}`
  let suffix = ''
  if (conflict) {
    suffix = `；与自动判级「${auto.level}」冲突，以人工为准`
    if (previousEffective && previousEffective.source === 'auto') {
      suffix += `，自动结论（#${previousEffective.id}）已转为不生效`
    }
  }
  if (!needsCheckItem(input.level)) {
    suffix += '；该设备待核查通信事项已按人工判断关闭'
  } else {
    suffix += '；已同步生成/更新巡检链路通信核查事项'
  }
  return { accepted: true, message: base + suffix, deviceCode: device.deviceCode, level: input.level, overriddenByManual: false }
}

/** 历史缺读数补录：补录信号与最近通讯时刻后自动重新判级（绕开本设备旧上报锁）。 */
export function supplementReading(input: {
  deviceId: number
  signalRaw: string
  lastCommAt: string
  note?: string
}): AutoReportResult {
  const state = cloneState()
  const device = findStateDevice(state, input.deviceId)
  if (!device) {
    return { accepted: false, message: '没有找到该通讯设备', deviceCode: '-', level: null, overriddenByManual: false }
  }
  device.signalRaw = input.signalRaw.trim()
  device.lastCommAt = input.lastCommAt ? new Date(input.lastCommAt).toISOString() : ''
  if (input.note !== undefined) {
    device.note = input.note
  }
  // migratedFromLegacy 迁移标记保留，台账可追溯。
  // 补录视为该设备新一轮上报：清掉旧锁后走标准自动判级流程。
  state.locks = state.locks.filter((lock) => lock.deviceId !== device.id)
  saveGradingState(state)
  return submitAutoReport(device.id)
}

function findStateDevice(state: CommGradingState, deviceId: number): CommDevice | undefined {
  return state.devices.find((item) => item.id === deviceId)
}

/** 停用 / 启用切换。停用会丢弃在途上报锁，但保留历史结论。 */
export function setDeviceStatus(deviceId: number, status: CommDevice['status']): string {
  const state = cloneState()
  const device = findStateDevice(state, deviceId)
  if (!device) {
    return '没有找到该通讯设备'
  }
  device.status = status
  if (status === '停用') {
    state.locks = state.locks.filter((lock) => lock.deviceId !== deviceId)
  }
  saveGradingState(state)
  return status === '停用'
    ? `${device.deviceCode} 已停用：在途上报锁已清除，停用期间不能保存新结论，历史结论保留`
    : `${device.deviceCode} 已启用，可以重新判级上报`
}

/** 开启新一轮判级：批次号前进，清空全部设备上报锁（历史结论保留）。 */
export function startNewRound(): number {
  const state = cloneState()
  state.roundId += 1
  state.locks = []
  saveGradingState(state)
  return state.roundId
}

export function currentRound(): number {
  return gradingState().roundId
}

export function listConclusions(deviceId?: number): GradeConclusion[] {
  const state = gradingState()
  const rows = deviceId
    ? state.conclusions.filter((item) => item.deviceId === deviceId)
    : state.conclusions
  return [...rows].sort((a, b) => b.id - a.id)
}

export function listCheckItems(status?: string): CommCheckItem[] {
  const state = gradingState()
  const rows = status ? state.checkItems.filter((item) => item.status === status) : state.checkItems
  return [...rows].sort((a, b) => b.id - a.id)
}

/** 巡检链路处置通信核查事项。 */
export function closeCheckItem(itemId: number): string {
  const state = cloneState()
  const item = state.checkItems.find((row) => row.id === itemId)
  if (!item) {
    return '没有找到该通信核查事项'
  }
  if (item.status === '已核查') {
    return `核查事项 #${itemId} 已关闭，不用重复处置`
  }
  item.status = '已核查'
  item.closedAt = new Date().toISOString()
  item.detail = `${item.detail}；巡检链路已现场核查并关闭（${operatorName()}）`
  saveGradingState(state)
  return `通信核查事项 #${itemId}（${item.deviceCode}）已在巡检链路登记处置`
}

export function listThresholds(): ProtocolThreshold[] {
  // 返回副本：台面上的编辑只有点「保存阈值」后才落库，避免直接改 live 缓存。
  return gradingState().thresholds.map((item) => ({ ...item }))
}

export function updateThreshold(input: {
  protocol: string
  weakDbm: number
  replaceDbm: number
  staleMinutes: number
}): string {
  const state = cloneState()
  const rule = state.thresholds.find((item) => item.protocol === input.protocol)
  if (input.weakDbm <= input.replaceDbm) {
    return '阈值不合法：弱信号阈值应高于（大于）更换阈值，例如 -95 高于 -110'
  }
  if (input.staleMinutes <= 0) {
    return '离线时长阈值必须为正整数分钟'
  }
  if (rule) {
    rule.weakDbm = input.weakDbm
    rule.replaceDbm = input.replaceDbm
    rule.staleMinutes = input.staleMinutes
  } else {
    state.thresholds.push({ ...input, builtin: false })
  }
  saveGradingState(state)
  return `「${input.protocol}」协议阈值已更新：弱信号 ≤${input.weakDbm}dBm，更换 ≤${input.replaceDbm}dBm，中断 >${input.staleMinutes} 分钟`
}

export function migrationSummary() {
  return gradingState().migration
}

export function gradingStats() {
  const devices = listDevices()
  const effectiveLevels = new Map<number, GradeConclusion | undefined>()
  for (const device of devices) {
    effectiveLevels.set(device.id, device.effective)
  }
  return {
    total: devices.length,
    active: devices.filter((d) => d.status === '在用').length,
    disabled: devices.filter((d) => d.status === '停用').length,
    missing: devices.filter((d) => d.grade.level === '缺读数待补').length,
    interrupt: devices.filter((d) => d.effective?.level === '建议中断核查').length,
    replace: devices.filter((d) => d.effective?.level === '建议更换').length,
    openChecks: listCheckItems('待核查').length,
    locked: devices.filter((d) => d.locked).length,
    round: currentRound(),
  }
}

export function resetConsole(): void {
  resetGradingState()
}

export function formatDateTime(iso: string): string {
  if (!iso) {
    return '—'
  }
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return iso
  }
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function minutesSince(iso: string): number | null {
  if (!iso) {
    return null
  }
  const time = Date.parse(iso)
  if (Number.isNaN(time)) {
    return null
  }
  return Math.max(0, Math.round((Date.now() - time) / 60000))
}
