# Leads：结果优先的筛选设计（待审阅）

> 状态更新：用户已确认布局，并要求加入客户端分页、待跟进及未回复筛选。本文记录最初的设计方案和当时待定的问题；最终行为以应用代码和测试为准。

本轮仅设计，没有修改应用功能或部署。检查基线：`cfeff45`，原工作区分支 `codex/account-settings-design`，检查时工作区干净。设计使用隔离 worktree `C:/Users/Lenovo/.codex/worktrees/leads-results-design/autotrack-next`，分支 `codex/leads-results-design`。未修改其他已有 worktree。

## 推荐布局

- 保留现有 AutoTrack 导航顺序：Customer data、Dashboard、Leads、Agenda、Analytics；沿用 Segoe UI、蓝色主操作、浅灰页面、白色表面、细边框和圆角。原侧栏可展开/折叠，窄屏已有导航抽屉；本设计不要求改导航架构。
- 去掉大块 Lead Filters 标题和重复的 Search / Basic Filters 区块标题。宽屏默认一行：带明确标签的搜索、Status、Stage、More filters。New Lead 放结果工具栏上方右侧，避免遮住末列和底部控件；该位置调整也需随设计确认。
- 常用区先推荐 Status、Stage，尚无使用频率数据；Trade-in、Score、意向车 Year / Make / Model 全部保留在 More filters，不能因为折叠而丢失能力。若车型是主要工作入口，可换到常用区，需用户确认。
- 高级筛选默认折叠，按需原位展开：第一行 Trade-in、Score，第二行 Vehicle interest 的 Year、Make、Model。原位展开更易实现和使用键盘，不占用表格横向空间。与桌面常驻侧栏相比，优先保证现有九列表格宽度。
- 结果数量与已生效条件放表格正上方。没有条件时只显示总数；有条件时显示“匹配数 / 全部数”和可逐项删除的条件标签，提供 Clear all。搜索条件也要计入；清空搜索使用输入框旁的 Clear search。高级筛选即便折叠，标签和 More filters 的生效数量也保留。默认不隐藏任何已应用条件；很多条件时自动换行。
- 查询即时生效，不增加 Apply 步骤；折叠只改变可见性，不清空、不撤销条件。保留所有条件的 AND 逻辑。
- 全部清除包括搜索与所有筛选；单项删除不清空其他条件，但车型依赖仍按现有规则处理。清空 Year 后保留仍有效的 Make / Model；更换 Year / Make 时只清除已失效的下游值，并用 polite 状态提示说明被清除项。

## 首屏空间目标

原图为 1920×869，筛选卡约 y=140–653，表格头约 y=694，第一行约 y=760。目标宽屏（同尺度、侧栏收起）：默认工具区 100–140px，表头约 y=270–310，第一行约 y=320–360，预计首屏 6–8 行；展开高级筛选后仍争取 3–5 行。这里是布局预算，尚未在应用中测量，浏览器缩放、长内容、侧栏展开会影响结果。不要靠缩小字体到难读来凑行数。常规行高建议 56–64px，舒适模式 72px 左右；触屏交互目标至少 44px。

可交互方案采用合成数据，演示搜索、组合筛选、车型联动、条件移除、清空、空结果和分页；不连接真实客户数据。演示中的分页是待确认的新能力，示意默认 10 条以控制审阅长度，正式建议 25 条。

## 桌面、窄屏与移动端

- ≥1280px：搜索、Status、Stage、More filters 同行，结果表保留现有九列。搜索有弹性最小宽度；长状态文案不裁掉关键信息。
- 768–1279px：搜索独占一行，其余控件第二行，侧栏维持现有行为。表格外容器水平滚动；可固定客户姓名列和表头，必须验证固定列不覆盖内容和键盘焦点。展开侧栏导致有效宽度不足时，也采用这一布局。
- <768px：保留顶部标题、导航菜单、通知。搜索占一行，Status / Stage 两列，More filters 与结果数相邻。高级区为原位折叠面板，字段两列或单列（≤390px优先单列）。保持 44px 目标与 16px 输入字号。
- 手机结果用紧凑客户列表：姓名、状态、阶段、评分、意向车、首选联系信息直接可见。展开单条详情显示完整电话/邮箱、置换车辆、最后联系，以及查看摘要、编辑和删除入口。信息与操作仍可达，不能为了缩短卡片静默删除字段；手机卡片替代表格属于待确认的呈现调整。
- 不默认同时粘住搜索、筛选、条件、分页，避免再吃掉小屏高度。分页在结果尾部；标题旁总数始终说明结果集。移动端不放遮挡内容的悬浮 New Lead。

