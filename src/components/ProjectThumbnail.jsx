import React, { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import DesignThumbnail from "./DesignThumbnail";
import "./library-pages.css";

export default function ProjectThumbnail({ project }) {
  const host = useRef(null);
  const [visible, setVisible] = useState(false);
  const [preview, setPreview] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "100px" },
    );
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || project.design) return;
    const controller = new AbortController();
    setPreview(null);
    setFailed(false);
    api(`/projects/${project.id}`, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setPreview(value.design);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [
    visible,
    project.id,
    project.documentId,
    project.revision,
    project.design,
  ]);
  const design = project.design || preview;
  return (
    <span className="dx-project-preview" ref={host}>
      {design ? (
        <DesignThumbnail design={design} title={project.title} />
      ) : (
        <span className="dx-preview-state">
          {failed ? "预览暂不可用，打开作品查看" : "正在加载作品预览…"}
        </span>
      )}
    </span>
  );
}
