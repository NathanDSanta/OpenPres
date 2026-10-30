import { useEffect, useState } from "react";
import { themesApi } from "@/api";
import type { Presentation, Theme } from "@/types";

export function usePresentationTheme(presentation: Presentation | null) {
  const [theme, setTheme] = useState<Theme | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const themeId = presentation?.metadata.theme;

  useEffect(() => {
    let cancelled = false;

    if (!themeId) {
      setTheme(null);
      setLoading(false);
      setError(null);
      return;
    }

    const currentThemeId = themeId;

    async function loadTheme() {
      try {
        setLoading(true);
        setError(null);

        const result = await themesApi.get(currentThemeId!);

        if (!cancelled) setTheme(result);
      } catch (err) {
        if (!cancelled) {
          setTheme(null);
          setError(
            err instanceof Error ? err.message : "Could not load theme.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadTheme();

    return () => {
      cancelled = true;
    };
  }, [themeId]);

  return { theme, loading, error };
}
