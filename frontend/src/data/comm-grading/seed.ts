import type { EntryRow } from '@/data/types'
import type { CommDevice, CommGradingState, MigrationSummary, ProtocolThreshold } from './types'
import { BUILTIN_THRESHOLDS } from './rules'

/**
 * 历史缺读数迁移策略（在此定案）：
 * 旧通讯清单（data/seed.ts 的 communication 模块）里的信号强度、最近通讯时刻多为占位文本，
 * 读不出真实数值。不做静默填零（填零会把所有旧设备误判成「建议更换」），也不丢弃历史台账，
 * 而是原样迁入判级台、标成「缺读数待补」，逐台补录信号与最近通讯时刻后重新自动判级；
 * 迁移结果在台面上留痕（迁出台账数、缺读数台数）。
 */

type DeviceSeed = Omit<CommDevice, 'id' | 'migratedFromLegacy'>

function isoMinutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60000).toISOString()
}

/** 判级台建档设备：信号与时刻给真实值，覆盖正常/弱信号/中断/更换/停用各场景。 */
const NATIVE_SEEDS: DeviceSeed[] = [
  {
    deviceCode: 'COMM-4G-01',
    station: '青山嘴水文站',
    protocol: '4G',
    deviceType: '4G 数传终端',
    signalRaw: '-72dBm',
    lastCommAt: isoMinutesAgo(3),
    maintainer: '李航',
    status: '在用',
    note: '中心站机房',
  },
  {
    deviceCode: 'COMM-4G-02',
    station: '白沙河水位站',
    protocol: '4G',
    deviceType: '4G 数传终端',
    signalRaw: '-98dBm',
    lastCommAt: isoMinutesAgo(12),
    maintainer: '李航',
    status: '在用',
    note: '山坳站点，信号长期偏弱',
  },
  {
    deviceCode: 'COMM-4G-03',
    station: '大岭雨量站',
    protocol: '4G',
    deviceType: '4G 数传终端',
    signalRaw: '-112dBm',
    lastCommAt: isoMinutesAgo(20),
    maintainer: '王牧',
    status: '在用',
    note: '疑似射频模块老化',
  },
  {
    deviceCode: 'COMM-4G-04',
    station: '柳树湾水文站',
    protocol: '4G',
    deviceType: '4G 数传终端',
    signalRaw: '-80dBm',
    lastCommAt: isoMinutesAgo(96),
    maintainer: '王牧',
    status: '在用',
    note: '供电改造后未恢复上报',
  },
  {
    deviceCode: 'COMM-NB-01',
    station: '北塬地下水井',
    protocol: 'NB-IoT',
    deviceType: 'NB-IoT 低功耗终端',
    signalRaw: '-88dBm',
    lastCommAt: isoMinutesAgo(65),
    maintainer: '陈芸',
    status: '在用',
    note: '每两小时一包',
  },
  {
    deviceCode: 'COMM-NB-02',
    station: '沙坡头水位站',
    protocol: 'NB-IoT',
    deviceType: 'NB-IoT 低功耗终端',
    signalRaw: '-118dBm',
    lastCommAt: isoMinutesAgo(150),
    maintainer: '陈芸',
    status: '在用',
    note: '地下井遮挡严重',
  },
  {
    deviceCode: 'COMM-BD-01',
    station: '河源无人站',
    protocol: '北斗卫星',
    deviceType: '北斗短报文终端',
    signalRaw: '-91dBm',
    lastCommAt: isoMinutesAgo(120),
    maintainer: '赵岭',
    status: '在用',
    note: '公网盲区，走卫星链路',
  },
  {
    deviceCode: 'COMM-VHF-01',
    station: '老渡口水文站',
    protocol: '超短波',
    deviceType: '超短波电台',
    signalRaw: '-107dBm',
    lastCommAt: isoMinutesAgo(40),
    maintainer: '赵岭',
    status: '在用',
    note: '天线锈蚀，计划检修',
  },
  {
    deviceCode: 'COMM-5G-01',
    station: '城东缆道站',
    protocol: '5G',
    deviceType: '5G 工业网关',
    signalRaw: '-69dBm',
    lastCommAt: isoMinutesAgo(2),
    maintainer: '李航',
    status: '停用',
    note: '汛期后撤点停用，设备留库',
  },
]

