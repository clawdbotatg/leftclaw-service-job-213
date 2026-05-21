"use client";

import { type ReactNode, useEffect, useState } from "react";

/**
 * Render children only after the component has mounted on the client.
 *
 * Scaffold-ETH 2 defers wagmi/RainbowKit provider initialization until after
 * the first client paint to avoid SSR/static-export errors. That means pages
 * which call wagmi hooks during the prerender pass would throw
 * `WagmiProviderNotFoundError`. Wrap such page bodies in <ClientOnly> so the
 * hook-calling tree only mounts client-side, after providers are available.
 */
export const ClientOnly = ({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) => {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted) return <>{fallback}</>;
  return <>{children}</>;
};
