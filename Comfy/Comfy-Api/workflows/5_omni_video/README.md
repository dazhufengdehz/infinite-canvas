# MiniMax H3 全能参考视频工作流（MS_V10）

当前系统仅内置 [`MS_V10.json`](./MS_V10.json) 这一款全能参考视频工作流，不再保留旧 FP8/BF16、PDMD、Pika 和首尾帧多档文件。

## 输入与执行能力

- 支持文生视频、图生视频与多模态参考，最多 9 张图片、3 段视频和 3 段音频。
- 未使用的参考槽位及级联桥接节点会在提交前移除，超出上限时直接报错。
- 尺寸严格限定为 0.4M~2.0M 的 12 档硬件对齐预设，16:9 与 9:16 对称对调，默认选择中间档位。
- 时长为 1~15 秒，使用 SelfLift 渐进式潜空间超分采样。

## 必要模型权重

| 类别 | ComfyUI `models/` 下的路径 |
| :--- | :--- |
| 扩散模型 | `diffusion_models/Cobijada_H3_Hybrid_Uncensored_pruned_hybrid_int8_convrot_pruned.safetensors` |
| 文本编码器 | `clip/qwen3vl_32b_minimax_h3_int8_convrot.safetensors` |
| 视频 / 音频 VAE | `vae/minimax_h3_video_vae_int8_convrot.safetensors`<br/>`vae/minimax_h3_audio_vae_fp32.safetensors` |
| 潜空间超分模型 | `latent_upscaler/MiniMax-H3/minimax_h3_latent_upscaler_3d_conv_v1_fp16.safetensors` |
| LoRA | `loras/minimax_h3_fl2v_lightx2v_turbo_4step_v0.1_comfy.safetensors`<br/>`loras/H3_Combat_V2.safetensors`<br/>`loras/FrameRush-Minimax-V2_c2-st1500.safetensors`<br/>`loras/H3-Licon-VBVR-I2V.safetensors` |

## 依赖扩展

- `https://github.com/facok/comfyui-SelfLift`：提供 `SelfLiftH3Sampler` 与 `H3SigmaRefiner`。
- `https://github.com/kijai/ComfyUI-KJNodes`：提供音视频组件处理节点。
- `https://github.com/M1kep/ComfyLiterals`：提供基础字面量节点。

此外需安装工作流中 MiniMax H3 Easy 相关节点。具体文件名与路径以 JSON 实际配置为准。
