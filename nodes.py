# -*- coding: utf-8 -*-
"""comfyui-h3-image - a compact wrapper for the official p-h3-image graph.

The inference path intentionally reuses ComfyUI's own MiniMax H3 nodes. This
plugin only loads the required weights and wires the official conditioning,
sigma shift, sampler and VAE decode steps together.
"""

import json
import os
import struct
import re

import folder_paths
import comfy.samplers
import comfy.sd
import comfy.utils

from comfy_api.latest import io
from comfy_api.latest._io import _DynamicGroup
from nodes import (
    UNETLoader,
    CLIPLoader,
    VAELoader,
    VAEDecode,
    LoadImage,
)
from comfy_extras.nodes_minimax_h3 import (
    PH3ImageConditioning,
    MiniMaxH3SigmaShift,
)
from comfy_extras.nodes_textgen import TextGenerateV2
from comfy_extras.nodes_custom_sampler import (
    BasicGuider,
    KSamplerSelect,
    RandomNoise,
    ManualSigmas,
    SamplerCustomAdvanced,
)

# Local model file names. The official Hugging Face names are documented in README.md.
DEFAULT_UNET = "p-h3-image_int8_convrot.safetensors"
DEFAULT_CLIP = "p-h3-image_text_encoder_int8_convrot.safetensors"
DEFAULT_VAE = "p-h3-image_vae_int8_convrot.safetensors"
DEFAULT_UPSAMPLER_CLIP = "p-h3-image_prompt_upsampler_int8_convrot.safetensors"
DEFAULT_LORA = "p-h3-image_lora_bf16.safetensors"

# The exact official 8-step p-h3-image sigma schedule.
OFFICIAL_SIGMAS = (
    1.0,
    0.984753,
    0.967905,
    0.951688,
    0.925372,
    0.881923,
    0.810083,
    0.528718,
    0.0,
)

AUTO_ASPECT_RATIO = "自动"
AUTO_QUALITY = "自动"
CUSTOM_QUALITY = "自定义"
ASPECT_RATIOS = {
    "1:1": (1, 1),
    "4:3": (4, 3),
    "3:4": (3, 4),
    "3:2": (3, 2),
    "2:3": (2, 3),
    "16:9": (16, 9),
    "9:16": (9, 16),
}
ASPECT_RATIO_OPTIONS = [AUTO_ASPECT_RATIO, *ASPECT_RATIOS]
QUALITY_OPTIONS = [
    AUTO_QUALITY,
    "480P",
    "720P",
    "1080P",
    "1K",
    "2K",
    "4K",
    CUSTOM_QUALITY,
]

OFFICIAL_ASPECT_SIZES = {
    "1:1": (2912, 2912),
    "4:3": (3360, 2496),
    "3:4": (2496, 3360),
    "3:2": (3552, 2368),
    "2:3": (2368, 3552),
    "16:9": (3872, 2176),
    "9:16": (2176, 3872),
}
QUALITY_SHORT_EDGE = {"480P": 480, "720P": 720, "1080P": 1080}
QUALITY_LONG_EDGE = {"1K": 1024, "2K": 2560, "4K": 3840}
CANVAS_GRID = 16

CATEGORY = "H3 Image"
BUNDLE_TYPE = "H3_IMAGE_BUNDLE"
IMAGE_LIBRARY_TYPE = "H3_IMAGE_LIBRARY"
UPSAMPLER_MAX_LENGTH = 1536
MAX_LIBRARY_IMAGES = 9


def _combo(folder, preferred, none_option=False):
    """Return installed files plus the official default as a stable placeholder."""
    options = list(folder_paths.get_filename_list(folder))
    if none_option:
        options = ["none", *options]
    if preferred and preferred not in options:
        options.insert(0, preferred)
    return options


def _default_for(folder, preferred, none_option=False):
    """Keep official defaults visible even before the files are downloaded."""
    available = folder_paths.get_filename_list(folder)
    if none_option:
        return preferred if preferred in available else "none"
    return preferred


