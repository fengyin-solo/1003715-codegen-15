<template>
  <section class="page grading-page" data-module="comm-grading">
    <header class="page-head">
      <div>
        <h2>通讯设备故障判级规则台</h2>
        <p class="page-desc">
          按设备编号、所属站点、通讯协议、信号阈值和最近通讯时刻给出中断或更换建议；自动结果与人工判断冲突时以人工为准，停用设备不保存新结论，中断/更换结论同步巡检链路。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="reportAll">一键自动判级</button>
        <button class="btn" type="button" @click="newRound">开启新一轮（第 {{ stats.round + 1 }} 轮）</button>
        <button class="btn ghost danger" type="button" @click="resetAll">重置判级台</button>
      </div>
    </header>

    <div v-if="migration" class="migration-banner">
      <strong>历史缺读数迁移说明</strong>
      <span>{{ migration.note }}</span>
      <span class="migration-meta">
        迁移时间 {{ formatDateTime(migration.migratedAt) }} · 策略：缺读数原样保留不填零，标「缺读数待补」逐台补录后重新判级
      </span>
    </div>

    <div class="stat-row">
      <article v-for="item in statCards" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value" :class="item.tone">{{ item.value }}</strong>
      </article>
    </div>

    <section class="panel">
      <h3 class="panel-title">
        协议信号阈值
        <span class="panel-hint">信号强度按 dBm 比较（数值越小越差）；最近通讯时刻超过静默阈值判中断核查</span>
      </h3>
      <table class="data-table threshold-table">
        <thead>
          <tr>
            <th>通讯协议</th>
            <th>弱信号阈值(dBm，≤)</th>
            <th>更换阈值(dBm，≤)</th>
            <th>离线静默阈值(分钟，&gt;)</th>
            <th>来源</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="rule in thresholds" :key="rule.protocol">
            <td>{{ rule.protocol }}</td>
            <td><input v-model.number="rule.weakDbm" type="number" class="num-input" /></td>
            <td><input v-model.number="rule.replaceDbm" type="number" class="num-input" /></td>
            <td><input v-model.number="rule.staleMinutes" type="number" min="1" class="num-input" /></td>
            <td>{{ rule.builtin ? '内置' : '新增' }}</td>
            <td><button class="link" type="button" @click="saveThreshold(rule.protocol)">保存阈值</button></td>
          </tr>
        </tbody>
      </table>
    </section>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>设备编号 / 站点 / 协议</span>
        <input v-model="keyword" placeholder="按设备编号、所属站点、通讯协议检索" />
      </label>
      <label class="filter-item">
        <span>设备状态</span>
        <select v-model="statusFilter">
          <option value="">全部</option>
          <option value="在用">在用</option>
          <option value="停用">停用</option>
        </select>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table device-table">
      <thead>
        <tr>
          <th>设备编号</th>
          <th>所属站点</th>
          <th>通讯协议</th>
          <th>信号阈值读数</th>
          <th>最近通讯时刻</th>
          <th>设备状态</th>
          <th>自动判级</th>
          <th>当前生效结论</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in devices" :key="row.id" :class="{ 'row-disabled': row.status === '停用' }">
          <td>
            {{ row.deviceCode }}
            <span v-if="row.migratedFromLegacy" class="tag tag-migrated" title="由旧通讯清单迁移">旧档</span>
            <span v-if="row.locked" class="tag tag-locked" title="本轮已有结论，重复并发上报将被丢弃">已上报</span>
          </td>
          <td>{{ row.station }}<div class="cell-sub">{{ row.deviceType }}</div></td>
          <td>{{ row.protocol }}</td>
          <td>
            {{ row.signalRaw || '缺读数' }}
            <div v-if="row.note" class="cell-sub">{{ row.note }}</div>
          </td>
          <td>
            {{ formatDateTime(row.lastCommAt) }}
            <div v-if="minutesSince(row.lastCommAt) !== null" class="cell-sub">
              距今 {{ minutesSince(row.lastCommAt) }} 分钟
            </div>
            <div v-else class="cell-sub">时刻缺失</div>
          </td>
          <td>
            <span :class="['status-pill', row.status === '停用' ? 'pill-off' : 'pill-on']">{{ row.status }}</span>
          </td>
          <td>
            <span :class="['grade-badge', gradeTone(row.grade.level)]">{{ row.grade.level }}</span>
            <div class="cell-sub reasons">{{ row.grade.reasons[0] }}</div>
          </td>
          <td>
            <template v-if="row.effective">
              <span :class="['grade-badge', gradeTone(row.effective.level)]">{{ row.effective.level }}</span>
              <span :class="['tag', row.effective.source === 'manual' ? 'tag-manual' : 'tag-auto']">
                {{ row.effective.source === 'manual' ? '人工' : '自动' }}
              </span>
              <div v-if="row.manual && row.grade.level !== row.manual.level" class="cell-sub conflict-text">
                自动建议「{{ row.grade.level }}」，以人工「{{ row.manual.level }}」为准
              </div>
            </template>
            <span v-else class="cell-sub">尚无生效结论</span>
          </td>
          <td class="row-actions vertical">
            <button class="link" type="button" @click="autoReport(row.id)">自动判级上报</button>
            <button class="link" type="button" @click="concurrentDemo(row.id)">并发上报×5</button>
            <button class="link" type="button" @click="openManual(row.id)">人工判断</button>
            <button v-if="row.grade.level === '缺读数待补'" class="link" type="button" @click="openSupplement(row.id)">
              补录读数
            </button>
            <button
              class="link"
              type="button"
              :class="{ 'toggle-on': row.status === '停用' }"
              @click="toggleStatus(row)"
            >
              {{ row.status === '停用' ? '启用设备' : '停用设备' }}
            </button>
          </td>
        </tr>
        <tr v-if="!devices.length">
          <td colspan="9" class="empty-state">没有符合条件的通讯设备</td>
        </tr>
      </tbody>
    </table>

    <section class="panel two-col">
      <div>
        <h3 class="panel-title">
          判级结论留痕
          <span class="panel-hint">自动/人工冲突时自动结论标记为不生效；同一轮次重复并发上报只接受一个</span>
        </h3>
        <table class="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>设备编号</th>
              <th>等级</th>
              <th>来源</th>
              <th>轮次</th>
              <th>是否生效</th>
              <th>时刻</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in conclusions" :key="item.id" :class="{ 'row-ineffective': !item.effective }">
              <td>{{ item.id }}</td>
              <td>{{ item.deviceCode }}</td>
              <td>{{ item.level }}</td>
              <td>
                <span :class="['tag', item.source === 'manual' ? 'tag-manual' : 'tag-auto']">
                  {{ item.source === 'manual' ? '人工' : '自动' }}
                </span>
                <div class="cell-sub">{{ item.operator }}</div>
              </td>
              <td>第 {{ item.roundId }} 轮</td>
              <td>{{ item.effective ? '生效中' : '不生效（已被覆盖/冲突留痕）' }}</td>
              <td>{{ formatDateTime(item.createdAt) }}</td>
            </tr>
            <tr v-if="!conclusions.length">
              <td colspan="7" class="empty-state">还没有判级结论</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div>
        <h3 class="panel-title">
          巡检链路 · 通信核查事项
          <span class="panel-hint">中断核查/更换结论自动同步，人工判为正常/弱信号时自动关闭</span>
        </h3>
        <table class="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>事项</th>
              <th>等级</th>
              <th>来源</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in checkItems" :key="item.id">
              <td>{{ item.id }}</td>
              <td>
                {{ item.title }}
                <div class="cell-sub">{{ item.detail }}</div>
              </td>
              <td><span :class="['grade-badge', gradeTone(item.level)]">{{ item.level }}</span></td>
              <td>{{ item.source === 'manual' ? '人工' : '自动' }}</td>
              <td>
                {{ item.status }}
                <div v-if="item.closedAt" class="cell-sub">{{ formatDateTime(item.closedAt) }}</div>
              </td>
              <td>
                <button v-if="item.status === '待核查'" class="link" type="button" @click="closeItem(item.id)">
                  现场核查关闭
                </button>
                <span v-else class="cell-sub">已处置</span>
              </td>
            </tr>
            <tr v-if="!checkItems.length">
              <td colspan="6" class="empty-state">暂无通信核查事项</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <div v-if="modal === 'manual'" class="modal-mask" @click.self="modal = ''">
      <div class="modal">
        <h3>人工判断 · {{ modalDevice?.deviceCode }}</h3>
        <p class="modal-tip">
          自动判级参考：<strong :class="gradeTone(modalAutoGrade?.level)">{{ modalAutoGrade?.level }}</strong>
          <span v-if="modalAutoGrade">（{{ modalAutoGrade.reasons.join('；') }}）</span>
          <br />人工结论保存后即为生效结论；与自动结果冲突时以人工为准。停用设备不允许保存。
        </p>
        <label class="modal-field">
          <span>判级等级</span>
          <select v-model="manualForm.level">
            <option v-for="level in gradeLevels" :key="level" :value="level">{{ level }}</option>
          </select>
        </label>
        <label class="modal-field">
          <span>处置建议</span>
          <textarea v-model="manualForm.advice" rows="3"></textarea>
        </label>
        <div class="modal-actions">
          <button class="btn" type="button" @click="modal = ''">取消</button>
          <button class="btn primary" type="button" @click="submitManual">保存人工结论</button>
        </div>
      </div>
    </div>

    <div v-if="modal === 'supplement'" class="modal-mask" @click.self="modal = ''">
      <div class="modal">
        <h3>历史缺读数补录 · {{ modalDevice?.deviceCode }}</h3>
        <p class="modal-tip">补录信号强度（如 -82 或 -82dBm）与最近通讯时刻后自动重新判级；缺读数不填零。</p>
        <label class="modal-field">
          <span>信号强度读数</span>
          <input v-model="supplementForm.signalRaw" placeholder="例如 -82dBm 或 72%" />
        </label>
        <label class="modal-field">
          <span>最近通讯时刻</span>
          <input v-model="supplementForm.lastCommAt" type="datetime-local" />
        </label>
        <div class="modal-actions">
          <button class="btn" type="button" @click="modal = ''">取消</button>
          <button class="btn primary" type="button" @click="submitSupplement">补录并重新判级</button>
        </div>
      </div>
    </div>

    <footer class="page-foot">
      <span>第 {{ stats.round }} 判级轮次 · 上报锁 10 分钟有效，防止同设备重复并发上报</span>
      <span v-if="toast" class="toast-text" :class="{ 'toast-error': !lastOk }">{{ toast }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  closeCheckItem,
  formatDateTime,
  gradingStats,
  listCheckItems,
  listConclusions,
  listDevices,
  listThresholds,
  migrationSummary,
  minutesSince,
  reportAllDevices,
  resetConsole,
  saveManualJudgment,
  setDeviceStatus,
  simulateConcurrentReports,
  startNewRound,
  submitAutoReport,
  supplementReading,
  updateThreshold,
} from '@/data/comm-grading/service'
import type { DeviceView } from '@/data/comm-grading/service'
import type { AutoReportResult, CommGradeLevel, GradeResult, ProtocolThreshold } from '@/data/comm-grading/types'

