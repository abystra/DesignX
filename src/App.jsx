import React, { useState, useEffect, useRef } from "react";
import {
  Home,
  Sparkles,
  LayoutGrid,
  PanelsTopLeft,
  FolderOpen,
  Images,
  History,
  Plus,
  ChevronDown,
  ArrowUpRight,
  ArrowUp,
  ArrowRight,
  Search,
  SlidersHorizontal,
  Heart,
  Check,
  X,
  HelpCircle,
  Command,
  PanelLeftClose,
  Bell,
  ImagePlus,
  WandSparkles,
  ShoppingBag,
  Video,
  Scissors,
  Presentation,
  Brush,
  Leaf,
  Play,
  Upload,
  Clock,
  BookOpen,
  Menu,
  CheckCircle2,
  ChevronRight,
  Folder,
  Layers,
  Settings2,
} from "lucide-react";
import Editor from "./components/Editor.jsx";
import Workspace from "./components/Workspace.jsx";
import ProjectThumbnail from "./components/ProjectThumbnail.jsx";
import LibraryPageStatus from "./components/LibraryPageStatus.jsx";
import { useLibraryPage } from "./lib/use-library-page.js";
import { api, uploadAsset, refreshWorkspace } from "./lib/api";
import { initialDesign } from "./data/template-design.js";
import { creationEntries, materialFor } from "./lib/creation-entry.js";
import "./styles/poster.css";
import JobPanel from "./components/JobPanel.jsx";
import DesignThumbnail from "./components/DesignThumbnail.jsx";
import Catalog from "./components/Catalog.jsx";
import Workbench from "./components/Workbench.jsx";
import AIStudio from "./components/AIStudio.jsx";
import { templates } from "./data/templates.js";
import {
  useCapabilities,
  capabilityFor,
  modeId,
  modeLabel,
} from "./lib/creative-capabilities";
import catalog from "./data/catalog.json";
import "./components/workbench.css";

