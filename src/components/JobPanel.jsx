import React, { useEffect, useState, useRef } from "react";
import {
  X,
  Download,
  RotateCcw,
  LoaderCircle,
  CheckCircle2,
} from "lucide-react";
import { createPortal } from "react-dom";
import "./JobPanel.css";
import { api } from "../lib/api";
export default function JobPanel({
  onClose,
  onToast,
  onOpenProject,
  onFeedback,
}) {
  const [jobs, setJobs] = useState([]),
    [error, setError] = useState(""),
    [loaded, setLoaded] = useState(false);
  const loading = useRef(false),
    mounted = useRef(true),
    previous = useRef(document.activeElement),
    panel = useRef(null),
    close = useRef(onClose);
  close.current = onClose;
  async function load() {
    if (loading.current) return;
    loading.current = true;
    try {
      const result = await api("/jobs");
      if (mounted.current) {
        setJobs(result);
        setError("");
        setLoaded(true);
      }
    } catch (e) {
      if (mounted.current) setError(e.message);
    } finally {
      loading.current = false;
    }
  }
  useEffect(() => {
    mounted.current = true;
    load();
    panel.current?.querySelector("button")?.focus();
    const onKey = (e) => {
      if (
        e.key === "Escape" &&
        !e.isComposing &&
        !e.target.closest?.("dialog[open]")
      ) {
        e.preventDefault();
        close.current();
      }
    };
    document.addEventListener("keydown", onKey);
    const timer = setInterval(load, 2500);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      document.removeEventListener("keydown", onKey);
      if (previous.current?.isConnected) previous.current.focus();
    };
  }, []);
  async function action(id, action) {
    try {
      await api(`/jobs/${id}/${action}`, { method: "POST" });
      await load();
    } catch (e) {
      onToast?.(e.message);
    }
  }
  return createPortal(
    <div
      className="notification-panel job-panel"
      ref={panel}
      role="region"
      aria-label="创作动态"
    >
      <h3>
        创作动态{" "}
        <button className="icon-button" onClick={onClose} aria-label="关闭消息">
          <X size={15} />
        </button>
      </h3>
      {error && (
        <p role="alert">
          {error}
          <button onClick={load}>重试读取任务</button>
        </p>
      )}
      {!loaded && !error && <p role="status">正在读取任务…</p>}
      {loaded && !error && !jobs.length && (
        <p>上传素材、导入项目和导出作品后，可以在这里查看进度。</p>
      )}
      {jobs.slice(0, 30).map((j) => (
        <article key={j.id} className="job-row">
          <div>
            {j.status === "succeeded" ? (
              <CheckCircle2 size={17} />
            ) : ["running", "queued"].includes(j.status) ? (
              <LoaderCircle size={17} className="st-spin" />
            ) : (
              <RotateCcw size={17} />
            )}
            <b>
              {j.kind === "project.import"
                ? "项目导入"
                : j.kind?.startsWith("render")
                  ? "作品导出"
                  : j.kind?.startsWith("media")
                    ? "素材处理"
                    : j.kind}
            </b>
          </div>
          <span>
            {{
              queued: "等待处理",
              running: "处理中",
              succeeded: "已完成",
              failed: "处理失败",
              cancelled: "已取消",
            }[j.status] || j.status}
            {j.progress != null ? ` · ${j.progress}%` : ""}
          </span>
          {j.error && <small>{j.error}</small>}
          <div className="job-actions">
            {j.status === "failed" && (
              <button
                onClick={() =>
                  onFeedback?.({
                    jobId: j.id,
                    ...(j.projectId ? { projectId: j.projectId } : {}),
                  })
                }
              >
                反馈此任务
              </button>
            )}
            {["failed", "cancelled"].includes(j.status) && (
              <button onClick={() => action(j.id, "retry")}>重试</button>
            )}
            {["queued", "running"].includes(j.status) && (
              <button onClick={() => action(j.id, "cancel")}>取消</button>
            )}
            {j.status === "succeeded" && j.kind?.startsWith("render") && (
              <a
                href={`/api/exports/${j.result?.exportId || j.exportId || j.id}/file`}
                download
              >
                <Download size={13} />
                下载
              </a>
            )}
            {j.status === "succeeded" &&
              j.kind === "project.import" &&
              j.result?.projectId &&
              onOpenProject && (
                <button
                  onClick={() => {
                    onClose();
                    onOpenProject({ id: j.result.projectId });
                  }}
                >
                  打开项目
                </button>
              )}
          </div>
        </article>
      ))}
    </div>,
    document.body,
  );
}
