import { app } from "/scripts/app.js";
const AUTO_ASPECT_RATIO = "自动";
const AUTO_QUALITY = "自动";
const CUSTOM_QUALITY = "自定义";
const ASPECT_RATIOS = {
  "1:1": [1, 1],
  "4:3": [4, 3],
  "3:4": [3, 4],
  "3:2": [3, 2],
  "2:3": [2, 3],
  "16:9": [16, 9],
  "9:16": [9, 16],
};
const OFFICIAL_ASPECT_SIZES = {
  "1:1": [2912, 2912],
  "4:3": [3360, 2496],
  "3:4": [2496, 3360],
  "3:2": [3552, 2368],
  "2:3": [2368, 3552],
  "16:9": [3872, 2176],
  "9:16": [2176, 3872],
};
const QUALITY_SHORT_EDGE = { "480P": 480, "720P": 720, "1080P": 1080 };
const QUALITY_LONG_EDGE = { "1K": 1024, "2K": 2560, "4K": 3840 };
const CANVAS_GRID = 16;

function roundToGrid(value) {
  return Math.max(CANVAS_GRID, Math.round(value / CANVAS_GRID) * CANVAS_GRID);
}

function sizeForRatio(ratioWidth, ratioHeight, quality) {
  const ratio = ratioWidth / ratioHeight;
  let width;
  let height;

  if (quality in QUALITY_SHORT_EDGE) {
    const shortEdge = QUALITY_SHORT_EDGE[quality];
    if (ratio >= 1) {
      width = shortEdge * ratio;
      height = shortEdge;
    } else {
      width = shortEdge;
      height = shortEdge / ratio;
    }
  } else {
    const longEdge = QUALITY_LONG_EDGE[quality];
    if (ratio >= 1) {
      width = longEdge;
      height = longEdge / ratio;
    } else {
      width = longEdge * ratio;
      height = longEdge;
    }
  }

  return [roundToGrid(width), roundToGrid(height)];
}

function resolveSize(aspectRatio, quality) {
  if (quality === CUSTOM_QUALITY) return null;
  if (quality === AUTO_QUALITY && aspectRatio === AUTO_ASPECT_RATIO) {
    return null;
  }
  if (quality === AUTO_QUALITY) {
    return OFFICIAL_ASPECT_SIZES[aspectRatio] ?? null;
  }
  if (aspectRatio === AUTO_ASPECT_RATIO) {
    return sizeForRatio(1, 1, quality);
  }
  const ratio = ASPECT_RATIOS[aspectRatio];
  return ratio ? sizeForRatio(ratio[0], ratio[1], quality) : null;
}

function widgetByName(node, name) {
  return node.widgets?.find((widget) => widget.name === name);
}

function hasFirstImage(node) {
  return (node.inputs ?? []).some(
    (input) =>
      (input.name === "image_library" || input.name === "images.image_1") &&
      input.link != null,
  );
}

function resolutionLabel(node) {
  const aspectRatio = widgetByName(node, "aspect_ratio")?.value ?? AUTO_ASPECT_RATIO;
  const quality = widgetByName(node, "quality")?.value ?? AUTO_QUALITY;
  const followsImage = hasFirstImage(node);

  if (quality === CUSTOM_QUALITY) {
    const width = Number(widgetByName(node, "custom_width")?.value ?? 1280);
    const height = Number(widgetByName(node, "custom_height")?.value ?? 720);
    return `实际尺寸：${roundToGrid(width)} × ${roundToGrid(height)}`;
  }

  if (aspectRatio === AUTO_ASPECT_RATIO && quality === AUTO_QUALITY) {
    return followsImage ? "实际尺寸：跟随第 1 张图" : "实际尺寸：官方 2912 × 2912";
  }
  if (aspectRatio === AUTO_ASPECT_RATIO && followsImage) {
    return `实际尺寸：跟随第 1 张图尺寸 · ${quality}`;
  }

  const size = resolveSize(aspectRatio, quality);
  return size
    ? `实际尺寸：${size[0]} × ${size[1]}`
    : "实际尺寸：自动";
}