const gradeLevels: CommGradeLevel[] = ['通讯正常', '信号弱', '建议中断核查', '建议更换', '缺读数待补']

const devices = ref<DeviceView[]>([])
const thresholds = ref<ProtocolThreshold[]>([])
const conclusions = ref(listConclusions().slice(0, 30))
const checkItems = ref(listCheckItems().slice(0, 30))
const stats = ref(gradingStats())
const migration = ref(migrationSummary())

const keyword = ref('')
const statusFilter = ref('')
const toast = ref('')
const lastOk = ref(true)

const modal = ref<'' | 'manual' | 'supplement'>('')
const modalDeviceId = ref<number | null>(null)
const manualForm = ref<{ level: CommGradeLevel; advice: string }>({ level: '通讯正常', advice: '' })
const supplementForm = ref<{ signalRaw: string; lastCommAt: string }>({ signalRaw: '', lastCommAt: '' })

const statCards = computed(() => [
  { label: '设备总数', value: stats.value.total, tone: '' },
  { label: '在用 / 停用', value: `${stats.value.active} / ${stats.value.disabled}`, tone: '' },
  { label: '缺读数待补', value: stats.value.missing, tone: stats.value.missing ? 'tone-warn' : '' },
  { label: '生效中断核查', value: stats.value.interrupt, tone: stats.value.interrupt ? 'tone-danger' : '' },
  { label: '生效建议更换', value: stats.value.replace, tone: stats.value.replace ? 'tone-danger' : '' },
  { label: '待核查事项', value: stats.value.openChecks, tone: stats.value.openChecks ? 'tone-warn' : '' },
  { label: '本轮已上报锁定', value: stats.value.locked, tone: '' },
])

