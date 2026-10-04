<template>
  <div class="grade-console">
    <!-- 规则配置区 -->
    <section class="console-card">
      <div class="console-card-head">
        <div>
          <h3>判级规则（按通讯协议配置阈值）</h3>
          <p class="muted">
            信号强度单位 dBm：实际信号不高于弱信号阈值判「信号弱」，不高于中断信号阈值或断联超过阈值小时数判「建议中断核查」；
            历史中断结论累计达到更换次数时升级「建议更换」。
          </p>
        </div>
        <button class="btn ghost" type="button" @click="resetRules">恢复默认规则</button>
      </div>
      <table class="data-table rule-table">
        <thead>
          <tr>
            <th>通讯协议</th>
            <th>弱信号阈值(dBm)</th>
            <th>中断信号阈值(dBm)</th>
            <th>断联超时(小时)</th>
            <th>中断累计更换次数</th>
            <th>更新时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="rule in rules" :key="rule.通讯协议">
            <td>{{ rule.通讯协议 }}</td>
            <td v-if="editingProtocol === rule.通讯协议" class="edit-cell">
              <input v-model.number="ruleDraft.弱信号阈值" type="number" />
            </td>
            <td v-else>{{ rule.弱信号阈值 }}</td>
            <td v-if="editingProtocol === rule.通讯协议" class="edit-cell">
              <input v-model.number="ruleDraft.中断信号阈值" type="number" />
            </td>
            <td v-else>{{ rule.中断信号阈值 }}</td>
            <td v-if="editingProtocol === rule.通讯协议" class="edit-cell">
              <input v-model.number="ruleDraft.断联超时小时" type="number" min="1" />
            </td>
            <td v-else>{{ rule.断联超时小时 }}</td>
            <td v-if="editingProtocol === rule.通讯协议" class="edit-cell">
              <input v-model.number="ruleDraft.中断累计更换次数" type="number" min="1" />
            </td>
            <td v-else>{{ rule.中断累计更换次数 }}</td>
            <td>{{ rule.更新时间 }}</td>
            <td class="row-actions">
              <template v-if="editingProtocol === rule.通讯协议">
                <button class="link" type="button" @click="saveEditingRule(rule)">保存</button>
                <button class="link danger" type="button" @click="editingProtocol = ''">取消</button>
              </template>
              <button v-else class="link" type="button" @click="startEditRule(rule)">调整阈值</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="ruleError" class="error-text">{{ ruleError }}</p>
    </section>

    <!-- 上报批次控制 -->
    <section class="console-card">
      <div class="console-card-head">
        <div>
          <h3>设备判级上报</h3>
          <p class="muted">
            当前上报批次：<code>{{ batch }}</code>
            ；同一批次内同一设备重复并发上报只接受一个结论。
            <button class="link" type="button" @click="startNewBatch">开启新一轮上报批次</button>
          </p>
        </div>
        <button class="btn primary" type="button" :disabled="batchRunning" @click="runBatch">
          {{ batchRunning ? '批量上报中…' : '批量自动上报全部在运设备' }}
        </button>
      </div>

      <table class="data-table grade-table">
        <thead>
          <tr>
            <th>设备编号</th>
            <th>所属站点</th>
            <th>通讯协议</th>
            <th>信号阈值(弱/中断/超时h)</th>
            <th>信号强度(dBm)</th>
            <th>最近通讯时刻</th>
            <th>设备状态</th>
            <th>自动判级建议</th>
            <th>判级操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in board" :key="item.device.id" :class="{ retired: item.retired }">
            <td>{{ item.device['设备编号'] }}</td>
            <td>{{ item.device['所属站点'] }}</td>
            <td>{{ item.device['通讯协议'] }}</td>
            <td>
              <template v-if="item.rule">
                {{ item.rule.弱信号阈值 }} / {{ item.rule.中断信号阈值 }} / {{ item.rule.断联超时小时 }}
              </template>
              <span v-else class="warn-text">未配置</span>
            </td>
            <td>
              {{ item.device['信号强度'] === '' ? '—' : item.device['信号强度'] }}
              <span v-if="item.missing" class="tag tag-warn">历史缺读</span>
            </td>
            <td>{{ formatTime(item.device['最近通讯时刻']) || '—' }}</td>
            <td>
              {{ item.device.status }}
              <span v-if="item.retired" class="tag tag-muted">已停用</span>
            </td>
            <td>
              <div :class="['suggestion', levelClass(item.suggestion.needManual ? null : item.suggestion.level)]">
                <strong>{{ item.suggestion.needManual ? '待人工核查' : item.suggestion.level }}</strong>
                <ul class="reason-list">
                  <li v-for="(reason, idx) in item.suggestion.reasons" :key="idx">{{ reason }}</li>
                </ul>
              </div>
            </td>
            <td class="ops-cell">
              <template v-if="item.retired">
                <span class="muted">停用设备禁止保存新结论</span>
              </template>
              <template v-else>
                <button
                  class="link"
                  type="button"
                  :disabled="inflight.has(String(item.device['设备编号']))"
                  @click="reportAuto(String(item.device['设备编号']))"
                >
                  接受自动结论
                </button>
                <span class="ops-divider">人工判定：</span>
                <button
                  v-for="level in manualLevels"
                  :key="level"
                  class="link"
                  type="button"
                  :disabled="inflight.has(String(item.device['设备编号']))"
                  @click="reportManual(String(item.device['设备编号']), level)"
                >
                  {{ level }}
                </button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- 历史结论 -->
    <section class="console-card">
      <div class="console-card-head">
        <div>
          <h3>历史判级结论</h3>
          <p class="muted">人工结论与自动建议冲突时以人工为准，冲突记录有标记。</p>
        </div>
      </div>
      <table class="data-table history-table">
        <thead>
          <tr>
            <th>#</th>
            <th>设备编号</th>
            <th>所属站点</th>
            <th>来源</th>
            <th>最终级别</th>
            <th>自动建议</th>
            <th>冲突</th>
            <th>批次</th>
            <th>判定人</th>
            <th>判定时间</th>
            <th>建议</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="conclusion in conclusions" :key="conclusion.id">
            <td>{{ conclusion.id }}</td>
            <td>{{ conclusion.设备编号 }}</td>
            <td>{{ conclusion.所属站点 }}</td>
            <td>
              <span :class="['tag', conclusion.来源 === '人工' ? 'tag-manual' : 'tag-auto']">{{ conclusion.来源 }}</span>
            </td>
            <td :class="levelClass(conclusion.级别)">{{ conclusion.级别 }}</td>
            <td class="muted">{{ conclusion.自动级别 }}</td>
            <td>
              <span v-if="conclusion.冲突" class="tag tag-conflict">冲突·以人工为准</span>
              <span v-else class="muted">—</span>
            </td>
            <td class="muted">{{ conclusion.上报批次 }}</td>
            <td>{{ conclusion.判定人 }}</td>
            <td>{{ formatTime(conclusion.判定时间) }}</td>
            <td class="advice-cell">{{ conclusion.建议 }}</td>
          </tr>
          <tr v-if="!conclusions.length">
            <td colspan="11" class="empty-state">暂无判级结论</td>
          </tr>
        </tbody>
      </table>
    </section>

    <p v-if="message" class="console-message" :class="messageKind">{{ message }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'

import { submitAutoGrade, submitManualGrade, gradeBoard } from '@/api/grade-service'
import type { SubmitResult } from '@/api/grade-service'
import {
  DEFAULT_RULES,
  listRules,
  saveRule,
  listConclusions,
} from '@/data/grade-store'
import type { FaultLevel, GradeRule } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()
const emit = defineEmits<{ (event: 'changed'): void }>()

const manualLevels: FaultLevel[] = ['通讯正常', '信号弱', '建议中断核查', '建议更换']

const rules = ref<GradeRule[]>([])
const board = ref<ReturnType<typeof gradeBoard>>([])
const conclusions = ref(listConclusions())
const editingProtocol = ref('')
const ruleDraft = ref<GradeRule>({ ...DEFAULT_RULES[0] })
const ruleError = ref('')
const message = ref('')
const messageKind = ref<'ok' | 'err'>('ok')
const inflight = ref<Set<string>>(new Set())
const batchRunning = ref(false)

function makeBatchId(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `BATCH-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}
const batch = ref(makeBatchId())
let batchSeq = 0

function refresh() {
  rules.value = listRules()
  board.value = gradeBoard()
  conclusions.value = listConclusions()
}

function startNewBatch() {
  batch.value = makeBatchId()
  batchSeq = 0
  flash(`已开启新上报批次 ${batch.value}，可重新验证重复上报去重`, 'ok')
}

function startEditRule(rule: GradeRule) {
  editingProtocol.value = rule.通讯协议
  ruleDraft.value = { ...rule }
  ruleError.value = ''
}

function saveEditingRule(base: GradeRule) {
  const draft = ruleDraft.value
  if (!(draft.弱信号阈值 > draft.中断信号阈值)) {
    ruleError.value = `${base.通讯协议}：弱信号阈值应高于（强于）中断信号阈值，例如 -95 高于 -105`
    return
  }
  if (!(draft.断联超时小时 >= 1)) {
    ruleError.value = '断联超时小时必须不小于 1'
    return
  }
  if (!(draft.中断累计更换次数 >= 1)) {
    ruleError.value = '中断累计更换次数必须不小于 1'
    return
  }
  saveRule(draft)
  editingProtocol.value = ''
  ruleError.value = ''
  refresh()
  flash(`协议 ${base.通讯协议} 的判级阈值已更新`, 'ok')
}

function resetRules() {
  const stamp = new Date().toLocaleString('sv-SE')
  for (const rule of DEFAULT_RULES) {
    saveRule({ ...rule, 更新时间: stamp })
  }
  editingProtocol.value = ''
  ruleError.value = ''
  refresh()
  flash('已恢复各通讯协议默认阈值', 'ok')
}

function levelClass(level: FaultLevel | null): string {
  if (!level) return 'level-manual'
  return {
    通讯正常: 'level-ok',
    信号弱: 'level-weak',
    建议中断核查: 'level-break',
    建议更换: 'level-replace',
  }[level]
}

function formatTime(value: unknown): string {
  if (!value) return ''
  const d = new Date(String(value))
  if (Number.isNaN(d.getTime())) return String(value)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

let messageTimer: ReturnType<typeof setTimeout> | undefined
function flash(text: string, kind: 'ok' | 'err') {
  message.value = text
  messageKind.value = kind
  clearTimeout(messageTimer)
  messageTimer = setTimeout(() => {
    message.value = ''
  }, 6000)
}

function handleResult(result: SubmitResult, deviceCode: string) {
  flash(result.message, result.ok ? 'ok' : 'err')
  if (result.ok) {
    refresh()
    emit('changed')
  }
}

function reportAuto(deviceCode: string) {
  if (inflight.value.has(deviceCode)) return
  inflight.value = new Set(inflight.value).add(deviceCode)
  // 同批次内并发点击：第二次调用在落库前就会被批次去重挡下；这里刻意保留异步窗口模拟并发
  window.setTimeout(() => {
    const result = submitAutoGrade(deviceCode, batch.value, store.operator)
    inflight.value = new Set([...inflight.value].filter((code) => code !== deviceCode))
    handleResult(result, deviceCode)
  }, 120)
}

function reportManual(deviceCode: string, level: FaultLevel) {
  if (inflight.value.has(deviceCode)) return
  inflight.value = new Set(inflight.value).add(deviceCode)
  window.setTimeout(() => {
    const result = submitManualGrade(deviceCode, level, batch.value, store.operator)
    inflight.value = new Set([...inflight.value].filter((code) => code !== deviceCode))
    handleResult(result, deviceCode)
  }, 120)
}

async function runBatch() {
  if (batchRunning.value) return
  batchRunning.value = true
  const codes = board.value
    .filter((item) => !item.retired)
    .map((item) => String(item.device['设备编号']))
  // 同一批次内并发上报：设备循环提交且不等待，验证「同一设备重复并发上报只接受一个结论」
  await Promise.all(
    codes.map(
      (code) =>
        new Promise<void>((resolve) => {
          const delay = batchSeq * 60
          batchSeq += 1
          window.setTimeout(() => {
            submitAutoGrade(code, batch.value, `${store.operator}·批量`)
            resolve()
          }, delay)
        }),
    ),
  )
  // 同批次立刻再来一轮重复上报，应全部被去重拒绝
  await new Promise((resolve) => window.setTimeout(resolve, codes.length * 60 + 200))
  const rejected: string[] = []
  for (const code of codes) {
    const result = submitAutoGrade(code, batch.value, `${store.operator}·批量重复`)
    if (!result.ok) rejected.push(code)
  }
  batchRunning.value = false
  refresh()
  emit('changed')
  flash(
    `批量上报完成：${codes.length} 台在运设备已处理；同批次重复上报 ${rejected.length} 台全部按去重忽略，只保留首个结论`,
    'ok',
  )
}

onBeforeUnmount(() => clearTimeout(messageTimer))
refresh()
</script>

<style scoped>
.grade-console { display: flex; flex-direction: column; gap: 14px; }
.console-card { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; }
.console-card-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 10px; }
.console-card h3 { margin: 0 0 4px; font-size: 15px; }
.muted { color: var(--muted); font-size: 12px; margin: 0; }
.muted code { background: #eef2f7; border-radius: 4px; padding: 1px 6px; }
.rule-table input { width: 86px; padding: 4px 6px; border: 1px solid var(--border); border-radius: 4px; }
.edit-cell { white-space: nowrap; }
.tag { display: inline-block; border-radius: 999px; padding: 1px 8px; font-size: 11px; margin-left: 4px; }
.tag-warn { background: #fef3c7; color: #92400e; }
.tag-muted { background: #e2e8f0; color: #475569; }
.tag-auto { background: #dbeafe; color: #1e40af; }
.tag-manual { background: #ede9fe; color: #5b21b6; }
.tag-conflict { background: #fee2e2; color: #b42318; }
.warn-text { color: #b45309; }
.suggestion strong { font-size: 12px; }
.reason-list { margin: 4px 0 0; padding-left: 16px; color: var(--muted); font-size: 11px; }
.ops-cell { white-space: nowrap; min-width: 230px; }
.ops-cell .link { margin-right: 6px; font-size: 12px; }
.ops-cell button:disabled { color: #94a3b8; cursor: not-allowed; }
.ops-divider { color: var(--muted); font-size: 12px; margin-right: 4px; }
tr.retired td { background: #f8fafc; color: #94a3b8; }
.level-ok { color: #15803d; }
.level-weak { color: #b45309; }
.level-break { color: #c2410c; }
.level-replace { color: #b42318; font-weight: 600; }
.level-manual { color: #6d28d9; }
.advice-cell { max-width: 260px; font-size: 12px; color: var(--muted); }
.console-message { position: sticky; bottom: 12px; align-self: center; border-radius: 8px; padding: 8px 16px; font-size: 13px; box-shadow: 0 4px 16px rgb(15 23 42 / 0.12); }
.console-message.ok { background: #ecfdf5; border: 1px solid #6ee7b7; color: #065f46; }
.console-message.err { background: #fef2f2; border: 1px solid #fca5a5; color: #991b1b; }
.history-table td, .grade-table td { vertical-align: top; }
</style>
