# ComfyUI 系统内置工作流

本项目全面采用**原生 ComfyUI API 直连架构**，浏览器直接连接本地或局域网 ComfyUI（默认地址 `http://127.0.0.1:8188`）。

系统当前内置 7 类工作流，共 9 份唯一 API JSON。`QRw_D.json` 同时注册到文生图和图生图分类，因此渠道工作流列表中共有 10 个内置条目；图片节点选择器会按 Profile 去重，只显示一次。

## 内置工作流清单

| 分类 | 工作流 | 文件 | 输入能力 |
| :--- | :--- | :--- | :--- |
| 文生图 | Qwen Image 全能生图 | [`1_t2i/QRw_D.json`](./workflows/1_t2i/QRw_D.json) | 纯文生图，也支持 1~9 张参考图 |
| 文生图 | Moss Image 文生图 | [`1_t2i/moss_image.json`](./workflows/1_t2i/moss_image.json) | 纯文生图，不接收参考图 |
| 文生图 | Z-Image-Turbo 文生图 | [`1_t2i/z_image_turbo_api.json`](./workflows/1_t2i/z_image_turbo_api.json) | 纯文生图，不接收参考图 |
| 图生图 | Qwen Image 全能生图 | [`2_i2i/QRw_D.json`](./workflows/2_i2i/QRw_D.json) | 与文生图共用同一 Profile 和 JSON，最多 9 张参考图 |
| 图生图 | Qwen Image 4×4 图生图 | [`2_i2i/QRw_4×4.json`](./workflows/2_i2i/QRw_4×4.json) | 必须连接 1 张参考图 |
| 文本生成 / 反推 | Qwen3.5 文本生成与反推 | [`4_text/qwen3_5_text_api.json`](./workflows/4_text/qwen3_5_text_api.json) | 本地文本生成、提示词扩写与视觉反推 |
| 全能参考视频 | MiniMax H3 MS_V10 | [`5_omni_video/MS_V10.json`](./workflows/5_omni_video/MS_V10.json) | 最多 9 图 + 3 视频 + 3 音频，SelfLift 渐进式潜空间超分 |
| 视频深度估计 | ReShot 深度视频提取 | [`7_depth_video/depth_video_api.json`](./workflows/7_depth_video/depth_video_api.json) | 从参考视频提取时序连续深度视频 |
| 音乐与音频 | MiniMax Music 03 | [`10_audio/audio_minimax_music_3_api.json`](./workflows/10_audio/audio_minimax_music_3_api.json) | 风格描述与歌词双文本驱动音乐生成 |
| 视频人脸精修 | MiniMax H3 Face Refine | [`11_h3_face_refine/H3_Face_Refine_Auto_Select_Api.json`](./workflows/11_h3_face_refine/H3_Face_Refine_Auto_Select_Api.json) | 原视频、角色参考图与提示词驱动的人脸追踪精修 |

## 目录结构

```text
Comfy/Comfy-Api/
├── README.md
└── workflows/
    ├── 1_t2i/
    │   ├── QRw_D.json
    │   ├── moss_image.json
    │   └── z_image_turbo_api.json
    ├── 2_i2i/
    │   ├── QRw_D.json
    │   └── QRw_4×4.json
    ├── 4_text/qwen3_5_text_api.json
    ├── 5_omni_video/MS_V10.json
    ├── 7_depth_video/depth_video_api.json
    ├── 10_audio/audio_minimax_music_3_api.json
    └── 11_h3_face_refine/H3_Face_Refine_Auto_Select_Api.json
```

前端内置资产位于 `web/src/assets/workflows/`，手册下载副本位于 `web/public/workflows/`。系统只提供当前实际使用的 API JSON，不再保留旧 Flux、Inpaint、首尾帧及多档 FP8/INT8 视频工作流。

## 工作流管理规则

- 内置和自定义工作流均可在「工作流管理」中删除，删除会同步到全部 ComfyUI 渠道。
- 已删除的内置工作流会记录删除标记，刷新页面或重新合并默认配置时不会复活。
- 图片、视频、音频和文本节点使用所选渠道的真实工作流列表，以单层菜单展示。
- 渠道工作流列表为空时显示「暂无工作流」并禁止生成，不回退到旧 Profile、旧模型或其他渠道字段。
- 节点参数仍由工作流实际槽位驱动；未标记或工作流不支持的参数不会显示。

## 运行核心插件清单

### 6 大通用基础插件

| 插件 | 仓库 | 主要用途 |
| :--- | :--- | :--- |
| Comfyui-kktools | `https://github.com/zhiwendesign/Comfyui-kktools` | 文本生成、提示词扩写与反推 |
| ComfyUI-KJNodes | `https://github.com/kijai/ComfyUI-KJNodes` | 全能视频与人脸精修的音视频组件处理 |
| ComfyLiterals | `https://github.com/M1kep/ComfyLiterals` | 全能视频与音乐工作流的基础字面量 |
| ComfyUI-UniversalToolkit | `https://github.com/whmc76/ComfyUI-UniversalToolkit` | 通用工具与参数桥接 |
| ComfyUI_LayerStyle | `https://github.com/chflame163/ComfyUI_LayerStyle` | 图像与遮罩处理 |
| comfyui-SelfLift | `https://github.com/facok/comfyui-SelfLift` | MS_V10 的 `SelfLiftH3Sampler` 渐进式潜空间超分 |

### 专用与进阶插件

- ReShot：`https://github.com/maosika-ai/ComfyUI-ReShot`
- ComfyUI-H3-FaceRefine：`https://github.com/Carasibana/ComfyUI-H3-FaceRefine`
- ComfyUI-MiniMaxH3-Myang：`https://github.com/civilcoco/ComfyUI-MiniMaxH3-Myang`
- ComfyUI-VideoHelperSuite：`https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite`

### 一键克隆命令

在 ComfyUI 的 `custom_nodes/` 目录执行：

```bash
git clone https://github.com/zhiwendesign/Comfyui-kktools.git
git clone https://github.com/kijai/ComfyUI-KJNodes.git
git clone https://github.com/M1kep/ComfyLiterals.git
git clone https://github.com/whmc76/ComfyUI-UniversalToolkit.git
git clone https://github.com/chflame163/ComfyUI_LayerStyle.git
git clone https://github.com/facok/comfyui-SelfLift.git

# 深度视频与人脸精修按需安装
git clone https://github.com/maosika-ai/ComfyUI-ReShot.git
python -m pip install -r ComfyUI-ReShot/requirements.txt
git clone https://github.com/Carasibana/ComfyUI-H3-FaceRefine.git
git clone https://github.com/civilcoco/ComfyUI-MiniMaxH3-Myang.git
git clone https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite.git
```

> 详细说明与排错请参考 [docs/COMFYUI_PLUGINS.md](../../docs/COMFYUI_PLUGINS.md)。各工作流的模型文件名与存放目录以 JSON 实际配置和「用户使用手册」为准。
