# VocaVoid1 — VF 音乐编辑器 · 技术规划 (Planning)

> Status: Draft v1 · 2026-09-05
> Owner: 小织 (Weave) for 陌老师
> License: Available License (https://license.kscm.top/available.md)

---

## 1. 项目定义 (Definition)

**VocaVoid1** 是一个**带 Web 控制台的 VF 音乐编辑器**（不是声库打包器）。
它以 [VocaForge 0.4.2](E:/PC/VocaForge) 为后端合成引擎，用
[Harvey UI](E:/php/Harvey UI/hui.js) 构建控制台前端，让用户在浏览器里作曲、
填词、选声库并一键合成歌唱音频。

| 项 | 值 |
|----|----|
| 类型 | Web 音乐编辑器 + 控制台前端 |
| 后端框架 | VocaForge 0.4.2 (pure Python, `/api/v1` REST 网关) |
| 前端框架 | Harvey UI (`<hui src>` 组件引擎) |
| 图标 | `VV_icon.png` |
| 运行方式 | **VV + VF 同时运行**（一个启动器拉起两个进程） |
| 声库存放 | `VocaVoid/vfvp/*.vfvp` |
| 合成结果 | `VocaVoid/wav/*.wav` |
| 工程存放 | `VocaVoid/projects/*.json` |
| 视觉方向 | 暗色合成器工作室 (Dark Synth Studio) + 浅色双主题 |

---

## 2. 架构 (Architecture)

```
┌─────────────────────────────────────────────┐
│  Browser  (Harvey UI 控制台 + Canvas 钢琴卷帘) │
└───────────────┬───────────────┬─────────────┘
                │  /vv/*         │  (可选直连, 已禁用)
                ▼                ▼
        ┌──────────────┐   ┌──────────────────────┐
        │  VV Server   │   │  VF Gateway (VocaForge)│
        │  :8000       │──▶│  :8080  /api/v1        │
        │  (VocaVoid)  │   │  (vf-cli api)          │
        │  - 静态前端   │   │  - models 注册/列表     │
        │  - 工程 CRUD  │   │  - synth → WAV         │
        │  - 合成代理    │   └──────────┬───────────┘
        │  - wav 服务    │              │ import vocaforge
        └──────┬───────┘              ▼
               │              DiffSinger / StubBackend
               ▼
        projects/  vfvp/  wav/
```

- **VF（VocaForge 网关）**：由 `python E:/PC/VocaForge/vf_cli.py api --host 127.0.0.1 --port 8080`
  启动，提供标准 `/api/v1`（health/version/models/synth…），CORS `*`。
- **VV（VocaVoid 后端）**：自写纯标准库 `vv_server.py`，托管前端 + 音乐工程 API，
  并把合成请求代理给 VF 网关（server-to-server），浏览器只与 VV 通信。
- **run.py**：编排器，先后启动 VF、VV，捕获 Ctrl-C 同时关闭两者。

---

## 3. 数据模型 (Data Model)

### 3.1 歌曲工程 (Song Project) — VocaVoid 自管
`projects/<id>.json`
```json
{
  "id": "uuid",
  "name": "未命名歌曲",
  "tempo_bpm": 100,
  "transpose": 0,
  "model_id": "stub-zh",
  "grid": 0.25,
  "notes": [
    { "id":"n1", "midi": 60, "start": 0.0, "duration": 0.5, "lyric": "你" }
  ],
  "created_at": "...", "updated_at": "..."
}
```
- 编辑器以**秒**为时间单位（直接映射到 VocaForge `Note.duration`）。
- `midi<=0` 表示休止符（VocaForge `Note` 约定）。
- `grid` 为吸附粒度（拍的分数，默认 1/4 拍）。

### 3.2 声库 (Voicebank)
- 文件形态：`.vfvp`（VocaForge 标准 7z 包，含 `info.json` / `phoneme_map.json` / `model/`）。
- 注册：VV 把 `vfvp/*.vfvp` 路径 `POST /api/v1/models {path}` 到 VF，VF 读 `info.json` 自动建 spec。
- 默认内置 `stub-zh`（无需模型即可合成，用于即时试听）。

---

## 4. API 契约 (API Contract)

### VV 自有接口 `/vv/api/v1`
| Method | Path | 说明 |
|--------|------|------|
| GET | `/vv/api/v1/health` | VV 存活 + VF 连通性 |
| GET | `/vv/api/v1/projects` | 列出工程（摘要） |
| POST | `/vv/api/v1/projects` | 新建工程 |
| GET | `/vv/api/v1/projects/{id}` | 读取工程 |
| PUT | `/vv/api/v1/projects/{id}` | 保存工程（notes/tempo/transpose/model…） |
| DELETE | `/vv/api/v1/projects/{id}` | 删除工程 |
| GET | `/vv/api/v1/voicebanks` | 聚合：VF 已注册模型 + 本地 `vfvp/*.vfvp` |
| POST | `/vv/api/v1/voicebanks/register` | 注册本地 `.vfvp` 到 VF |
| POST | `/vv/api/v1/projects/{id}/synth` | 转序列后代理 VF `/api/v1/synth`，WAV 落 `wav/`，返回播放 URL |
| GET | `/vv/wav/{file}` | 静态服务生成的 WAV |

### 合成转换 (Synth mapping)
前端音符（可能带任意 start/重叠）→ VocaForge `SynthProject`（**严格顺序、单声部**）：
1. 按 `start` 升序排序；
2. `cursor=0`；每遇到 `note.start>cursor` 插入休止 `Note(midi=0, duration=gap)`；
3. 依次压入音符；`cursor = note.start + note.duration`；
4. 重叠音符忽略（歌唱为单声部）。

---

## 5. 前端结构 (Frontend)

```
frontend/
├── index.html              # Harvey UI 页面：外壳 <hui> + #pianoroll 容器 + 应用挂载
├── css/theme.css          # 设计系统（暗色合成器工作室 / 浅色），CSS 变量，动效
├── components/             # .hui 组件（均以 <is harvey> 开头，禁止嵌套 <hui>）
│   ├── Header.hui         # 图标 + 标题 + 主题切换 + VF 状态灯
│   ├── Sidebar.hui        # 工程列表 + 新建按钮
│   ├── Transport.hui      # 速度/移调/声库选择/合成保存/清空
│   ├── VoicebankCard.hui  # 声库卡片
│   └── ProjectItem.hui    # 侧栏工程项
├── js/
│   ├── api.js             # VV/FV fetch 封装
│   ├── pianoroll.js       # Canvas 钢琴卷帘编辑器
│   └── app.js             # SPA 控制器 / 状态 / 事件
└── assets/VV_icon.png     # 项目图标（复制自根目录）
```

**关键决策**：Harvey UI 用于**静态外壳组件**（Header/Sidebar/Transport/卡片），
动态列表（工程项、音符属性、钢琴卷帘）用原生 JS DOM + Canvas 渲染——
因为 Harvey UI 的占位符模型要求全局唯一 id，不适合海量动态实例。
`.hui` 样式统一引用 `theme.css` 的全局 CSS 变量，保证双主题一致。

### 钢琴卷帘 (核心体验)
- 纵向 = 音高轨（约 C3–C6，带八度分隔线）；横向 = 时间轴（拍线 + 细分线）。
- 交互：空白点击=加音符；拖拽音符体=移动音高/时间；拖右缘=改时长；双击=编辑歌词；Delete=删除。
- 网格吸附（1/4 拍）；播放头动画。
- 选中音符在侧栏/弹层显示并编辑其歌词、音高、时长。

### 视觉规范 (Impeccable — Dark Synth Studio)
- 底色近黑暖灰（非纯黑）：`--bg:#0d0e10`；面板 `#16181c`；描边 `#262a31`。
- 文字暖白 `#e7e3da`，次要 `#9aa0a8`。
- 主强调 **studio amber** `#ff7a45`；次强调 teal `#38d6c0`（避免蓝/紫 AI 配色）。
- 字体：展示用 `Space Grotesk`，技术读数用 `JetBrains Mono`（Google Fonts + 系统回退）。
- 动效：`cubic-bezier(.16,1,.3,1)`（ease-out-quart）做状态过渡；无回弹/弹性。
- 浅色主题：暖纸 `#f4f1ea` 底、白面板、同强调色降饱和以保证对比。

---

## 6. 运行与交付 (Run & Deliver)

- `run.py` 一条命令启动：`python run.py` → 打开 `http://127.0.0.1:8000`。
- 依赖：仅 Python 标准库（VV）；VocaForge 自带零依赖核心；**真实 `.vfvp` 加载需 `py7zr`**
  （`pip install py7zr`，装到受管 venv），Stub 合成无需。
- 交付物：`README.md`(+`README-zh.md` 链接)、`README-zh.md`、`LICENSE`、`index.html`(公开落地页)、
  代码可用性自检、GitHub 上传（先认证 `Developerprit/VocaVoid1` 存在性）。

---

## 7. 风险与对策 (Risks)
| 风险 | 对策 |
|------|------|
| VocaForge 无"工程存储"，仅合成/注册 | VocaVoid 自管 `projects/*.json` |
| VocaForge `Note` 无 start、单声部 | 编辑器转顺序序列 + 休止填充，重叠忽略 |
| `.vfvp` 需 py7zr | 预装到受管 venv；Stub 兜底试听 |
| Harvey UI 全局 id 冲突 | 静态外壳用 HUI，动态/列表用原生 JS |
| 双进程生命周期 | run.py 统一拉起/关闭，SIGINT 级联终止 |