const modalDevice = computed(() => devices.value.find((item) => item.id === modalDeviceId.value) ?? null)
const modalAutoGrade = computed<GradeResult | null>(() => modalDevice.value?.grade ?? null)

function showToast(result: AutoReportResult | string, ok?: boolean) {
  if (typeof result === 'string') {
    toast.value = result
    lastOk.value = ok ?? true
  } else {
    toast.value = result.message
    lastOk.value = result.accepted
  }
}

function gradeTone(level?: CommGradeLevel | null): string {
  switch (level) {
    case '建议中断核查':
      return 'tone-danger'
    case '建议更换':
      return 'tone-replace'
    case '信号弱':
      return 'tone-warn'
    case '缺读数待补':
      return 'tone-missing'
    default:
      return 'tone-ok'
  }
}

function reload() {
  devices.value = listDevices({ keyword: keyword.value, status: statusFilter.value })
  thresholds.value = listThresholds()
  conclusions.value = listConclusions().slice(0, 30)
  checkItems.value = listCheckItems().slice(0, 30)
  stats.value = gradingStats()
  migration.value = migrationSummary()
}

function resetFilters() {
  keyword.value = ''
  statusFilter.value = ''
  reload()
}

function autoReport(id: number) {
  showToast(submitAutoReport(id))
  reload()
}

