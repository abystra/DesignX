import React from "react";
import "./library-pages.css";

export default function LibraryPageStatus({ page, label = "内容" }) {
  return (
    <div className="dx-page-status">
      {page.error && (
        <div role="alert">
          <span>
            {label}加载失败：{page.error}
          </span>
          <button type="button" onClick={page.retry}>
            重试加载{label}
          </button>
        </div>
      )}
      {page.loading && <p role="status">正在加载{label}…</p>}
      {page.loaded && (
        <p role="status">
          已显示 {page.items.length} / {page.total} 项{label}
        </p>
      )}
      {page.nextCursor && !page.error && (
        <button type="button" disabled={page.loading} onClick={page.loadMore}>
          加载更多{label}
        </button>
      )}
    </div>
  );
}
