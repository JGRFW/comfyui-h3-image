import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

const NODE_ID = "H3ImageLibrary";
const MAX_IMAGES = 9;
const STYLE_ID = "h3-image-library-styles";
const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|gif|bmp|tiff?|avif)$/i;

function widgetByName(node, name) {
  return node.widgets?.find((widget) => widget.name === name);
}

function normalizeFilename(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\/+/, "").trim();
}

function parseImages(rawValue) {
  let value = rawValue;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value || "{}");
    } catch {
      value = {};
    }
  }

  if (Array.isArray(value)) {
    value = { images: value };
  }

  const entries = Array.isArray(value?.images) ? value.images : [];
  return entries
    .map((entry) => normalizeFilename(typeof entry === "object" ? entry?.filename : entry))
    .filter((filename) => filename && !filename.split("/").includes(".."))
    .slice(0, MAX_IMAGES);
}

function imageUrl(filename) {
  const normalized = normalizeFilename(filename);
  if (!normalized) return "";
  const parts = normalized.split("/");
  const name = parts.pop() || normalized;
  const params = new URLSearchParams({ filename: name, type: "input" });
  if (parts.length) params.set("subfolder", parts.join("/"));
  return `/view?${params.toString()}`;
}

function shortFilename(filename) {
  const name = normalizeFilename(filename).split("/").pop() || filename;
  if (name.length <= 30) return name;
  return `${name.slice(0, 26)}...${name.slice(-8)}`;
}

