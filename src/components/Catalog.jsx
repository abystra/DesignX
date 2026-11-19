import React, { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Bookmark, Search } from "lucide-react";
import catalog from "../data/catalog.json";
import { readPreference, usePreferenceWriter, acceptPreference } from "../lib/preferences";
import { useCapabilities } from "../lib/creative-capabilities";
import { creationEntries } from "../lib/creation-entry.js";
import "./creation-catalog.css";

export default function Catalog({ mode = "tools", onSelect, onToast }) {
  const capabilities = useCapabilities();
  const writePreference = usePreferenceWriter();
  const favoriteRevision = useRef(0);
  const [query, setQuery] = useState("");
  const [favorites, setFavorites] = useState([]);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isPresets = mode === "skills";
  const entries = creationEntries(
    capabilities.catalog,
    isPresets ? catalog.skills : [],
  ).filter((item) =>
    isPresets ? item.kind === "preset" : item.kind !== "preset",
  );
  const filtered = entries.filter(
    (item) =>
      (!favoritesOnly || favorites.includes(item.id)) &&
      `${item.name} ${item.description}`.includes(query.trim()),
  );
  async function loadFavorites() {
    try {
      acceptPreference(await readPreference("catalog-favorites"), favoriteRevision, setFavorites);
      setReady(true);
      setError("");
    } catch (failure) {
      setError(failure.message);
    }
  }
  useEffect(() => {
    loadFavorites();
  }, []);
  useEffect(() => {
    setQuery("");
    setFavoritesOnly(false);
  }, [mode]);
  async function toggleFavorite(item) {
    if (!ready || saving) return;
    setSaving(true);
    try {
      acceptPreference(await writePreference("catalog-favorites", { item: item.id, present: !favorites.includes(item.id) }), favoriteRevision, setFavorites);
      setError("");
    } catch (failure) {
      setError(failure.message);
      onToast?.(failure.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section
      className="creation-catalog"
      aria-label={isPresets ? "创作提示词目录" : "设计工具目录"}
    >
      <header>
        <span className="poster-eyebrow">YOUR CREATIVE TOOLKIT</span>
        <h1>
          {isPresets ? "把想法，写得更具体。" : "从第一张海报，到一组作品。"}
        </h1>
        <p>
          {isPresets
            ? "这些是可复用的提示词，不是独立设计工具。AI 创作开放后，可以把它们带入工作区。"
            : "手动编辑随时可用。自动生成与执行配方按当前服务能力开放。"}
        </p>
      </header>
      {capabilities.loading && <p role="status">正在读取自动创作能力…</p>}
      {capabilities.error && (
        <p role="alert">
          自动创作能力暂时无法读取，仍可使用手动编辑。{capabilities.error}
        </p>
      )}
      {error && (
        <div role="alert">
          {error}
          <button onClick={loadFavorites}>重新加载收藏</button>
        </div>
      )}
      <div className="creation-catalog-controls">
        <label>
          <Search size={20} />
          <span className="sr-only">搜索{isPresets ? "提示词" : "工具"}</span>
          <input
            aria-label={isPresets ? "搜索提示词" : "搜索工具"}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              isPresets ? "搜索海报、商品等提示词" : "搜索模板、素材或工作区"
            }
          />
        </label>
        <button
          aria-pressed={favoritesOnly}
          onClick={() => setFavoritesOnly((value) => !value)}
        >
          <Bookmark size={16} />
          我的收藏
        </button>
      </div>
      <p className="creation-catalog-count">
        {filtered.length} 个{isPresets ? "提示词预设" : "创作入口"}
      </p>
      <div className="creation-catalog-grid">
        {filtered.map((item) => (
          <article key={item.id}>
            <div className="creation-catalog-card-head">
              <span>
                {item.kind === "manual"
                  ? "手动编辑"
                  : item.kind === "recipe"
                    ? `执行配方 v${item.version}`
                    : "提示词预设"}
              </span>
              <button
                disabled={!ready || saving}
                aria-label={`${favorites.includes(item.id) ? "取消收藏" : "收藏"}${item.name}`}
                aria-pressed={favorites.includes(item.id)}
                onClick={() => toggleFavorite(item)}
              >
                <Bookmark
                  size={18}
                  fill={favorites.includes(item.id) ? "currentColor" : "none"}
                />
              </button>
            </div>
            <h2>{item.name}</h2>
            <p>{item.description}</p>
            {!item.enabled && (
              <p className="creation-unavailable">
                尚未开放 · {item.reason || "当前服务未启用这项能力"}
              </p>
            )}
            <button
              className="creation-catalog-start"
              disabled={!item.enabled}
              onClick={() => onSelect?.(item)}
            >
              {item.enabled
                ? item.kind === "manual"
                  ? "开始设计"
                  : "进入工作区"
                : "尚未开放"}
              <ArrowUpRight size={18} />
            </button>
          </article>
        ))}
      </div>
      {!filtered.length && (
        <p role="status">
          没有找到匹配内容。
          <button
            onClick={() => {
              setQuery("");
              setFavoritesOnly(false);
            }}
          >
            清除筛选
          </button>
        </p>
      )}
    </section>
  );
}