function migrateLegacyRows(rows: EntryRow[]): { devices: CommDevice[]; missing: number } {
  const devices: CommDevice[] = []
  let missing = 0
  for (const row of rows) {
    const signalRaw = String(row['信号强度'] ?? '').trim()
    const lastCommAt = String(row['最近通讯时刻'] ?? '').trim()
    // 占位文本（如「通讯系统样例1」）不是合法读数，按缺读数迁移；合法时刻保留。
    const signalMissing = !/^-?\d+(\.\d+)?(\s*dBm)?$/i.test(signalRaw) && !/^\d+(\.\d+)?%$/.test(signalRaw)
    const timeMissing = Number.isNaN(Date.parse(lastCommAt))
    if (signalMissing || timeMissing) {
      missing += 1
    }
    devices.push({
      id: Number(row.id),
      deviceCode: String(row['设备编号'] ?? `COMM-LEGACY-${row.id}`),
      station: String(row['所属站点'] ?? ''),
      protocol: String(row['通讯协议'] ?? ''),
      deviceType: String(row['设备类型'] ?? ''),
      signalRaw: signalMissing ? '' : signalRaw,
      lastCommAt: timeMissing ? '' : new Date(lastCommAt).toISOString(),
      maintainer: String(row['维护人员'] ?? ''),
      status: '在用',
      migratedFromLegacy: true,
      note:
        signalMissing || timeMissing
          ? `由旧通讯清单迁移：${[signalMissing ? '信号强度' : '', timeMissing ? '最近通讯时刻' : '']
              .filter(Boolean)
              .join('、')}缺读数，待人工补录`
          : '由旧通讯清单迁移：读数完整，已纳入自动判级',
    })
  }
  return { devices, missing }
}

/** 首次进入判级台时构造初始状态：内置阈值 + 新台账设备 + 旧清单缺读数迁移。 */
export function buildInitialState(legacyRows: EntryRow[] = []): {
  state: CommGradingState
  migration: MigrationSummary
} {
  const thresholds: ProtocolThreshold[] = BUILTIN_THRESHOLDS.map((item) => ({
    ...item,
    builtin: true,
  }))

  const nativeDevices: CommDevice[] = NATIVE_SEEDS.map((seed, index) => ({
    id: index + 1,
    deviceCode: seed.deviceCode,
    station: seed.station,
    protocol: seed.protocol,
    deviceType: seed.deviceType,
    signalRaw: seed.signalRaw,
    lastCommAt: seed.lastCommAt,
    maintainer: seed.maintainer,
    status: seed.status,
    migratedFromLegacy: false,
    note: seed.note,
  }))

  const legacy = migrateLegacyRows(legacyRows)
  const legacyDevices = legacy.devices.map((device) => ({
    ...device,
    id: device.id + nativeDevices.length,
  }))

  const migration: MigrationSummary = {
    migratedAt: new Date().toISOString(),
    legacyTotal: legacyRows.length,
    imported: legacy.devices.length,
    missingReadings: legacy.missing,
    note:
      legacy.missing > 0
        ? `旧通讯清单迁入 ${legacy.devices.length} 台，其中 ${legacy.missing} 台信号强度或最近通讯时刻为占位文本，按缺读数原样保留，待人工补录后重新判级（未做填零处理）。`
        : `旧通讯清单迁入 ${legacy.devices.length} 台，读数均完整。`,
  }

  const state: CommGradingState = {
    version: 1,
    devices: [...nativeDevices, ...legacyDevices],
    thresholds,
    conclusions: [],
    checkItems: [],
    locks: [],
    nextId: nativeDevices.length + legacyDevices.length + 1,
    roundId: 1,
    migration,
  }
  return { state, migration }
}
