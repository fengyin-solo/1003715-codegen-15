/* 判级台业务规则冒烟测试：esbuild 即时转译后用内存 localStorage 跑一遍六条规则。 */
const { build } = require('esbuild')
const path = require('path')
const fs = require('fs')
const os = require('os')

const outFile = path.join(os.tmpdir(), 'comm-smoke.mjs')

function localStorePlugin() {
  // local-store 在 Node 下会读 window，给它打桩；seed 迁移只用到 listRows。
  return {
    name: 'stub-local-store',
    setup(b) {
      b.onResolve({ filter: /@\/data\/local-store$/ }, () => ({ path: 'local-store', namespace: 'stub' }))
      b.onResolve({ filter: /pinia$/ }, () => ({ path: 'pinia', namespace: 'stub' }))
      b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => {
        if (args.path === 'local-store') {
        return {
          contents: `
          const legacy = [
            { id: 1, '设备编号': 'COMM-0001', '所属站点': '旧站A', '通讯协议': '4G', '设备类型': 'X', '信号强度': '通讯系统样例1', '最近通讯时刻': '通讯系统样例1', '维护人员': '' },
            { id: 2, '设备编号': 'COMM-0002', '所属站点': '旧站B', '通讯协议': '未知协议', '设备类型': 'X', '信号强度': '-80dBm', '最近通讯时刻': new Date(Date.now()-5*60000).toISOString(), '维护人员': '' },
            { id: 3, '设备编号': 'COMM-0003', '所属站点': '旧站C', '通讯协议': '4G', '设备类型': 'X', '信号强度': '', '最近通讯时刻': '', '维护人员': '' },
          ]
          export function listRows() { return legacy }
        `,
          loader: 'js',
        }
        }
        return {
          contents: `export function defineStore(_id, def) {
          return () => def.state()
        }`,
          loader: 'js',
        }
      })
    },
  }
}

