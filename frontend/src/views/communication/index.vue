<template>
  <section class="page" data-module="communication">
    <header class="page-head">
      <div>
        <h2>通讯系统管理</h2>
        <p class="page-desc">
          维护通讯设备，围绕设备编号、所属站点、通讯协议、信号阈值与最近通讯时刻做登记、判级与状态流转；
          故障判级规则台给出中断或更换建议，人工结论与自动建议冲突时以人工为准。
        </p>
      </div>
      <div class="page-actions">
        <button v-if="tab === 'devices'" class="btn primary" type="button" @click="openCreate">登记通讯设备</button>
        <button v-if="tab === 'devices'" class="btn" type="button" @click="exportRows">导出通讯系统清单</button>
      </div>
    </header>

    <div class="tab-bar" role="tablist">
      <button
        type="button"
        role="tab"
        :class="['tab-btn', { active: tab === 'devices' }]"
        @click="tab = 'devices'"
      >
        通讯设备清单
      </button>
      <button
        type="button"
        role="tab"
        :class="['tab-btn', { active: tab === 'grade' }]"
        @click="switchToGrade"
      >
        故障判级规则台
      </button>
    </div>

    <template v-if="tab === 'devices'">
      <div class="stat-row">
        <article v-for="item in stats" :key="item.label" class="stat-card">
          <span class="stat-label">{{ item.label }}</span>
          <strong class="stat-value">{{ item.value }}</strong>
        </article>
      </div>

      <p class="status-legend">
        <span v-for="item in statusSummary" :key="item.status" class="legend-item">
          {{ item.status }}：{{ item.count }}
        </span>
      </p>

      <form class="filter-bar" @submit.prevent="reload">
        <label v-for="field in filterFields" :key="field" class="filter-item">
          <span>{{ field }}</span>
          <input v-model="filters[field]" :placeholder="`按${field}检索`" />
        </label>
        <button class="btn" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
      </form>

      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column">{{ column }}</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="String(row.id)">
            <td v-for="column in columns" :key="column">{{ formatCell(row, column) }}</td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button
                v-for="action in actions"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="columns.length + 2" class="empty-state">暂无通讯系统数据，可先登记通讯设备</td>
          </tr>
        </tbody>
      </table>

      <footer class="page-foot">
        <span>共 {{ total }} 条通讯系统记录</span>
        <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      </footer>
    </template>

    <GradeConsole v-else @changed="reload" />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import GradeConsole from './GradeConsole.vue'

const meta = moduleMeta('communication')
const columns = ["设备编号", "设备类型", "所属站点", "通讯协议", "信号强度", "最近通讯时刻", "维护人员", "设备状态"]
const actions = ["登记故障", "确认恢复", "申请更换", "停用设备"]
const statuses = ["通讯正常", "信号弱", "通讯中断", "待更换", "已停用"]

const tab = ref<'devices' | 'grade'>('devices')
const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const stats = computed(() => [
  { label: '设备总数', value: rows.value.length },
  { label: '通讯正常数', value: rows.value.filter((row) => row.status === '通讯正常').length },
  { label: '中断设备数', value: rows.value.filter((row) => row.status === '通讯中断').length },
  { label: '停用设备数', value: rows.value.filter((row) => row.status === '已停用').length },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function formatCell(row: EntryRow, column: string): string {
  const value = row[column]
  if (value === '' || value === undefined || value === null) return '—'
  if (column === '最近通讯时刻') {
    const d = new Date(String(value))
    if (!Number.isNaN(d.getTime())) {
      const pad = (n: number) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    }
  }
  const note = column === '设备状态' && String(row['读数备注'] ?? '') ? `（${row['读数备注']}）` : ''
  return `${value}${note}`
}

function switchToGrade() {
  tab.value = 'grade'
  errorMessage.value = ''
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '通讯设备登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '通讯系统列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.tab-bar { display: flex; gap: 8px; margin-bottom: 12px; }
.tab-btn {
  border: 1px solid var(--border);
  background: #fff;
  border-radius: 6px 6px 0 0;
  padding: 8px 18px;
  cursor: pointer;
  font-size: 13px;
  color: var(--muted);
}
.tab-btn.active { background: var(--brand); border-color: var(--brand); color: #fff; font-weight: 600; }
</style>