def _require(folder, name, label):
    """Validate a model file and report a useful error before execution."""
    if name == "none":
        return
    if folder_paths.get_full_path(folder, name) is not None:
        return
    available = folder_paths.get_filename_list(folder)
    raise ValueError(
        f"[H3 Image] 未找到{label}：'{name}'（models/{folder}）。\n"
        f"请先下载该权重放到对应目录，或在加载器下拉框改选已安装的{label}。\n"
        f"当前目录可用文件：{', '.join(available) if available else '（空）'}。"
    )


def _apply_lora(model, lora_name, strength, label):
    """Apply one model-only LoRA and add context to compatibility errors."""
    if not lora_name or lora_name == "none" or abs(float(strength)) < 1e-8:
        return model

    _require("loras", lora_name, label)
    try:
        lora_path = folder_paths.get_full_path("loras", lora_name)
        lora, metadata = comfy.utils.load_torch_file(
            lora_path, safe_load=True, return_metadata=True
        )
        model, _ = comfy.sd.load_lora_for_models(
            model,
            None,
            lora,
            float(strength),
            0,
            lora_metadata=metadata,
        )
        return model
    except Exception as exc:
        raise ValueError(
            f"[H3 Image] {label}加载失败：'{lora_name}'。"
            "该文件可能不是 p-h3-image 兼容的扩散模型 LoRA，或文件已损坏。"
        ) from exc


def _round_to_grid(value):
    """Keep output dimensions on the H3 VAE's 16-pixel spatial grid."""
    return max(
        CANVAS_GRID,
        int(value / CANVAS_GRID + 0.5) * CANVAS_GRID,
    )


def _size_for_ratio(ratio_width, ratio_height, quality):
    ratio = ratio_width / ratio_height
    if quality in QUALITY_SHORT_EDGE:
        short_edge = QUALITY_SHORT_EDGE[quality]
        if ratio >= 1.0:
            width, height = short_edge * ratio, short_edge
        else:
            width, height = short_edge, short_edge / ratio
    else:
        long_edge = QUALITY_LONG_EDGE[quality]
        if ratio >= 1.0:
            width, height = long_edge, long_edge / ratio
        else:
            width, height = long_edge * ratio, long_edge
    return _round_to_grid(width), _round_to_grid(height)


def _resolve_size(aspect_ratio, quality, image=None, custom_width=1280, custom_height=720):
    """Map the visual ratio/quality controls to an exact H3 canvas size."""
    if quality == CUSTOM_QUALITY:
        return _round_to_grid(custom_width), _round_to_grid(custom_height)
    if quality == AUTO_QUALITY and aspect_ratio == AUTO_ASPECT_RATIO:
        return 0, 0
    if quality == AUTO_QUALITY:
        return OFFICIAL_ASPECT_SIZES[aspect_ratio]

    if aspect_ratio != AUTO_ASPECT_RATIO:
        ratio_width, ratio_height = ASPECT_RATIOS[aspect_ratio]
    elif image is not None:
        ratio_width, ratio_height = int(image.shape[2]), int(image.shape[1])
    else:
        ratio_width, ratio_height = 1, 1
    return _size_for_ratio(ratio_width, ratio_height, quality)


def _prompt_with_ratio(prompt, aspect_ratio):
    """Keep the model's official Aspect ratio prompt aligned with the selector."""
    if aspect_ratio == AUTO_ASPECT_RATIO:
        return prompt
    line = f"Aspect ratio: {aspect_ratio}"
    if re.search(r"(?im)^\s*Aspect ratio\s*:\s*[^\r\n]*", prompt):
        return re.sub(
            r"(?im)^\s*Aspect ratio\s*:\s*[^\r\n]*", line, prompt, count=1
        )
    return f"{line}\n{prompt.strip()}"


def _safetensors_header(path):
    """Read only the safetensors metadata header, without loading tensor data."""
    with open(path, "rb") as f:
        header_len = struct.unpack("<Q", f.read(8))[0]
        return json.loads(f.read(header_len).decode("utf-8"))


