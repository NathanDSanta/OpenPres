import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FileUp, ImagePlus, LayoutGrid, Radio } from "lucide-react";
import { streamApi } from "@/api/stream";
import { useLive } from "@/api/events";
import { formatDuration } from "@/lib/format";
import { useApp } from "@/state/AppContext";
import { notifyError } from "@/state/Dialogs";
import { NAVIGATION } from "./Sidebar";
import "./styles/TopBar.css";

/** Page title, imports and the stream button. The command bar opens with its shortcut. */
export default function TopBar() {
  const { setImportOpen, requestMediaImport } = useApp();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { data: status } = useLive(() => streamApi.status());
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const running = !!status?.running;
  const page =
    pathname === "/settings" ? "Settings" : NAVIGATION.find((n) => (n.path === "/" ? pathname === "/" : pathname.startsWith(n.path)))?.name ?? "";

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [running]);

  const toggleStream = async () => {
    setBusy(true);
    try {
      if (running) await streamApi.stop();
      else await streamApi.start();
    } catch (err) {
      notifyError(err);
      navigate("/live");
    } finally {
      setBusy(false);
    }
  };

  return (
    <header className="topbar">
      <h1 className="topbar-title">{page}</h1>
      {pathname === "/" && (
        <button className="icon-btn topbar-page-action" onClick={() => window.dispatchEvent(new Event("openpres:edit-home"))} title="Edit the layout of this page">
          <LayoutGrid size={15} />
        </button>
      )}
      <div className="topbar-actions">
        <button className="btn btn-small" onClick={() => setImportOpen(true)} title="Import a song from a text file or the clipboard">
          <FileUp size={14} /> Import song
        </button>
        <button className="btn btn-small" onClick={requestMediaImport} title="Import pictures, videos or audio">
          <ImagePlus size={14} /> Import media
        </button>
        <button
          className={`btn btn-small ${running ? "btn-live" : ""}`}
          onClick={() => void toggleStream()}
          disabled={busy}
          title={running ? "Stop the stream" : "Start the stream (settings in the Live tab)"}
        >
          <Radio size={14} />
          {running && status?.started_at_ms ? (
            <>
              {status.streaming ? "LIVE" : "REC"} {formatDuration(now - status.started_at_ms, "H:mm:ss")}
            </>
          ) : (
            "Go live"
          )}
        </button>
      </div>
    </header>
  );
}
