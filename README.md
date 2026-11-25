# SubLedger · 订阅与日常总账管家 (Local Web + CLI)

**SubLedger** 是一款支持**本地一键部署 + CLI 终端极速调取**的个人数字订阅、游戏氪金均摊与月度日常总账管理工具。本地运行时，网页端与 `subledger` 命令行实时共享本机私有账本（`~/.subledger/data.json`），无需登录、零隐私上云；同时也完美兼容 Netlify 无服务器一键部署。

---

## 核心特性

1. **CLI 一键唤起与终端极速查账 (`subledger`)**
   - 任意终端输入 `subledger` 即可自动在后台启动本地服务（若端口占用自动顺延）并打开可视化面板。
   - 无需打开浏览器，在命令行直接运行 `subledger stats` / `subledger ls` 查看月均与年化开销、近 14 天续费预警，或用 `subledger add` / `subledger topup` 一键记账。
2. **多币种实时汇率与首期/原价双轨核算**
   - 内置 `CNY`、`USD`、`PHP`、`HKD`、`JPY`、`EUR`、`GBP`、`SGD`、`TWD`、`TRY`、`INR` 等多币种实时外汇中间价同步（支持跨区如菲律宾区、美区、土区折算）。
   - 支持**首月特惠 + 次月恢复原价**双轨计算、多人家庭组拼车平摊、两年（720 天）/年付/季付/买断制全周期折算。
3. **单次消费与游戏氪金按月均摊**
   - 卡片内置 **`+氪金` / `+加购`** 挂载功能：例如游戏 `¥648` 礼包可均摊到当月（或 `2/3/6/12` 个月），期满自动归零，不污染后续固定月卡预测。
4. **独立「月度日常总账」与智能渠道防重**
   - 月底支持上传或 `Ctrl+V` 粘贴**微信支付 / 支付宝月度账单统计截图**，AI 自动提取餐饮、购物、交通等分类金额，并自动剥离已记入订阅仓的重合扣款（防止算双倍）。
5. **AI 截图智能填表 & 订阅者人格画像点评**
   - 粘贴会员中心或扣款截图即可自动识别名称、价格、币种与到期时间；支持一键生成「深度画像」与「毒舌锐评」双模式账单点评。

---

## 本地安装与一键启动

> 环境要求：**Node.js >= 18**

```bash
# 1. 克隆仓库并安装依赖
git clone https://github.com/zianxu78-ux/subledger.git
cd subledger
npm install

# 2. 全局链接 CLI 命令（此后在任意终端目录均可直接输入 subledger）
npm link

# 3. 一键后台启动服务并打开浏览器面板（默认 http://127.0.0.1:4780）
subledger
```

也可以免克隆直接通过 `npx` 运行：

```bash
npx github:zianxu78-ux/subledger
```

---

## CLI 命令行速查手册

| 命令 | 说明 |
| :--- | :--- |
| `subledger` | 后台启动本地服务并在默认浏览器打开可视化面板（已运行则直接秒开） |
| `subledger serve [--port 4780]` | 在前台运行本地 Web 与 API 服务 |
| `subledger stop` | 停止后台运行的本地服务进程 |
| `subledger stats` | 终端查看月均/年化总支出、预算进度、本月现金流与近 14 天续费预警 |
| `subledger ls [--all] [--json]` | 终端对齐表格列出全部生效订阅、跨币种月均折算与到期天数 |
| `subledger add <名称> [选项]` | 终端快速添加订阅（自动匹配常见预设，如 `subledger add "Claude Pro" --price 20 --currency USD`） |
| `subledger topup <名称> <金额>` | 为已有卡片挂载单次氪金/加购（如 `subledger topup 明日方舟 648 --title "周年礼包" --months 1`） |
| `subledger rates` | 立即拉取最新国际外汇中间价并更新本地账本 |
| `subledger export [--csv] [路径]` | 导出完整 JSON 备份文件或 Excel 兼容（UTF-8 BOM）CSV 表格 |
| `subledger import <备份.json>` | 从 JSON 备份文件恢复订阅与日常月账单记录 |
| `subledger config [选项]` | 查看或设置本地配置（如 `subledger config --gemini-key <API_KEY> --port 4780`） |

---

## 开启本地 AI 识图与账单点评（可选）

如果需要在线下本地服务中使用 **AI 截图自动填表**、**微信/支付宝月账单识图** 与 **AI 订阅者画像点评**，只需配置 Google Gemini API Key：

```bash
subledger config --gemini-key "AIzaSy..."
```

（也可在项目根目录创建 `.env` 文件填入 `GEMINI_API_KEY=...`，详见 `.env.example`。）

---

## 数据存储与隐私说明

- **本地部署模式（`subledger` CLI + 本地网页）**：所有个人订阅与账单数据仅保存在本机用户目录 `~/.subledger/data.json`（Windows 下为 `C:\Users\<用户名>\.subledger\data.json`），与代码仓库完全隔离，网页端与 CLI 实时双向同步。
- **静态云端托管模式（如 Netlify）**：数据仅保存在访问者各自的浏览器 `localStorage` 中，云端不存储任何个人账单数据。

---

## 目录结构

```text
subledger/
├── bin/
│   └── subledger.mjs          # CLI 命令行入口（守护进程管理、终端看板、快捷录入）
├── src/
│   ├── server.mjs             # 零额外框架依赖的本地 HTTP + Serverless 函数宿主服务
│   ├── store.mjs              # ~/.subledger 本地原子化数据存储与环境配置引擎
│   └── metrics.mjs            # 跨币种周期折算、单次均摊与月度现金流核心计算模块
├── public/
│   ├── index.html             # 双账本 Web 界面（订阅与氪金账本 + 月度日常总账）
│   ├── styles.css             # 响应式浅色/深色双主题样式
│   ├── app.js                 # 前端交互、图表日历渲染与本地服务双向同步引擎
│   ├── presets.js             # 软件预设模板、分类、币种与示例数据
│   └── logos.js               # 品牌高清图标解析器
├── netlify/functions/         # Web 标准 Serverless API（本地 Node 与 Netlify 双端复用）
│   ├── live-rates.mjs         # 实时外汇中间价接口 (/api/rates)
│   ├── app-icon.mjs           # 官方应用图标搜索接口 (/api/app-icon)
│   ├── parse-screenshot.mjs   # 订阅截图视觉识别接口 (/api/parse-screenshot)
│   ├── parse-monthly-bill.mjs # 微信/支付宝月结单视觉解析接口 (/api/parse-monthly-bill)
│   └── ai-review.mjs          # AI 订阅者人格画像与毒舌锐评接口 (/api/ai-review)
├── netlify.toml               # Netlify 云端部署配置
└── package.json
```

## License

MIT