def _check_clip_role(path, expect_main):
    """Prevent swapping the main text encoder and prompt-upsampler encoder."""
    if path is None:
        return
    try:
        header = _safetensors_header(path)
        has_connector = "text_connector.proj.weight" in header
    except Exception:
        return
    name = os.path.basename(path)
    if expect_main and not has_connector:
        raise ValueError(
            f"[H3 Image] 文本编码器选错了：'{name}' 是提示词扩写模型（不含 text_connector），"
            "输出维度与扩散模型不匹配。\n请在「文本编码器」槽位改选 p-h3-image_text_encoder_*；"
            "扩写模型请放到「提示词扩写编码器」槽位（或选 none 关闭扩写）。"
        )
    if not expect_main and has_connector:
        raise ValueError(
            f"[H3 Image] 提示词扩写编码器选错了：'{name}' 是主文本编码器（含 text_connector）。\n"
            "请把主编码器放到「文本编码器」槽位，本槽位选 p-h3-image_prompt_upsampler_* 或 none。"
        )


def _sigmas_for_steps(steps):
    """Resample the official 8-step schedule while preserving its exact default."""
    steps = max(1, min(50, int(steps)))
    if steps == len(OFFICIAL_SIGMAS) - 1:
        return ", ".join(str(value) for value in OFFICIAL_SIGMAS)

    values = []
    last_index = len(OFFICIAL_SIGMAS) - 1
    for index in range(steps + 1):
        position = index * last_index / steps
        left = min(int(position), last_index - 1)
        fraction = position - left
        value = OFFICIAL_SIGMAS[left] + (
            OFFICIAL_SIGMAS[left + 1] - OFFICIAL_SIGMAS[left]
        ) * fraction
        values.append(value)
    values[0] = 1.0
    values[-1] = 0.0
    return ", ".join(f"{value:.6f}".rstrip("0").rstrip(".") for value in values)


def _library_image_names(image_state):
    """Normalize the 3x3 library state to ordered, safe image filenames."""
    if isinstance(image_state, str):
        try:
            image_state = json.loads(image_state or "{}")
        except (TypeError, ValueError):
            image_state = []

    if isinstance(image_state, dict):
        image_state = image_state.get("images", [])
    if not isinstance(image_state, (list, tuple)):
        return []

    names = []
    for entry in image_state:
        if isinstance(entry, dict):
            entry = entry.get("filename", "")
        filename = str(entry or "").replace("\\", "/").strip().lstrip("/")
        if not filename or ".." in filename.split("/"):
            continue
        names.append(filename)
        if len(names) >= MAX_LIBRARY_IMAGES:
            break
    return names


class H3ImageBundle:
    """Loaded models passed from H3ImageLoader to H3ImageGenerate."""

    def __init__(self, model, clip, vae, upsampler_clip):
        self.model = model
        self.clip = clip
        self.vae = vae
        self.upsampler_clip = upsampler_clip


class H3ImageLibraryBundle:
    """Ordered images loaded from one 3x3 image-library node."""

    def __init__(self, images):
        self.images = tuple(images)


