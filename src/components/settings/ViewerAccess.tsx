import { useState } from "react";
import { markChanged, systemApi } from "@/api";
import { Toggle } from "@/components/ui/Toggle";
import { notify, notifyError } from "@/state/Dialogs";
import type { ConfigResponse, NetworkInfo } from "@/types";

/**
 * Settings → Server & security: viewers (the OpenPres Android app, or /viewer in a browser) watch
 * the screens and listen to the buses, with a password of their own or none.
 */
export default function ViewerAccess({ config, network, onChanged }: { config: ConfigResponse; network: NetworkInfo | null; onChanged: () => void }) {
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const save = async (body: Parameters<typeof systemApi.updateSecurity>[0], message: string) => {
    try {
      await systemApi.updateSecurity(body);
      notify(message, "ok");
      setPassword("");
      setPassword2("");
      onChanged();
      markChanged();
    } catch (err) {
      notifyError(err);
    }
  };
  const on = !!config.viewers;
  const url = network?.urls.find((u) => !u.includes("localhost")) ?? network?.urls[0];
  return (
    <section className="card">
      <h2 className="card-title">Viewers (the Android app)</h2>
      <label className="toggle-inline">
        <Toggle checked={on} onChange={(v) => void save({ viewers: v }, v ? "Viewers can watch now." : "Viewers can't watch any more.")} />
        <span>Let viewers watch the screens and listen to the buses</span>
      </label>
      <p className="muted small">
        Viewers see one screen and hear one bus, nothing else: they can't change anything. Use the OpenPres app for Android{url ? <>, or open <code>{url}/viewer</code> in a browser</> : null}.
        {!config.remote_access && " Other devices also need “Let managers on other computers and tablets connect”."}
      </p>
      {on && (
        <>
          <p className="small">
            {config.viewer_password_set ? "Viewers need their own password." : "Viewers need no password: anyone who can reach this server can watch."}
          </p>
          <div className="field-row">
            <div className="field">
              <label>{config.viewer_password_set ? "New viewer password" : "Viewer password"}</label>
              <input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="field">
              <label>Repeat</label>
              <input className="input" type="password" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} />
            </div>
          </div>
          <div className="page-actions" style={{ marginTop: 10 }}>
            {config.viewer_password_set && (
              <button className="btn" onClick={() => void save({ viewer_password: "" }, "Viewers need no password now.")}>
                No password
              </button>
            )}
            <button className="btn btn-primary" disabled={password.length < 4 || password !== password2} onClick={() => void save({ viewer_password: password }, "Viewer password set. Viewers log in again.")}>
              {config.viewer_password_set ? "Change viewer password" : "Set a viewer password"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
