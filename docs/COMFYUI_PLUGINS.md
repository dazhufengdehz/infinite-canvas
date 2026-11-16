# Infinite Canvas · ComfyUI 核心依赖插件全景说明与安装指南

本文档将本项目所有官方工作流所依赖的 **6 大 ComfyUI 核心扩展插件** 进行统一集中整理与深度说明，提供一键安装命令、工作流对应矩阵、关键节点解析与常见排错方法。

---

## 1. 核心插件速查清单

运行 Infinite Canvas 官方预置的 7 类共 9 份 API 工作流，需在 ComfyUI 的 `custom_nodes/` 目录下安装以下 6 个核心插件：

| 序号 | 插件名称 | GitHub 仓库地址 | 维护作者 | 依赖此插件的工作流 | 核心功能 / 关键节点 |
| :---: | :--- | :--- | :--- | :--- | :--- |
| **1** | **Comfyui-kktools** | [`zhiwendesign/Comfyui-kktools`](https://github.com/zhiwendesign/Comfyui-kktools) | zhiwendesign | **文本生成 / 反推** (`qwen3_5_text_api.json`) | 端侧大语言模型多模态文本生成、提示词润色扩写与反推 (`kkSomethingToAny`) |
| **2** | **ComfyUI-KJNodes** | [`kijai/ComfyUI-KJNodes`](https://github.com/kijai/ComfyUI-KJNodes) | kijai | **人脸精修** (`H3_Face_Refine_Auto_Select_Api.json`) | 高级逻辑流控制、多模态音视频组件解包提取 (`SetNode`, `GetVideoComponents`) |
| **3** | **ComfyLiterals** | [`M1kep/ComfyLiterals`](https://github.com/M1kep/ComfyLiterals) | M1kep | **QRw 图像、MS_V10 视频与音乐生成** | 基础字面量常数与参数暴露端口 (`Int`, `Float`, `String`, `Boolean`) |
| **4** | **ComfyUI-UniversalToolkit** | [`whmc76/ComfyUI-UniversalToolkit`](https://github.com/whmc76/ComfyUI-UniversalToolkit) | whmc76 | **文本生成 / 反推** (`qwen3_5_text_api.json`) | 通用数据类型转换工具箱与多类型参数转接桥接 (`ShowAny_UTK`) |
| **5** | **ComfyUI_LayerStyle** | [`chflame163/ComfyUI_LayerStyle`](https://github.com/chflame163/ComfyUI_LayerStyle) | chflame163 | **自定义局部编辑与遮罩工作流** | 图层样式合成与局部重绘遮罩处理 (`LayerMask: MaskPreview`, `LayerMask: MaskGrow`) |
| **6** | **comfyui-SelfLift** | [`facok/comfyui-SelfLift`](https://github.com/facok/comfyui-SelfLift) | facok | **MS_V10 全能参考视频** (`MS_V10.json`) | MiniMax H3 渐进式潜空间超分采样器 (`SelfLiftH3Sampler`)，结合 3D 卷积潜空间模型打破显存瓶颈 |

---

## 2. 一键安装命令

打开终端进入你的 ComfyUI 根目录下的 `custom_nodes/` 文件夹执行以下命令：

### Linux / macOS / AutoDL 云主机

```bash
cd custom_nodes
git clone https://github.com/zhiwendesign/Comfyui-kktools.git
git clone https://github.com/kijai/ComfyUI-KJNodes.git
git clone https://github.com/M1kep/ComfyLiterals.git
git clone https://github.com/whmc76/ComfyUI-UniversalToolkit.git
git clone https://github.com/chflame163/ComfyUI_LayerStyle.git
git clone https://github.com/facok/comfyui-SelfLift.git
```

### Windows (PowerShell)

```powershell
cd custom_nodes
git clone https://github.com/zhiwendesign/Comfyui-kktools.git
git clone https://github.com/kijai/ComfyUI-KJNodes.git
git clone https://github.com/M1kep/ComfyLiterals.git
git clone https://github.com/whmc76/ComfyUI-UniversalToolkit.git
git clone https://github.com/chflame163/ComfyUI_LayerStyle.git
git clone https://github.com/facok/comfyui-SelfLift.git
```

> ⚠️ **提示**：克隆完成后，**必须完全重启 ComfyUI** 服务，新节点才会注册加载到 ComfyUI 运行环境中。

---

## 3. 工作流与依赖插件对应关系矩阵

| 官方工作流文件 | 工作流名称 | kktools | KJNodes | ComfyLiterals | UniversalToolkit | LayerStyle | comfyui-SelfLift |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| `QRw_D.json` | Qwen Image 全能生图（T2I / I2I） | - | - | ✅ | - | - | - |
| `QRw_4×4.json` | Qwen Image 4×4 图生图 | - | - | ✅ | - | - | - |
| `moss_image.json` | Moss Image 文生图 | - | - | ✅ | - | - | - |
| `z_image_turbo_api.json` | Z-Image-Turbo 文生图 | - | - | - | - | - | - |
| `qwen3_5_text_api.json` | 文本生成 / 反推 | ✅ | - | - | ✅ | - | - |
| `MS_V10.json` | MiniMax H3 全能参考视频 | - | - | ✅ | - | - | ✅ |
| `depth_video_api.json` | ReShot 深度视频提取 | - | - | - | - | - | - |
| `audio_minimax_music_3_api.json` | MiniMax Music 03 音乐生成 | - | - | ✅ | - | - | - |
| `H3_Face_Refine_Auto_Select_Api.json` | MiniMax H3 人脸精修 | - | ✅ | - | - | - | - |

> 💡 **说明**：
> - `QRw_D`、`QRw_4×4`、`moss_image` 与 `MS_V10` 使用 `ComfyLiterals` 暴露尺寸或时长参数；音乐生成使用该插件的 `Float` 节点暴露时长。
> - **文本生成/反推**依靠 `kktools` + `UniversalToolkit` 驱动本地轻量端侧大模型。
> - **MS_V10** 使用 `comfyui-SelfLift` 进行渐进式超分去噪采样；**人脸精修**使用 `KJNodes` 解包视频组件。
> - 深度视频与人脸精修还需安装使用手册中列出的专用扩展；`LayerStyle` 用于自定义局部重绘和遮罩工作流。

---

## 4. 插件深度解析与工作原理

### 4.1 Comfyui-kktools
- **仓库**：`https://github.com/zhiwendesign/Comfyui-kktools`
- **核心功能**：端侧轻量化 LLM（如 Qwen3.5-4B / 7B）在 ComfyUI 中的多模态文本生成、提示词润色扩写与画面反推。
- **关键节点**：`kkSomethingToAny`
- **作用机制**：
  在无限画布中，用户可在文本生成节点输入文字或连接参考图片。`kkSomethingToAny` 负责将多模态大语言模型的输出解析转换为系统下游节点统一接受的文本与数据结构，支持流式与单次完整产物输出。

### 4.2 ComfyUI-KJNodes
- **仓库**：`https://github.com/kijai/ComfyUI-KJNodes`
- **核心功能**：高级工作流控制流、逻辑分支与多模态音视频组件解包。
- **关键节点**：`SetNode`、`GetNode`、`GetVideoComponents`
- **作用机制**：
  人脸精修工作流通过 `GetVideoComponents` 解包输入视频的画面与音频组件，供人脸追踪、逐帧修复和结果合成使用。
  - **动态级联修剪配合**：自定义视频工作流若使用 KJNodes 桥接未连满的参考输入，无限画布会在提交前自动抹除未连线的参考输入及其对应级联节点，杜绝 ComfyUI 因悬挂空引用而报 `FileNotFoundError`。

### 4.3 ComfyLiterals
- **仓库**：`https://github.com/M1kep/ComfyLiterals`
- **核心功能**：提供原生的基础类型常数（Integer、Float、String、Boolean）输入端口。
- **关键节点**：`Int`、`Float`
- **作用机制**：
  用于在工作流中以原生槽位形式暴露动态参数（例如 `_meta.title = "width"`、`_meta.title = "height"`、`_meta.title = "duration"`）。无限画布前端解析到这些槽位后，会按模型能力展示硬件对齐的 12 档视频尺寸与预设时长控件，提交时将数值直接注入到 Literal 节点中。

### 4.4 ComfyUI-UniversalToolkit
- **仓库**：`https://github.com/whmc76/ComfyUI-UniversalToolkit`
- **核心功能**：多类型通用数据转换、桥接与数据流查看工具箱。
- **关键节点**：`ShowAny_UTK`
- **作用机制**：
  在文本生成与多模态反推工作流中，用于桥接大模型输出的文本并传递给系统保存节点，确保前端能够通过 `/history` 接口完整抓取生成的文本内容。

### 4.5 ComfyUI_LayerStyle
- **仓库**：`https://github.com/chflame163/ComfyUI_LayerStyle`
- **核心功能**：图层样式合成、遮罩预处理、边缘羽化与反转。
- **关键节点**：`LayerMask: MaskPreview`、`LayerMask: MaskGrow`
- **作用机制**：
  在自定义局部遮罩工作流中，前端可将用户涂抹的白色 Mask 图片上传并绑定到 `ref_mask` 槽位。`ComfyUI_LayerStyle` 节点负责将遮罩与原图进行尺寸校验、图层对齐与预处理，确保 ControlNet 与重绘采样器精准作用于目标区域。

### 4.6 comfyui-SelfLift
- **仓库**：`https://github.com/facok/comfyui-SelfLift`
- **核心功能**：MiniMax H3 渐进式潜空间超分去噪采样器。
- **关键节点**：`SelfLiftH3Sampler`
- **作用机制**：
  在 MS_V10 全能参考视频工作流中担任采样器。前期在低分辨率潜空间快速构建主体结构与大动态，随后通过 `MiniMax-H3/minimax_h3_latent_upscaler_3d_conv_v1_fp16.safetensors` 进行 3D 卷积超分，跃升至全分辨率精修，打破高分辨率视频生成的显存瓶颈。

---

## 5. 两种安装方式指引

### 方式一：终端 Git Clone（推荐，最快捷稳定）
1. 确认系统已安装 `git` 工具；
2. 打开终端，执行 `cd <ComfyUI根目录>/custom_nodes`；
3. 复制上方第 2 节的 6 条克隆命令并回车执行；
4. 检查每个插件目录下是否存在 `requirements.txt`。若有且缺少依赖，执行对应环境的 `pip install -r requirements.txt`；
5. 重启 ComfyUI。

### 方式二：通过 ComfyUI-Manager 界面安装
1. 打开 ComfyUI 网页界面；
2. 点击右侧悬浮菜单中的 **Manager**；
3. 点击 **Custom Nodes Manager**；
4. 在搜索框中分别搜索以下关键词并点击 **Install**：
   - `kktools` ➔ 找到 **Comfyui-kktools**
   - `KJNodes` ➔ 找到 **ComfyUI-KJNodes**
   - `ComfyLiterals` ➔ 找到 **ComfyLiterals**
   - `UniversalToolkit` ➔ 找到 **ComfyUI-UniversalToolkit**
   - `LayerStyle` ➔ 找到 **ComfyUI_LayerStyle**
   - `SelfLift` ➔ 找到 **comfyui-SelfLift**
5. 点击 Manager 弹窗下方的 **Restart** 重启 ComfyUI 服务。

---

## 6. 常见问题与排错（FAQ）

### 6.1 导入工作流提示 `When loading the graph, the following node types were not found`
- **原因**：缺少对应插件，或者插件已克隆但未重启 ComfyUI。
- **排查步骤**：
  1. 查看红字提示中缺失的节点类型（例如 `SelfLiftH3Sampler` 代表缺少 `comfyui-SelfLift`，`SetNode` 代表缺少 `ComfyUI-KJNodes`，`ShowAny_UTK` 代表缺少 `UniversalToolkit`）；
  2. 确认 `custom_nodes/` 目录下对应插件文件夹是否完整存在；
  3. 查看 ComfyUI 终端启动日志，确认启动时是否有该插件的 `ImportError`（若有说明缺少 Python 依赖库，需 `pip install` 对应依赖）；
  4. 重启 ComfyUI 后刷新网页重新导入。

### 6.2 国内网络下 Git Clone 超时失败
- 可使用 GitHub 加速镜像进行克隆，例如：
  ```bash
  git clone https://ghfast.top/https://github.com/zhiwendesign/Comfyui-kktools.git
  git clone https://ghfast.top/https://github.com/kijai/ComfyUI-KJNodes.git
  git clone https://ghfast.top/https://github.com/M1kep/ComfyLiterals.git
  git clone https://ghfast.top/https://github.com/whmc76/ComfyUI-UniversalToolkit.git
  git clone https://ghfast.top/https://github.com/chflame163/ComfyUI_LayerStyle.git
  git clone https://ghfast.top/https://github.com/facok/comfyui-SelfLift.git
  ```

### 6.3 视频生成提示组件节点报错
- 确认安装的 `ComfyUI-KJNodes` 为最新版本，老版本可能缺少部分视频解包处理节点。进入 `custom_nodes/ComfyUI-KJNodes` 目录下执行 `git pull` 更新即可。
