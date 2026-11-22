import { useState } from "react";
import { serverApi, useLive } from "@/api";
import { useManager } from "@/state/Manager";
import UpdateDialog, { type UpdatePhase } from "@/components/UpdateDialog";
import type { UpdateStatus } from "@/types";

/** "Remind me later": not again on this device until the interface is opened again. */
const laterKey = (serverId: string) => `openpres.serverUpdateLater.${serverId}`;

function phaseOf(status: UpdateStatus): UpdatePhase {
  if (status.state === "downloading") return { step: "downloading", done: status.done, total: status.total };
  if (status.state === "installing") return { step: "installing" };
  return { step: "ready" };
}

/**
 * The server found a newer version: its admin is offered the update (the server downloads
 * it, installs it and restarts; this page reconnects by itself).
 */
export default function ServerUpdate() {
  const { admin, server } = useManager();
  const { data: status } = useLive(() => serverApi.updateStatus(), [], ["update"]);
  const [later, setLater] = useState(() => {
    try {
      return sessionStorage.getItem(laterKey(server.id));
    } catch {
      return null;
    }
  });
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  const available = status?.available;
  if (!admin || !status || !available) return null;
  const phase = phaseOf(status);
  if (later === available.version && phase.step === "ready" && !started) return null;

  const remindLater = () => {
    try {
      sessionStorage.setItem(laterKey(server.id), available.version);
    } catch {
      /* ignore */
    }
    setLater(available.version);
    setStarted(false);
  };

  const update = async () => {
    setError(null);
    setStarted(true);
    try {
      await serverApi.installUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <UpdateDialog
      title={`${server.name} can be updated to OpenPres ${available.version}`}
      current={status.current}
      date={available.date}
      notes={available.notes}
      note="The server restarts to finish: its screens and the stream stop for a moment. Managers reconnect by themselves."
      installing="Installing… the server restarts and this page reconnects by itself."
      phase={phase}
      error={error ?? (started && phase.step === "ready" ? status.error : null)}
      onUpdate={() => void update()}
      onLater={remindLater}
    />
  );
}
