import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { screensApi } from "@/api/screens";
import type { ScreenRenderResponse } from "@/types";
import { SlideRenderer } from "@/components/slides/SlideRenderer";
import "@/styles/PresentationWindow.css";

export default function PresentationWindow() {
  const { id } = useParams<{ id: string }>();
  const [rendered, setRendered] = useState<ScreenRenderResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval>;

    const refresh = async () => {
      try {
        const result = await screensApi.render(id);
        if (!cancelled) {
          setRendered(result);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not render this screen.");
        }
      }
    };

    void refresh();
    timer = setInterval(() => void refresh(), 400);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      void invoke("hide_current_presentation_window");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const slides = rendered?.presentations.slides;
  const announcements = rendered?.presentations.announcements;

  return (
    <main className="presentation-window">
      {slides ? (
        <SlideRenderer state={slides.slide} theme={slides.theme} className="presentation-window-slide" />
      ) : announcements ? (
        <SlideRenderer state={announcements.slide} theme={announcements.theme} className="presentation-window-slide" />
      ) : (
        <div className="presentation-window-empty">
          {error ? error : rendered ? "Waiting for content…" : "Connecting to screen…"}
        </div>
      )}
      {slides && announcements?.slide.current && (
        <div className="presentation-announcement">
          {announcements.slide.current.text}
        </div>
      )}
    </main>
  );
}
