# 文生图工作流（T2I）

本目录包含当前系统内置的 3 份文生图 API JSON。

| 工作流 | 文件 | 参考图 | 核心模型与权重 |
| :--- | :--- | :--- | :--- |
| Qwen Image 全能生图（默认） | [`QRw_D.json`](./QRw_D.json) | 0~9 张；同一文件也用于图生图 | `diffusion_models/qwen_image_2.1_bf16.safetensors`<br/>`clip/qwen3vl_8b_bf16.safetensors`<br/>`vae/qwen_image_2.1_vae_bf16.safetensors` |
| Moss Image 文生图 | [`moss_image.json`](./moss_image.json) | 不支持 | `diffusion_models/moss_image_sft_int8_convrot.safetensors`<br/>`clip/qwen3.5_9b_w4a8_gptq.safetensors`<br/>`vae/flux2-vae_small.safetensors` |
| Z-Image-Turbo 文生图 | [`z_image_turbo_api.json`](./z_image_turbo_api.json) | 不支持 | `diffusion_models/z_image_turbo_bf16.safetensors`<br/>`clip/qwen_3_4b.safetensors`<br/>`vae/ae.safetensors` |

QRw_D 在画布未连接参考图时执行文生图；连接参考图后使用同一 Profile 执行图生图。未使用的参考槽位会在提交前移除，Moss Image 与 Z-Image-Turbo 不会显示参考图入口。
