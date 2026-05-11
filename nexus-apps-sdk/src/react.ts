/**
 * React bindings for @nexus/app-sdk.
 *
 * Wrap your app in <NexusProvider>; child components read state via useNexus().
 * SSR-safe — no calls happen until the provider mounts in the browser.
 */
import * as React from "react";
import { initNexus, NexusClient, NexusContext, InitOptions } from "./client";

const Ctx = React.createContext<{
  nexus: NexusClient | null;
  ctx: NexusContext | null;
  error: Error | null;
}>({ nexus: null, ctx: null, error: null });


export const NexusProvider: React.FC<React.PropsWithChildren<InitOptions>> = ({ children, ...opts }) => {
  const [nexus, setNexus] = React.useState<NexusClient | null>(null);
  const [ctx, setCtx] = React.useState<NexusContext | null>(null);
  const [error, setError] = React.useState<Error | null>(null);

  React.useEffect(() => {
    let mounted = true;
    initNexus({
      ...opts,
      onContextChange: (next) => {
        if (mounted) setCtx(next);
        opts.onContextChange?.(next);
      },
    })
      .then((n) => {
        if (!mounted) return;
        setNexus(n);
        setCtx(n.ctx);
      })
      .catch((e: Error) => mounted && setError(e));
    return () => {
      mounted = false;
    };
  }, []);

  return React.createElement(Ctx.Provider, { value: { nexus, ctx, error } }, children);
};


export function useNexus(): NexusClient {
  const v = React.useContext(Ctx);
  if (!v.nexus) {
    throw new Error("useNexus() called before <NexusProvider> initialised — wrap with a Suspense boundary or check useNexusReady()");
  }
  return v.nexus;
}

export function useNexusContext(): NexusContext {
  const v = React.useContext(Ctx);
  if (!v.ctx) throw new Error("Nexus context not yet loaded");
  return v.ctx;
}

export function useNexusReady(): { ready: boolean; error: Error | null } {
  const v = React.useContext(Ctx);
  return { ready: v.nexus !== null, error: v.error };
}

/**
 * Auto-resize hook. Pass a ref to your top-level container. The SDK posts
 * `resize` to the host whenever the element's height changes.
 */
export function useAutoResize<T extends HTMLElement>(ref: React.RefObject<T>) {
  const nexus = useNexus();
  React.useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        nexus.resize(Math.ceil(e.contentRect.height));
      }
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref.current, nexus]);
}


/**
 * useNexusQuery — like useSWR for ontology queries.
 *
 *   const { data, loading, error, refetch } = useNexusQuery(
 *     () => nexus.ontology.query({ object_type: "ordenes_de_compra", limit: 20 }),
 *     [tenant_id],
 *   );
 */
export function useNexusQuery<T>(
  factory: () => Promise<T>,
  deps: React.DependencyList,
  opts?: { refetchInterval?: number }
): { data: T | null; loading: boolean; error: Error | null; refetch: () => void } {
  const [data, setData] = React.useState<T | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<Error | null>(null);
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    factory()
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e: Error) => !cancelled && setError(e))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  React.useEffect(() => {
    if (!opts?.refetchInterval) return;
    const id = setInterval(() => setTick((t) => t + 1), opts.refetchInterval);
    return () => clearInterval(id);
  }, [opts?.refetchInterval]);

  return { data, loading, error, refetch: () => setTick((t) => t + 1) };
}
