import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'hydrology-monitor-station:entries'
// 数据结构版本：老用户的占位/缺读数据按版本做一次性迁移。
const SCHEMA_KEY = 'hydrology-monitor-station:schema-version'
const SCHEMA_VERSION = 2

// 判级规则台 v2 起使用的字段；v1 播种的是「通讯系统样例N」占位串，读不出真实信号。
const COMMUNICATION_READABLE_FIELDS = ['设备类型', '所属站点', '通讯协议', '维护人员', '设备状态']
const LEGACY_PLACEHOLDER = /^通讯系统样例\d+$/

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 历史缺读迁移（v1 → v2）：
// 设备身份字段（类型/站点/协议/维护人员）用新种子补齐；信号强度、最近通讯时刻这类「读数」
// 不凭空编造，保留为空并备注「历史缺读，待人工补录」，规则台只提示人工核查、不自动下中断结论。
function migrateCommunication(legacy: EntryRow[], fallback: EntryRow[]): EntryRow[] {
  const fallbackById = new Map(fallback.map((item) => [item.id, item]))
  const merged = legacy.map((item) => {
    const base = fallbackById.get(item.id)
    if (!base) {
      return item
    }
    const next: EntryRow = { ...item }
    for (const field of COMMUNICATION_READABLE_FIELDS) {
      if (LEGACY_PLACEHOLDER.test(String(next[field] ?? ''))) {
        next[field] = base[field]
      }
    }
    const signal = next['信号强度']
    const seenAt = next['最近通讯时刻']
    const missingSignal = typeof signal !== 'number' || Number.isNaN(Number(signal))
    const missingSeenAt = !seenAt || LEGACY_PLACEHOLDER.test(String(seenAt)) || Number.isNaN(Date.parse(String(seenAt)))
    if (missingSignal) {
      next['信号强度'] = ''
    }
    if (missingSeenAt) {
      next['最近通讯时刻'] = ''
    }
    if (missingSignal || missingSeenAt) {
      next['读数备注'] = '历史缺读，待人工补录'
    }
    return next
  })
  // 老数据里没有的新增样例设备（停用、缺读演示等）直接补入
  for (const item of fallback) {
    if (!merged.some((row) => row.id === item.id)) {
      merged.push(clone(item))
    }
  }
  return merged
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    window.localStorage.setItem(SCHEMA_KEY, String(SCHEMA_VERSION))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    const schema = Number(window.localStorage.getItem(SCHEMA_KEY) ?? '1')
    const merged: Record<string, EntryRow[]> = { ...fallback, ...parsed }
    if (schema < SCHEMA_VERSION && Array.isArray(parsed.communication)) {
      merged.communication = migrateCommunication(parsed.communication, fallback.communication)
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
    window.localStorage.setItem(SCHEMA_KEY, String(SCHEMA_VERSION))
    return merged
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    window.localStorage.setItem(SCHEMA_KEY, String(SCHEMA_VERSION))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