class H3ImageLoader(io.ComfyNode):
    """Load the diffusion model, text encoders, VAE and optional LoRA."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="H3ImageLoader",
            display_name="H3 Image 加载器",
            category=CATEGORY,
            description=("加载 p-h3-image 全套权重，可挂载主 LoRA 和最多 9 个附加 LoRA。"),
            inputs=[
                io.Combo.Input(
                    "unet_name",
                    display_name="扩散模型",
                    options=_combo("diffusion_models", DEFAULT_UNET),
                    default=_default_for("diffusion_models", DEFAULT_UNET),
                    tooltip="p-h3-image / MiniMax H3 扩散模型。",
                ),
                io.Combo.Input(
                    "weight_dtype",
                    display_name="权重精度",
                    options=["default", "fp8_e4m3fn", "fp8_e4m3fn_fast", "fp8_e5m2"],
                    default="default",
                ),
                io.Combo.Input(
                    "clip_name",
                    display_name="文本编码器",
                    options=_combo("text_encoders", DEFAULT_CLIP),
                    default=_default_for("text_encoders", DEFAULT_CLIP),
                    tooltip="p-h3-image 文本编码器（type=minimax）。",
                ),
                io.Combo.Input(
                    "vae_name",
                    display_name="VAE",
                    options=_combo("vae", DEFAULT_VAE),
                    default=_default_for("vae", DEFAULT_VAE),
                ),
                io.Combo.Input(
                    "upsampler_clip_name",
                    display_name="提示词扩写编码器",
                    options=_combo("text_encoders", DEFAULT_UPSAMPLER_CLIP, none_option=True),
                    default=_default_for(
                        "text_encoders", DEFAULT_UPSAMPLER_CLIP, none_option=True
                    ),
                    tooltip="提示词扩写编码器；选 none 关闭。",
                ),
                io.Combo.Input(
                    "lora_name",
                    display_name="主 LoRA",
                    options=_combo("loras", DEFAULT_LORA, none_option=True),
                    default=_default_for("loras", DEFAULT_LORA, none_option=True),
                    tooltip="p-h3-image 的官方主 LoRA；不需要时选 none。",
                ),
                io.Float.Input(
                    "lora_strength",
                    display_name="主 LoRA 权重",
                    default=1.0,
                    min=-100.0,
                    max=100.0,
                    step=0.01,
                ),
                _DynamicGroup.Input(
                    "extra_loras",
                    template=[
                        io.Combo.Input(
                            "lora_name",
                            display_name="LoRA",
                            options=_combo("loras", DEFAULT_LORA, none_option=True),
                            default="none",
                        ),
                        io.Float.Input(
                            "strength",
                            display_name="权重",
                            default=1.0,
                            min=-100.0,
                            max=100.0,
                            step=0.01,
                        ),
                    ],
                    min=0,
                    max=9,
                    group_name="附加 LoRA",
                    tooltip="点加号添加，最多 9 个；删除后不会留下空白行。",
                ),
            ],
            outputs=[
                io.Custom(BUNDLE_TYPE).Output(display_name="h3_image_bundle")
            ],
        )

    @classmethod
    def execute(
        cls,
        unet_name,
        weight_dtype,
        clip_name,
        vae_name,
        upsampler_clip_name,
        lora_name,
        lora_strength,
        extra_loras=None,
    ):
        _require("diffusion_models", unet_name, "扩散模型")
        _require("text_encoders", clip_name, "文本编码器")
        _require("vae", vae_name, "VAE")
        _require("text_encoders", upsampler_clip_name, "提示词扩写编码器")

        _check_clip_role(
            folder_paths.get_full_path("text_encoders", clip_name), expect_main=True
        )
        if upsampler_clip_name != "none":
            _check_clip_role(
                folder_paths.get_full_path("text_encoders", upsampler_clip_name),
                expect_main=False,
            )

        model = UNETLoader().load_unet(unet_name, weight_dtype)[0]
        model = _apply_lora(model, lora_name, lora_strength, "主 LoRA")
        for index, row in enumerate(extra_loras or [], start=1):
            if not row:
                continue
            extra_name = row.get("lora_name")
            extra_strength = row.get("strength")
            if not extra_name or extra_name == "none" or extra_strength is None:
                continue
            model = _apply_lora(
                model, extra_name, extra_strength, f"附加 LoRA {index}"
            )

        clip = CLIPLoader().load_clip(clip_name, "minimax", "default")[0]
        vae = VAELoader().load_vae(vae_name)[0]

        up_clip = None
        if upsampler_clip_name != "none":
            up_clip = CLIPLoader().load_clip(
                upsampler_clip_name, "minimax", "default"
            )[0]

        return io.NodeOutput(H3ImageBundle(model, clip, vae, up_clip))


class H3ImageLibrary(io.ComfyNode):
    """Load up to nine images from one compact 3x3 resource grid."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="H3ImageLibrary",
            display_name="H3 Image 九宫格资源库",
            category=CATEGORY,
            description=
                "一个节点管理最多 9 张图。第 1 张是编辑原图，其余是按顺序引用的参考图。",
            inputs=[
                io.String.Input(
                    "image_state",
                    display_name="图片状态",
                    default="",
                    multiline=False,
                    tooltip="由九宫格图片库自动保存，不建议手动修改。",
                ),
            ],
            outputs=[
                io.Custom(IMAGE_LIBRARY_TYPE).Output(
                    display_name="images",
                    tooltip="按九宫格顺序传给 H3 Image 生成节点。",
                )
            ],
        )

    @classmethod
    def execute(cls, image_state=""):
        images = []
        for index, filename in enumerate(_library_image_names(image_state), start=1):
            try:
                image, _mask = LoadImage().load_image(filename)
            except Exception as exc:
                raise ValueError(
                    f"[H3 Image] 九宫格第 {index} 张图片无法读取：'{filename}'。"
                    "请重新上传该图片，或检查 ComfyUI/input 目录中的文件是否存在。"
                ) from exc
            images.append(image)
        return io.NodeOutput(H3ImageLibraryBundle(images))


