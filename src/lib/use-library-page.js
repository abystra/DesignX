import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

const empty = {
  items: [],
  total: 0,
  nextCursor: null,
  loaded: false,
  loading: true,
  error: "",
};
export function useLibraryPage(path, parameters = {}, enabled = true) {
  const query = new URLSearchParams(
    Object.entries(parameters).filter(
      ([, value]) => value !== undefined && value !== "",
    ),
  ).toString();
  const key = `${path}?${query}`;
  const [state, setState] = useState({ ...empty, key });
  const request = useRef({ sequence: 0, controller: null, append: false, key: null });
  const current = useRef();
  current.current = { key, enabled, state };
  const load = useCallback(async (append = false) => {
    const scope = current.current;
    if (
      !scope.enabled ||
      (append && (scope.state.loading || !scope.state.nextCursor))
    )
      return;
    request.current.controller?.abort();
    const controller = new AbortController(),
      sequence = ++request.current.sequence;
    request.current = { sequence, controller, append, key: scope.key };
    const previous = scope.state.key === scope.key ? scope.state : empty;
    setState({
      ...(append ? previous : empty),
      key: scope.key,
      loading: true,
      error: "",
    });
    try {
      const page = await api(
        scope.key +
          (append ? `&cursor=${encodeURIComponent(previous.nextCursor)}` : ""),
        { signal: controller.signal },
      );
      if (
        sequence !== request.current.sequence ||
        scope.key !== current.current.key
      )
        return;
      setState({
        ...page,
        key: scope.key,
        items: append
          ? [
              ...new Map(
                [...previous.items, ...page.items].map((item) => [
                  item.id,
                  item,
                ]),
              ).values(),
            ]
          : page.items,
        loading: false,
        loaded: true,
        error: "",
      });
    } catch (error) {
      if (
        controller.signal.aborted ||
        sequence !== request.current.sequence ||
        scope.key !== current.current.key
      )
        return;
      setState({
        ...(append ? previous : empty),
        key: scope.key,
        loading: false,
        error: error.message,
      });
    }
  }, []);
  useEffect(() => {
    if (!enabled) setState({ ...empty, key, loading: false });
    const timer = enabled ? setTimeout(() => {
      // A coalesced resource event may have already loaded this new query.
      // Do not run the query timer again and silently retry a failed response.
      if (request.current.key !== key) load();
    }, 200) : null;
    return () => {
      clearTimeout(timer);
      request.current.controller?.abort();
      request.current.key = null;
      ++request.current.sequence;
    };
  }, [key, enabled, load]);
  useEffect(() => {
    if (!enabled) return;
    let timer;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        // A replayed background event must not dismiss a recoverable error or
        // cancel an in-flight next page. Retry remains an explicit user action.
        const latest = current.current.state;
        if (!latest.error && !latest.loading) load();
      }, 200);
    };
    window.addEventListener("designx:refresh", refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("designx:refresh", refresh);
    };
  }, [enabled, load]);
  return {
    ...(state.key === key && enabled ? state : { ...empty, loading: enabled }),
    reload: () => load(),
    loadMore: () => load(true),
    retry: () => load(request.current.append),
  };
}