async function main() {
  await build({
    entryPoints: [path.join(__dirname, '../src/data/comm-grading/service.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: outFile,
    plugins: [
      {
        name: 'alias',
        setup(b) {
          b.onResolve({ filter: /^@\/stores\/session$/ }, () => ({ path: 'session', namespace: 'stub2' }))
          b.onLoad({ filter: /.*/, namespace: 'stub2' }, () => ({
            contents: `export function useSessionStore(){ return { operator: '测试员' } }`,
            loader: 'js',
          }))
        },
      },
      localStorePlugin(),
    ],
  })

  const mem = new Map()
  globalThis.window = {
    localStorage: {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, v),
      removeItem: (k) => mem.delete(k),
    },
  }

  const svc = await import(outFile)
  const results = []
  const check = (name, cond, detail = '') => {
    results.push({ name, ok: Boolean(cond), detail })
  }

  // 初始状态：9 台新档 + 3 台旧档迁移
  const devices0 = svc.listDevices()
  check('设备总数=12（9新档+3迁移）', devices0.length === 12, `实际 ${devices0.length}`)
  const migrated = devices0.filter((d) => d.migratedFromLegacy)
  check('迁移旧档=3台', migrated.length === 3, `实际 ${migrated.length}`)
  const missingMigrated = migrated.filter((d) => d.grade.level === '缺读数待补')
  check('旧档缺读数=2台（占位文本与空值，合法读数的1台正常迁移）', missingMigrated.length === 2, missingMigrated.map((d) => d.deviceCode).join(','))
  const legacyGood = devices0.find((d) => d.deviceCode === 'COMM-0002')
  check('旧档合法读数未误判缺读', legacyGood && legacyGood.grade.level === '通讯正常', legacyGood?.grade.level)
  check('迁移汇总缺读数=2', svc.migrationSummary().missingReadings === 2)

  // 规则1：信号弱（-98 ≤ -95，且在线）
  const weak = devices0.find((d) => d.deviceCode === 'COMM-4G-02')
  check('规则: -98dBm/4G 判信号弱', weak.grade.level === '信号弱', weak.grade.level)
  // 规则2：更换（-112 ≤ -110）
  const replace = devices0.find((d) => d.deviceCode === 'COMM-4G-03')
  check('规则: -112dBm/4G 判建议更换', replace.grade.level === '建议更换', replace.grade.level)
  // 规则3：中断（静默96分钟 > 30）
  const interrupt = devices0.find((d) => d.deviceCode === 'COMM-4G-04')
  check('规则: 静默96分钟/4G 判建议中断核查', interrupt.grade.level === '建议中断核查', interrupt.grade.level)
  // NB -118 低于 -115 更换
  const nbReplace = devices0.find((d) => d.deviceCode === 'COMM-NB-02')
  check('规则: NB-IoT -118dBm 判建议更换', nbReplace.grade.level === '建议更换', nbReplace.grade.level)

  // 自动上报 + 核查事项同步
  const r1 = svc.submitAutoReport(replace.id)
  check('自动上报接受', r1.accepted, r1.message)
  const items1 = svc.listCheckItems('待核查')
  check('更换结论同步生成核查事项', items1.some((i) => i.deviceCode === replace.deviceCode && i.level === '建议更换'))

  // 规则：同设备并发重复上报只接受一个
  const r2 = svc.submitAutoReport(replace.id)
  const r3 = svc.submitAutoReport(replace.id)
  check('第2次重复上报被拒', !r2.accepted && /重复并发上报/.test(r2.message), r2.message)
  check('第3次重复上报被拒', !r3.accepted, r3.message)
  const conc = svc.simulateConcurrentReports(interrupt.id, 5)
  check('并发×5仅接受1条', conc.filter((c) => c.accepted).length === 1, conc.map((c) => c.accepted).join(','))

  // 规则：自动与人工冲突以人工为准
  const manual = svc.saveManualJudgment({ deviceId: replace.id, level: '通讯正常', advice: '现场复测正常，天线松动已固定' })
  check('人工结论保存成功', manual.accepted, manual.message)
  const afterManual = svc.submitAutoReport(replace.id)
  check('冲突时自动结论被拒且标记以人工为准', !afterManual.accepted && afterManual.overriddenByManual, afterManual.message)
  const cons = svc.listConclusions(replace.id)
  check('冲突自动结论留痕但不生效', cons.some((c) => c.source === 'auto' && !c.effective && c.level === '建议更换'))
  const eff = svc.listDevices().find((d) => d.id === replace.id)
  check('生效结论=人工通讯正常', eff.effective.source === 'manual' && eff.effective.level === '通讯正常')
  check('人工判正常后旧核查事项自动关闭', svc.listCheckItems('待核查').every((i) => i.deviceCode !== replace.deviceCode))

  // 规则：停用设备不允许保存新结论
  const disabled = svc.listDevices().find((d) => d.deviceCode === 'COMM-5G-01')
  const autoOnDisabled = svc.submitAutoReport(disabled.id)
  const manualOnDisabled = svc.saveManualJudgment({ deviceId: disabled.id, level: '通讯正常', advice: 'x' })
  check('停用设备拒绝自动结论', !autoOnDisabled.accepted && /停用/.test(autoOnDisabled.message), autoOnDisabled.message)
  check('停用设备拒绝人工结论', !manualOnDisabled.accepted && /停用/.test(manualOnDisabled.message), manualOnDisabled.message)
  svc.setDeviceStatus(disabled.id, '停用')
  const activeDevice = svc.listDevices().find((d) => d.deviceCode === 'COMM-4G-02')
  svc.setDeviceStatus(activeDevice.id, '停用')
  const afterDisable = svc.submitAutoReport(activeDevice.id)
  check('在用设备停用后拒绝新结论', !afterDisable.accepted && /停用/.test(afterDisable.message), afterDisable.message)

  // 规则：缺读数补录后重新判级
  const missId = missingMigrated[0].id
  const supp = svc.supplementReading({
    deviceId: missId,
    signalRaw: '-70dBm',
    lastCommAt: new Date(Date.now() - 2 * 60000).toISOString(),
  })
  check('缺读数补录后自动重判并接受', supp.accepted && supp.level === '通讯正常', `${supp.accepted}/${supp.level}`)
  const suppMiss = svc.supplementReading({
    deviceId: missingMigrated[1].id,
    signalRaw: '-70dBm',
    lastCommAt: new Date(Date.now() - 2 * 60000).toISOString(),
  })
  check('第二台补录也能重判', suppMiss.accepted, suppMiss.message)

  // 阈值校验
  check('阈值非法被拒（弱信号<=更换）', svc.updateThreshold({ protocol: '4G', weakDbm: -111, replaceDbm: -110, staleMinutes: 30 }).includes('不合法'))
  const upd = svc.updateThreshold({ protocol: '4G', weakDbm: -70, replaceDbm: -100, staleMinutes: 45 })
  check('阈值更新成功', upd.includes('已更新'), upd)
  // 阈值收紧到 -70 后，原 -72dBm 的正常设备应变信号弱
  check('阈值更新即时生效', svc.listDevices().find((d) => d.deviceCode === 'COMM-4G-01').grade.level === '信号弱')

  // 巡检链路关闭事项
  const openItem = svc.listCheckItems('待核查')[0]
  if (openItem) {
    svc.closeCheckItem(openItem.id)
    check('核查事项可关闭', svc.listCheckItems('待核查').every((i) => i.id !== openItem.id))
  } else {
    check('存在可关闭的核查事项', false)
  }

  // 新一轮：锁清空，可再次上报
  svc.startNewRound()
  const rr = svc.submitAutoReport(replace.id) // 该设备生效结论是人工，仍冲突拒绝
  check('新一轮自动仍服从人工结论', !rr.accepted && rr.overriddenByManual, rr.message)
  const weakDev = svc.listDevices().find((d) => d.deviceCode === 'COMM-NB-01')
  const nb01 = svc.submitAutoReport(weakDev.id)
  check('新一轮对无人工结论设备可重新上报', nb01.accepted, nb01.message)

  let pass = 0
  for (const r of results) {
    if (r.ok) pass += 1
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '  >>> ' + r.detail}`)
  }
  console.log(`\n${pass}/${results.length} passed`)
  fs.unlinkSync(outFile)
  if (pass !== results.length) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
