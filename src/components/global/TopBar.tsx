import { useEffect, useState } from "react";
import { Command, FileUp, ImagePlus, Radio, Search } from "lucide-react";
import { streamApi } from "@/api/stream";
import { useLive } from "@/api/events";
import { formatDuration } from "@/lib/format";
import { useApp } from "@/state/AppContext";
import { useNavigate } from "react-router-dom";
import "./styles/TopBar.css";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Always-visible controls: command bar, imports and the stream button. */
export default function TopBar() {
  const { openCommand, setImportOpen, requestMediaImport } = useApp();
  const navigate = useNavigate();
  const { data: status } = useLive(() => streamApi.status());
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const running = !!status?.running;

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
      alert(err instanceof Error ? err.message : "Could not start the stream.");
      navigate("/stream");
    } finally {
      setBusy(false);
    }
  };

  return (
    <header className="topbar">
      <button className="topbar-search" onClick={() => openCommand("present")} title="Find and present a song, or type > for commands">
        <Search size={15} />
        <span>Present a song or type <b>&gt;</b> for commands…</span>
        <kbd>{isMac ? "⌘" : "Ctrl"} K</kbd>
      </button>
      <div className="topbar-actions">
        <button className="btn btn-small" onClick={() => openCommand("command")} title="Command mode">
          <Command size={14} /> Commands
        </button>
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
          title={running ? "Stop the stream" : "Start the stream (settings in the Stream tab)"}
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
