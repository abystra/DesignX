import React, { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import "./library-pages.css";
// Bound cold work per tab; mounted offscreen cards never request full documents.
let active = 0;
const queue = [];
function schedule(task, signal) {
  return new Promise((resolve, reject) => {
    queue.push({ task, signal, resolve, reject });
    drain();
  });
}
function drain() {
  while (active < 3 && queue.length) {
    const item = queue.shift();
    if (item.signal.aborted) {
      item.resolve();
      continue;
    }
    active++;
    item
      .task()
      .then(item.resolve, item.reject)
      .finally(() => {
        active--;
        drain();
      });
  }
}
export default function ProjectThumbnail({ project }) {
  const host = useRef(null),
    [visible, setVisible] = useState(false),
    [state, setState] = useState({}),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: "100px" },
    );
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const again = (e) => {
      if (e.detail === project.id) setRetry((n) => n + 1);
    };
    window.addEventListener("designx:preview-retry", again);
    return () => window.removeEventListener("designx:preview-retry", again);
  }, [project.id]);
  useEffect(() => {
    if (!visible || project.deletedAt) return;
    const controller = new AbortController(),
      signal = controller.signal;
    let timer;
    setState((previous) => ({ ...previous, failed: false, pending: true }));
    schedule(async () => {
      for (let n = 0; n < 80 && !signal.aborted; n++) {
        let result;
        try {
          result = await api(`/projects/${project.id}/preview`, {
            method: "POST",
            body: { retry: retry > 0 && n === 0 },
            signal,
          });
        } catch (error) {
          if (error.status === 409 && n < 3) continue;
          throw error;
        }
        if (signal.aborted) return;
        const failed = ["failed", "cancelled"].includes(result.current.status);
        setState({
          url: result.preview?.url,
          stale: !!result.preview?.stale,
          pending: !failed && result.current.status !== "succeeded",
          failed,
        });
        if (failed || result.current.status === "succeeded") return;
        await new Promise((resolve) => {
          const done = () => {
            signal.removeEventListener("abort", done);
            resolve();
          };
          timer = setTimeout(done, 1500);
          signal.addEventListener("abort", done, { once: true });
        });
      }
      if (!signal.aborted)
        setState((previous) => ({ ...previous, failed: true, pending: false }));
    }, signal).catch(() => {
      if (!signal.aborted)
        setState((previous) => ({ ...previous, failed: true, pending: false }));
    });
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [
    visible,
    project.id,
    project.documentId,
    project.revision,
    project.deletedAt,
    retry,
  ]);
  return (
    <span
      className="dx-project-preview"
      ref={host}
      aria-busy={state.pending || undefined}
    >
      {state.url ? (
        <img
          className="dx-preview-image"
          src={state.url}
          alt={`${project.title}预览`}
          loading="lazy"
          decoding="async"
          onError={() =>
            setState((previous) => ({
              ...previous,
              url: null,
              failed: true,
              pending: false,
            }))
          }
        />
      ) : (
        <span className="dx-preview-state">
          {project.deletedAt
            ? "作品已移到回收站"
            : state.failed
              ? "预览暂不可用，可在更多操作中重试"
              : "正在生成作品预览…"}
        </span>
      )}
      {state.url && (state.stale || state.failed) && (
        <span className="dx-preview-label">
          {state.failed ? "预览更新失败，可重试" : "旧版预览 · 正在更新"}
        </span>
      )}
    </span>
  );
}