function setWidgetVisible(widget, visible) {
  if (!widget) return;

  if (!widget.__h3OriginalState) {
    widget.__h3OriginalState = {
      type: widget.type,
      hidden: widget.hidden,
      computeSize: widget.computeSize,
    };
  }

  if (visible) {
    widget.type = widget.__h3OriginalState.type;
    widget.hidden = widget.__h3OriginalState.hidden ?? false;
    if (widget.__h3OriginalState.computeSize === undefined) {
      delete widget.computeSize;
    } else {
      widget.computeSize = widget.__h3OriginalState.computeSize;
    }
  } else {
    widget.type = "hidden";
    widget.hidden = true;
    widget.computeSize = () => [0, -4];
  }
}

function setCustomDimensionVisibility(node, visible) {
  setWidgetVisible(widgetByName(node, "custom_width"), visible);
  setWidgetVisible(widgetByName(node, "custom_height"), visible);
}

function resizeNodeToVisibleWidgets(node) {
  const computed = node.computeSize?.();
  if (!computed) return;

  const width = Math.max(node.size?.[0] ?? computed[0], computed[0]);
  const height = computed[1];
  if (
    Math.abs((node.size?.[0] ?? 0) - width) > 0.5 ||
    Math.abs((node.size?.[1] ?? 0) - height) > 0.5
  ) {
    node.setSize?.([width, height]);
  }
  node.setDirtyCanvas?.(true, true);
}

function ensureResolutionWidget(node) {
  let widget = node.widgets?.find((candidate) => candidate.__h3ResolutionStatus);
  if (!widget) {
    widget = node.addWidget("text", "实际尺寸：自动", "", () => {}, {
      serialize: false,
    });
    widget.__h3ResolutionStatus = true;
    widget.disabled = true;
    widget.serialize = false;
    widget.serializeValue = async () => undefined;
  }
  return widget;
}

function refreshResolutionLabel(node) {
  const aspectRatio = widgetByName(node, "aspect_ratio");
  const quality = widgetByName(node, "quality");
  if (!aspectRatio || !quality) return;

  setCustomDimensionVisibility(node, quality.value === CUSTOM_QUALITY);
  ensureResolutionWidget(node).name = resolutionLabel(node);
  requestAnimationFrame(() => resizeNodeToVisibleWidgets(node));
  node.setDirtyCanvas?.(true, true);
}

function installResolutionLabel(node) {
  const aspectRatio = widgetByName(node, "aspect_ratio");
  const quality = widgetByName(node, "quality");
  if (!aspectRatio || !quality) return;

  const customWidth = widgetByName(node, "custom_width");
  const customHeight = widgetByName(node, "custom_height");

  if (!aspectRatio.__h3ResolutionWrapped) {
    aspectRatio.__h3ResolutionWrapped = true;
    const originalCallback = aspectRatio.callback;
    aspectRatio.callback = (...args) => {
      const result = originalCallback?.apply(aspectRatio, args);
      refreshResolutionLabel(node);
      return result;
    };
  }

  if (!quality.__h3ResolutionWrapped) {
    quality.__h3ResolutionWrapped = true;
    const originalCallback = quality.callback;
    quality.callback = (...args) => {
      const result = originalCallback?.apply(quality, args);
      refreshResolutionLabel(node);
      return result;
    };
  }

  for (const widget of [customWidth, customHeight]) {
    if (!widget || widget.__h3ResolutionWrapped) continue;
    widget.__h3ResolutionWrapped = true;
    const originalCallback = widget.callback;
    widget.callback = (...args) => {
      const result = originalCallback?.apply(widget, args);
      refreshResolutionLabel(node);
      return result;
    };
  }

  refreshResolutionLabel(node);
}

app.registerExtension({
  name: "H3Image.ResolutionLabel",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    const nodeName = nodeData?.name ?? nodeType.comfyClass;
    if (nodeName !== "H3ImageGenerate" && nodeType.comfyClass !== "H3ImageGenerate") return;
    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = onNodeCreated?.apply(this, arguments);
      installResolutionLabel(this);
      return result;
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const result = onConfigure?.apply(this, arguments);
      requestAnimationFrame(() => {
        installResolutionLabel(this);
        refreshResolutionLabel(this);
      });
      return result;
    };

    const onConnectionsChange = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
      const result = onConnectionsChange?.apply(this, arguments);
      refreshResolutionLabel(this);
      return result;
    };
  },
});
