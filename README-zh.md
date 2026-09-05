# VocaVoid（中文文档）

> 一个**带 Web 控制台的 VF 音乐编辑器**，基于 **VocaForge 0.4.2**（后端合成引擎）与 **Harvey UI**（前端框架）构建。
> [English](./README.md)

在钢琴卷帘上作曲、为每个音符填词、选择声库（`.vfvp`），即可在浏览器里一键合成歌唱音频。
VocaVoid 以**VV + VF 同时运行**的方式作为一个整体启动。

---

## 功能特性

- **钢琴卷帘编辑器** — 单击放置音符、拖拽移动、拖右缘改时长、双击编辑歌词。
- **逐音符歌词** — 每个音符自带音节/字词，用于歌唱合成。
- **声库选择** — 从已注册的 `.vfvp` 声库或内置 `stub-zh` 测试声库中选择。
- **一键合成** — 将歌曲发送给 VocaForge，并把 WAV 写入 `wav/`。
- **工程持久化** — 歌曲以 JSON 形式保存在 `projects/`。
- **暗色合成器工作室 UI**，附带浅色主题，由 Harvey UI 组件构建。
- **零重依赖** — VV 后端为纯 Python 标准库；VocaForge 的 stub 后端无需任何模型即可合成。

## 技术栈

| 层 | 技术 |
|----|------|
| 后端合成引擎 | [VocaForge 0.4.2](https://github.com/Developerprit/VocaForge)（`/api/v1` REST 网关） |
| 控制台后端 | `vv_server.py` — 标准库 `http.server`（静态资源 + `/vv/api/v1` + 合成代理） |
| 前端 | [Harvey UI](https://harveyui.rth1.xyz)（`<hui>` 组件）+ Canvas 钢琴卷帘 |
| 启动器 | `run.py` — 同时启动 VV 与 VF |
| 图标 | `VV_icon.png` |

## 快速开始

```bash
# 在 VocaVoid 目录下
python run.py
# 控制台 -> http://127.0.0.1:8000
# VocaForge -> http://127.0.0.1:8080/api/v1
```

环境要求：Python 3.9+。核心流程无需 `pip install`（内置 `stub-zh` 声库即可合成）。

> 若要使用真实的 `.vfvp` 声库，需要 `py7zr`：
> `pip install py7zr`（安装到你的受管虚拟环境）。

## 工作原理

```
浏览器（Harvey UI 控制台 + Canvas 钢琴卷帘）
        │  /vv/*
        ▼
VocaVoid 后端 :8000  ── 合成代理 ──▶  VocaForge 网关 :8080  (/api/v1)
        │                                      │  import vocaforge
   projects/  vfvp/  wav/                      ▼  DiffSinger / StubBackend
```

- **VV** 托管控制台并存储歌曲（`projects/*.json`）。
- **VF**（VocaForge）提供合成（`/api/v1/synth`）与声库注册。
- 合成请求以服务端对服务端方式代理，浏览器只与 VV 通信。

### 数据目录

| 路径 | 用途 |
|------|------|
| `vfvp/`   | 声库 `.vfvp` 包（把声库放这里） |
| `wav/`    | 生成的歌唱 WAV 文件 |
| `projects/` | VocaVoid 歌曲工程（JSON） |

## API（VocaVoid）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/vv/api/v1/health` | VV 存活 + VF 连通性 |
| GET/POST | `/vv/api/v1/projects` | 列出 / 新建歌曲 |
| GET/PUT/DELETE | `/vv/api/v1/projects/{id}` | 读取 / 保存 / 删除歌曲 |
| GET | `/vv/api/v1/voicebanks` | 聚合已注册 + 本地 `.vfvp` |
| POST | `/vv/api/v1/voicebanks/register` | 将本地 `.vfvp` 注册进 VocaForge |
| POST | `/vv/api/v1/projects/{id}/synth` | 合成 → `wav/` 中的 WAV |
| GET | `/vv/wav/{file}` | 流式返回生成的 WAV |

## 目录结构

```
VocaVoid/
├── run.py              # 启动器（VV + VF）
├── vv_server.py        # VocaVoid 后端
├── frontend/
│   ├── index.html      # Harvey UI 控制台
│   ├── hui.js          # Harvey UI 引擎（本地副本）
│   ├── css/theme.css   # 暗色合成器工作室设计系统
│   ├── components/     # .hui 外壳（Header / Sidebar / Transport）
│   ├── js/api.js       # VV API 客户端
│   ├── js/pianoroll.js # Canvas 钢琴卷帘引擎
│   └── js/app.js       # 控制台控制器
├── vfvp/  wav/  projects/
├── LICENSE
└── index.html          # 公开落地页
```

## 许可证

[Available License](https://license.kscm.top/available.md) · © 2026 kscm（初陌 / Developer-prit）