function concurrentDemo(id: number) {
  const outcomes = simulateConcurrentReports(id, 5)
  const accepted = outcomes.filter((item) => item.accepted).length
  const code = outcomes[0]?.deviceCode ?? ''
  const last = outcomes[outcomes.length - 1]
  showToast(
    accepted > 0
      ? `${code} 并发上报 5 次：仅 1 个结论被接受，其余 ${5 - accepted} 次重复上报已丢弃。${last?.message ?? ''}`
      : `${code} 并发上报 5 次：本轮已有生效结论，5 次全部作为重复上报丢弃`,
    true,
  )
  reload()
}

function reportAll() {
  const results = reportAllDevices()
  const accepted = results.filter((item) => item.accepted).length
  const rejected = results.length - accepted
  showToast(`一键判级完成：在用设备 ${results.length} 台，接受 ${accepted} 条结论，丢弃/留痕 ${rejected} 条`)
  reload()
}

function newRound() {
  const round = startNewRound()
  showToast(`已开启第 ${round} 判级轮次，各设备上报锁已清空，可重新上报`)
  reload()
}

function resetAll() {
  if (!window.confirm('确定重置判级台？结论、核查事项、阈值调整都会回到初始迁移状态。')) {
    return
  }
  resetConsole()
  showToast('判级台已重置为初始迁移状态')
  reload()
}

function openManual(id: number) {
  modalDeviceId.value = id
  const device = devices.value.find((item) => item.id === id)
  manualForm.value = {
    level: device?.manual?.level ?? device?.grade.level ?? '通讯正常',
    advice: device?.grade.advice ?? '',
  }
  modal.value = 'manual'
}

function submitManual() {
  if (modalDeviceId.value === null) {
    return
  }
  const result = saveManualJudgment({
    deviceId: modalDeviceId.value,
    level: manualForm.value.level,
    advice: manualForm.value.advice.trim() || '人工现场核定',
  })
  showToast(result)
  modal.value = ''
  reload()
}

function openSupplement(id: number) {
  modalDeviceId.value = id
  const device = devices.value.find((item) => item.id === id)
  supplementForm.value = {
    signalRaw: '',
    lastCommAt: device?.lastCommAt ? toLocalInput(device.lastCommAt) : toLocalInput(new Date().toISOString()),
  }
  modal.value = 'supplement'
}

