# 图生图工作流（I2I）

本目录包含当前系统内置的 2 份图生图 API JSON。

| 工作流 | 文件 | 参考图要求 | 核心模型与权重 |
| :--- | :--- | :--- | :--- |
| Qwen Image 全能生图（默认） | [`QRw_D.json`](./QRw_D.json) | 0~9 张；与文生图共用同一 Profile 和 JSON | `diffusion_models/qwen_image_2.1_bf16.safetensors`<br/>`clip/qwen3vl_8b_bf16.safetensors`<br/>`vae/qwen_image_2.1_vae_bf16.safetensors` |
| Qwen Image 4×4 图生图 | [`QRw_4×4.json`](./QRw_4×4.json) | 必须连接 1 张，不支持额外参考图 | 与 QRw_D 相同 |

图片节点会按 Profile 去重，因此 QRw_D 虽同时注册在 T2I 和 I2I 分类中，在选择器里仍只显示一次。QRw_4×4 是独立 Profile，要求严格的单图输入。
