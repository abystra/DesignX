import React, { useLayoutEffect, useRef } from "react";
import "./modal.css";
const focusable =
  'button:not([disabled]),a[href],input:not([disabled]):not([type=hidden]),textarea:not([disabled]),select:not([disabled]),[tabindex="0"]';
/** Native top layer supplies background isolation; one shared keyboard/focus lifecycle. */
export default function ModalFrame({
  title,
  onClose,
  children,
  closeDisabled = false,
  role = "dialog",
}) {
  const dialog = useRef(null),
    previous = useRef(
      typeof document === "undefined" ? null : document.activeElement,
    ),
    composing = useRef(false),
    close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const node = dialog.current;
    node.showModal();
    const preferred = node.querySelector("[data-autofocus],[autofocus]");
    if (preferred) preferred.focus();
    const resize = () => {
      node.style.setProperty(
        "--dx-visible-height",
        `${window.visualViewport?.height || window.innerHeight}px`,
      );
      node.style.top = `${window.visualViewport?.offsetTop || 0}px`;
    };
    resize();
    window.visualViewport?.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("scroll", resize);
    return () => {
      window.visualViewport?.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("scroll", resize);
      node.close();
      if (previous.current?.isConnected) previous.current.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="dx-modal-frame"
      role={role}
      aria-modal="true"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        if (!closeDisabled && !composing.current) close.current?.();
      }}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key !== "Tab") return;
        const controls = [...dialog.current.querySelectorAll(focusable)].filter(
          (n) => n.getClientRects().length && !n.closest("[hidden],[inert]"),
        );
        const first = controls[0],
          last = controls.at(-1);
        if (!first) {
          e.preventDefault();
          dialog.current.focus();
          return;
        }
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }}
    >
      {children}
    </dialog>
  );
}
