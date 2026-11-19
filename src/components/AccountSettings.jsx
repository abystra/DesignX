import React, { useState } from "react";
import {
  CheckCircle2,
  KeyRound,
  LogOut,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { api } from "../lib/api";
import "./account.css";

function Feedback({ error, message }) {
  return error ? (
    <p className="account-error" role="alert">
      {error}
    </p>
  ) : message ? (
    <p className="account-success" role="status">
      <CheckCircle2 size={18} aria-hidden="true" />
      {message}
    </p>
  ) : null;
}
export default function AccountSettings({
  user,
  workspace,
  onSessionChange,
  onLogout,
}) {
  const [name, setName] = useState(user.name);
  const [workspaceName, setWorkspaceName] = useState(workspace.name);
  const [profile, setProfile] = useState({});
  const [password, setPassword] = useState({});
  const [sessions, setSessions] = useState({});
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  async function saveProfile(event) {
    event.preventDefault();
    if (profile.busy) return;
    setProfile({ busy: true });
    try {
      const next = await api("/auth/profile", {
        method: "PATCH",
        body: { name, workspaceName },
      });
      onSessionChange(next);
      setName(next.user.name);
      setWorkspaceName(next.workspace.name);
      setProfile({ message: "个人资料已保存" });
    } catch (error) {
      setProfile({ error: error.message });
    }
  }
  async function savePassword(event) {
    event.preventDefault();
    if (password.busy) return;
    if (newPassword !== confirmPassword) {
      setPassword({ error: "两次输入的新密码不一致" });
      event.currentTarget.elements.confirmPassword.focus();
      return;
    }
    setPassword({ busy: true });
    try {
      await api("/auth/password", {
        method: "POST",
        body: { currentPassword, newPassword },
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPassword({ message: "密码已修改，其他设备已退出登录。" });
    } catch (error) {
      setPassword({ error: error.message });
    }
  }
  async function manageSession(logout = false) {
    if (sessions.busy) return;
    setSessions({ busy: true });
    try {
      if (logout) await onLogout();
      else {
        const result = await api("/auth/sessions/revoke-others", {
          method: "POST",
        });
        setSessions({
          message: result.revoked
            ? "其他设备已退出登录，当前设备继续使用。"
            : "没有需要退出的其他登录会话。",
        });
      }
    } catch (error) {
      setSessions({ error: error.message });
    }
  }
  return (
    <div className="account-page">
      <header>
        <span className="account-eyebrow">YOUR ACCOUNT</span>
        <h1>账户设置</h1>
        <p>管理个人资料、密码与登录状态。</p>
      </header>
      <div className="account-sections">
        <section
          className="account-card"
          aria-labelledby="account-profile-title"
        >
          <h2 id="account-profile-title">
            <UserRound size={20} aria-hidden="true" />
            个人资料
          </h2>
          <form onSubmit={saveProfile}>
            <label>
              登录账号
              <input
                value={user.username || user.email || ""}
                readOnly
                autoComplete="username"
              />
            </label>
            <p className="account-help">
              登录账号用于识别你的账户，昵称可以随时修改。
            </p>
            <label>
              昵称
              <input
                name="name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setProfile({});
                }}
                required
                maxLength={80}
                autoComplete="nickname"
                disabled={profile.busy}
              />
            </label>
            <label>
              空间名称
              <input
                name="workspaceName"
                value={workspaceName}
                onChange={(e) => {
                  setWorkspaceName(e.target.value);
                  setProfile({});
                }}
                required
                maxLength={100}
                disabled={profile.busy}
              />
            </label>
            <Feedback {...profile} />
            <button className="account-primary" disabled={profile.busy}>
              {profile.busy ? "正在保存…" : "保存个人资料"}
            </button>
          </form>
        </section>
        <section
          className="account-card"
          aria-labelledby="account-password-title"
        >
          <h2 id="account-password-title">
            <KeyRound size={20} aria-hidden="true" />
            修改密码
          </h2>
          <p className="account-help">
            修改后当前设备保持登录，其他设备需要使用新密码重新登录。
          </p>
          <form onSubmit={savePassword}>
            <label>
              当前密码
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => {
                  setCurrentPassword(e.target.value);
                  setPassword({});
                }}
                required
                maxLength={128}
                autoComplete="current-password"
                disabled={password.busy}
              />
            </label>
            <label>
              新密码
              <input
                type="password"
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  setPassword({});
                }}
                required
                minLength={10}
                maxLength={128}
                aria-describedby="account-password-help"
                autoComplete="new-password"
                disabled={password.busy}
              />
            </label>
            <p id="account-password-help" className="account-help">
              使用 10–128 个字符，不要与当前密码相同。
            </p>
            <label>
              确认新密码
              <input
                name="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  setPassword({});
                }}
                required
                minLength={10}
                maxLength={128}
                autoComplete="new-password"
                disabled={password.busy}
              />
            </label>
            <Feedback {...password} />
            <button className="account-primary" disabled={password.busy}>
              {password.busy ? "正在修改…" : "更新密码"}
            </button>
          </form>
        </section>
        <section
          className="account-card account-sessions"
          aria-labelledby="account-session-title"
        >
          <div>
            <h2 id="account-session-title">
              <ShieldCheck size={20} aria-hidden="true" />
              登录管理
            </h2>
            <p className="account-help">
              使用公共设备后，请退出登录。退出不会删除已保存的作品。
            </p>
          </div>
          <Feedback {...sessions} />
          <div className="account-actions">
            <button
              className="account-secondary"
              disabled={sessions.busy}
              onClick={() => manageSession()}
            >
              退出其他设备
            </button>
            <button
              className="account-secondary"
              disabled={sessions.busy}
              onClick={() => manageSession(true)}
            >
              <LogOut size={18} aria-hidden="true" />
              退出登录
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
