import React, { useEffect, useRef, useState } from "react";
import { ArrowRight, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { api } from "../lib/api";
import App from "../App";
import "./auth.css";

export default function Auth() {
  const [session, setSession] = useState(null),
    [checking, setChecking] = useState(true),
    [register, setRegister] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [showPassword, setShowPassword] = useState(false),
    [serviceError, setServiceError] = useState(false);
  const currentSession = useRef(session);
  currentSession.current = session;
  const [expiredSession, setExpiredSession] = useState(false);
  useEffect(() => {
    if (session?.user.id) {
      try {
        sessionStorage.setItem("designx:last-user", session.user.id);
      } catch {}
    }
  }, [session?.user.id]);
  useEffect(() => {
    api("/auth/me")
      .then(setSession)
      .catch((e) => {
        if (e.status !== 401) setServiceError(true);
      })
      .finally(() => setChecking(false));
    const expired = () => {
      let userId = currentSession.current?.user.id;
      try {
        userId ||= sessionStorage.getItem("designx:last-user");
      } catch {}
      if (userId) {
        try {
          sessionStorage.setItem(
            "designx:resume",
            JSON.stringify({
              userId,
              hash: location.hash,
            }),
          );
        } catch {}
        setExpiredSession(true);
      }
      setSession(null);
    };
    window.addEventListener("designx:unauthorized", expired);
    return () => window.removeEventListener("designx:unauthorized", expired);
  }, []);
  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    const data = Object.fromEntries(new FormData(e.currentTarget));
    if (register && data.password !== data.confirmPassword) {
      setError("两次输入的密码不一致");
      e.currentTarget.elements.confirmPassword.focus();
      return;
    }
    delete data.confirmPassword;
    setBusy(true);
    setError("");
    try {
      const next = await api(`/auth/${register ? "register" : "login"}`, {
        method: "POST",
        body: data,
      });
      let destination = "#home";
      try {
        const resume = JSON.parse(
          sessionStorage.getItem("designx:resume") || "null",
        );
        if (
          resume?.userId === next.user.id &&
          /^#(?:editor|studio)\/[a-zA-Z0-9_-]+$/.test(resume.hash)
        )
          destination = resume.hash;
        sessionStorage.removeItem("designx:resume");
      } catch {}
      history.replaceState(null, "", destination);
      setExpiredSession(false);
      setSession(next);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    await api("/auth/logout", { method: "POST" });
    location.hash = "home";
    try {
      sessionStorage.removeItem("designx:resume");
      sessionStorage.removeItem("designx:last-user");
    } catch {}
    setExpiredSession(false);
    setRegister(false);
    setError("");
    setSession(null);
  }
  if (checking)
    return (
      <div className="auth-loading">
        <LoaderCircle className="st-spin" /> 正在打开创作空间…
      </div>
    );
  if (serviceError)
    return (
      <main className="auth-loading" role="alert">
        暂时无法连接服务，请检查网络后重试。
        <button className="auth-retry" onClick={() => location.reload()}>
          重新连接
        </button>
      </main>
    );
  if (session)
    return (
      <App
        key={session.user.id}
        sessionUser={session.user}
        workspace={session.workspace}
        onLogout={logout}
        onSessionChange={setSession}
      />
    );
  return (
    <div className="auth-page">
      <section className="auth-story">
        <div className="auth-logo">
          ✳ design<span>x</span>
        </div>
        <div>
          <span className="eyebrow">A SPACE FOR YOUR IDEAS</span>
          <h1>
            给灵感，
            <br />
            一个自己的空间。
          </h1>
          <p>
            收藏素材，打磨设计。
            <br />
            让每一次创作，都有迹可循。
          </p>
        </div>
        <img src="/assets/coffee.jpg" alt="温暖的咖啡创作灵感" />
      </section>
      <main className="auth-form-wrap">
        <form onSubmit={submit} aria-busy={busy}>
          <span className="eyebrow">YOUR CREATIVE WORKSPACE</span>
          <h2>{register ? "开始你的创作旅程" : "欢迎回来"}</h2>
          {expiredSession && (
            <p role="status">
              登录已失效。使用同一账号登录后，可继续恢复本机未同步的作品。
            </p>
          )}
          <p>
            {register
              ? "创建账户，保存属于你的每一份灵感。"
              : "登录后继续上次的灵感。"}
          </p>
          {register && (
            <label>
              你的名字
              <input
                name="name"
                autoComplete="name"
                required
                maxLength={60}
                placeholder="怎么称呼你"
              />
            </label>
          )}
          <label>
            {register ? "账号" : "登录账号"}
            <input
              key={register ? "username" : "account"}
              name={register ? "username" : "account"}
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              minLength={register ? 3 : undefined}
              maxLength={register ? 32 : 254}
              pattern={register ? "[a-zA-Z][a-zA-Z0-9_.\\-]{2,31}" : undefined}
              aria-describedby={register ? "auth-account-help" : undefined}
              placeholder={
                register ? "例如 lin_design" : "用户名或已有邮箱账号"
              }
              disabled={busy}
            />
          </label>
          {register && (
            <p id="auth-account-help" className="auth-help">
              3–32
              位，以字母开头，可用字母、数字、下划线、点和短横线；不区分大小写。
            </p>
          )}
          <label>
            密码
            <input
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete={register ? "new-password" : "current-password"}
              required
              minLength={register ? 10 : 1}
              maxLength={128}
              placeholder="至少 10 个字符"
              disabled={busy}
            />
          </label>
          <button
            type="button"
            className="auth-password-toggle"
            aria-pressed={showPassword}
            onClick={() => setShowPassword(!showPassword)}
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            {showPassword ? "隐藏密码" : "显示密码"}
          </button>
          {register && (
            <label>
              确认密码
              <input
                name="confirmPassword"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                required
                minLength={10}
                maxLength={128}
                disabled={busy}
              />
            </label>
          )}
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? (
              <LoaderCircle className="st-spin" size={18} />
            ) : (
              <ArrowRight size={18} />
            )}{" "}
            {register ? "创建账户" : "进入创作空间"}
          </button>
          <button
            type="button"
            className="auth-switch"
            disabled={busy}
            onClick={() => {
              setRegister(!register);
              setError("");
              setShowPassword(false);
            }}
          >
            {register ? "已有账户？登录" : "第一次来？创建账户"}
          </button>
          <small>设计与素材将保存在你的个人工作空间中。</small>
        </form>
      </main>
    </div>
  );
}
