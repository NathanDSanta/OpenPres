import { useEffect, useState } from "react";
import { ExternalLink, LogOut, MonitorPlay as Youtube } from "lucide-react";
import { markChanged, useLive, youtubeApi } from "@/api";
import { notifyError, notify } from "@/state/Dialogs";

/** The Google OAuth client and the linked YouTube account (for chat and broadcasts). */
export default function YoutubeSettings() {
  const { data: status, setData } = useLive(() => youtubeApi.status());
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  useEffect(() => {
    if (status) setClientId(status.client_id);
  }, [status?.client_id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!status) return <div className="empty">Loading…</div>;

  const saveClient = () =>
    void youtubeApi
      .setClient(clientId.trim(), secret.trim() || undefined)
      .then((s) => {
        setData(s);
        setSecret("");
        markChanged();
      })
      .catch(notifyError);

  return (
    <div className="settings-stack">
      <section className="card">
        <h2 className="card-title">
          <span className="inline-icon">
            <Youtube size={16} /> YouTube account
          </span>
        </h2>
        {status.connected ? (
          <div className="yt-account">
            <span>
              Connected as <b>{status.channel_title || "your channel"}</b>
            </span>
            <button className="btn btn-small" onClick={() => void youtubeApi.disconnect().then((s) => setData(s)).catch(notifyError)}>
              <LogOut size={14} /> Disconnect
            </button>
          </div>
        ) : (
          <div className="yt-account">
            <span className="muted">Not connected. The Live tab needs the account for the chat and to find your broadcast and stream key.</span>
            <button
              className="btn btn-small btn-primary"
              disabled={!status.configured}
              onClick={() =>
                void youtubeApi
                  .connect()
                  .then((r) => {
                    if (!r.opened) window.open(r.url, "_blank");
                    notify("Finish the sign-in in your browser, then come back.", "info");
                  })
                  .catch(notifyError)
              }
            >
              Connect YouTube
            </button>
          </div>
        )}
      </section>
      <section className="card">
        <h2 className="card-title">Google OAuth client</h2>
        <p className="muted small">
          {status.built_in_client
            ? "This build includes its own client; you only need these fields to use a different one."
            : "Needed once: in Google Cloud, create a project, enable the “YouTube Data API v3”, and create an OAuth client of type “Desktop app”. Paste its id and secret here."}{" "}
          <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">
            Google Cloud credentials <ExternalLink size={11} />
          </a>
        </p>
        <div className="field-row">
          <div className="field">
            <label>Client id</label>
            <input className="input" value={clientId} placeholder="…apps.googleusercontent.com" onChange={(e) => setClientId(e.target.value)} onBlur={() => clientId.trim() !== status.client_id && saveClient()} />
          </div>
          <div className="field">
            <label>Client secret {status.client_secret_set && <span className="muted">(saved)</span>}</label>
            <input className="input" type="password" value={secret} placeholder={status.client_secret_set ? "••••••••" : "GOCSPX-…"} onChange={(e) => setSecret(e.target.value)} onBlur={() => secret.trim() && saveClient()} />
          </div>
        </div>
      </section>
    </div>
  );
}