class H3ImageGenerate(io.ComfyNode):
    """Official p-h3-image text-to-image, edit and multi-reference generation."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="H3ImageGenerate",
            display_name="H3 Image 生成",
            category=CATEGORY,
            description=(
                "p-h3-image 单节点出图。接九宫格资源库后，图片 1 是编辑原图，"
                "其余图片按顺序作为参考；不接图片库即为文生图。"
            ),
            inputs=[
                io.Custom(BUNDLE_TYPE).Input(
                    "bundle",
                    tooltip="从 H3 Image 加载器接入已加载的模型与编码器。",
                ),
                io.String.Input(
                    "prompt",
                    display_name="提示词",
                    multiline=True,
                    dynamic_prompts=True,
                    default="Aspect ratio: 1:1\nRequest: change the lighting to night time",
                    tooltip=(
                        "官方格式：Aspect ratio: <比例>，下一行 Request: <要求>。"
                        "多图时用 <Picture 1>、<Picture 2> 指代图片。"
                    ),
                ),
                io.Combo.Input(
                    "aspect_ratio",
                    display_name="比例",
                    options=ASPECT_RATIO_OPTIONS,
                    default=AUTO_ASPECT_RATIO,
                    tooltip=(
                        "自动：编辑时跟随第 1 张图比例；文生图按 1:1。"
                        "选择固定比例后，会自动同步提示词中的 Aspect ratio。"
                    ),
                ),
                io.Combo.Input(
                    "quality",
                    display_name="画质",
                    options=QUALITY_OPTIONS,
                    default=AUTO_QUALITY,
                    tooltip=(
                        "自动：保持 p-h3-image 官方尺寸；固定画质时按比例计算实际宽高；"
                        "选择“自定义”时可设置下方宽度和高度。"
                    ),
                ),
                io.Int.Input(
                    "custom_width",
                    display_name="宽度",
                    default=1280,
                    min=16,
                    max=8192,
                    step=16,
                    tooltip="画质选择“自定义”时显示；最终宽高按 16 像素对齐。",
                ),
                io.Int.Input(
                    "custom_height",
                    display_name="高度",
                    default=720,
                    min=16,
                    max=8192,
                    step=16,
                    tooltip="画质选择“自定义”时显示；最终宽高按 16 像素对齐。",
                ),
                io.Int.Input(
                    "steps",
                    display_name="步数",
                    default=8,
                    min=1,
                    max=50,
                    step=1,
                    tooltip="8 步为官方原始曲线；其他步数在官方曲线上插值。",
                ),
                io.Combo.Input(
                    "sampler_name",
                    display_name="采样器",
                    options=comfy.samplers.SAMPLER_NAMES,
                    default="er_sde",
                    tooltip="官方工作流使用 er_sde。",
                ),
                io.Int.Input(
                    "seed",
                    display_name="随机种",
                    default=0,
                    min=0,
                    max=0xFFFFFFFFFFFFFFFF,
                    step=1,
                    control_after_generate=True,
                ),
                io.Boolean.Input(
                    "use_prompt_upsampler",
                    display_name="提示词扩写",
                    default=True,
                    label_on="开启",
                    label_off="关闭",
                    tooltip=(
                        "使用官方提示词扩写模型；扩写失败时自动回退原始提示词。"
                    ),
                ),
                io.Custom(IMAGE_LIBRARY_TYPE).Input(
                    "image_library",
                    optional=True,
                    tooltip="接入 H3 Image 九宫格资源库；一条线传入最多 9 张图。",
                ),
            ],
            outputs=[
                io.Image.Output(
                    display_name="image",
                    tooltip="p-h3-image 生成的最终图像。",
                )
            ],
        )

    @staticmethod
    def _run_upsampler(up_clip, raw_prompt, images):
        """Run the official TextGenerateV2 node, falling back to the raw prompt."""
        if up_clip is None:
            return raw_prompt

        upsampler_images = {}
        for index, image in enumerate(images, start=1):
            if image is not None:
                upsampler_images[f"image{index}"] = image

        try:
            out = TextGenerateV2.execute(
                clip=up_clip,
                prompt=raw_prompt,
                max_length=UPSAMPLER_MAX_LENGTH,
                sampling_mode={"sampling_mode": "off"},
                images=upsampler_images or None,
                thinking=True,
                use_default_template=True,
                mtp="auto",
            )
            generated = out.args[0]
            if generated and str(generated).strip():
                return str(generated).strip()
        except Exception as exc:
            print(f"[h3-image] 提示词扩写失败，使用原始提示词：{exc}", flush=True)
        return raw_prompt

    @classmethod
    def execute(
        cls,
        bundle,
        prompt,
        aspect_ratio,
        quality,
        custom_width,
        custom_height,
        steps,
        sampler_name,
        seed,
        use_prompt_upsampler,
        image_library=None,
    ) -> io.NodeOutput:
        image_batches = list(image_library.images) if image_library else []
        image_batches = image_batches[:MAX_LIBRARY_IMAGES]

        raw_prompt = _prompt_with_ratio(prompt, aspect_ratio)
        final_prompt = raw_prompt
        if use_prompt_upsampler:
            final_prompt = cls._run_upsampler(
                bundle.upsampler_clip, raw_prompt, image_batches
            )

        first_image = image_batches[0] if image_batches else None
        width, height = _resolve_size(
            aspect_ratio,
            quality,
            first_image,
            custom_width,
            custom_height,
        )

        # Keep the official conditioning order: image_1 edits, later images are references.
        cond_images = {
            f"image_{index}": image
            for index, image in enumerate(image_batches, start=1)
        }
        cond_out = PH3ImageConditioning.execute(
            clip=bundle.clip,
            prompt=final_prompt,
            width=width,
            height=height,
            vae=bundle.vae,
            images=cond_images or None,
        )
        positive = cond_out.args[0]
        latent = cond_out.args[1]

        # The official image graph keeps both MiniMax H3 shifts at 1.0.
        model = MiniMaxH3SigmaShift.execute(
            model=bundle.model,
            shift_video=1.0,
            shift_audio=1.0,
        ).args[0]

        guider = BasicGuider.execute(model=model, conditioning=positive).args[0]
        sampler = KSamplerSelect.execute(sampler_name=sampler_name).args[0]
        noise = RandomNoise.execute(noise_seed=seed).args[0]
        sigmas = ManualSigmas.execute(sigmas=_sigmas_for_steps(steps)).args[0]

        sampled = SamplerCustomAdvanced.execute(
            noise=noise,
            guider=guider,
            sampler=sampler,
            sigmas=sigmas,
            latent_image=latent,
        ).args[0]

        image = VAEDecode().decode(vae=bundle.vae, samples=sampled)[0]
        return io.NodeOutput(image)


NODE_CLASS_MAPPINGS = {
    "H3ImageLoader": H3ImageLoader,
    "H3ImageLibrary": H3ImageLibrary,
    "H3ImageGenerate": H3ImageGenerate,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "H3ImageLoader": "H3 Image 加载器",
    "H3ImageLibrary": "H3 Image 九宫格资源库",
    "H3ImageGenerate": "H3 Image 生成",
}

print(
    "[comfyui-h3-image] nodes loaded: H3ImageLoader, H3ImageLibrary, H3ImageGenerate",
    flush=True,
)
