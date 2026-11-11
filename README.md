# comfyui-h3-image

[![ComfyUI Custom Node](https://img.shields.io/badge/ComfyUI-Custom%20Node-2ea44f?style=flat-square)](https://www.comfy.org/)
[![MiniMax H3](https://img.shields.io/badge/MiniMax-H3%20Image-e85d75?style=flat-square)](https://huggingface.co/PrunaAI/p-h3-image-comfy)
[![No Extra Dependencies](https://img.shields.io/badge/dependencies-none-3b82f6?style=flat-square)](#安装)
[![License: MIT](https://img.shields.io/badge/license-MIT-f4c542?style=flat-square)](LICENSE)

一个为 **p-h3-image / MiniMax H3 Image** 做的 ComfyUI 精简封装。把官方长工作流收进三个节点，保留官方条件编码、Sigma 曲线、`er_sde` 采样与 VAE 解码，同时提供九宫格图片库、动态 LoRA 和画质分辨率联动。

## 核心优势

| 能力 | 实际效果 |
|---|---|
| 官方推理链 | 固定官方 `MiniMaxH3SigmaShift 1.0 / 1.0`，默认使用官方 8 步 Sigma 曲线与 `er_sde` |
| 极简工作流 | 文生图 3 个节点，图片编辑 4 个节点，不再手工连接一长串加载器、Guider、Sampler 和 Decode |
| 一条线传 9 图 | 九宫格资源库最多 9 张图，只通过一条 `H3_IMAGE_LIBRARY` 线接入生成节点 |
| 固定九宫格 | 资源库始终是 3×3，节点可自由放大缩小；不再出现无意义的空输入槽 |
| 编辑与参考图统一 | 第 1 张是编辑原图，第 2 到第 9 张按顺序作为参考图；不接资源库就是文生图 |
| 主 LoRA + 9 个附加 LoRA | 每条附加 LoRA 可单独选择文件、调整权重，并支持增删行 |
| 画质和比例联动 | 比例、480P 到 4K、自定义宽高集中在一个节点，节点内实时显示最终像素 |
| 提示词扩写 | 可选用官方扩写编码器；扩写失败自动回退原始提示词，不中断生成 |
| 无额外 Python 依赖 | 复用 ComfyUI 已安装的 MiniMax H3 / p-h3-image 核心节点 |

## 节点

分类：`H3 Image`

| 显示名 | 节点 ID | 作用 |
|---|---|---|
| H3 Image 加载器 | `H3ImageLoader` | 加载扩散模型、文本编码器、VAE、提示词扩写编码器和 LoRA |
| H3 Image 九宫格资源库 | `H3ImageLibrary` | 上传、替换、删除和拖动排序最多 9 张图片，一条线输出 |
| H3 Image 生成 | `H3ImageGenerate` | 文生图、单图编辑和多参考图编辑，直接输出 `IMAGE` |

### 图片编辑

```text
H3 Image 加载器 ──bundle──────────────┐
                                      ▼
H3 Image 九宫格资源库 ──9 张图片──▶ H3 Image 生成 ──IMAGE──▶ 保存图像
```

工作流文件：`workflows/H3-Image_图片编辑.json`

### 文生图

```text
H3 Image 加载器 ──bundle──▶ H3 Image 生成 ──IMAGE──▶ 保存图像
```

工作流文件：`workflows/H3-Image_文生图.json`

## 九宫格资源库

- 固定 3×3，一共 9 个位置，节点本身可自由缩放。
- 空格中央显示加号，点击加号或单元格即可选择图片；点击已有图片可替换。
- 可以从外部把图片直接拖到指定格子；拖到资源库空白区域时会追加到已有图片之后。
- 拖动已加载的图片可以调整顺序。
- 单元格右上角删除单张，顶部按钮清空全部。
- 第 1 格是编辑原图，后 8 格是参考图。
- 生成节点只接收一条资源库连线，不会自动露出额外空槽。
- 提示词中用 `<Picture 1>`、`<Picture 2>` 等指代对应图片。

## 加载器与 LoRA

加载器包含一套 p-h3-image 所需权重：

- 扩散模型
- 文本编码器
- VAE
- 提示词扩写编码器
- 主 LoRA 与主 LoRA 权重
- 最多 9 个可增删的附加 LoRA

附加 LoRA 支持单个文件选择和独立权重：

- 点击「添加 附加 LoRA」新增一行。
- 点击对应减号删除该行。
- 最多 9 个。
- `none` 或权重 `0` 会自动跳过。
- 普通 H3 视频 LoRA 不一定兼容 p-h3-image；不兼容时会给出明确错误。

主文本编码器和提示词扩写编码器不能互换。插件会读取 safetensors 头检查模型角色，并在选错时给出中文提示。

## 画质与分辨率

生成节点提供以下控制：

- **比例**：`自动`、`1:1`、`4:3`、`3:4`、`3:2`、`2:3`、`16:9`、`9:16`
- **画质**：`自动`、`480P`、`720P`、`1080P`、`1K`、`2K`、`4K`、`自定义`
- **自定义宽高**：只有选择「自定义」时才显示
- **步数**：默认 `8`
- **采样器**：默认 `er_sde`
- **随机种**：支持 fixed / increment / decrement / randomize
- **提示词扩写**：可开启或关闭

尺寸规则：

- 比例和画质都为「自动」时，图片编辑跟随第 1 张图，文生图使用官方 `2912 × 2912`。
- 选择固定比例和画质时，节点会显示并实际使用计算后的宽高，例如 `16:9 + 720P = 1280 × 720`。
- 宽高会按 H3 VAE 的 16 像素画布网格对齐。
- 选择「自定义」后，宽度和高度输入才出现；其他选项不会显示这两个多余输入。

## 采样核心

插件没有重写扩散推理，内部调用 ComfyUI 自带的 MiniMax H3 相关节点：

- `PH3ImageConditioning`
- `MiniMaxH3SigmaShift`
- `BasicGuider`
- `KSamplerSelect`
- `RandomNoise`
- `ManualSigmas`
- `SamplerCustomAdvanced`
- `VAEDecode`

官方 8 步 Sigma：

```text
1.0, 0.984753, 0.967905, 0.951688, 0.925372,
0.881923, 0.810083, 0.528718, 0.0
```

默认步数为 8 时，直接使用这条官方曲线。修改步数时，在官方曲线基础上插值；得到的是以官方曲线为基准的不同步数版本。

## 所需模型

下拉框会扫描本地模型目录。p-h3-image 是图像专用权重，不能用普通 H3 视频模型替代。

| 目录 | 文件名 | 必需 |
|---|---|---|
| `diffusion_models` | `p-h3-image_int8_convrot.safetensors` | 是 |
| `text_encoders` | `p-h3-image_text_encoder_int8_convrot.safetensors` | 是 |
| `vae` | `p-h3-image_vae_int8_convrot.safetensors` | 是 |
| `text_encoders` | `p-h3-image_prompt_upsampler_int8_convrot.safetensors` | 否 |
| `loras` | `p-h3-image_lora_bf16.safetensors` | 否 |

模型来源：[PrunaAI/p-h3-image-comfy](https://huggingface.co/PrunaAI/p-h3-image-comfy)

```text
ComfyUI/models/
├── diffusion_models/p-h3-image_int8_convrot.safetensors
├── text_encoders/p-h3-image_text_encoder_int8_convrot.safetensors
├── text_encoders/p-h3-image_prompt_upsampler_int8_convrot.safetensors
├── vae/p-h3-image_vae_int8_convrot.safetensors
└── loras/p-h3-image_lora_bf16.safetensors
```

## 安装

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/JGRFW/comfyui-h3-image.git
```

重启 ComfyUI，然后从节点库打开内置工作流：

- `workflows/H3-Image_文生图.json`
- `workflows/H3-Image_图片编辑.json`

插件没有额外 Python 依赖，`requirements.txt` 只用于说明运行环境由 ComfyUI 本体提供。

## 使用

### 文生图

1. 打开 `H3-Image_文生图` 工作流。
2. 在加载器中选择模型、编码器、VAE 和 LoRA。
3. 输入官方格式提示词。
4. 选择比例和画质，或保持「自动」。
5. 点击 Queue Prompt。

### 图片编辑

1. 打开 `H3-Image_图片编辑` 工作流。
2. 在九宫格第 1 格上传要编辑的原图。
3. 需要参考图时，继续上传到第 2 到第 9 格。
4. 提示词中用 `<Picture 1>`、`<Picture 2>` 指代图片。
5. 选择比例和画质后运行。

提示词示例：

```text
Aspect ratio: 1:1
Request: change the lighting to night time
```

多参考图示例：

```text
Aspect ratio: 16:9
Request: keep <Picture 1> unchanged, place the object from <Picture 2> on the table
```

选择固定比例时，插件会自动同步提示词中的 `Aspect ratio:` 行。比例为「自动」时不会覆盖原始提示词。

## 项目结构

```text
comfyui-h3-image/
├── __init__.py
├── nodes.py
├── requirements.txt
├── web/
│   ├── h3_image.js
│   └── h3_image_library.js
└── workflows/
    ├── H3-Image_图片编辑.json
    └── H3-Image_文生图.json
```

## 说明

- 插件只负责加载权重、组织输入和连接 ComfyUI 官方推理节点，不修改扩散模型本体。
- 图片编辑通过九宫格资源库传递，不需要额外的 `LoadImage` 节点。
- 工作流中的模型文件名是发布时的默认示例，可在加载器中改成自己本地的文件名。
- 本项目使用 [MIT License](LICENSE)。
