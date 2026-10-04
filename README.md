# 水文监测站网管理系统

面向水文监测站点运行、水位流量雨量数据采集、遥测设备维护与数据整编发布的水文站网管理平台。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 目录结构

```text
.
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、动作流转、导出
│   ├── src/data/             模块元数据 / 示例数据 / localStorage 持久化
│   ├── src/stores/           会话与筛选状态
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）
├── .gitignore
└── docker-compose.yml
```

## 启动

```bash
cd frontend
npm install
npm run dev
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。

生产构建：

```bash
cd frontend
npm run build
```

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 监测站点 | `station` | 水文监测站 | 站点编号、站点名称、站点类型 |
| 水位监测 | `waterlevel` | 水位记录 | 记录编号、站点编号、观测时间 |
| 流量监测 | `discharge` | 流量记录 | 记录编号、站点编号、测量方法 |
| 雨量观测 | `rainfall` | 雨量记录 | 记录编号、站点编号、观测时段 |
| 水质检测 | `waterquality` | 水质检测报告 | 报告编号、采样站点、采样时间 |
| 断面测量 | `crosssection` | 断面测量记录 | 记录编号、站点编号、断面名称 |
| 遥测设备 | `telemetry` | 遥测设备 | 设备编号、设备类型、所属站点 |
| 数据整编 | `compilation` | 整编成果 | 成果编号、整编年份、站点编号 |
| 预警阈值 | `warning` | 预警阈值配置 | 配置编号、站点编号、监测类型 |
| 地下水观测 | `groundwater` | 地下水观测记录 | 记录编号、井点编号、观测日期 |
| 蒸发观测 | `evaporation` | 蒸发观测记录 | 记录编号、站点编号、观测日期 |
| 测流缆道 | `cableway` | 测流缆道 | 缆道编号、所属站点、跨度米数 |
| 泥沙监测 | `sediment` | 泥沙监测记录 | 记录编号、站点编号、采样时间 |
| 通讯系统 | `communication` | 通讯设备 | 设备编号、设备类型、所属站点、通讯协议、信号阈值、最近通讯时刻 |
| 站房维护 | `stationhouse` | 站房维护记录 | 记录编号、站点编号、维护类型 |
| 仪器检定 | `calibration` | 仪器检定记录 | 记录编号、仪器编号、仪器名称 |
| 巡检记录 | `inspection` | 巡检记录 | 记录编号、站点编号、巡检日期 |
| 测报方案 | `plan` | 测报方案 | 方案编号、方案名称、适用范围 |

## 通讯设备故障判级规则台

通讯系统页（`communication`）内置「故障判级规则台」页签，代码：

- `frontend/src/views/communication/GradeConsole.vue`：规则配置、设备判级表、历史结论
- `frontend/src/api/grade-service.ts`：自动判级、人工判级、结论落库守卫
- `frontend/src/data/grade-store.ts`：判级阈值规则与结论的独立持久化（`hydrology-monitor-station:communication-grade`）

业务约定：

1. 按**通讯协议**（4G / 5G / 北斗 / 超短波）配置弱信号阈值、中断信号阈值、断联超时小时数、中断累计更换次数；
   结合**设备编号、所属站点、信号阈值、最近通讯时刻**自动给出「通讯正常 / 信号弱 / 建议中断核查 / 建议更换」。
2. 自动结果与人工判断冲突时**以人工为准**：人工判级直接落最终级别，结论保留自动建议并打「冲突」标记。
3. **历史缺读迁移**：v1 占位/缺读数据升级到 schema v2 时，身份字段用新种子补齐，信号强度、最近通讯时刻等
   读数不编造、保留为空并标注「历史缺读，待人工补录」；缺读设备自动上报会被拦下转人工，不自动下中断结论。
4. **已停用设备不允许保存新结论**（规则台与设备清单动作流均拦截），也不再参与批量自动上报。
5. 中断/更换结论落地时，向**巡检记录**模块同步生成一条「通信核查-{设备编号}」事项（同设备待办去重）；
   人工恢复正常时自动关闭该设备的核查待办。巡检页新增「通信核查事项」统计。
6. **同一设备重复并发上报只接受一个结论**：以「上报批次」为去重键，同批次重复提交（含批量并发）只保留首个结论；
   「开启新一轮上报批次」可重新验证。
7. 设备新增「已停用」状态与「停用设备」动作；判级落定同时回写通讯设备状态（通讯中断 / 待更换 / 信号弱 / 通讯正常）。
8. 结论带判级时的阈值规则快照，之后再调阈值不影响历史结论追溯。

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.vue`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`（判级规则台例外，走 `frontend/src/api/grade-service.ts`）。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.ts`。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断。
- 想回到初始数据：清掉浏览器里 `hydrology-monitor-station:entries`（判级数据清
  `hydrology-monitor-station:communication-grade`）这一项，或调用 `resetModule(模块)`。
