import React, { useState } from "react";
import { useLibraryPage } from "../lib/use-library-page";
import LibraryPageStatus from "./LibraryPageStatus";

export function LogoPicker({ value, onChange }) {
  const [q, setQuery] = useState("");
  const page = useLibraryPage("/assets/page", { q, status: "ready" });
  return (
    <div className="dx-material-picker">
      <label>
        查找 Logo 素材
        <input
          aria-label="搜索品牌 Logo"
          type="search"
          maxLength={200}
          value={q}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="按素材名称搜索"
        />
      </label>
      <label>
        品牌 Logo
        <select
          aria-label="品牌 Logo"
          value={value || ""}
          onChange={(e) =>
            onChange(page.items.find((a) => a.id === e.target.value) || null)
          }
        >
          <option value="">不使用 Logo</option>
          {value && !page.items.some((a) => a.id === value) && (
            <option value={value}>当前已选 Logo</option>
          )}
          {page.items.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title}
            </option>
          ))}
        </select>
      </label>
      <LibraryPageStatus page={page} label="Logo 素材" />
    </div>
  );
}

export function ReferencePicker({ value, onChange, stockAssets }) {
  const [q, setQuery] = useState("");
  const page = useLibraryPage("/assets/page", { q, status: "ready" });
  const samples = stockAssets.filter((a) =>
    a.title.toLowerCase().includes(q.trim().toLowerCase()),
  );
  return (
    <div className="dx-material-picker">
      <label>
        查找参考图片
        <input
          aria-label="搜索参考图片"
          type="search"
          maxLength={200}
          value={q}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="ws-reference-images">
        <button
          type="button"
          className={value ? "" : "active"}
          aria-label="不使用参考图片"
          onClick={() => onChange(null)}
        >
          纯文字参考
        </button>
        {[...page.items, ...samples].map((a) => (
          <button
            type="button"
            key={a.id}
            className={value === a.image ? "active" : ""}
            aria-label={`选择 ${a.title}`}
            aria-pressed={value === a.image}
            onClick={() => onChange(a)}
          >
            <img src={a.thumbnail || a.image} alt={a.title} loading="lazy" />
          </button>
        ))}
      </div>
      <LibraryPageStatus page={page} label="参考素材" />
    </div>
  );
}
