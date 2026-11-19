import React, { useEffect, useRef, useState } from "react";
import { X, ArrowLeft, RefreshCw } from "lucide-react";
import ModalFrame from "./ui/ModalFrame.jsx";
import { api } from "../lib/api";
import "./FeedbackPanel.css";
const statuses = {
  received: "已收到",
  triaged: "处理中",
  resolved: "已解决",
  closed: "已关闭",
};
const empty = { category: "problem", subject: "", message: "" };
function validBody(body) {
  return (
    body &&
    ["problem", "suggestion"].includes(body.category) &&
    typeof body.subject === "string" &&
    body.subject.length <= 100 &&
    typeof body.message === "string" &&
    body.message.length <= 2000 &&
    [body.projectId, body.jobId].every(
      (id) => id === undefined || /^[0-9a-f-]{36}$/i.test(id),
    )
  );
}
function restore(key, context) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key));
    if (
      saved &&
      Number.isFinite(saved.at) &&
      saved.at <= Date.now() &&
      Date.now() - saved.at < 30 * 86400000 &&
      validBody(saved.body) &&
      (!saved.attempt ||
        (typeof saved.attempt.key === "string" &&
          /^[0-9a-f-]{36}$/i.test(saved.attempt.key) &&
          validBody(saved.attempt.body)))
    )
      return saved;
    sessionStorage.removeItem(key);
  } catch {}
  return { body: { ...empty, ...context }, attempt: null };
}
export default function FeedbackPanel({ owner, context = {}, onClose }) {
  const key = "designx:feedback:" + owner;
  const [initial] = useState(() => restore(key, context)),
    [body, setBody] = useState(initial.body),
    [attempt, setAttempt] = useState(initial.attempt),
    [view, setView] = useState("form"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [storageWarning, setStorageWarning] = useState(""),
    [items, setItems] = useState(null),
    [cursor, setCursor] = useState(null),
    [detail, setDetail] = useState(null),
    [notice, setNotice] = useState("");
  const mounted = useRef(true),
    loadingList = useRef(false),
    sending = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function persist(nextBody, nextAttempt) {
    try {
      sessionStorage.setItem(
        key,
        JSON.stringify({
          at: Date.now(),
          body: nextBody,
          attempt: nextAttempt,
        }),
      );
      setStorageWarning("");
    } catch {
      setStorageWarning("浏览器无法保存本机草稿，请保持此窗口打开。");
    }
  }
  function change(field, value) {
    const next = { ...body, [field]: value };
    setBody(next);
    persist(next, attempt);
  }
  async function showList(more = false) {
    if (loadingList.current) return;
    loadingList.current = true;
    setBusy(true);
    setError("");
    setView("list");
    try {
      const data = await api(
        "/feedback?limit=20" + (more && cursor ? "&cursor=" + cursor : ""),
      );
      if (mounted.current) {
        setItems((previous) =>
          more ? [...(previous || []), ...data.items] : data.items,
        );
        setCursor(data.nextCursor);
      }
    } catch (e) {
      if (mounted.current) setError(e.message);
    } finally {
      loadingList.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function showDetail(id) {
    setBusy(true);
    setError("");
    try {
      const data = await api("/feedback/" + id);
      if (mounted.current) {
        setDetail(data);
        setView("detail");
      }
    } catch (e) {
      if (mounted.current) setError(e.message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function submit(e) {
    e.preventDefault();
    if (sending.current || e.nativeEvent?.isComposing) return;
    sending.current = true;
    const pending = attempt || {
      key: crypto.randomUUID(),
      body: {
        ...body,
        subject: body.subject.trim(),
        message: body.message.trim(),
      },
    };
    persist(body, pending);
    setAttempt(pending);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const receipt = await api("/feedback", {
        method: "POST",
        headers: { "Idempotency-Key": pending.key },
        body: pending.body,
      });
      if (!receipt?.id) throw new Error("服务返回了无法核对的受理结果");
      try {
        sessionStorage.removeItem(key);
      } catch {}
      if (mounted.current) {
        setAttempt(null);
        setBody({ ...empty });
        setNotice("反馈已保存。已收到表示系统受理，处理进展请在我的反馈查看。");
        await showDetail(receipt.id);
      }
    } catch (e) {
      if (mounted.current) {
        // Known validation/permission/rate errors did not accept a new request. Unknown results keep the exact body/key.
        if (e.status && e.status < 500 && e.status !== 408) {
          setAttempt(null);
          persist(body, null);
          setError(e.message);
        } else
          setError(
            "暂时无法确认是否受理，请核对重试；重试使用同一请求，不会重复提交。",
          );
      }
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function discard() {
    try {
      sessionStorage.removeItem(key);
    } catch {}
    setBody({ ...empty, ...context });
    setAttempt(null);
    setError("");
    setNotice("本机草稿已清除，已受理的反馈仍保留在我的反馈。");
  }
  return (
    <ModalFrame title="反馈与帮助" onClose={onClose} closeDisabled={busy}>
      <div className="modal-shade dx-feedback-shade">
        <section className="dx-feedback" aria-busy={busy}>
          <header>
            <h2>反馈与帮助</h2>
            <button
              type="button"
              aria-label="关闭反馈"
              disabled={busy}
              onClick={onClose}
            >
              <X size={20} />
            </button>
          </header>
          <nav aria-label="反馈导航">
            <button
              disabled={busy}
              aria-pressed={view === "form"}
              onClick={() => {
                setView("form");
                setError("");
              }}
            >
              提交反馈
            </button>
            <button
              disabled={busy}
              aria-pressed={view !== "form"}
              onClick={() => showList()}
            >
              我的反馈
            </button>
          </nav>
          <div className="dx-feedback-body">
            {notice && (
              <p role="status" className="dx-feedback-notice">
                {notice}
              </p>
            )}
            {storageWarning && <p role="alert">{storageWarning}</p>}
            {error && (
              <p role="alert" className="dx-feedback-error">
                {error}
              </p>
            )}
            {view === "form" && (
              <form onSubmit={submit}>
                <p id="feedback-help">
                  描述遇到的问题或建议即可，无需邮箱或手机号。请勿填写密码、令牌或其他私密内容。
                </p>
                <fieldset disabled={busy || !!attempt}>
                  <div className="dx-feedback-field">
                    <label htmlFor="feedback-category">反馈类型</label>
                    <select
                      id="feedback-category"
                      value={body.category}
                      onChange={(e) => change("category", e.target.value)}
                    >
                      <option value="problem">问题</option>
                      <option value="suggestion">建议</option>
                    </select>
                  </div>
                  <div className="dx-feedback-field">
                    <label htmlFor="feedback-subject">简短标题</label>
                    <input
                      id="feedback-subject"
                      required
                      maxLength={100}
                      value={body.subject}
                      onChange={(e) => change("subject", e.target.value)}
                      data-autofocus
                    />
                  </div>
                  <div className="dx-feedback-field">
                    <label htmlFor="feedback-message">详细描述</label>
                    <textarea
                      id="feedback-message"
                      required
                      maxLength={2000}
                      rows={5}
                      value={body.message}
                      onChange={(e) => change("message", e.target.value)}
                      aria-describedby="feedback-help"
                    />
                  </div>
                  {(body.projectId || body.jobId) && (
                    <div className="dx-feedback-context">
                      <span>
                        附带当前{body.jobId ? "任务和作品" : "作品"}
                        编号，便于定位；不自动附带作品内容。
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const next = {
                            category: body.category,
                            subject: body.subject,
                            message: body.message,
                          };
                          setBody(next);
                          persist(next, null);
                        }}
                      >
                        移除关联
                      </button>
                    </div>
                  )}
                </fieldset>
                {attempt && (
                  <p>
                    上次受理结果待核对，保留原内容后重试。也可以先查看我的反馈。
                  </p>
                )}
                <div className="dx-feedback-actions">
                  <button
                    className="dx-feedback-primary"
                    disabled={busy}
                    type="submit"
                  >
                    {busy ? "正在核对…" : attempt ? "核对并重试" : "发送反馈"}
                  </button>
                  <button type="button" disabled={busy} onClick={discard}>
                    清除本机草稿
                  </button>
                </div>
                <p className="dx-feedback-meta">
                  草稿仅保留在当前浏览器会话中，重新打开时清理超过 30
                  天的内容；关闭标签页通常会清除。
                </p>
              </form>
            )}
            {view === "list" && (
              <>
                <div className="dx-feedback-actions">
                  <button disabled={busy} onClick={() => showList()}>
                    <RefreshCw size={16} />
                    刷新记录
                  </button>
                </div>
                {busy && <p role="status">正在读取反馈…</p>}
                {items?.length === 0 && !error && <p>还没有反馈记录。</p>}
                {items?.map((item) => (
                  <button
                    key={item.id}
                    className="dx-feedback-row"
                    disabled={busy}
                    onClick={() => showDetail(item.id)}
                  >
                    <strong>{item.subject}</strong>
                    <span>
                      {statuses[item.status]} ·{" "}
                      {new Date(item.createdAt).toLocaleDateString()}
                    </span>
                    <small>反馈号 {item.id}</small>
                  </button>
                ))}
                {cursor && (
                  <button disabled={busy} onClick={() => showList(true)}>
                    加载更多反馈
                  </button>
                )}
              </>
            )}
            {view === "detail" && detail && (
              <article>
                <div className="dx-feedback-actions">
                  <button disabled={busy} onClick={() => showList()}>
                    <ArrowLeft size={16} />
                    返回记录
                  </button>
                  <button disabled={busy} onClick={() => showDetail(detail.id)}>
                    刷新进展
                  </button>
                </div>
                <h3>{detail.subject}</h3>
                <p className="dx-feedback-state">{statuses[detail.status]}</p>
                <p className="dx-feedback-meta">反馈号 {detail.id}</p>
                <p className="dx-feedback-message">{detail.message}</p>
                {detail.job && (
                  <p>
                    关联任务：{detail.job.id} · {detail.job.kind} ·{" "}
                    {detail.job.status}
                  </p>
                )}
                <h3>处理进展</h3>
                {!detail.updates.length && (
                  <p>系统已收到，暂时没有人工处理回复。无需重复提交。</p>
                )}
                {detail.updates.map((update) => (
                  <section className="dx-feedback-update" key={update.revision}>
                    <b>{statuses[update.status]}</b>
                    <p className="dx-feedback-message">{update.reply}</p>
                    <small>{new Date(update.createdAt).toLocaleString()}</small>
                  </section>
                ))}
              </article>
            )}
          </div>
        </section>
      </div>
    </ModalFrame>
  );
}
