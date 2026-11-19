import React, { Component, Suspense } from "react";
class RouteError extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <section className="dx-route-state" role="alert">
        <h2>创作界面加载失败</h2>
        <p>请检查网络后重新加载，已保存作品和本机草稿会保留。</p>
        <button onClick={() => location.reload()}>重新加载界面</button>
        <button onClick={this.props.onBack}>返回作品列表</button>
      </section>
    ) : (
      this.props.children
    );
  }
}
export default function DeferredRoute({ children, onBack }) {
  return (
    <RouteError onBack={onBack}>
      <Suspense
        fallback={
          <section className="dx-route-state" role="status" aria-live="polite">
            <h2>正在加载创作界面…</h2>
            <button onClick={onBack}>返回作品列表</button>
          </section>
        }
      >
        {children}
      </Suspense>
    </RouteError>
  );
}