const NAV = [
  ["home", "创作首页", Home],
  ["skills", "创作提示词", Sparkles],
  ["tools", "设计工具", LayoutGrid],
  ["templates", "模板灵感", PanelsTopLeft],
  ["recent", "最近打开", History],
  ["projects", "我的项目", FolderOpen],
  ["assets", "资产库", Images],
];
export function Modal({ children, onClose, className = "", title = "设计操作" }) {
  const ref = useRef();
  useEffect(() => {
    const old = document.activeElement;
    ref.current?.focus();
    const f = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const a = ref.current?.querySelectorAll(
          'button:not([disabled]),input,textarea,select,a,[tabindex="0"]',
        );
        if (!a?.length) return;
        const first = a[0],
          last = a[a.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", f);
    return () => {
      document.removeEventListener("keydown", f);
      old?.focus();
    };
  }, []);
  return (
    <div
      className="modal-shade"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        className={"modal " + className}
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-label={title}
        aria-modal="true"
      >
        <button
          className="modal-close icon-button"
          aria-label="关闭弹窗"
          onClick={onClose}
        >
          <X size={20} />
        </button>
        {children}
      </section>
    </div>
  );
}
export function Artwork({ item }) {
  return (
    <div className="template-document">
      <DesignThumbnail design={initialDesign(item)} title={item.title} />
    </div>
  );
}
function TemplateCard({ item, onSelect, favorites, toggleFavorite }) {
  return (
    <article className="template-card">
      <button
        className="art-trigger"
        onClick={() => onSelect(item)}
        aria-label={"预览模板 " + item.title}
      >
        <Artwork item={item} />
        {item.tag && <span className="template-tag">{item.tag}</span>}
        <span className="art-hover">
          查看模板 <ArrowUpRight size={16} />
        </span>
      </button>
      <button
        className={
          "favorite-button " +
          (favorites.includes(item.id) ? "is-favorite" : "")
        }
        aria-label={
          (favorites.includes(item.id) ? "取消收藏 " : "收藏 ") + item.title
        }
        onClick={() => toggleFavorite(item.id)}
      >
        <Heart
          size={16}
          fill={favorites.includes(item.id) ? "currentColor" : "none"}
        />
      </button>
      <div className="template-caption">
        <h3>{item.title}</h3>
        <span>{item.subtitle}</span>
      </div>
    </article>
  );
}
function HomePage({
  onNavigate,
  onTemplate,
  onCreate,
  projects,
  onProject,
  favorites,
  toggleFavorite,
  creating,
}) {
  const [title, setTitle] = useState("");
  const [ratio, setRatio] = useState("3:4");
  return (
    <div className="poster-home">
      <section className="poster-hero">
        <div>
          <span className="poster-eyebrow">DESIGN YOUR EVERYDAY</span>
          <h1>
            把日常灵感，
            <br />
            做成自己的海报。
          </h1>
          <p>
            选一个模板，换上你的文字和图片。
            <br />
            作品自动保存，随时回来继续，完成后即可导出。
          </p>
          <button className="primary" onClick={() => onNavigate("templates")}>
            挑选海报模板 <ArrowRight size={20} />
          </button>
        </div>
        <div className="poster-hero-art" aria-hidden="true">
          <Artwork item={templates[0]} />
        </div>
      </section>
      <section className="poster-start" aria-labelledby="poster-start-title">
        <div>
          <h2 id="poster-start-title">从空白画布开始</h2>
          <p>适合已经有想法的你，也可以先去素材库选一张图片。</p>
          <button className="text-button" onClick={() => onNavigate("assets")}>
            打开素材库 <ArrowRight size={16} />
          </button>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onCreate({ name: title.trim() || "未命名海报", ratio });
          }}
        >
          <label>
            作品名称
            <input
              value={title}
              maxLength={80}
              placeholder="例如：周末咖啡海报"
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            画布比例
            <select
              value={ratio}
              onChange={(event) => setRatio(event.target.value)}
            >
              <option value="3:4">竖版 3:4 · 600 × 800</option>
              <option value="1:1">方形 1:1 · 600 × 600</option>
              <option value="9:16">长图 9:16 · 540 × 960</option>
              <option value="16:9">横版 16:9 · 960 × 540</option>
            </select>
          </label>
          <button className="secondary" disabled={creating} type="submit">
            <Plus size={18} />
            {creating ? "正在创建…" : "创建海报"}
          </button>
        </form>
      </section>
      <section className="poster-templates">
        <div className="section-heading">
          <div>
            <h2>从喜欢的版式出发</h2>
            <p>内置模板 · 图片、文字和配色均可编辑</p>
          </div>
          <button
            className="text-button"
            onClick={() => onNavigate("templates")}
          >
            查看全部 <ArrowRight size={16} />
          </button>
        </div>
        <div className="template-grid">
          {templates.slice(0, 4).map((item) => (
            <TemplateCard
              key={item.id}
              item={item}
              onSelect={onTemplate}
              favorites={favorites}
              toggleFavorite={toggleFavorite}
            />
          ))}
        </div>
      </section>
      <section className="poster-recent">
        <div className="section-heading">
          <h2>继续你的创作</h2>
          <button
            className="text-button"
            onClick={() => onNavigate("projects")}
          >
            我的项目 <ArrowRight size={16} />
          </button>
        </div>
        {projects.length ? (
          <div className="poster-projects">
            {projects.slice(0, 3).map((project) => (
              <button key={project.id} onClick={() => onProject(project)}>
                <span className="poster-project-preview">
                  <ProjectThumbnail project={project} />
                </span>
                <span>
                  <strong>{project.title}</strong>
                  <small>
                    {project.updatedAt
                      ? new Date(project.updatedAt).toLocaleDateString("zh-CN")
                      : "已保存"}
                  </small>
                </span>
                <ArrowUpRight size={20} />
              </button>
            ))}
          </div>
        ) : (
          <p className="poster-empty">
            还没有作品。从上方模板或空白画布开始，保存的海报会出现在这里。
          </p>
        )}
      </section>
    </div>
  );
}
function TemplatesPage({ onSelect, favorites, toggleFavorite }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("全部");
  const [style, setStyle] = useState("所有风格");
  const [sort, setSort] = useState("编辑精选");
  let list = templates.filter(
    (t) =>
      (cat === "全部" || t.category === cat) &&
      (style === "所有风格" || t.style === style) &&
      `${t.title}${t.subtitle}`.includes(q),
  );
  if (sort === "最近上新") list = [...list].reverse();
  return (
    <div className="templates-page">
      <div className="page-intro">
        <span className="eyebrow">A GOOD PLACE TO START</span>
        <h1>
          每一个好设计，
          <br />
          都从一点灵感开始。
        </h1>
        <p>找到喜欢的模板，加入你的想法，让它成为你的作品。</p>
        <div className="large-search">
          <Search size={19} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索模板，例如：咖啡、护肤、秋日…"
            aria-label="搜索模板"
          />
          {q && (
            <button aria-label="清空搜索" onClick={() => setQ("")}>
              <X size={16} />
            </button>
          )}
        </div>
        <span className="intro-decoration">✳</span>
      </div>
      <div className="inspiration-tabs">
        {[
          "全部",
          "电商设计",
          "海报设计",
          "社媒内容",
          "服饰穿戴",
          "办公设计",
          "品牌设计",
        ].map((c) => (
          <button
            className={cat === c ? "active" : ""}
            onClick={() => setCat(c)}
            key={c}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="filter-row">
        <span>
          为你找到 <b>{list.length}</b> 个精选模板
        </span>
        <div>
          <select
            aria-label="模板风格"
            value={style}
            onChange={(e) => setStyle(e.target.value)}
          >
            {["所有风格", "简约", "自然", "现代", "杂志"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select
            aria-label="模板排序"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option>编辑精选</option>
            <option>最近上新</option>
          </select>
        </div>
      </div>
      <div className="template-grid full-templates">
        {list.map((item) => (
          <TemplateCard
            key={item.id}
            {...{ item, onSelect, favorites, toggleFavorite }}
          />
        ))}
      </div>
      {!list.length && (
        <div className="empty-block">
          <Search size={32} />
          <h3>暂时没有找到这个灵感</h3>
          <p>换个关键词，或者试试其他风格。</p>
          <button
            className="secondary"
            onClick={() => {
              setQ("");
              setCat("全部");
              setStyle("所有风格");
            }}
          >
            重置筛选
          </button>
        </div>
      )}
    </div>
  );
}
function Guide({ onNavigate }) {
  return (
    <div className="guide-page">
      <span className="eyebrow">DESIGN X · CREATIVE GUIDE</span>
      <h1>一个想法，走完创作的全程。</h1>
      <p className="lead">
        以任务为中心组织能力，以可编辑的作品承接结果，以资产复用延续创作。
      </p>
      <div className="flow-guide">
        {[
          ["01", "开始创作", "空白画板 / 模板"],
          ["02", "添加素材", "图片 / 品牌 / 参考"],
          ["03", "组织画布", "画板 / 排列 / 分组"],
          ["04", "打磨设计", "画布 / 文字 / 元素"],
          ["05", "保存与复用", "导出 / 项目 / 资产"],
        ].map(([n, t, s]) => (
          <div key={n}>
            <span>{n}</span>
            <h3>{t}</h3>
            <p>{s}</p>
            <ArrowRight size={20} />
          </div>
        ))}
      </div>
      <div className="guide-columns">
        <section>
          <h2>先体验这三条路径</h2>
          <button onClick={() => onNavigate("projects")}>
            <ShoppingBag />
            项目管理与版本延续 <ArrowUpRight />
          </button>
          <button onClick={() => onNavigate("templates")}>
            <PanelsTopLeft />
            模板选择与画布编辑 <ArrowUpRight />
          </button>
          <button onClick={() => onNavigate("assets")}>
            <Images />
            资产管理与品牌复用 <ArrowUpRight />
          </button>
        </section>
        <section>
          <h2>当前创作能力</h2>
          <p>
            从模板或空白画板开始，上传素材并调整文字、图片和图层。保存后可以继续编辑、恢复历史版本，或导出图片和
            PDF。
          </p>
          <p>
            模板、画布编辑、项目、素材和导出已连接个人空间。AI
            生成能力暂未接入；可以先使用模板或自由画板开始创作。
          </p>
          <span className="guide-note">
            修改会自动保存。离线时请保留当前浏览器，联网后完成同步。
          </span>
        </section>
      </div>
    </div>
  );
}
export default function App({
  sessionUser = { name: "创作者" },
  workspace,
  onLogout,
}) {
  const [page, setPage] = useState(
    () => location.hash.slice(1).split("/")[0] || "home",
  );
  const [collapsed, setCollapsed] = useState(false),
    [projects, setProjects] = useState([]),
    [favorites, setFavorites] = useState([]);
  const [template, setTemplate] = useState(null),
    [editing, setEditing] = useState(null),
    [task, setTask] = useState(null),
    [studio, setStudio] = useState(null),
    [editedProject, setEditedProject] = useState(null);
  const [notice, setNotice] = useState(false),
    [toast, setToast] = useState(""),
    [searchOpen, setSearchOpen] = useState(false),
    [query, setQuery] = useState(""),
    [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState("");
  const searchedProjects = useLibraryPage("/projects/page", { q: query, limit: 12 }, searchOpen && !!query.trim());
  const timer = useRef();
  const capabilities = useCapabilities();
  const publicEntries = creationEntries(capabilities.catalog, catalog.skills);
  const creatingRef = useRef(false);
  const creationRequest = useRef(null);
  const [creating, setCreating] = useState(false);
  const [creationError, setCreationError] = useState("");
  function notify(text) {
    setToast(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(""), 4500);
  }
  async function reloadProjects() {
    const result = await api("/projects/page?limit=3");
    setProjects(result.items);
    return result.items;
  }
  async function restoreStudio(id, options = {}, loaded = {}) {
    const [project, board] = await Promise.all([
      loaded.project || api("/projects/" + id + "?view=metadata"),
      loaded.board || api("/projects/" + id + "/studio"),
    ]);
    setStudio({
      id,
      projectId: id,
      revision: board.revision,
      snapshot: {
        ...board.snapshot,
        title: board.snapshot?.title || project.title,
      },
      ...options,
    });
    setEditing(null);
    setTask(null);
    setPage("studio");
    await api("/projects/" + id + "/open", { method: "POST" });
  }
  async function openStudio(item = {}) {
    if (creatingRef.current) return;
    if (item.destination) {
      navigate(item.destination);
      return;
    }
    const aiEntry =
      item.kind === "recipe" || item.kind === "preset" || item.mode;
    if (aiEntry) {
      const available =
        item.kind === "recipe"
          ? capabilities.catalog?.recipes?.find(
              (recipe) => recipe.id === (item.recipeId || item.id),
            )
          : capabilityFor(capabilities.catalog, item.mode || "design");
      if (!available?.enabled) {
        setCreationError(
          available?.reason || "此创作能力尚未开放，请先使用模板或空白海报",
        );
        return;
      }
    }
    const workspaceMode =
      aiEntry || item.workspaceMode === "studio" ? "studio" : "editor";
    const body = {
      title: item.template?.title || item.name || "未命名海报",
      workspaceMode,
      brief: item.prompt || item.draft || "",
      ...(item.template
        ? { templateId: item.template.id }
        : { design: initialDesign({ blank: true, ratio: item.ratio }) }),
      ...(materialFor(item) ? { material: materialFor(item) } : {}),
    };
    const signature = JSON.stringify(body);
    if (creationRequest.current?.signature !== signature)
      creationRequest.current = { signature, key: crypto.randomUUID(), item };
    const request = creationRequest.current;
    creatingRef.current = true;
    setCreating(true);
    setCreationError("");
    try {
      const project =
        request.project ||
        (await api("/projects", {
          method: "POST",
          headers: { "Idempotency-Key": request.key },
          body,
        }));
      request.project = project;
      if (workspaceMode === "editor") {
        setStudio(null);
        setTask(null);
        setEditing(project);
        history.pushState(null, "", "#editor/" + project.id);
      } else {
        await restoreStudio(
          project.id,
          {
            skill: aiEntry ? item : null,
            draft: item.prompt || item.draft || "",
            mode: item.mode || "Agent",
            panel: item.panel,
          },
          { project },
        );
        history.pushState(null, "", "#studio/" + project.id);
      }
      setTemplate(null);
      creationRequest.current = null;
      void api(`/projects/${project.id}/open`, { method: "POST" })
        .then(reloadProjects)
        .catch(() => {});
    } catch (error) {
      setCreationError(error.message);
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  }
  function navigate(p) {
    if (p === "product-demo") {
      navigate("tools");
      return;
    }
    setStudio(null);
    setPage(p);
    history.pushState(null, "", "#" + p);
    setEditing(null);
    setTask(null);
    reloadProjects().catch((e) => notify(e.message));
    window.scrollTo(0, 0);
  }
  useEffect(() => {
    let active = true;
    async function boot() {
      setLoading(true);
      try {
        const [list, favs] = await Promise.all([
          api("/projects/page?limit=3"),
          api("/preferences/template-favorites"),
        ]);
        if (!active) return;
        setProjects(list.items);
        setFavorites(favs || []);
        setLoadError("");
        const route = location.hash.slice(1);
        if (route.startsWith("studio/")) await restoreStudio(route.slice(7));
        else if (route.startsWith("editor/")) {
          const p = await api("/projects/" + route.slice(7));
          if (active) setEditing(p);
        } else if (route === "studio") await openStudio();
      } catch (e) {
        if (active) setLoadError(e.message);
      } finally {
        if (active) setLoading(false);
      }
    }
    boot();
    const onHash = () => {
      setStudio(null);
      setEditing(null);
      setTask(null);
      setPage(location.hash.slice(1).split("/")[0] || "home");
      boot();
    };
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    let refreshTimer;
    const refresh = () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => reloadProjects().catch(() => {}), 180);
    };
    window.addEventListener("hashchange", onHash);
    window.addEventListener("popstate", onHash);
    window.addEventListener("keydown", onKey);
    window.addEventListener("designx:refresh", refresh);
    const events = new EventSource("/api/events");
    // Reconnection replays persisted events. Coalesce that burst before notifying
    // subscribers, each of which may read several workspace resources.
    let workspaceEventTimer;
    const event = (message) => {
      if (message?.type === "job.updated") {
        try {
          const payload = JSON.parse(message.data).payload;
          if (payload?.kind === "ai.turn") {
            window.dispatchEvent(
              new CustomEvent("designx:ai-turn", { detail: payload }),
            );
            // Token/tool progress must not reload every design in a large project.
            if (!["succeeded", "failed", "cancelled"].includes(payload.status))
              return;
          }
        } catch {
          /* Normal resource refresh handles non-protocol events. */
        }
      }
      clearTimeout(workspaceEventTimer);
      workspaceEventTimer = setTimeout(refreshWorkspace, 180);
    };
    events.onmessage = event;
    [
      "job.updated",
      "asset.ready",
      "project.updated",
      "document.committed",
      "generation.updated",
      "generation.completed",
      "asset.updated",
      "interaction.updated",
      "interaction.command",
      "activity.agent",
      "activity.created",
      "activity.updated",
    ].forEach((name) => events.addEventListener(name, event));
    return () => {
      active = false;
      events.close();
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("popstate", onHash);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("designx:refresh", refresh);
      clearTimeout(refreshTimer);
      clearTimeout(workspaceEventTimer);
      clearTimeout(timer.current);
    };
  }, []);
  async function save(p) {
    const body = { title: p.title, design: p.design, baseRevision: p.revision };
    const result =
      p.projectId && p.documentId && p.id !== p.projectId
        ? await api(`/projects/${p.projectId}/artboards/${p.documentId}`, {
            method: "PATCH",
            body,
          })
        : await api("/projects/" + p.id, { method: "PATCH", body });
    const savedProject = { ...p, ...result, persisted: true };
    setEditedProject(savedProject);
    // The document mutation is already committed. Accept its revision before
    // refreshing the project list; a read failure must never invite duplicate saves.
    setEditing((current) =>
      current &&
      (current.documentId || current.id) ===
        (savedProject.documentId || savedProject.id)
        ? savedProject
        : current,
    );
    void reloadProjects().catch(() => notify("设计已保存，项目列表暂时未刷新"));
    return savedProject;
  }
  async function favorite(id) {
    const next = favorites.includes(id)
      ? favorites.filter((x) => x !== id)
      : [...favorites, id];
    try {
      await api("/preferences/template-favorites", {
        method: "PUT",
        body: next,
      });
      setFavorites(next);
    } catch (e) {
      notify(e.message);
    }
  }
  async function edit(p) {
    try {
      let target;
      if (p.projectId && p.documentId && p.id !== p.projectId) target = p;
      else if (p.persisted && p.id) {
        target = await api("/projects/" + p.id);
        await api("/projects/" + p.id + "/open", { method: "POST" });
      } else
        target = await api("/projects", {
          method: "POST",
          body: {
            title: p.title || "未命名设计",
            design: initialDesign(p),
            image: p.image,
            type: "设计作品",
          },
        });
      setTemplate(null);
      setTask(null);
      setEditing({ ...target, persisted: true });
      if (!studio) history.pushState(null, "", "#editor/" + target.id);
      await reloadProjects();
      window.scrollTo(0, 0);
    } catch (e) {
      notify(e.message);
    }
  }
  async function openProject(p) {
    try {
      if (!p.workspaceMode) p = await api("/projects/" + p.id);
      if (p.workspaceMode === "editor") {
        await edit(p);
        return;
      }
      const board = await api("/projects/" + p.id + "/studio");
      if (board.snapshot) {
        await restoreStudio(p.id, {}, { project: p, board });
        history.pushState(null, "", "#studio/" + p.id);
      } else await edit(p);
    } catch (e) {
      notify(e.message);
    }
  }
  const current = NAV.find((x) => x[0] === page);
  return (
    <>
      {(creating || creationError) && (
        <div
          className="creation-feedback"
          role={creationError ? "alert" : "status"}
        >
          <span>{creating ? "正在创建作品…" : creationError}</span>
          {creationError && (
            <>
              {creationRequest.current && (
                <button
                  onClick={() => openStudio(creationRequest.current.item)}
                >
                  重试创建
                </button>
              )}
              <button onClick={() => setCreationError("")}>关闭提示</button>
            </>
          )}
        </div>
      )}
      <div
        className={"app-shell " + (collapsed ? "collapsed" : "")}
        aria-busy={creating || loading}
        inert={template || searchOpen ? true : undefined}
      >
        {loadError && (
          <div className="app-load-error" role="alert">
            {loadError}
            <button onClick={() => location.reload()}>重试</button>
          </div>
        )}
        {studio && (
          <div style={{ display: editing ? "none" : "contents" }}>
            <AIStudio
              key={studio.id}
              session={studio}
              onBack={() => navigate("home")}
              onNew={() => openStudio({ workspaceMode: "studio" })}
              onEdit={edit}
              onSave={save}
              onToast={notify}
              editedProject={editedProject}
            />
          </div>
        )}
        {editing ? (
          <Editor
            key={editing.id}
            project={editing}
            onBack={() => {
              setEditing(null);
              if (!studio) navigate("projects");
            }}
            onSave={save}
            onToast={notify}
          />
        ) : studio ? null : (
          <>
            <aside className="sidebar">
              <button
                className="brand"
                onClick={() => navigate("home")}
                aria-label="Design X 首页"
              >
                <span className="brand-symbol">✳</span>
                <span>
                  design<span className="brand-x">x</span>
                  <small>灵感设计室</small>
                </span>
              </button>
              <button
                className="space-picker"
                onClick={() => navigate("projects")}
              >
                <span className="space-avatar">Y</span>
                <span>
                  我的创作空间<small>个人空间</small>
                </span>
                <ChevronDown size={14} />
              </button>
              <button className="create-button" onClick={() => openStudio()}>
                <Plus size={20} />
                <span>开始创作</span>
              </button>
              <nav aria-label="主导航">
                {NAV.map(([id, name, Icon], i) => (
                  <React.Fragment key={id}>
                    {i === 4 && (
                      <div className="nav-separator">
                        <span>我的工作空间</span>
                      </div>
                    )}
                    <button
                      className={
                        "nav-item " + (page === id && !task ? "active" : "")
                      }
                      onClick={() => navigate(id)}
                      title={name}
                    >
                      <Icon size={19} strokeWidth={1.7} />
                      <span>{name}</span>
                      {page === id && !task && <i />}
                    </button>
                  </React.Fragment>
                ))}
              </nav>
              <div className="sidebar-bottom">
                <div className="sidebar-tip">
                  <div>
                    <Sparkles size={17} />
                    <span>给灵感，一个开始</span>
                  </div>
                  <p>选一个模板，开始你的第一张海报</p>
                  <button onClick={() => navigate("templates")}>
                    挑选海报模板 <ArrowUpRight size={14} />
                  </button>
                  <span className="tip-drawing">✳</span>
                </div>
                <button className="nav-item" onClick={() => navigate("guide")}>
                  <BookOpen size={18} />
                  <span>创作指南</span>
                  <ArrowUpRight size={14} />
                </button>
                <div className="profile">
                  <button
                    className="profile-avatar"
                    onClick={onLogout}
                    title="退出登录"
                    aria-label="退出登录"
                  >
                    {sessionUser.name?.slice(0, 1) || "我"}
                  </button>
                  <div>
                    <b>{sessionUser.name} 的设计空间</b>
                    <small>
                      <span /> 个人创作者
                    </small>
                  </div>
                  <button
                    aria-label="收起侧栏"
                    onClick={() => setCollapsed((v) => !v)}
                  >
                    <PanelLeftClose size={17} />
                  </button>
                </div>
              </div>
            </aside>
            <div className="main-shell">
              <header className="topbar">
                <div className="breadcrumb">
                  {collapsed && (
                    <button
                      className="icon-button"
                      onClick={() => setCollapsed(false)}
                      aria-label="展开导航"
                    >
                      <Menu size={18} />
                    </button>
                  )}
                  <span>工作空间</span>
                  <ChevronRight size={13} />
                  <b>{task ? task.name : current?.[1] || "创作指南"}</b>
                </div>
                <div className="header-actions">
                  <button
                    className="header-search"
                    onClick={() => setSearchOpen(true)}
                  >
                    <Search size={15} />
                    <span>搜索灵感、工具或作品</span>
                    <kbd>⌘ K</kbd>
                  </button>
                  <span className="prototype-badge">
                    <span />
                    创作空间
                  </span>
                  <button
                    className="icon-button notification-toggle"
                    aria-label="查看消息"
                    onClick={() => setNotice(!notice)}
                  >
                    <Bell size={18} />
                  </button>
                  <button
                    className="header-avatar"
                    onClick={() => navigate("projects")}
                    aria-label="我的空间"
                  >
                    Y
                  </button>
                </div>
                {notice && (
                  <JobPanel
                    onClose={() => setNotice(false)}
                    onToast={notify}
                    onOpenProject={openProject}
                  />
                )}
              </header>
              <main
                className={"main-content " + (task ? "workbench-content" : "")}
              >
                {task ? (
                  <Workbench
                    key={task.name + task.prompt}
                    item={task}
                    onBack={() => setTask(null)}
                    onEdit={edit}
                    onSave={save}
                    onToast={notify}
                  />
                ) : page === "home" ? (
                  <HomePage
                    onNavigate={navigate}
                    onTemplate={setTemplate}
                    onCreate={openStudio}
                    creating={creating}
                    projects={projects}
                    onProject={openProject}
                    favorites={favorites}
                    toggleFavorite={favorite}
                  />
                ) : page === "templates" ? (
                  <TemplatesPage
                    onSelect={setTemplate}
                    favorites={favorites}
                    toggleFavorite={favorite}
                  />
                ) : page === "skills" || page === "tools" ? (
                  <Catalog mode={page} onSelect={openStudio} onToast={notify} />
                ) : ["projects", "assets", "recent"].includes(page) ? (
                  <Workspace
                    key={page}
                    mode={page}
                    onOpenProject={openProject}
                    onProjectsChanged={reloadProjects}
                    onToast={notify}
                    onCreateProject={openStudio}
                  />
                ) : (
                  <Guide onNavigate={navigate} />
                )}
              </main>
            </div>
          </>
        )}
      </div>
      {toast && (
        <div className="toast" role="status">
          <span aria-hidden="true">·</span>
          {toast}
        </div>
      )}
      {template && (
        <Modal onClose={() => setTemplate(null)} className="template-modal">
          <div className="template-preview">
            <Artwork item={template} />
          </div>
          <div className="template-detail">
            <span className="eyebrow">DESIGN X / EDITOR'S PICK</span>
            <h2>{template.title}</h2>
            <p>{template.description}</p>
            <div className="detail-chips">
              <span>{template.category}</span>
              <span>{template.style}</span>
              <span>可编辑模板</span>
            </div>
            <dl>
              <div>
                <dt>画布比例</dt>
                <dd>3 : 4</dd>
              </div>
              <div>
                <dt>设计内容</dt>
                <dd>图片、文字与装饰元素</dd>
              </div>
              <div>
                <dt>适用场景</dt>
                <dd>{template.subtitle}</dd>
              </div>
            </dl>
            <button
              className="primary"
              disabled={creating}
              onClick={() => openStudio({ template })}
            >
              使用这个模板 <ArrowRight size={17} />
            </button>
            <button className="secondary" onClick={() => favorite(template.id)}>
              <Heart
                size={16}
                fill={favorites.includes(template.id) ? "currentColor" : "none"}
              />
              {favorites.includes(template.id) ? "已收藏灵感" : "收藏这个灵感"}
            </button>
            <small>文字、图片与配色均可在画布中自由调整</small>
          </div>
        </Modal>
      )}
      {searchOpen && (
        <Modal onClose={() => setSearchOpen(false)} className="search-modal" title="搜索项目与灵感">
          <div className="global-search">
            <Search size={22} />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="想找什么灵感？"
              aria-label="全局搜索"
              maxLength={200}
            />
          </div>
          <h4>{query ? "搜索结果" : "快捷导航"}</h4>
          {NAV.filter((x) => !query || x[1].includes(query)).map(
            ([id, n, I]) => (
              <button
                className="search-result"
                key={id}
                onClick={() => {
                  setSearchOpen(false);
                  navigate(id);
                }}
              >
                <I size={18} />
                <span>{n}</span>
                <ArrowUpRight size={15} />
              </button>
            ),
          )}
          {templates
            .filter((t) => query && `${t.title}${t.subtitle}`.includes(query))
            .map((t) => (
              <button
                className="search-result"
                key={t.id}
                onClick={() => {
                  setSearchOpen(false);
                  setTemplate(t);
                }}
              >
                <img src={t.image} />
                <span>{t.title}</span>
                <ArrowUpRight size={15} />
              </button>
            ))}
          {query &&
            publicEntries
              .filter((t) => t.enabled && t.name.includes(query))
              .slice(0, 8)
              .map((t) => (
                <button
                  className="search-result"
                  key={t.id}
                  onClick={() => {
                    setSearchOpen(false);
                    openStudio(t);
                  }}
                >
                  <Sparkles size={18} />
                  <span>
                    {t.name} · {t.category}
                  </span>
                  <ArrowUpRight size={15} />
                </button>
              ))}
          {query &&
            searchedProjects.items.map((p) => (
                <button
                  className="search-result"
                  key={p.id}
                  onClick={() => {
                    setSearchOpen(false);
                    openProject(p);
                  }}
                >
                  <FolderOpen size={18} />
                  <span>{p.title}</span>
                  <ArrowUpRight size={15} />
                </button>
              ))}
          {query.trim() && <LibraryPageStatus page={searchedProjects} label="作品" />}
          {query && searchedProjects.loaded && !searchedProjects.loading && !searchedProjects.error &&
            !publicEntries.some((t) => t.enabled && t.name.includes(query)) &&
            searchedProjects.items.length === 0 &&
            !NAV.some((x) => x[1].includes(query)) &&
            !templates.some((t) =>
              `${t.title}${t.subtitle}`.includes(query),
            ) && (
              <div className="empty-block">
                <p>没有找到匹配内容</p>
                <button
                  onClick={() => {
                    setSearchOpen(false);
                    navigate("skills");
                  }}
                  className="text-button"
                >
                  去技能库继续探索 <ArrowRight size={14} />
                </button>
              </div>
            )}
        </Modal>
      )}
    </>
  );
}
