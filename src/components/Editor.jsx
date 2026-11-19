import DesignThumbnail from "./DesignThumbnail.jsx";
import { useDrawerFocus } from "./ui/useDrawerFocus.js";
import ModalFrame from "./ui/ModalFrame.jsx";
import { useVisualViewport } from "./ui/useVisualViewport.js";
import { createDraftJournal } from "../lib/draft-cache";
import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Cloud,
  Copy,
  Download,
  Eye,
  EyeOff,
  ImagePlus,
  Layers,
  LayoutTemplate,
  Lock,
  Maximize2,
  Minus,
  MoreHorizontal,
  Move,
  Palette,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Settings2,
  Shapes,
  Sparkles,
  Square,
  Trash2,
  Type,
  Undo2,
  Unlock,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import "./editor.css";

import { api, uploadAsset, waitForJob, refreshWorkspace } from "../lib/api";
import {
  NodeContent,
  nodeStyle,
  DOCUMENT_FONT,
} from "../../packages/doc-render/src/render";
import {
  resizeArtboard,
  applyOps,
  diffDesign,
  ArtboardSchema,
} from "../../packages/doc-core/src/index";

const FONT = DOCUMENT_FONT;
const COLORS = [
  "#f0e7d8",
  "#f2634b",
  "#323a2e",
  "#f9f8f5",
  "#cedbd7",
  "#e8c5c1",
  "#25272c",
  "#ffffff",
];
const uid = () =>
  `layer-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const clone = (value) => JSON.parse(JSON.stringify(value));
const esc = (text) =>
  String(text).replace(
    /[<>&"']/g,
    (x) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[x],
  );
export { initialDesign } from "../data/template-design.js";
import { initialDesign } from "../data/template-design.js";

function IconButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  active,
  className = "",
}) {
  return (
    <button
      type="button"
      className={`ed-icon-button ${active ? "is-active" : ""} ${className}`}
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={disabled}
    >
      <Icon size={18} />
    </button>
  );
}
function ColorPicker({ value, onChange, label = "颜色" }) {
  return (
    <div className="ed-color-picker">
      <label className="ed-color-input" title={label}>
        <input
          type="color"
          aria-label={label}
          value={/^#[0-9a-f]{6}$/i.test(value || "") ? value : "#ffffff"}
          onChange={(e) => onChange(e.target.value)}
        />
        <span style={{ background: value }} />
      </label>
      <span>{value?.toUpperCase()}</span>
    </div>
  );
}
export default function Editor({
  project,
  draftOwner,
  onBack,
  onSave,
  onCopy,
  onToast,
}) {
  const cacheKey =
    String(project.projectId || project.id) +
    ":" +
    String(project.documentId || "primary");
  const [journal] = useState(() =>
    createDraftJournal(`editor:${draftOwner}:${cacheKey}`, cacheKey),
  );
  const [otherDrafts, setOtherDrafts] = useState([]);
  const [cacheReady, setCacheReady] = useState(false);
  const pendingRequest = useRef(null),
    copyRequest = useRef(null),
    mounted = useRef(true);
  const conflictRef = useRef(false),
    recoveryBusy = useRef(false);
  const [recovering, setRecovering] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const projectRef = useRef(project),
    savingRef = useRef(null),
    changeRef = useRef(0),
    composingRef = useRef(false);
  const [saving, setSaving] = useState(false),
    [saveError, setSaveError] = useState(""),
    [conflict, setConflict] = useState(false),
    [versions, setVersions] = useState(null),
    [versionName, setVersionName] = useState("");
  const [design, setDesign] = useState(() => clone(initialDesign(project)));
  const W = design.width || 600,
    H = design.height || 800;
  const ratio =
    project?.ratio ||
    ["3:4", "1:1", "16:9", "9:16"].find((r) => {
      const [a, b] = r.split(":").map(Number);
      return Math.abs(a / b - W / H) < 0.01;
    }) ||
    "自定义";
  const designRef = useRef(design);
  const committedDesign = useRef(clone(design));
  const history = useRef([null]),
    historyIndex = useRef(0);
  const [, renderHistory] = useState(0);
  const [title, setTitle] = useState(project?.title || "秋日咖啡 · 品牌海报");
  const titleRef = useRef(title);
  titleRef.current = title;
  const [selectionIds, setSelectionIds] = useState([]);
  const clipboard = useRef([]);
  const [selectedId, setActiveId] = useState(
    project?.blank ? null : "subtitle",
  );
  const setSelectedId = (id) => {
    setActiveId(id);
    setSelectionIds(id ? [id] : []);
  };
  const [brand, setBrand] = useState(null);
  useEffect(() => {
    api("/preferences/brand")
      .then(setBrand)
      .catch(() => {});
  }, []);
  function applyBrand() {
    if (!brand) return;
    commit((d) => ({
      ...d,
      background: brand.colors?.[2] || d.background,
      nodes: d.nodes.map((n) =>
        n.type === "text"
          ? {
              ...n,
              color: brand.colors?.[1] || n.color,
              font: brand.font || n.font,
            }
          : n.type === "rect" || n.type === "circle"
            ? { ...n, color: brand.colors?.[0] || n.color }
            : n,
      ),
    }));
    notify("已应用品牌配色");
  }
  function addBrandLogo() {
    if (!brand?.logo) return;
    commit((d) => ({
      ...d,
      nodes: [
        ...d.nodes,
        {
          id: uid(),
          type: "image",
          src: brand.logo,
          label: "品牌 Logo",
          x: 24,
          y: 24,
          w: 120,
          h: 80,
          fit: "contain",
        },
      ],
    }));
  }
  const [tab, setTab] = useState("templates");
  const [zoom, setZoom] = useState(68);
  const [autoFit, setAutoFit] = useState(true);
  const [saved, setSaved] = useState(project.persisted !== false);
  const [exportOpen, setExportOpen] = useState(false);
  const [format, setFormat] = useState("PNG");
  const [exportScale, setExportScale] = useState(2);
  const [transparent, setTransparent] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [exportProgress, setExportProgress] = useState("");
  const [exportJob, setExportJob] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const exportAttempt = useRef(null),
    exportVisible = useRef(false);
  exportVisible.current = exportOpen;
  const rootViewport = useRef(null);
  useVisualViewport(rootViewport);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [leftOpen, setLeftOpen] = useState(false);
  const libraryDrawer = useRef(null),
    propertiesDrawer = useRef(null);
  useDrawerFocus(libraryDrawer, leftOpen, "(max-width:850px)");
  useDrawerFocus(propertiesDrawer, inspectorOpen, "(max-width:1100px)");
  const stageRef = useRef(null),
    fileRef = useRef(null),
    dragRef = useRef(null);
  const selected = design.nodes.find((n) => n.id === selectedId);
  const apply = (next) => {
    changeRef.current += 1;
    designRef.current = next;
    setDesign(next);
    setSaved(false);
  };
  const commit = (next) => {
    try {
      const value = ArtboardSchema.parse(
        typeof next === "function" ? next(designRef.current) : next,
      );
      const ops = diffDesign(committedDesign.current, value);
      if (!ops.length) {
        apply(value);
        return;
      }
      const inverse = diffDesign(value, committedDesign.current);
      history.current = [
        ...history.current.slice(0, historyIndex.current + 1),
        { ops, inverse },
      ].slice(-201);
      historyIndex.current = history.current.length - 1;
      committedDesign.current = clone(value);
      apply(value);
      renderHistory((n) => n + 1);
    } catch (e) {
      notify("无法应用修改：" + (e.issues?.[0]?.message || e.message));
    }
  };
  const updateNode = (id, values) =>
    commit((d) => ({
      ...d,
      nodes: d.nodes.map((n) => (n.id === id ? { ...n, ...values } : n)),
    }));
  const notify = (message) => onToast?.(message);
  const undo = () => {
    if (!historyIndex.current) return;
    const value = applyOps(
      designRef.current,
      history.current[historyIndex.current].inverse,
    );
    historyIndex.current--;
    committedDesign.current = clone(value);
    apply(value);
    renderHistory((n) => n + 1);
  };
  const redo = () => {
    if (historyIndex.current >= history.current.length - 1) return;
    historyIndex.current++;
    const value = applyOps(
      designRef.current,
      history.current[historyIndex.current].ops,
    );
    committedDesign.current = clone(value);
    apply(value);
    renderHistory((n) => n + 1);
  };
  const draftValue = () => ({
    design: designRef.current,
    title: titleRef.current,
    baseRevision: projectRef.current.revision,
    pending: pendingRequest.current,
    copy: copyRequest.current,
    project: {
      id: project.id,
      projectId: project.projectId,
      documentId: project.documentId,
      workspaceMode: project.workspaceMode,
    },
  });
  const sameContent = (a, b) =>
    a.title.trim() === b.title.trim() && !diffDesign(a.design, b.design).length;
  const cacheFailure = () =>
    setSaveError("浏览器无法保留离线草稿，请保持页面开启并保存。");
  async function refreshDrafts() {
    const values = await journal.list();
    setOtherDrafts(
      values.filter(
        (entry) => ArtboardSchema.safeParse(entry.value?.design).success,
      ),
    );
  }
  function applyDraft(draft) {
    const value = ArtboardSchema.parse(draft.design);
    designRef.current = clone(value);
    committedDesign.current = clone(value);
    titleRef.current = draft.title;
    setDesign(clone(value));
    setTitle(draft.title);
    history.current = [null];
    historyIndex.current = 0;
    pendingRequest.current = draft.pending || null;
    copyRequest.current = draft.copy || null;
    // A pending idempotent request must be reconciled before declaring conflict.
    const changed =
      project.unavailable ||
      (draft.baseRevision !== projectRef.current.revision && !draft.pending);
    projectRef.current = {
      ...projectRef.current,
      revision: draft.baseRevision,
    };
    conflictRef.current = changed;
    setConflict(changed);
    setSaved(false);
    setSaveError(
      project.unavailable
        ? "作品已删除或当前账号无法访问。未同步草稿仍保留在本机，可另存副本，或恢复原作品后使用最新版本。"
        : changed
          ? "发现未同步的本地修改，服务器已有新版本。请保留为副本或使用最新版本。"
          : "",
    );
    changeRef.current++;
  }
  useEffect(() => {
    let active = true;
    (async () => {
      const entries = await journal.list();
      if (!active) return;
      const valid = entries.filter(
        (entry) => ArtboardSchema.safeParse(entry.value?.design).success,
      );
      const entry = valid[0];
      if (entry) {
        await journal.adopt(entry);
        if (!active) return;
        if (!project.unavailable && sameContent(entry.value, project))
          await journal.clear();
        else {
          applyDraft(entry.value);
          await journal.put(draftValue());
          notify("已恢复尚未同步的修改");
        }
      }
      if (active) await refreshDrafts();
    })()
      .catch(cacheFailure)
      .finally(() => {
        if (active) setCacheReady(true);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (cacheReady && !saved) journal.put(draftValue()).catch(cacheFailure);
  }, [design, title, saved, cacheReady]);
  const save = async (manual = true) => {
    if (!cacheReady || conflictRef.current || recoveryBusy.current)
      return false;
    if (savingRef.current) return savingRef.current;
    setSaving(true);
    setSaveError("");
    const pending = (async () => {
      try {
        // Flush edits made during a request before allowing navigation or export.
        while (mounted.current) {
          if (!pendingRequest.current)
            pendingRequest.current = {
              ...projectRef.current,
              title: titleRef.current.trim() || "未命名设计",
              design: clone(designRef.current),
              saveRequestKey: crypto.randomUUID(),
            };
          const next = pendingRequest.current;
          ArtboardSchema.parse(next.design);
          // Persist the request identity before sending it; refresh can safely retry.
          await journal.put(draftValue()).catch(cacheFailure);
          const result = await onSave(next);
          if (!result || !Number.isInteger(result.revision))
            throw new Error("保存结果未确认，请重试");
          projectRef.current = { ...projectRef.current, ...result };
          pendingRequest.current = null;
          if (
            sameContent(next, {
              design: designRef.current,
              title: titleRef.current.trim() || "未命名设计",
            })
          ) {
            const counter = changeRef.current;
            await journal.clear().catch(cacheFailure);
            if (counter !== changeRef.current) continue;
            setSaved(true);
            if (manual) notify("设计已保存到个人空间");
            return true;
          }
          await journal.put(draftValue()).catch(cacheFailure);
        }
        return false;
      } catch (e) {
        if (e.status === 409) {
          conflictRef.current = true;
          setConflict(true);
          pendingRequest.current = null;
          await journal.put(draftValue()).catch(cacheFailure);
        }
        setSaveError(
          e.status === 409
            ? "这份设计已在其他页面更新。你的改动仍保留，请选择处理方式。"
            : [403, 404].includes(e.status)
              ? "作品已删除或当前账号无法访问。未同步修改仍保留在本机，可另存副本或稍后恢复原作品。"
              : e.message || "保存失败，请稍后重试",
        );
        return false;
      } finally {
        setSaving(false);
        savingRef.current = null;
      }
    })();
    savingRef.current = pending;
    return pending;
  };
  useEffect(() => {
    if (!cacheReady || saved || conflict || composingRef.current) return;
    const t = setTimeout(() => {
      if (!dragRef.current && !composingRef.current) save(false);
    }, 1300);
    return () => clearTimeout(t);
  }, [design, title, saved, conflict, cacheReady]);
  useEffect(() => {
    const before = (e) => {
      if (!saved) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [saved]);
  useEffect(() => {
    const online = () => {
      if (!saved && !conflict) save(false);
    };
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  });
  async function restoreLocal(entry) {
    if (savingRef.current || recoveryBusy.current) return;
    recoveryBusy.current = true;
    setRecovering(true);
    try {
      if (!saved) await journal.put(draftValue());
      // Use a fresh server revision to distinguish this draft from a newer save.
      const latest = await readLatest();
      await journal.adopt(entry);
      projectRef.current = { ...projectRef.current, ...latest };
      applyDraft(entry.value);
      await journal.put(draftValue());
      await refreshDrafts();
    } catch (e) {
      setSaveError(e.message);
    } finally {
      recoveryBusy.current = false;
      setRecovering(false);
    }
  }
  async function readLatest() {
    const p = projectRef.current;
    if (p.projectId && p.id !== p.projectId) {
      const board = await api("/projects/" + p.projectId + "/studio");
      const value = board.snapshot.results.find(
        (r) => r.documentId === p.documentId,
      );
      if (!value) throw new Error("画板已不存在，未同步草稿仍保留在本机");
      return value;
    }
    return api("/projects/" + p.id);
  }
  async function loadLatest() {
    if (savingRef.current || recoveryBusy.current) return;
    recoveryBusy.current = true;
    setRecovering(true);
    try {
      const value = await readLatest();
      await journal.clear();
      projectRef.current = { ...projectRef.current, ...value };
      pendingRequest.current = null;
      setDesign(clone(value.design));
      designRef.current = clone(value.design);
      setTitle(value.title);
      titleRef.current = value.title;
      committedDesign.current = clone(value.design);
      history.current = [null];
      historyIndex.current = 0;
      setSaved(true);
      setConflict(false);
      conflictRef.current = false;
      setSaveError("");
      await refreshDrafts();
      return true;
    } catch (e) {
      setSaveError(e.message);
      return false;
    } finally {
      recoveryBusy.current = false;
      setRecovering(false);
    }
  }
  async function saveCopy() {
    if (recoveryBusy.current || savingRef.current) return;
    recoveryBusy.current = true;
    setRecovering(true);
    try {
      const body = {
        title:
          (titleRef.current.trim() || "未命名设计").slice(0, 195) + " · 副本",
        design: clone(designRef.current),
        workspaceMode: "editor",
      };
      const signature = JSON.stringify(body);
      if (copyRequest.current?.signature !== signature)
        copyRequest.current = { signature, key: crypto.randomUUID() };
      await journal.put(draftValue());
      const p = await api("/projects", {
        method: "POST",
        headers: { "Idempotency-Key": copyRequest.current.key },
        body,
      });
      await journal.clear();
      refreshWorkspace();
      onCopy(p);
      notify("已将你的修改另存为副本");
    } catch (e) {
      setSaveError(e.message);
    } finally {
      recoveryBusy.current = false;
      setRecovering(false);
    }
  }
  async function openVersions() {
    try {
      setVersions(
        await api(
          "/projects/" +
            (projectRef.current.projectId || projectRef.current.id) +
            "/versions",
        ),
      );
    } catch (e) {
      notify(e.message);
    }
  }
  async function nameVersion() {
    if (!saved && !(await save(false))) return;
    try {
      await api(
        "/projects/" +
          (projectRef.current.projectId || projectRef.current.id) +
          "/versions",
        {
          method: "POST",
          body: {
            name: versionName.trim() || "命名版本",
            documentId: projectRef.current.documentId,
          },
        },
      );
      setVersionName("");
      await openVersions();
    } catch (e) {
      notify(e.message);
    }
  }
  async function restoreVersion(id) {
    try {
      await api(
        "/projects/" +
          (projectRef.current.projectId || projectRef.current.id) +
          "/versions/" +
          id +
          "/restore",
        { method: "POST" },
      );
      if (!(await loadLatest())) return;
      setVersions(null);
      refreshWorkspace();
      notify("已恢复所选版本");
    } catch (e) {
      notify(e.message);
    }
  }
  useEffect(() => {
    if (!autoFit || !stageRef.current) return;
    const fit = () => {
      if (!stageRef.current) return;
      const rect = stageRef.current.getBoundingClientRect();
      setZoom(
        Math.max(
          20,
          Math.min(
            82,
            Math.floor(
              Math.min((rect.width - 100) / W, (rect.height - 78) / H) * 100,
            ),
          ),
        ),
      );
    };
    const observer = new ResizeObserver(fit);
    observer.observe(stageRef.current);
    fit();
    return () => observer.disconnect();
  }, [autoFit, inspectorOpen, leftOpen]);
  useEffect(() => {
    const keyboard = (e) => {
      if (e.isComposing || composingRef.current) return;
      const input = /INPUT|TEXTAREA|SELECT/.test(
        document.activeElement?.tagName,
      );
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      }
      if (!input && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      }
      if (
        !input &&
        selectedId &&
        (e.key === "Delete" || e.key === "Backspace")
      ) {
        e.preventDefault();
        deleteSelected();
      }
      if (!input && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "g") {
        e.preventDefault();
        groupSelection(e.shiftKey);
      }
      if (!input && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
        e.preventDefault();
        clipboard.current = clone(selectedNodes());
      }
      if (!input && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v") {
        e.preventDefault();
        pasteNodes(clipboard.current);
      }
      if (
        !input &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
      ) {
        e.preventDefault();
        const ids = selectedNodes().map((n) => n.id),
          step = e.shiftKey ? 10 : 1;
        commit((d) => ({
          ...d,
          nodes: d.nodes.map((n) =>
            ids.includes(n.id)
              ? {
                  ...n,
                  x:
                    n.x +
                    (e.key === "ArrowLeft"
                      ? -step
                      : e.key === "ArrowRight"
                        ? step
                        : 0),
                  y:
                    n.y +
                    (e.key === "ArrowUp"
                      ? -step
                      : e.key === "ArrowDown"
                        ? step
                        : 0),
                }
              : n,
          ),
        }));
      }
      if (e.key === "Escape") {
        setExportOpen(false);
        setPreview(false);
        setInspectorOpen(false);
        setLeftOpen(false);
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => document.removeEventListener("keydown", keyboard);
  });
  function selectedNodes() {
    const ids = selectionIds.length ? selectionIds : [selectedId];
    return designRef.current.nodes.filter(
      (n) => ids.includes(n.id) && !n.locked,
    );
  }
  function deleteSelected() {
    const ids = selectedNodes().map((n) => n.id);
    commit((d) => ({
      ...d,
      nodes: d.nodes.filter((n) => !ids.includes(n.id)),
    }));
    setSelectedId(null);
  }
  function pasteNodes(nodes) {
    if (!nodes.length) return;
    const groups = new Map();
    const added = nodes.map((n) => {
      if (n.groupId && !groups.has(n.groupId)) groups.set(n.groupId, uid());
      return {
        ...clone(n),
        id: uid(),
        x: n.x + 20,
        y: n.y + 20,
        groupId: n.groupId ? groups.get(n.groupId) : undefined,
        locked: false,
      };
    });
    commit((d) => ({ ...d, nodes: [...d.nodes, ...added] }));
    setSelectionIds(added.map((n) => n.id));
    setActiveId(added[0].id);
  }
  function duplicateSelected() {
    pasteNodes(selectedNodes());
  }
  function groupSelection(ungroup = false) {
    const ids = selectedNodes().map((n) => n.id),
      groupId = ungroup ? undefined : uid();
    commit((d) => ({
      ...d,
      nodes: d.nodes.map((n) => (ids.includes(n.id) ? { ...n, groupId } : n)),
    }));
  }
  function alignSelection(axis) {
    const nodes = selectedNodes();
    if (!nodes.length) return;
    const ids = nodes.map((n) => n.id);
    const minX = Math.min(...nodes.map((n) => n.x)),
      maxX = Math.max(...nodes.map((n) => n.x + n.w)),
      minY = Math.min(...nodes.map((n) => n.y)),
      maxY = Math.max(...nodes.map((n) => n.y + n.h));
    commit((d) => ({
      ...d,
      nodes: d.nodes.map((n) =>
        !ids.includes(n.id)
          ? n
          : {
              ...n,
              ...(axis === "left"
                ? { x: nodes.length === 1 ? 0 : minX }
                : axis === "center"
                  ? {
                      x:
                        ((nodes.length === 1 ? 0 : minX) +
                          (nodes.length === 1 ? W : maxX) -
                          n.w) /
                        2,
                    }
                  : axis === "right"
                    ? { x: (nodes.length === 1 ? W : maxX) - n.w }
                    : axis === "top"
                      ? { y: nodes.length === 1 ? 0 : minY }
                      : axis === "middle"
                        ? {
                            y:
                              ((nodes.length === 1 ? 0 : minY) +
                                (nodes.length === 1 ? H : maxY) -
                                n.h) /
                              2,
                          }
                        : { y: (nodes.length === 1 ? H : maxY) - n.h }),
            },
      ),
    }));
  }
  function addText(text = "双击灵感，开始创作", size = 36) {
    const n = {
      id: uid(),
      type: "text",
      text,
      x: Math.round(W * 0.08),
      y: Math.round(H * 0.4),
      w: Math.round(W * 0.83),
      h: size * 1.3,
      size,
      color: "#323a2e",
      weight: 500,
      font: FONT,
    };
    commit((d) => ({ ...d, nodes: [...d.nodes, n] }));
    setSelectedId(n.id);
    setLeftOpen(false);
    setInspectorOpen(true);
  }
  function addShape(type) {
    const n = {
      id: uid(),
      type,
      label: type === "circle" ? "圆形" : "矩形",
      x: Math.round((W - 200) / 2),
      y: Math.round((H - 200) / 2),
      w: 200,
      h: 200,
      color: "#f2634b",
      opacity: 1,
    };
    commit((d) => ({ ...d, nodes: [...d.nodes, n] }));
    setSelectedId(n.id);
  }
  function changeLayer(direction) {
    const index = design.nodes.findIndex((n) => n.id === selectedId),
      dest = index + direction;
    if (dest < 0 || dest >= design.nodes.length) return;
    const nodes = [...design.nodes];
    [nodes[index], nodes[dest]] = [nodes[dest], nodes[index]];
    commit({ ...design, nodes });
  }
  function startDrag(e, node) {
    if (preview || e.button !== 0) return;
    e.stopPropagation();
    const group = node.groupId
      ? designRef.current.nodes
          .filter((n) => n.groupId === node.groupId)
          .map((n) => n.id)
      : [node.id];
    const ids = e.shiftKey
      ? [...new Set([...selectionIds, ...group])]
      : selectionIds.includes(node.id)
        ? selectionIds
        : group;
    setSelectionIds(ids);
    setActiveId(node.id);
    if (e.shiftKey || node.locked) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      kind: "move",
      ids,
      id: node.id,
      startX: e.clientX,
      startY: e.clientY,
      x: node.x,
      y: node.y,
      origin: clone(designRef.current),
    };
  }
  function startResize(e, node, corner) {
    e.stopPropagation();
    if (node.locked || preview) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      kind: "resize",
      id: node.id,
      corner,
      startX: e.clientX,
      startY: e.clientY,
      x: node.x,
      y: node.y,
      w: node.w,
      h: node.h,
      size: node.size,
    };
  }
  function moveDrag(e) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = (e.clientX - drag.startX) / (zoom / 100),
      dy = (e.clientY - drag.startY) / (zoom / 100);
    let patch;
    if (drag.kind === "resize") {
      const left = drag.corner.endsWith("l"),
        top = drag.corner.startsWith("t");
      const w = Math.max(24, Math.round(drag.w + (left ? -dx : dx))),
        h = Math.max(24, Math.round(drag.h + (top ? -dy : dy)));
      patch = {
        x: left ? drag.x + drag.w - w : drag.x,
        y: top ? drag.y + drag.h - h : drag.y,
        w,
        h,
      };
      if (drag.size)
        patch.size = Math.max(
          8,
          Math.min(240, Math.round((drag.size * w) / drag.w)),
        );
    } else patch = { x: Math.round(drag.x + dx), y: Math.round(drag.y + dy) };
    if (drag.kind === "move") {
      let mx = dx,
        my = dy;
      const targetsX = [
        0,
        W / 2,
        W,
        ...designRef.current.nodes
          .filter((n) => !drag.ids.includes(n.id))
          .flatMap((n) => [n.x, n.x + n.w / 2, n.x + n.w]),
      ];
      const targetsY = [
        0,
        H / 2,
        H,
        ...designRef.current.nodes
          .filter((n) => !drag.ids.includes(n.id))
          .flatMap((n) => [n.y, n.y + n.h / 2, n.y + n.h]),
      ];
      for (const target of targetsX)
        if (Math.abs(drag.x + mx - target) < 5) {
          mx = target - drag.x;
          break;
        }
      for (const target of targetsY)
        if (Math.abs(drag.y + my - target) < 5) {
          my = target - drag.y;
          break;
        }
      apply({
        ...designRef.current,
        nodes: drag.origin.nodes.map((n) =>
          drag.ids.includes(n.id) && !n.locked
            ? { ...n, x: Math.round(n.x + mx), y: Math.round(n.y + my) }
            : n,
        ),
      });
      return;
    }
    apply({
      ...designRef.current,
      nodes: designRef.current.nodes.map((n) =>
        n.id === drag.id ? { ...n, ...patch } : n,
      ),
    });
  }
  function endDrag() {
    if (!dragRef.current) return;
    const next = clone(designRef.current);
    dragRef.current = null;
    commit(next);
  }
  function applyTheme(theme) {
    const palette =
      theme === "sage"
        ? { bg: "#dce3d8", fg: "#324b3b", accent: "#a4b65e" }
        : theme === "rose"
          ? { bg: "#f3d9d3", fg: "#823e3b", accent: "#f2634b" }
          : { bg: "#f0e7d8", fg: "#323a2e", accent: "#f2634b" };
    commit((d) => ({
      ...d,
      background: palette.bg,
      nodes: d.nodes.map((n) =>
        n.id === "title" || n.id === "subtitle" || n.id === "brand"
          ? { ...n, color: palette.fg }
          : n.id === "badge"
            ? { ...n, color: palette.accent }
            : n,
      ),
    }));
    notify("已应用配色，文字与图层继续保留");
  }
  async function upload(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadError("正在上传并处理素材…");
    try {
      const asset = await uploadAsset(
        file,
        projectRef.current.projectId || projectRef.current.id,
      );
      const photo = designRef.current.nodes.find(
        (n) => n.id === selectedId && n.type === "image",
      );
      if (photo)
        updateNode(photo.id, {
          src: asset.image,
          assetId: asset.id,
          assetVersionId: asset.versionId,
          label: asset.title,
        });
      else {
        const node = {
          id: uid(),
          type: "image",
          label: asset.title,
          src: asset.image,
          assetId: asset.id,
          assetVersionId: asset.versionId,
          x: 40,
          y: 80,
          w: Math.min(W - 80, 500),
          h: Math.min(H - 80, 400),
          opacity: 1,
        };
        commit((d) => ({ ...d, nodes: [...d.nodes, node] }));
        setSelectedId(node.id);
      }
      setUploadError("");
      notify("素材已上传并加入画布");
    } catch (e) {
      setUploadError(e.message);
    }
  }
  async function cancelExport() {
    if (!exportJob || cancelling) return;
    setCancelling(true);
    setExportError("");
    try {
      const job = await api(`/jobs/${exportJob.id}/cancel`, { method: "POST" });
      setExportJob(job);
      setExportProgress(
        job.status === "cancelled"
          ? "已取消导出"
          : job.status === "succeeded"
            ? "文件已生成，取消未生效"
            : "正在核对取消状态…",
      );
    } catch (e) {
      setExportError(`取消尚未确认：${e.message}，可重试或在创作动态核对。`);
    } finally {
      setCancelling(false);
    }
  }
  async function exportFile() {
    if (exporting) return;
    let observedStatus;
    setExporting(true);
    setExportError("");
    setExportProgress("正在保存作品…");
    try {
      if (!saved && !(await save(false)))
        throw new Error("请先完成保存，再导出作品");
      const p = projectRef.current;
      const body = {
        format: format === "JPG" ? "jpeg" : format.toLowerCase(),
        scale: exportScale,
        transparent,
        documentId: p.documentId,
      };
      const signature = JSON.stringify([p.projectId || p.id, p.revision, body]);
      if (exportAttempt.current?.signature !== signature)
        exportAttempt.current = { signature, key: crypto.randomUUID() };
      const attempt = exportAttempt.current;
      let job = attempt.jobId
        ? await api(`/jobs/${attempt.jobId}`)
        : await api("/projects/" + (p.projectId || p.id) + "/exports", {
            method: "POST",
            body,
            headers: { "Idempotency-Key": attempt.key },
          });
      attempt.jobId = job.job?.id || job.id;
      setExportJob(job);
      const done = await waitForJob(attempt.jobId, (j) => {
        observedStatus = j.status;
        setExportJob(j);
        setExportProgress(
          {
            queued: "等待导出…",
            running: "正在生成文件…",
            succeeded: "文件已生成",
            cancelled: "已取消导出",
            failed: "导出失败",
          }[j.status] || "正在核对导出状态…",
        );
        if (["failed", "cancelled"].includes(j.status))
          exportAttempt.current = null;
      });
      const id = done.result?.exportId || done.exportId || done.id;
      if (exportVisible.current) {
        const a = document.createElement("a");
        a.href = "/api/exports/" + id + "/file";
        a.download = "";
        a.click();
        setExportOpen(false);
      }
      setExportProgress("文件已生成，可从创作动态下载");
      exportAttempt.current = null;
      refreshWorkspace();
      notify(format + " 文件已生成");
    } catch (e) {
      setExportError(observedStatus === "cancelled" ? "" : e.message);
    } finally {
      setExporting(false);
    }
  }
  const setZoomValue = (value) => {
    setAutoFit(false);
    setZoom(Math.max(20, Math.min(150, value)));
  };
  const nav = [
    { id: "templates", icon: LayoutTemplate, label: "配色" },
    { id: "text", icon: Type, label: "文字" },
    { id: "elements", icon: Shapes, label: "元素" },
    { id: "uploads", icon: Upload, label: "上传" },
    { id: "background", icon: Palette, label: "背景" },
    { id: "layers", icon: Layers, label: "图层" },
  ];

  return (
    <div
      ref={rootViewport}
      aria-busy={!cacheReady || recovering}
      className={`ed-root ${preview ? "ed-preview" : ""} ${inspectorOpen ? "ed-properties-open" : ""} ${leftOpen ? "ed-left-open" : ""}`}
    >
      {!cacheReady && (
        <div className="ed-service-error" role="status">
          正在检查本机未同步的草稿…
        </div>
      )}
      {!!otherDrafts.length && (
        <details className="ed-local-drafts">
          <summary>其他本机草稿（{otherDrafts.length}）</summary>
          <p>打开其他草稿会保留当前修改。不同标签页的草稿分别保存。</p>
          {otherDrafts.map((entry) => (
            <button
              key={entry.key}
              disabled={saving || recovering}
              onClick={() => restoreLocal(entry)}
            >
              恢复草稿：{entry.value.title} ·{" "}
              {new Date(entry.value.updatedAt || Date.now()).toLocaleString()}
            </button>
          ))}
        </details>
      )}
      {saveError && (
        <div className="ed-service-error" role="alert">
          {saveError}
          {conflict ? (
            <>
              <button disabled={saving || recovering} onClick={loadLatest}>
                使用最新版本
              </button>
              <button disabled={saving || recovering} onClick={saveCopy}>
                将我的修改另存副本
              </button>
            </>
          ) : (
            <>
              <button disabled={saving || recovering} onClick={() => save()}>
                重试保存
              </button>
              <button disabled={saving || recovering} onClick={saveCopy}>
                将我的修改另存副本
              </button>
            </>
          )}
        </div>
      )}
      {versions && (
        <ModalFrame title="版本记录" onClose={() => setVersions(null)}>
          <div className="ed-modal-backdrop">
            <section className="ed-export-modal">
              <header>
                <h2>版本记录</h2>
                <button
                  onClick={() => setVersions(null)}
                  aria-label="关闭版本记录"
                >
                  <X size={18} />
                </button>
              </header>
              <div className="ed-version-create">
                <input
                  aria-label="版本名称"
                  placeholder="为当前版本命名"
                  value={versionName}
                  onChange={(e) => setVersionName(e.target.value)}
                />
                <button onClick={nameVersion}>保存命名版本</button>
              </div>
              <div className="ed-version-list">
                {versions
                  .filter(
                    (v) =>
                      !projectRef.current.documentId ||
                      v.documentId === projectRef.current.documentId,
                  )
                  .map((v) => (
                    <div key={v.id}>
                      <span>
                        {v.name || "自动保存"}
                        <small>{new Date(v.createdAt).toLocaleString()}</small>
                      </span>
                      <button onClick={() => restoreVersion(v.id)}>恢复</button>
                    </div>
                  ))}
              </div>
            </section>
          </div>
        </ModalFrame>
      )}
      <header
        className="ed-header"
        inert={!cacheReady || recovering ? true : undefined}
      >
        <div className="ed-header-left">
          <IconButton
            icon={ArrowLeft}
            label="返回工作区"
            onClick={async () => {
              if (!saved && !(await save())) return;
              onBack?.();
            }}
          />
          <span className="ed-header-divider" />
          <span className="ed-mini-logo">
            x<span>✦</span>
          </span>
          <input
            className="ed-title-input"
            aria-label="作品名称"
            maxLength={200}
            disabled={!cacheReady || recovering}
            value={title}
            onChange={(e) => {
              changeRef.current += 1;
              titleRef.current = e.target.value;
              setTitle(e.target.value);
              setSaved(false);
            }}
          />
          <span className="ed-save-state">
            <Cloud size={15} />
            {saving ? "正在保存…" : saved ? "已保存" : "有未保存更改"}
          </span>
        </div>
        <div className="ed-header-right">
          <div className="ed-history-controls">
            <IconButton
              icon={Undo2}
              label="撤销"
              onClick={undo}
              disabled={historyIndex.current === 0}
            />
            <IconButton
              icon={Redo2}
              label="重做"
              onClick={redo}
              disabled={historyIndex.current >= history.current.length - 1}
            />
          </div>
          <IconButton
            icon={Eye}
            label={preview ? "结束预览" : "预览作品"}
            onClick={() => setPreview(!preview)}
            active={preview}
          />
          <IconButton
            icon={Settings2}
            label="显示属性面板"
            onClick={() => {
              setLeftOpen(false);
              setInspectorOpen(!inspectorOpen);
            }}
            className="ed-inspector-toggle"
          />
          <button className="ed-button" onClick={openVersions}>
            版本记录
          </button>
          <button
            className="ed-button ed-save-button"
            disabled={saving || !cacheReady || recovering}
            onClick={() => save()}
          >
            <Save size={16} />
            保存
          </button>
          <button
            className="ed-button ed-primary ed-main-export"
            onClick={() => setExportOpen(true)}
          >
            <Download size={16} />
            导出作品
          </button>
        </div>
      </header>
      <div
        className="ed-body"
        inert={!cacheReady || recovering ? true : undefined}
      >
        <nav className="ed-tool-rail" aria-label="编辑工具">
          {nav.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              aria-pressed={tab === id}
              aria-expanded={tab === id && leftOpen}
              className={tab === id ? "is-active" : ""}
              onClick={() => {
                setTab(id);
                setInspectorOpen(false);
                setLeftOpen(true);
              }}
            >
              <Icon size={21} />
              <span>{label}</span>
            </button>
          ))}
          <div className="ed-tool-rail-bottom">
            <span>
              DESIGN
              <br />X STUDIO
            </span>
          </div>
        </nav>
        <aside
          className="ed-library"
          ref={libraryDrawer}
          aria-label="编辑工具面板"
        >
          <details className="ed-source-info">
            <summary>作品来源</summary>
            <p>
              {project.creationSource?.kind === "template"
                ? `模板：${project.creationSource.title} · 版本 ${project.creationSource.version}`
                : {
                    manual: "手动创作",
                    material: "从素材开始",
                    import: "导入作品",
                  }[project.creationSource?.kind] || "历史作品，创建来源未记录"}
            </p>
            {project.aiSource && <p>有已发布的 AI 创作记录</p>}
          </details>
          {project.brief && (
            <details className="ed-creation-note">
              <summary>创作参考</summary>
              <p>{project.brief}</p>
            </details>
          )}
          <div className="ed-panel-heading">
            <h2>{nav.find((n) => n.id === tab)?.label}</h2>
            <IconButton
              icon={X}
              label="收起工具面板"
              onClick={() => setLeftOpen(false)}
              className="ed-close-library"
            />
          </div>
          {tab === "templates" && (
            <>
              <p className="ed-panel-description">
                为当前作品调整配色，保留已有内容。
              </p>
              <div className="ed-search-like">
                <LayoutTemplate size={15} />
                配色方案 <span>3</span>
              </div>
              <div className="ed-template-grid">
                {[
                  {
                    id: "classic",
                    label: "秋日咖啡",
                    bg: "#f0e7d8",
                    fg: "#323a2e",
                  },
                  {
                    id: "sage",
                    label: "自然慢生活",
                    bg: "#dce3d8",
                    fg: "#324b3b",
                  },
                  {
                    id: "rose",
                    label: "浪漫日常",
                    bg: "#f3d9d3",
                    fg: "#823e3b",
                  },
                ].map((t, i) => (
                  <button
                    className="ed-theme-card"
                    key={t.id}
                    onClick={() => applyTheme(t.id)}
                  >
                    <div className="ed-theme-swatches" aria-hidden="true">
                      <i style={{ background: t.bg }} />
                      <i style={{ background: t.fg }} />
                      <i style={{ background: "#f2634b" }} />
                    </div>
                    <span>{t.label}</span>
                  </button>
                ))}
              </div>
              <div className="ed-library-tip">
                <Sparkles size={17} />
                <div>
                  <strong>让设计有自己的风格</strong>
                  <p>配色可以一键切换，文字与图片都可自由修改。</p>
                </div>
              </div>
            </>
          )}
          {tab === "text" && (
            <>
              <p className="ed-panel-description">
                用恰好的文字，说出你的想法。
              </p>
              <button
                className="ed-add-text"
                onClick={() => addText("添加标题", 52)}
              >
                <Plus size={17} />
                添加文本
              </button>
              <div className="ed-text-presets">
                <button
                  onClick={() => addText("这是一段主标题", 52)}
                  style={{ fontSize: 24, fontWeight: 700 }}
                >
                  添加大标题
                </button>
                <button
                  onClick={() => addText("有温度的设计，从这里开始", 30)}
                  style={{ fontSize: 17, fontWeight: 500 }}
                >
                  添加副标题
                </button>
                <button
                  onClick={() => addText("为你的作品补充一段说明文字", 18)}
                >
                  添加一段正文
                </button>
              </div>
              <h3 className="ed-small-heading">文字组合</h3>
              <button
                className="ed-text-combo"
                onClick={() => addText("GOOD\nTHINGS\nTAKE TIME.", 64)}
              >
                <strong>
                  GOOD
                  <br />
                  THINGS
                  <br />
                  TAKE TIME.
                </strong>
                <span>简约英文标题</span>
              </button>
              <button
                className="ed-text-combo ed-text-combo-cn"
                onClick={() => addText("把灵感\n变成日常", 58)}
              >
                <strong>
                  把灵感
                  <br />
                  变成日常
                </strong>
                <span>极简中文标题</span>
              </button>
            </>
          )}
          {tab === "elements" && (
            <>
              <p className="ed-panel-description">简单的形状，不简单的表达。</p>
              <h3 className="ed-small-heading">基础形状</h3>
              <div className="ed-shape-grid">
                <button aria-label="添加矩形" onClick={() => addShape("rect")}>
                  <span className="ed-shape-square" />
                </button>
                <button
                  aria-label="添加圆形"
                  onClick={() => addShape("circle")}
                >
                  <span className="ed-shape-circle" />
                </button>
              </div>
              <h3 className="ed-small-heading">装饰文字</h3>
              <div className="ed-decoration-grid">
                {["✦", "✳", "↗", "✷"].map((symbol) => (
                  <button key={symbol} onClick={() => addText(symbol, 96)}>
                    {symbol}
                  </button>
                ))}
              </div>
              <p className="ed-muted-note">
                添加后可在画布中拖动，并在属性面板调整尺寸、颜色和层级。
              </p>
            </>
          )}
          {tab === "uploads" && (
            <>
              <p className="ed-panel-description">
                带上你的素材，开始新的创作。
              </p>
              <button
                className="ed-upload-box"
                onClick={() => fileRef.current?.click()}
              >
                <Upload size={28} />
                <strong>点击上传图片</strong>
                <span>PNG / JPG / WebP · 最大 10 MB</span>
              </button>
              {uploadError && (
                <p className="ed-error" role="alert">
                  {uploadError}
                </p>
              )}
              <h3 className="ed-small-heading">当前画布素材</h3>
              <div className="ed-upload-list">
                {design.nodes
                  .filter((n) => n.type === "image")
                  .map((n) => (
                    <button key={n.id} onClick={() => setSelectedId(n.id)}>
                      <img src={n.src} alt={n.label || "画布图片"} />
                      <span>{n.label || "图片素材"}</span>
                    </button>
                  ))}
              </div>
              <p className="ed-muted-note">
                上传图片将替换选中的图片图层。素材保存在你的个人空间，可在其他设计中复用。
              </p>
            </>
          )}
          {tab === "background" && (
            <>
              <p className="ed-panel-description">从一抹颜色开始。</p>
              <h3 className="ed-small-heading">画布背景</h3>
              <ColorPicker
                label="画布背景颜色"
                value={design.background}
                onChange={(color) =>
                  commit((d) => ({ ...d, background: color }))
                }
              />
              <h3 className="ed-small-heading">推荐色板</h3>
              <div className="ed-palette-grid">
                {COLORS.map((color) => (
                  <button
                    key={color}
                    aria-label={`设置背景为 ${color}`}
                    style={{ background: color }}
                    onClick={() => commit((d) => ({ ...d, background: color }))}
                  >
                    {design.background === color && (
                      <Check
                        size={19}
                        color={color === "#25272c" ? "white" : "#333"}
                      />
                    )}
                  </button>
                ))}
              </div>
              <div className="ed-library-tip">
                <Palette size={17} />
                <div>
                  <strong>少一点颜色，多一点表达</strong>
                  <p>试试用一个主色、一个强调色，让作品更有呼吸感。</p>
                </div>
              </div>
            </>
          )}
          {tab === "layers" && (
            <>
              <p className="ed-panel-description">选中图层，调整每一个细节。</p>
              <div className="ed-layer-list">
                {[...design.nodes].reverse().map((n) => (
                  <div
                    key={n.id}
                    className={`ed-layer-row ${n.id === selectedId ? "is-active" : ""}`}
                  >
                    <button
                      className="ed-layer-main"
                      onClick={() => setSelectedId(n.id)}
                    >
                      {n.type === "image" ? (
                        <img src={n.src} alt="" />
                      ) : n.type === "text" ? (
                        <Type size={16} />
                      ) : (
                        <Square size={16} />
                      )}
                      <span>
                        {n.text?.replace(/\n/g, " ") || n.label || "形状"}
                      </span>
                    </button>
                    <button
                      aria-label={`${n.hidden ? "显示" : "隐藏"}图层 ${n.text || n.label || "形状"}`}
                      onClick={() => updateNode(n.id, { hidden: !n.hidden })}
                    >
                      {n.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <button
                      aria-label={`${n.locked ? "解锁" : "锁定"}图层 ${n.text || n.label || "形状"}`}
                      onClick={() => updateNode(n.id, { locked: !n.locked })}
                    >
                      {n.locked ? <Lock size={13} /> : <Unlock size={13} />}
                    </button>
                  </div>
                ))}
              </div>
              <p className="ed-muted-note">
                列表上方的图层显示在画布上层。通过右侧属性面板调整前后顺序。
              </p>
            </>
          )}
        </aside>
        <main className="ed-workspace">
          <div className="ed-canvas-toolbar">
            <div>
              <span className="ed-page-label">第 1 页</span>
              <span className="ed-size-label">
                {W} × {H} px
              </span>
              <span className="ed-ratio-label">{ratio}</span>
            </div>
            <div>
              <button
                onClick={() => {
                  setSelectedId(null);
                  setTab("background");
                  setLeftOpen(true);
                }}
              >
                <Palette size={15} />
                画布背景
              </button>
              <IconButton
                icon={Maximize2}
                label="适应画布大小"
                onClick={() => setAutoFit(true)}
              />
            </div>
          </div>
          <div
            ref={stageRef}
            className="ed-stage"
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) setSelectedId(null);
            }}
          >
            <div
              className="ed-board-holder"
              style={{ width: (W * zoom) / 100, height: (H * zoom) / 100 }}
            >
              <div
                className="ed-board"
                aria-label="设计画布"
                style={{
                  width: W,
                  height: H,
                  transform: `scale(${zoom / 100})`,
                  background: design.background,
                }}
                onPointerDown={(e) => {
                  if (e.target === e.currentTarget) setSelectedId(null);
                }}
              >
                {design.nodes
                  .filter((n) => !n.hidden)
                  .map((n) => (
                    <div
                      key={n.id}
                      role="button"
                      tabIndex={preview ? -1 : 0}
                      aria-label={`选中${n.type === "text" ? "文字" : "图层"}：${n.text || n.label || "形状"}`}
                      className={`ed-node ${(selectionIds.includes(n.id) || selectedId === n.id) && !preview ? "ed-node-selected" : ""} ${n.locked ? "ed-node-locked" : ""}`}
                      style={{
                        ...nodeStyle(n),
                        cursor: preview
                          ? "default"
                          : n.locked
                            ? "pointer"
                            : "move",
                      }}
                      onPointerDown={(e) => startDrag(e, n)}
                      onPointerMove={moveDrag}
                      onPointerUp={endDrag}
                      onPointerCancel={endDrag}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          setSelectedId(n.id);
                          setInspectorOpen(true);
                        }
                      }}
                      onDoubleClick={() => {
                        setSelectedId(n.id);
                        setInspectorOpen(true);
                      }}
                    >
                      <NodeContent node={n} />
                      {(selectionIds.includes(n.id) || selectedId === n.id) &&
                        !preview && (
                          <>
                            <span className="ed-selection-label">
                              {n.type === "text"
                                ? "文字"
                                : n.type === "image"
                                  ? "图片"
                                  : "形状"}
                              {n.locked ? " · 已锁定" : ""}
                            </span>
                            {!n.locked &&
                              ["tl", "tr", "bl", "br"].map((corner) => (
                                <i
                                  key={corner}
                                  className={`ed-handle ${corner}`}
                                  onPointerDown={(e) =>
                                    startResize(e, n, corner)
                                  }
                                />
                              ))}
                          </>
                        )}
                    </div>
                  ))}
              </div>
            </div>
            {preview && (
              <button
                className="ed-end-preview"
                onClick={() => setPreview(false)}
              >
                <X size={15} />
                结束预览
              </button>
            )}
          </div>
          <div className="ed-bottom-bar">
            <div className="ed-page-strip">
              <div className="ed-page-preview">
                <DesignThumbnail design={design} title="第 1 页" />
              </div>
              <div>
                <strong>第 1 页</strong>
                <span>
                  {W} × {H} px
                </span>
              </div>
            </div>
            <div className="ed-zoom-controls">
              <IconButton
                icon={Minus}
                label="缩小画布"
                onClick={() => setZoomValue(zoom - 10)}
                disabled={zoom <= 20}
              />
              <span>{zoom}%</span>
              <IconButton
                icon={Plus}
                label="放大画布"
                onClick={() => setZoomValue(zoom + 10)}
                disabled={zoom >= 150}
              />
              <span className="ed-zoom-divider" />
              <button onClick={() => setAutoFit(true)}>适应</button>
            </div>
          </div>
        </main>
        <aside
          className="ed-properties"
          ref={propertiesDrawer}
          aria-label="图层属性面板"
        >
          <div className="ed-properties-heading">
            <h2>
              {selected
                ? selected.type === "text"
                  ? "文字属性"
                  : selected.type === "image"
                    ? "图片属性"
                    : "形状属性"
                : "画布属性"}
            </h2>
            <IconButton
              icon={Settings2}
              label="收起属性面板"
              onClick={() => setInspectorOpen(false)}
              className="ed-close-properties"
            />
          </div>
          {selected ? (
            <>
              <div className="ed-property-section">
                <div className="ed-selected-label">
                  {selected.type === "text" ? (
                    <Type size={15} />
                  ) : selected.type === "image" ? (
                    <ImagePlus size={15} />
                  ) : (
                    <Shapes size={15} />
                  )}
                  <span>
                    {selected.type === "text"
                      ? "编辑文字内容"
                      : selected.label || "选中图层"}
                  </span>
                  <button
                    aria-label={
                      selected.locked ? "解锁选中图层" : "锁定选中图层"
                    }
                    onClick={() =>
                      updateNode(selected.id, { locked: !selected.locked })
                    }
                  >
                    {selected.locked ? (
                      <Lock size={14} />
                    ) : (
                      <Unlock size={14} />
                    )}
                  </button>
                </div>
                {selected.type === "text" && (
                  <textarea
                    onCompositionStart={() => {
                      composingRef.current = true;
                    }}
                    onCompositionEnd={() => {
                      composingRef.current = false;
                      setSaved(false);
                    }}
                    className="ed-text-content"
                    aria-label="文字内容"
                    value={selected.text}
                    onChange={(e) =>
                      updateNode(selected.id, {
                        text: e.target.value,
                        h: Math.max(
                          selected.size * 1.15,
                          e.target.value.split("\n").length *
                            selected.size *
                            1.15,
                        ),
                      })
                    }
                    rows={3}
                  />
                )}{" "}
                {selected.type === "image" && (
                  <>
                    <img
                      className="ed-property-image"
                      src={selected.src}
                      alt="选中图片预览"
                    />
                    <button
                      className="ed-button ed-replace-image"
                      onClick={() => fileRef.current?.click()}
                    >
                      <Upload size={15} />
                      替换图片
                    </button>
                  </>
                )}
              </div>
              {selected.type === "text" && (
                <div className="ed-property-section">
                  <h3>字体与排版</h3>
                  <select
                    className="ed-select ed-font-select"
                    aria-label="字体"
                    value={
                      selected.font === "Noto Sans SC Variable"
                        ? FONT
                        : selected.font || FONT
                    }
                    onChange={(e) =>
                      updateNode(selected.id, { font: e.target.value })
                    }
                  >
                    <option value={FONT}>Noto Sans SC · 中文无衬线</option>
                    <option value="Source Serif 4 Variable">
                      Source Serif 4 · 衬线
                    </option>
                    {selected?.font?.includes("Georgia") && (
                      <option value={selected.font}>
                        经典衬线（历史作品）
                      </option>
                    )}
                    {selected.font &&
                      ![
                        FONT,
                        "Noto Sans SC Variable",
                        "Source Serif 4 Variable",
                      ].includes(selected.font) &&
                      !selected.font.includes("Georgia") && (
                        <option value={selected.font}>
                          历史字体（无衬线回退）
                        </option>
                      )}
                  </select>
                  <div className="ed-property-row">
                    <select
                      className="ed-select"
                      aria-label="字重"
                      value={selected.weight || 400}
                      onChange={(e) =>
                        updateNode(selected.id, {
                          weight: Number(e.target.value),
                        })
                      }
                    >
                      <option value={400}>常规</option>
                      <option value={500}>中等</option>
                      <option value={600}>半粗</option>
                      <option value={700}>粗体</option>
                      <option value={800}>特粗</option>
                    </select>
                    <label className="ed-number-field">
                      <span>字号</span>
                      <input
                        aria-label="字号"
                        type="number"
                        min="8"
                        max="240"
                        value={selected.size}
                        onChange={(e) =>
                          updateNode(selected.id, {
                            size: Math.max(
                              8,
                              Math.min(240, Number(e.target.value) || 8),
                            ),
                          })
                        }
                      />
                    </label>
                  </div>
                  <div className="ed-align-controls">
                    {[
                      { value: "left", label: "左对齐", symbol: "☰" },
                      { value: "center", label: "居中", symbol: "☷" },
                      { value: "right", label: "右对齐", symbol: "☰" },
                    ].map((a) => (
                      <button
                        key={a.value}
                        aria-label={a.label}
                        className={
                          (selected.align || "left") === a.value
                            ? "is-active"
                            : ""
                        }
                        onClick={() =>
                          updateNode(selected.id, { align: a.value })
                        }
                      >
                        <span style={{ textAlign: a.value }}>{a.symbol}</span>
                      </button>
                    ))}
                  </div>
                  <div className="ed-labeled-color">
                    <span>文字颜色</span>
                    <ColorPicker
                      label="文字颜色"
                      value={selected.color}
                      onChange={(color) => updateNode(selected.id, { color })}
                    />
                  </div>
                </div>
              )}
              {selected.type !== "text" && selected.type !== "image" && (
                <div className="ed-property-section">
                  <h3>填充颜色</h3>
                  <ColorPicker
                    label="形状颜色"
                    value={selected.color}
                    onChange={(color) => updateNode(selected.id, { color })}
                  />
                </div>
              )}
              <div className="ed-property-section">
                <h3>
                  {selectionIds.length > 1
                    ? `已选 ${selectionIds.length} 个图层`
                    : "对齐与变换"}
                </h3>
                <div className="ed-alignment-grid">
                  {[
                    ["left", "左"],
                    ["center", "水平居中"],
                    ["right", "右"],
                    ["top", "顶"],
                    ["middle", "垂直居中"],
                    ["bottom", "底"],
                  ].map(([a, l]) => (
                    <button key={a} onClick={() => alignSelection(a)}>
                      {l}
                    </button>
                  ))}
                </div>
                {selectionIds.length > 1 && (
                  <button onClick={() => groupSelection()}>组合选中图层</button>
                )}
                {selected.groupId && (
                  <button onClick={() => groupSelection(true)}>取消组合</button>
                )}
                <label className="ed-number-field">
                  <span>旋转</span>
                  <input
                    aria-label="旋转角度"
                    type="number"
                    value={selected.rotation || 0}
                    onChange={(e) =>
                      updateNode(selected.id, {
                        rotation: Number(e.target.value) || 0,
                      })
                    }
                  />
                </label>
              </div>
              {selected.type === "image" && (
                <div className="ed-property-section">
                  <h3>图片裁剪</h3>
                  <select
                    aria-label="图片填充方式"
                    value={selected.fit || "cover"}
                    onChange={(e) =>
                      updateNode(selected.id, { fit: e.target.value })
                    }
                  >
                    <option value="cover">填充裁剪</option>
                    <option value="contain">完整显示</option>
                    <option value="fill">拉伸</option>
                  </select>
                  {["水平", "垂直"].map((label, i) => (
                    <label key={label}>
                      {label}位置
                      <input
                        aria-label={label + "裁剪位置"}
                        type="range"
                        min="0"
                        max="100"
                        value={parseFloat(
                          (selected.objectPosition || "50% 50%").split(" ")[i],
                        )}
                        onChange={(e) => {
                          const pos = (
                            selected.objectPosition || "50% 50%"
                          ).split(" ");
                          pos[i] = e.target.value + "%";
                          updateNode(selected.id, {
                            objectPosition: pos.join(" "),
                          });
                        }}
                      />
                    </label>
                  ))}
                </div>
              )}
              <div className="ed-property-section">
                <h3>
                  位置与尺寸 <Move size={13} />
                </h3>
                <div className="ed-property-grid">
                  {[
                    ["x", "X"],
                    ["y", "Y"],
                    ["w", "宽"],
                    ["h", "高"],
                  ].map(([key, label]) => (
                    <label className="ed-number-field" key={key}>
                      <span>{label}</span>
                      <input
                        aria-label={`${label === "宽" ? "宽度" : label === "高" ? "高度" : `${label}位置`}`}
                        type="number"
                        value={Math.round(selected[key])}
                        onChange={(e) =>
                          updateNode(selected.id, {
                            [key]:
                              key === "w" || key === "h"
                                ? Math.max(10, Number(e.target.value) || 10)
                                : Number(e.target.value) || 0,
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
                <div className="ed-opacity-label">
                  <span>不透明度</span>
                  <span>{Math.round((selected.opacity ?? 1) * 100)}%</span>
                </div>
                <input
                  className="ed-range"
                  aria-label="不透明度"
                  type="range"
                  min="0"
                  max="100"
                  value={(selected.opacity ?? 1) * 100}
                  onChange={(e) =>
                    updateNode(selected.id, {
                      opacity: Number(e.target.value) / 100,
                    })
                  }
                />
              </div>
              <div className="ed-property-section">
                <h3>图层操作</h3>
                <div className="ed-layer-actions">
                  <button
                    onClick={() => changeLayer(1)}
                    disabled={design.nodes.at(-1)?.id === selectedId}
                  >
                    <ChevronUp size={15} />
                    上移一层
                  </button>
                  <button
                    onClick={() => changeLayer(-1)}
                    disabled={design.nodes[0]?.id === selectedId}
                  >
                    <ChevronDown size={15} />
                    下移一层
                  </button>
                  <button onClick={duplicateSelected}>
                    <Copy size={15} />
                    复制图层
                  </button>
                  <button
                    className="ed-delete-layer"
                    onClick={deleteSelected}
                    disabled={selected.locked}
                  >
                    <Trash2 size={15} />
                    删除图层
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="ed-property-section">
                <h3>画布信息</h3>
                <div className="ed-canvas-info">
                  <span>宽度</span>
                  <input
                    aria-label="画布宽度"
                    type="number"
                    min="16"
                    max="8192"
                    value={W}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (v >= 16 && v <= 8192)
                        commit(resizeArtboard(designRef.current, v, H));
                    }}
                  />
                  <span>高度</span>
                  <input
                    aria-label="画布高度"
                    type="number"
                    min="16"
                    max="8192"
                    value={H}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (v >= 16 && v <= 8192)
                        commit(resizeArtboard(designRef.current, W, v));
                    }}
                  />
                  <span>比例</span>
                  <strong>{ratio}</strong>
                </div>
              </div>
              <div className="ed-property-section">
                {brand && (
                  <div className="ed-property-section">
                    <h3>品牌套件 · {brand.name}</h3>
                    <button className="ed-button" onClick={applyBrand}>
                      应用品牌配色
                    </button>
                    {brand.logo && (
                      <button className="ed-button" onClick={addBrandLogo}>
                        加入品牌 Logo
                      </button>
                    )}
                  </div>
                )}
                <h3>背景颜色</h3>
                <ColorPicker
                  value={design.background}
                  onChange={(color) =>
                    commit((d) => ({ ...d, background: color }))
                  }
                />
              </div>
              <div className="ed-inspector-empty">
                <Move size={28} />
                <strong>每个细节，都可以调整</strong>
                <p>选择画布中的文字、图片或形状，开始编辑。</p>
              </div>
            </>
          )}
          <div className="ed-editor-hint">
            <span>⌘ S</span>保存设计<span>⌘ Z</span>撤销操作
          </div>
        </aside>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={upload}
      />
      {exportOpen && (
        <ModalFrame title="导出作品" onClose={() => setExportOpen(false)}>
          <div
            className="ed-modal-backdrop"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setExportOpen(false);
            }}
          >
            <section className="ed-export-modal">
              <div className="ed-modal-header">
                <div>
                  <span className="ed-modal-eyebrow">READY TO SHARE</span>
                  <h2 id="ed-export-title">让好设计，被看见。</h2>
                </div>
                <IconButton
                  icon={X}
                  label="关闭导出弹窗"
                  onClick={() => setExportOpen(false)}
                />
              </div>
              <p className="ed-export-description">
                导出高清作品，带着灵感去往更多地方。
              </p>
              <label className="ed-export-label">文件格式</label>
              <div className="ed-format-options">
                {[
                  { name: "PNG", text: "高清图片 · 推荐" },
                  { name: "JPG", text: "轻量分享" },
                  { name: "WebP", text: "高效图片" },
                  { name: "PDF", text: "单页文档" },
                  { name: "DXPROJ", text: "可编辑源稿" },
                ].map((f) => (
                  <button
                    key={f.name}
                    disabled={exporting}
                    aria-pressed={format === f.name}
                    className={format === f.name ? "is-active" : ""}
                    onClick={() => {
                      setFormat(f.name);
                      if (f.name === "JPG") setTransparent(false);
                    }}
                  >
                    <strong>{f.name}</strong>
                    <span>{f.text}</span>
                    {format === f.name && <Check size={15} />}
                  </button>
                ))}
              </div>
              <label className="ed-export-label" htmlFor="ed-export-resolution">
                导出尺寸
              </label>
              <select
                className="ed-select"
                disabled={exporting}
                id="ed-export-resolution"
                value={exportScale}
                onChange={(e) => setExportScale(Number(e.target.value))}
              >
                <option value={1}>
                  原始尺寸 · {W} × {H} px
                </option>
                <option value={2}>
                  2 倍高清 · {W * 2} × {H * 2} px
                </option>
                <option value={3}>
                  3 倍超清 · {W * 3} × {H * 3} px
                </option>
              </select>
              <label className="ed-checkbox-label">
                <input
                  type="checkbox"
                  checked={transparent}
                  disabled={
                    exporting || ["JPG", "PDF", "DXPROJ"].includes(format)
                  }
                  onChange={(e) => setTransparent(e.target.checked)}
                />
                <span>透明画布背景</span>
                <small>
                  {["JPG", "PDF", "DXPROJ"].includes(format)
                    ? "当前格式不支持此选项"
                    : "保留图片及所有图层"}
                </small>
              </label>
              <div className="ed-export-summary">
                <Layers size={17} />
                <span>
                  第 1 页 · {design.nodes.filter((n) => !n.hidden).length}{" "}
                  个可见图层
                </span>
                <span>
                  {W * exportScale} × {H * exportScale}
                </span>
              </div>
              {exportProgress && (
                <p className="ed-export-progress" role="status">
                  {exportProgress}
                </p>
              )}
              {exporting && (
                <p className="ed-export-progress">
                  关闭弹窗后任务继续，可在创作动态查看。
                  <button
                    className="ed-button"
                    onClick={cancelExport}
                    disabled={
                      !exportJob ||
                      cancelling ||
                      !["queued", "running"].includes(exportJob.status)
                    }
                  >
                    {cancelling ? "正在请求取消…" : "取消导出任务"}
                  </button>
                </p>
              )}
              {exportError && (
                <p role="alert" className="ed-error">
                  {exportError}
                </p>
              )}
              <button
                className="ed-button ed-primary ed-export-submit"
                onClick={exportFile}
                disabled={exporting}
              >
                {exporting ? (
                  <>
                    <span className="ed-spinner" />
                    正在准备作品…
                  </>
                ) : (
                  <>
                    <Download size={18} />
                    导出 {format}
                  </>
                )}
              </button>
              <p className="ed-export-footnote">
                生成后请求下载文件，不添加水印。
              </p>
            </section>
          </div>
        </ModalFrame>
      )}
    </div>
  );
}