## 键盘和辅助技术

- Tab 按视觉顺序：搜索 → 清空搜索（有值时）→ Status → Stage → More filters → 已展开高级字段 → 条件移除 → Clear all → 结果行操作 → 分页。各输入都有显式或屏幕阅读器标签，不能只依赖 placeholder。
- More filters 是原生 button，带 aria-expanded / aria-controls，Enter / Space 切换。若从高级区按 Escape，先关闭当前下拉建议；若无建议打开，再折叠面板并把焦点还给 More filters。没有模态面板，因此不陷获焦点。
- 沿用现有 Base UI 选择与联想组件：↑/↓ 浏览建议，Enter 选择，Escape 关闭建议，Tab 前进；支持自由输入。prototype 使用原生输入与 datalist，仅演示行为，不替代最终组件的无障碍验证。
- 标签删除按钮有完整名称，如“Remove Status: Active”；删除后焦点移至下一个标签，或 Clear all / 搜索框。Clear all 后焦点回搜索。结果数使用 aria-live=polite，输入停止约 300ms 后播报，避免逐键刷屏；这不是网络请求延迟。
- 使用键盘修改筛选时不把焦点突然移到结果；分页操作后才把焦点移至结果区标题，并播报区间和匹配总数。保持可见 focus ring。
- 行内状态变更是数据写操作，与列表筛选明确区分；终态客户继续在详情改阶段，不能在新布局中绕开限制。

## 空状态、加载和错误

- 0 个匹配：显示“0 of N leads / No matching leads”，保留全部条件并提供 Clear all；提示检查拼写或减少条件。不能把无匹配误写成尚无客户。
- 数据集为 0 且未筛选：显示“No leads yet”，突出 New Lead。若需要导入入口可链接已有 Customer data，但不在本轮擅自新增导入能力。
- 加载中显示结果骨架或 Loading leads，不能先闪出 0 条。读取失败要显示 Unable to load leads 和 Retry，不能当成空集；筛选重排本身不解决读失败，目前 LeadsPage 缺乏 catch / 重试。相关另一个 worktree `read-error-recovery` 已存在，后续实现时先协调，避免重复覆盖。
- 分页后删除最后一行或收窄筛选，回到存在的页；更改筛选回第一页；状态更新导致该行不再匹配时，以状态消息说明去向。

## 实际能力与限制（代码核查）

| 能力 | 当前实现 | 设计处理 |
| --- | --- | --- |
| 搜索 | 姓名、邮箱、电话，trim 后不区分大小写的单串 includes；无电话格式归一、词语拆分、拼音、备注、VIN 或车型搜索 | 保留准确 placeholder；不要暗示全局万能搜索 |
| Status | All、Active、Lost、Delivered、Closed (outcome unconfirmed)；显式 DELIVERED/CLOSED 阶段优先于旧布尔 status | 全部保留；“未确认结果关闭”与 Lost 不合并 |
| Stage | New、Contacted、Visited、Appointment、Test Drive、Negotiation、Delivered、Closed；trim / uppercase 标准化 | 全部保留，单选；不要伪造 Lost 阶段 |
| Trade-in | 关联置换车辆是否为 null | 仅 Yes/No，不支持置换车 make/model |
| Score | <50、50–79（含两端）、≥80；比较原始值，表格 Math.floor 显示 | 保留区间，不擅自把 80+ 重命名 Hot；业务优先级还有 55 / 100 / 130 等阈值和购买意向逻辑，含义并不一致。若评分可能为小数，79–80之间存在区间缺口，需产品与数据验证 |
| Vehicle interest | Year/Make/Model 自由输入及已有数据联想，substring 匹配；VW 与 Volkswagen 别名兼容；只看意向车，不看置换车 | 全部保留并标注 Vehicle interest；不擅自改成精确枚举 |
| 联动 | 年份缩小 Make；年份+Make 缩小 Model；清理失效下游值。联想来源为已加载 leads，不随 Status/Stage 等收窄 | 保持联动；不能把某个建议说成“此组合一定有结果” |
| 组合 | 不同字段 AND；每个字段单值 | 保留；多选 OR 是新增需求 |
| 状态可见性 | 数量在筛选卡底部；Clear Filters 仅有条件时出现；无条件标签 | 移至表格上方并加逐项移除 |
| 表格 | 九列，邮箱+电话两行；查看摘要/详情/编辑/删除；末尾 New Lead 为可拖动悬浮按钮 | 保留信息和操作，推荐把 New Lead 移至上方明确位置 |
| 排序/分页 | getAllLeads 按 lead_id 升序，readAllPages 每批请求至空页，hydrator 载入车辆并重算分数；filteredLeads 全部 map；无用户列表分页、排序、虚拟滚动 | 区分底层分批读取与用户分页。可先做客户端分页减少 DOM；不会减少初次下载量。服务端筛选/分页需另立数据范围与排序方案 |
| 持久化 | useState 本地，刷新/重挂载丢失；无 URL、已保存视图 | URL同步或保存视图待确认，不暗示已支持 |

