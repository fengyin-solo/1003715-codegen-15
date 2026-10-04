import { listRows } from '@/data/local-store'
import { buildInitialState } from './seed'
import type { CommGradingState } from './types'

// 判级台与通用清单分键存放：规则、结论、核查事项、并发上报锁都在这里，刷新/重开浏览器后仍在。
const STORAGE_KEY = 'hydrology-monitor-station:comm-grading'
const STATE_VERSION = 1

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

let cache: CommGradingState | null = null

function createState(): CommGradingState {
  // 迁移源取当前 localStorage 里的旧通讯清单（用户在旧页面的流转结果一并迁过来）。
  const legacyRows = listRows('communication')
  const { state } = buildInitialState(legacyRows)
  persist(state)
  return state
}

function persist(state: CommGradingState): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }
}

export function gradingState(): CommGradingState {
  if (cache) {
    return cache
  }
  if (typeof window === 'undefined' || !window.localStorage) {
    return createState()
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    cache = createState()
    return cache
  }
  try {
    const parsed = JSON.parse(raw) as CommGradingState
    if (parsed.version !== STATE_VERSION) {
      cache = createState()
      return cache
    }
    cache = parsed
    return cache
  } catch {
    cache = createState()
    return cache
  }
}

export function saveGradingState(state: CommGradingState = gradingState()): void {
  cache = state
  persist(state)
}

export function resetGradingState(): CommGradingState {
  const fresh = createState()
  cache = fresh
  return fresh
}

export function cloneState(): CommGradingState {
  return clone(gradingState())
}

export function gradingStorageKey(): string {
  return STORAGE_KEY
}