function hideWidget(widget) {
  if (!widget) return;
  widget.hidden = true;
  widget.type = "hidden";
  widget.computeSize = () => [0, -4];
  widget.options ||= {};
  widget.options.hidden = true;
  widget.options.canvasOnly = true;
}

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .h3il-root {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 250px;
      box-sizing: border-box;
      gap: 7px;
      padding: 2px 0 0;
      color: #d7dce0;
      font: 11px/1.25 Inter, "Segoe UI", sans-serif;
    }
    .h3il-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-height: 25px;
      box-sizing: border-box;
    }
    .h3il-title {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }
    .h3il-title strong {
      color: #edf1f3;
      font-size: 11px;
      font-weight: 650;
    }
    .h3il-count {
      color: #8f9ba4;
      font-variant-numeric: tabular-nums;
    }
    .h3il-status {
      min-width: 0;
      overflow: hidden;
      color: #f0a85a;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .h3il-clear {
      flex: 0 0 auto;
      height: 24px;
      padding: 0 9px;
      border: 1px solid #3d454c;
      border-radius: 4px;
      background: #22262a;
      color: #aeb8bf;
      cursor: pointer;
    }
    .h3il-clear:hover {
      border-color: #626d76;
      color: #f0f3f5;
    }
    .h3il-clear:disabled {
      cursor: default;
      opacity: .45;
    }
    .h3il-grid {
      display: grid;
      flex: 1 1 auto;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      grid-template-rows: repeat(3, minmax(0, 1fr));
      gap: 6px;
      min-width: 0;
      min-height: 0;
    }
    .h3il-root.is-file-drop-target .h3il-grid {
      outline: 1px solid #67b8ff;
      outline-offset: 2px;
    }
    .h3il-root.is-file-drop-target .h3il-cell.is-empty {
      border-color: #67b8ff;
      background: #1b2b39;
    }
    .h3il-cell:focus-visible {
      border-color: #67b8ff;
      outline: 1px solid rgba(103, 184, 255, .5);
      outline-offset: 1px;
    }
    .h3il-file-input {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      opacity: 0;
      pointer-events: none;
    }
    .h3il-cell {
      position: relative;
      min-width: 0;
      min-height: 0;
      margin: 0;
      padding: 0;
      overflow: hidden;
      border: 1px solid #353d44;
      border-radius: 6px;
      background: #171a1d;
      color: #75808a;
      cursor: pointer;
      isolation: isolate;
    }
    .h3il-cell:hover {
      border-color: #65717a;
      background: #1d2125;
    }
    .h3il-cell.is-empty {
      border-style: dashed;
    }
    .h3il-cell.is-file-over {
      border-color: #67b8ff;
      background: #1b2b39;
    }
    .h3il-cell.is-primary {
      border-color: #b8874e;
    }
    .h3il-cell img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: contain;
      background:
        linear-gradient(45deg, #1c1f22 25%, transparent 25%),
        linear-gradient(-45deg, #1c1f22 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, #1c1f22 75%),
        linear-gradient(-45deg, transparent 75%, #1c1f22 75%);
      background-color: #121416;
      background-position: 0 0, 0 5px, 5px -5px, -5px 0;
      background-size: 10px 10px;
      pointer-events: none;
    }
    .h3il-empty-mark {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #58636c;
      font-size: 25px;
      font-weight: 300;
      pointer-events: none;
    }
    .h3il-cell:not(.is-empty) .h3il-empty-mark {
      display: none;
    }
    .h3il-plus {
      position: relative;
      width: 30px;
      height: 30px;
      border: 1px solid #4b5660;
      border-radius: 50%;
      background: rgba(255, 255, 255, .025);
      color: #7d8b96;
      transition: border-color .12s ease, background .12s ease, color .12s ease;
    }
    .h3il-plus::before,
    .h3il-plus::after {
      box-sizing: border-box;
      position: absolute;
      top: 50%;
      left: 50%;
      width: 12px;
      height: 1.5px;
      border-radius: 2px;
      background: currentColor;
      content: "";
      transform: translate(-50%, -50%);
    }
    .h3il-plus::after {
      transform: translate(-50%, -50%) rotate(90deg);
    }
    .h3il-cell.is-empty:hover .h3il-plus,
    .h3il-cell.is-file-over .h3il-plus {
      border-color: #67b8ff;
      background: rgba(103, 184, 255, .1);
      color: #9bd0ff;
    }
    .h3il-badge {
      position: absolute;
      z-index: 2;
      top: 5px;
      left: 5px;
      max-width: calc(100% - 34px);
      padding: 2px 6px;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, .16);
      border-radius: 4px;
      background: rgba(12, 15, 18, .84);
      color: #e8ecef;
      font-size: 10px;
      font-weight: 650;
      text-overflow: ellipsis;
      white-space: nowrap;
      pointer-events: none;
    }
    .h3il-cell.is-primary .h3il-badge {
      border-color: rgba(240, 178, 101, .48);
      color: #ffd29b;
    }
    .h3il-name {
      position: absolute;
      z-index: 2;
      right: 0;
      bottom: 0;
      left: 0;
      padding: 15px 24px 5px 6px;
      overflow: hidden;
      background: linear-gradient(transparent, rgba(5, 7, 9, .92) 58%);
      color: #e4e8eb;
      font-size: 9px;
      text-overflow: ellipsis;
      white-space: nowrap;
      pointer-events: none;
    }
    .h3il-remove {
      position: absolute;
      z-index: 3;
      top: 4px;
      right: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      padding: 0;
      border: 1px solid rgba(255, 255, 255, .18);
      border-radius: 4px;
      background: rgba(12, 15, 18, .88);
      color: #cbd2d8;
      font: 16px/1 sans-serif;
      cursor: pointer;
      opacity: 0;
      transition: opacity .12s ease;
    }
    .h3il-cell:hover .h3il-remove,
    .h3il-remove:focus-visible {
      opacity: 1;
    }
    .h3il-remove:hover {
      border-color: #b95c5c;
      background: #582526;
      color: #fff;
    }
    .h3il-cell.is-uploading::after {
      position: absolute;
      inset: 0;
      z-index: 4;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(10, 13, 16, .72);
      color: #dce8f2;
      content: "…";
      font-size: 24px;
    }
  `;
  document.head.append(style);
}

function createCell(node, index) {
  const cell = document.createElement("div");
  cell.tabIndex = 0;
  cell.setAttribute("role", "button");
  cell.className = "h3il-cell is-empty";
  cell.dataset.index = String(index);
  cell.draggable = false;
  cell.title = index === 0 ? "第 1 张：编辑原图" : `第 ${index + 1} 张：参考图`;

  const badge = document.createElement("span");
  badge.className = "h3il-badge";
  const image = document.createElement("img");
  image.alt = "";
  image.hidden = true;
  const emptyMark = document.createElement("span");
  emptyMark.className = "h3il-empty-mark";
  const plus = document.createElement("span");
  plus.className = "h3il-plus";
  plus.setAttribute("aria-hidden", "true");
  emptyMark.append(plus);
  const name = document.createElement("span");
  name.className = "h3il-name";
  name.hidden = true;
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "h3il-remove";
  remove.textContent = "×";
  remove.title = "删除这张图片";
  remove.setAttribute("aria-label", "删除这张图片");
  remove.hidden = true;
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.className = "h3il-file-input";
  fileInput.accept = "image/*";
  fileInput.multiple = true;
  fileInput.tabIndex = -1;
  fileInput.setAttribute("aria-hidden", "true");

  for (const element of [badge, image, emptyMark, name, remove]) {
    element.addEventListener("pointerdown", stopPropagation);
    element.addEventListener("mousedown", stopPropagation);
  }

  fileInput.addEventListener("pointerdown", stopPropagation);
  fileInput.addEventListener("mousedown", stopPropagation);
  fileInput.addEventListener("click", stopPropagation);
  fileInput.addEventListener("change", () => {
    const files = Array.from(fileInput.files || []);
    fileInput.value = "";
    if (files.length) uploadFiles(node, files, index);
  });

  cell.addEventListener("dragstart", (event) => {
    const images = readImages(node);
    if (index >= images.length) {
      event.preventDefault();
      return;
    }
    node.__h3ImageDragIndex = index;
    event.dataTransfer?.setData("application/x-h3-image-index", String(index));
    event.dataTransfer?.setData("text/plain", images[index]);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    cell.classList.add("is-dragging");
  });

  cell.addEventListener("dragend", () => {
    node.__h3ImageDragIndex = null;
    clearDropState(node);
  });

  cell.addEventListener("click", (event) => {
    stopEvent(event);
    fileInput.click();
  });

  cell.addEventListener("dblclick", stopEvent);
  cell.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    stopEvent(event);
    fileInput.click();
  });

  cell.addEventListener("dragover", (event) => {
    if (!event.dataTransfer) return;
    const internal = node.__h3ImageDragIndex != null
      || hasTransferType(event.dataTransfer, "application/x-h3-image-index");
    const external = hasExternalFiles(event.dataTransfer);
    if (!internal && !external) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = internal ? "move" : "copy";
    node.__h3ImageLibraryRoot?.classList.remove("is-file-drop-target");
    clearDropState(node, cell);
    cell.classList.add("is-file-over");
  });

  cell.addEventListener("dragleave", (event) => {
    if (event.relatedTarget instanceof globalThis.Node && cell.contains(event.relatedTarget)) return;
    cell.classList.remove("is-file-over");
  });

  cell.addEventListener("drop", (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    cell.classList.remove("is-file-over");

    const sourceIndex = node.__h3ImageDragIndex;
    if (sourceIndex != null) {
      moveImage(node, Number(sourceIndex), index);
      node.__h3ImageDragIndex = null;
      return;
    }

    const files = filesFromDataTransfer(event.dataTransfer);
    if (files.length) uploadFiles(node, files, index);
  });

  remove.addEventListener("click", (event) => {
    stopEvent(event);
    const images = readImages(node);
    images.splice(index, 1);
    writeImages(node, images);
  });

  cell.append(badge, image, emptyMark, name, remove, fileInput);
  cell.__h3ImageParts = { badge, image, emptyMark, name, remove, fileInput };
  return cell;
}

function stopEvent(event) {
  event.preventDefault?.();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
}

function stopPropagation(event) {
  event.stopPropagation();
  event.stopImmediatePropagation?.();
}

function hasTransferType(dataTransfer, type) {
  return Array.from(dataTransfer?.types || []).includes(type);
}

function hasExternalFiles(dataTransfer) {
  if (!dataTransfer) return false;
  return hasTransferType(dataTransfer, "Files")
    || Array.from(dataTransfer.items || []).some((item) => item?.kind === "file");
}

function clearDropState(node, exception = null) {
  for (const cell of node.__h3ImageCells || []) {
    if (cell !== exception) cell.classList.remove("is-file-over");
  }
}

function readImages(node) {
  return parseImages(widgetByName(node, "image_state")?.value);
}

function writeImages(node, images, status = "") {
  const stateWidget = widgetByName(node, "image_state");
  if (!stateWidget) return;
  const normalized = (Array.isArray(images) ? images : [])
    .map(normalizeFilename)
    .filter((filename) => filename && !filename.split("/").includes(".."))
    .slice(0, MAX_IMAGES);
  stateWidget.value = JSON.stringify({ version: 1, images: normalized.map((filename) => ({ filename })) });
  renderLibrary(node, status);
}

function renderLibrary(node, status = "") {
  const root = node.__h3ImageLibraryRoot;
  if (!root) return;
  const images = readImages(node);
  const count = root.querySelector(".h3il-count");
  const clear = root.querySelector(".h3il-clear");
  const statusLabel = root.querySelector(".h3il-status");

  count.textContent = `${images.length} / ${MAX_IMAGES}`;
  clear.disabled = images.length === 0;
  statusLabel.textContent = status;

  for (let index = 0; index < MAX_IMAGES; index += 1) {
    const cell = node.__h3ImageCells[index];
    const { badge, image, emptyMark, name, remove } = cell.__h3ImageParts;
    const filename = images[index];
    const hasImage = Boolean(filename);

    cell.classList.toggle("is-empty", !hasImage);
    cell.classList.toggle("is-primary", index === 0 && hasImage);
    cell.draggable = hasImage;
    badge.textContent = index === 0 ? "原图" : `参考 ${index}`;
    image.hidden = !hasImage;
    emptyMark.hidden = hasImage;
    name.hidden = !hasImage;
    remove.hidden = !hasImage;

    if (hasImage) {
      const url = imageUrl(filename);
      if (image.getAttribute("src") !== url) image.src = url;
      image.alt = shortFilename(filename);
      name.textContent = shortFilename(filename);
      name.title = filename;
      cell.title = `第 ${index + 1} 张 · 单击替换，拖动换位`;
    } else {
      image.removeAttribute("src");
      image.alt = "";
      name.textContent = "";
      name.title = "";
      cell.title = index === 0 ? "添加编辑原图" : `添加参考图 ${index}`;
    }
  }
}

function filesFromDataTransfer(dataTransfer) {
  const files = Array.from(dataTransfer?.files || []);
  if (files.length) return files;
  return Array.from(dataTransfer?.items || [])
    .filter((item) => item?.kind === "file")
    .map((item) => item.getAsFile?.())
    .filter(Boolean);
}

function isImageFile(file) {
  return String(file?.type || "").toLowerCase().startsWith("image/")
    || IMAGE_EXTENSIONS.test(String(file?.name || ""));
}

async function uploadOne(file) {
  const form = new FormData();
  form.append("image", file, String(file.name || "h3-image.png"));
  form.append("type", "input");
  const response = await api.fetchApi("/upload/image", { method: "POST", body: form });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
  const name = String(data?.name || data?.filename || "").trim();
  if (!name) throw new Error("上传接口没有返回文件名");
  const subfolder = String(data?.subfolder || "").replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  return subfolder ? `${subfolder}/${name}` : name;
}

async function uploadFilesNow(node, fileList, startIndex) {
  const files = Array.from(fileList || []).filter(isImageFile);
  if (!files.length) return;
  const images = readImages(node);
  let cursor = Math.max(0, Math.min(Number(startIndex) || 0, images.length));
  let inserted = 0;
  let replacedAtStart = false;
  const errors = [];
  const cells = node.__h3ImageCells || [];
  cells[cursor]?.classList.add("is-uploading");
  renderLibrary(node, "上传中…");

  for (const file of files) {
    if (images.length >= MAX_IMAGES) break;
    try {
      const filename = await uploadOne(file);
      if (cursor < images.length && !replacedAtStart) {
        images.splice(cursor, 1, filename);
        replacedAtStart = true;
      } else {
        images.splice(Math.min(cursor, images.length), 0, filename);
      }
      cursor += 1;
      inserted += 1;
      writeImages(node, images);
    } catch (error) {
      errors.push(`${file.name || "图片"}：${error?.message || error}`);
    }
  }

  for (const cell of cells) cell.classList.remove("is-uploading");
  const status = errors.length
    ? `上传失败：${errors[0]}`
    : inserted ? `已加入 ${inserted} 张` : "已达到 9 张上限";
  renderLibrary(node, status);
  if (status) {
    setTimeout(() => {
      if (node.__h3ImageLibraryRoot?.isConnected) renderLibrary(node);
    }, 2600);
  }
}

function uploadFiles(node, files, startIndex) {
  const previous = node.__h3ImageUploadQueue || Promise.resolve();
  const queued = previous
    .catch(() => {})
    .then(() => uploadFilesNow(node, files, startIndex));
  node.__h3ImageUploadQueue = queued;
  const clear = () => {
    if (node.__h3ImageUploadQueue === queued) delete node.__h3ImageUploadQueue;
  };
  queued.then(clear, clear);
  return queued;
}

function moveImage(node, sourceIndex, targetIndex) {
  const images = readImages(node);
  if (
    sourceIndex < 0
    || sourceIndex >= images.length
    || targetIndex < 0
    || targetIndex >= MAX_IMAGES
    || sourceIndex === targetIndex
  ) {
    return;
  }
  const [moved] = images.splice(sourceIndex, 1);
  images.splice(Math.min(targetIndex, images.length), 0, moved);
  writeImages(node, images, "顺序已更新");
  setTimeout(() => {
    if (node.__h3ImageLibraryRoot?.isConnected) renderLibrary(node);
  }, 1600);
}

function createPanel(node) {
  installStyles();
  const root = document.createElement("div");
  root.className = "h3il-root";

  const toolbar = document.createElement("div");
  toolbar.className = "h3il-toolbar";
  const title = document.createElement("div");
  title.className = "h3il-title";
  const heading = document.createElement("strong");
  heading.textContent = "图片";
  const count = document.createElement("span");
  count.className = "h3il-count";
  const status = document.createElement("span");
  status.className = "h3il-status";
  title.append(heading, count, status);

  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "h3il-clear";
  clear.textContent = "清空";
  clear.title = "清空全部图片";
  clear.addEventListener("pointerdown", stopPropagation);
  clear.addEventListener("mousedown", stopPropagation);
  clear.addEventListener("click", (event) => {
    stopEvent(event);
    writeImages(node, [], "已清空");
  });
  toolbar.append(title, clear);

  const grid = document.createElement("div");
  grid.className = "h3il-grid";
  grid.addEventListener("pointerdown", (event) => event.stopPropagation());
  grid.addEventListener("mousedown", (event) => event.stopPropagation());
  grid.addEventListener("wheel", (event) => event.stopPropagation(), { passive: true });

  node.__h3ImageCells = Array.from({ length: MAX_IMAGES }, (_, index) => createCell(node, index));
  grid.append(...node.__h3ImageCells);
  root.append(toolbar, grid);

  root.addEventListener("pointerdown", (event) => event.stopPropagation());
  root.addEventListener("mousedown", (event) => event.stopPropagation());
  root.addEventListener("click", (event) => event.stopPropagation());
  root.addEventListener("dblclick", (event) => event.stopPropagation());
  root.addEventListener("wheel", (event) => event.stopPropagation(), { passive: true });

  root.addEventListener("dragover", (event) => {
    if (!hasExternalFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    root.classList.add("is-file-drop-target");
  });
  root.addEventListener("dragleave", (event) => {
    if (event.relatedTarget instanceof globalThis.Node && root.contains(event.relatedTarget)) return;
    root.classList.remove("is-file-drop-target");
  });
  root.addEventListener("drop", (event) => {
    if (!hasExternalFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    root.classList.remove("is-file-drop-target");
    uploadFiles(node, filesFromDataTransfer(event.dataTransfer), readImages(node).length);
  });

  node.__h3ImageLibraryRoot = root;
  return root;
}

function installLibrary(node) {
  if (!node || node.__h3ImageLibraryInstalled) return;
  node.__h3ImageLibraryInstalled = true;

  hideWidget(widgetByName(node, "image_state"));
  const root = createPanel(node);
  const widget = node.addDOMWidget("h3_image_grid", "h3_image_grid", root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => 250,
  });
  if (widget) {
    widget.serialize = false;
    widget.options ||= {};
    widget.options.serialize = false;
    node.__h3ImageLibraryWidget = widget;
  }

  if (Array.isArray(node.size)) {
    node.size[0] = Math.max(360, Number(node.size[0]) || 0);
    node.size[1] = Math.max(510, Number(node.size[1]) || 0);
  }
  renderLibrary(node);

  if (typeof ResizeObserver === "function") {
    node.__h3ImageLibraryObserver = new ResizeObserver(() => {
      node.setDirtyCanvas?.(true, true);
    });
    node.__h3ImageLibraryObserver.observe(root);
  }
}

app.registerExtension({
  name: "H3Image.ImageLibrary",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    const nodeName = nodeData?.name ?? nodeType.comfyClass;
    if (nodeName !== NODE_ID && nodeType.comfyClass !== NODE_ID) return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = onNodeCreated?.apply(this, arguments);
      installLibrary(this);
      return result;
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const result = onConfigure?.apply(this, arguments);
      requestAnimationFrame(() => {
        installLibrary(this);
        renderLibrary(this);
      });
      return result;
    };

    const onResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function () {
      const result = onResize?.apply(this, arguments);
      requestAnimationFrame(() => {
        if (this.__h3ImageLibraryRoot) {
          this.__h3ImageLibraryRoot.style.height = "100%";
          this.setDirtyCanvas?.(true, true);
        }
      });
      return result;
    };

    const onRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      this.__h3ImageLibraryObserver?.disconnect?.();
      const result = onRemoved?.apply(this, arguments);
      return result;
    };
  },
});