主要证据：`components/leads/LeadTable.tsx`（筛选、联动、渲染）；`LeadTableRow.tsx`；`app/leads/page.tsx`；`components/ui/Autocomplete.tsx`；`domain/objects/LeadOutcome.ts`；`domain/business/ScoringService.ts`；`lib/persistence/real/supabase/LeadRepo.ts`、`LeadTableHydrator.ts`、`readAllPages.ts`；`components/layout/Sidebar.tsx`、`TopBar.tsx`、`components/auth/AuthGate.tsx`、`app/globals.css`。已有 UI 测试覆盖搜索、评分边界、AND、清空与终态优先级。

## 待确认的产品能力

1. 常用筛选是否以 Status / Stage 为首选，还是 Vehicle interest 更常用？缺少频率证据，当前是设计建议。
2. 是否增加手机号格式归一、车型纳入主搜索、多个词同时匹配？这些会改变搜索结果语义，应逐项决定。
3. 是否需要“待跟进 / 已逾期 / 未回复 / 最近联系”工作筛选？它们可能比 Score 更符合每日任务，但需要定义跟进日期、时区、回复来源与排除终态的规则，当前 Leads 列表没有这些筛选。
4. 评分继续数字区间，还是与业务优先级统一？不直接用现有 80+ 代表 Hot。
5. 是否需要状态/阶段多选、年份区间、无意向车型、置换车型、创建日期、保存视图或 URL 保留？均未在本轮默认新增。
6. 是否接受客户端分页（建议 25/50/100、默认25）以及可选排序（如最近联系/评分）？prototype 的分页只是审阅用。若目标是大数据性能，需服务端方案；不要把客户端分页宣传为解决网络加载性能。
7. 是否接受手机卡片列表及 New Lead 上移？这两处影响结果呈现和操作习惯，但没有删除现有功能。

## 后续验证边界

本轮不运行应用测试、不安装依赖、不连接 Supabase、不部署。设计演示已通过独立 headless Chrome 的 15 项行为检查：默认行数、邮箱大小写搜索、空结果清除、展开高级筛选、VW 别名、年份清理失效车型、AND 组合、折叠后标签和计数、单项清除保留其余条件、分页、筛选回第一页、手机列表、320px 折叠/展开无水平溢出、匹配数更新。另目视检查桌面、手机、最窄屏展开以及桌面已应用条件的截图。独立检查页没有加载宿主 Lucide/Tweak；正式预览仍使用宿主提供的图标和密度控件。键盘流程按本文规范设计，尚未完成整套辅助技术测试。现有工作区 `node_modules/next/dist/docs/` 不存在；若进入 Next.js 实现，先恢复匹配锁文件的依赖并读取所需 Next 16.4.4 本地指南，遵守 AGENTS.md，不能依靠旧版 Next API 经验。

实现确认后验收：1920×869、1366×768、1024×768、390×844、320px 宽、200% 缩放、展开侧栏、长姓名和长 Closed 文案、所有条件同时生效、车型依赖、无结果、加载失败、翻页删除与筛选归第一页、纯键盘及屏幕阅读器。保留现有测试断言代表的业务语义，并补有实际风险的行为验证。