function toLocalInput(iso: string): string {
  if (!iso) {
    return ''
  }
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function submitSupplement() {
  if (modalDeviceId.value === null) {
    return
  }
  if (!supplementForm.value.signalRaw.trim() || !supplementForm.value.lastCommAt) {
    showToast('信号强度与最近通讯时刻都补录后才能重新判级', false)
    return
  }
  const result = supplementReading({
    deviceId: modalDeviceId.value,
    signalRaw: supplementForm.value.signalRaw,
    lastCommAt: supplementForm.value.lastCommAt,
  })
  showToast(result)
  modal.value = ''
  reload()
}

function toggleStatus(row: DeviceView) {
  const next = row.status === '停用' ? '在用' : '停用'
  if (next === '停用' && !window.confirm(`确定停用 ${row.deviceCode}？停用后不能保存新结论，在途上报锁会清除。`)) {
    return
  }
  showToast(setDeviceStatus(row.id, next))
  reload()
}

function saveThreshold(protocol: string) {
  const rule = thresholds.value.find((item) => item.protocol === protocol)
  if (!rule) {
    return
  }
  showToast(updateThreshold({ ...rule }))
  reload()
}

function closeItem(id: number) {
  showToast(closeCheckItem(id))
  reload()
}

onMounted(reload)
</script>

<style scoped>
.migration-banner {
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: #fff8e6;
  border: 1px solid #f0d99b;
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
  font-size: 13px;
}
.migration-banner strong {
  font-size: 13px;
}
.migration-meta {
  color: var(--muted);
  font-size: 12px;
}
.panel {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  margin: 14px 0;
}
.panel-title {
  margin: 0 0 10px;
  font-size: 14px;
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.panel-hint {
  font-weight: 400;
  font-size: 12px;
  color: var(--muted);
}
.num-input {
  width: 110px;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
}
.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  background: transparent;
  border: none;
  padding: 0;
}
.two-col > div {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
}
.cell-sub {
  color: var(--muted);
  font-size: 12px;
  margin-top: 2px;
}
.cell-sub.reasons {
  max-width: 220px;
}
.row-disabled td {
  background: #f3f4f6;
  color: var(--muted);
}
.row-ineffective td {
  background: #fafafa;
  color: var(--muted);
}
.row-actions.vertical {
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}
.vertical .link.toggle-on {
  color: #b42318;
}
.grade-badge {
  display: inline-block;
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
  background: #e5e7eb;
  white-space: nowrap;
}
.tone-ok {
  color: #047857;
  background: #d1fae5;
}
.tone-warn {
  color: #92400e;
  background: #fef3c7;
}
.tone-danger {
  color: #b42318;
  background: #fee2e2;
}
.tone-replace {
  color: #6d28d9;
  background: #ede9fe;
}
.tone-missing {
  color: #1e40af;
  background: #dbeafe;
}
.stat-value.tone-warn {
  color: #b45309;
}
.stat-value.tone-danger {
  color: #b42318;
}
.tag {
  display: inline-block;
  border-radius: 4px;
  padding: 0 6px;
  font-size: 11px;
  margin-left: 4px;
}
.tag-migrated {
  background: #fef3c7;
  color: #92400e;
}
.tag-locked {
  background: #e0e7ff;
  color: #3730a3;
}
.tag-manual {
  background: #ede9fe;
  color: #5b21b6;
}
.tag-auto {
  background: #e0f2fe;
  color: #075985;
}
.status-pill {
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
}
.pill-on {
  background: #d1fae5;
  color: #047857;
}
.pill-off {
  background: #fee2e2;
  color: #b42318;
}
.conflict-text {
  color: #b42318;
  max-width: 200px;
}
.danger {
  color: #b42318;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.modal {
  background: #fff;
  border-radius: 10px;
  padding: 18px 20px;
  width: 520px;
  max-width: calc(100vw - 40px);
}
.modal h3 {
  margin: 0 0 8px;
  font-size: 15px;
}
.modal-tip {
  font-size: 12px;
  color: var(--muted);
  margin: 0 0 12px;
  line-height: 1.6;
}
.modal-field {
  display: block;
  margin-bottom: 10px;
}
.modal-field span {
  display: block;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 4px;
}
.modal-field select,
.modal-field input,
.modal-field textarea {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-family: inherit;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}
.toast-text {
  color: #047857;
  max-width: 70%;
  text-align: right;
}
.toast-error {
  color: #b42318;
}
</style>
