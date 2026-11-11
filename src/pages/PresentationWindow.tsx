import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { screensApi } from "@/api/screens";
import { presentationWindowsApi } from "@/api/presentationWindows";
import type { ScreenRenderResponse } from "@/types";
import { SlideRenderer } from "@/components/slides/SlideRenderer";
import "@/styles/PresentationWindow.css";

const POLL_INTERVAL_MS = 400;

export default function PresentationWindow() {
  const { id } = useParams<{ id: string }>();
  const [rendered, setRendered] = useState<ScreenRenderResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastBody: string | null = null;

    // A timeout chain (rather than setInterval) never stacks requests when the backend is
    // slow, and comparing the raw body skips parsing and re-rendering when nothing changed.
    const poll = async () => {
      if (!document.hidden) {
        try {
          const body = await screensApi.renderRaw(id);
          if (!cancelled && body !== lastBody) {
            lastBody = body;
            setRendered(JSON.parse(body) as ScreenRenderResponse);
          }
          if (!cancelled) setError(null);
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : "Could not render this screen.");
          }
        }
      }
      if (!cancelled) timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    };

    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      void presentationWindowsApi.hideCurrent();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const slides = rendered?.presentations.slides;
  const announcements = rendered?.presentations.announcements;
  const main = slides ?? announcements;

  return (
    <main className="presentation-window">
      {main ? (
        <SlideRenderer state={main.slide} theme={main.theme} className="presentation-window-slide" />
      ) : (
        <div className="presentation-window-empty">
          {error ?? (rendered ? "Waiting for content…" : "Connecting to screen…")}
        </div>
      )}
      {slides && announcements?.slide.current && (
        <div className="presentation-announcement">{announcements.slide.current.text}</div>
      )}
    </main>
  );
}
