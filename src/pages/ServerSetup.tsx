import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, Server } from "lucide-react";
import { serverApi } from "@/api/serverApi";
import { Toggle } from "@/components/ui/Toggle";
import "@/styles/Login.css";

/**
 * The server's first run (its own window): its name, the admin password (general settings)
 * and the operator password (everyone else), and whether other devices may connect.
 */
export default function ServerSetup() {
  const [name, setName] = useState("");
  const [placeholder, setPlaceholder] = useState("");
  const [admin, setAdmin] = useState("");
  const [admin2, setAdmin2] = useState("");
  const [operator, setOperator] = useState("");
  const [operator2, setOperator2] = useState("");
  const [remote, setRemote] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    void serverApi.setupStatus().then((s) => {
      setPlaceholder(s.name);
      if (s.set_up) setDone(true);
    });
  }, []);

  const problem =
    admin.length < 4
      ? "The admin password needs at least 4 characters."
      : admin !== admin2
        ? "The admin passwords don't match."
        : operator.length < 4
          ? "The operator password needs at least 4 characters."
          : operator !== operator2
            ? "The operator passwords don't match."
            : admin === operator
              ? "Use different admin and operator passwords."
              : null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await serverApi.setUp({ name, admin_password: admin, operator_password: operator, remote_access: remote });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-icon">
            <Check size={22} />
          </div>
          <h1>The server is ready</h1>
          <p>It runs in the background (see its icon near the clock). Open OpenPres on this or any computer of the network to manage it.</p>
          <button className="btn btn-primary" onClick={() => void invoke("close_setup")}>
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <form
        className="login-card setup-card"
        onSubmit={(e) => {
          e.preventDefault();
          if (!problem) void submit();
        }}
      >
        <div className="login-icon">
          <Server size={22} />
        </div>
        <h1>Set up this OpenPres server</h1>
        <p>It does all the work in the background; managers on this or other computers operate it.</p>
        <div className="field">
          <label>Server name</label>
          <input className="input" placeholder={placeholder} value={name} onChange={(e) => setName(e.target.value)} />
          <span className="muted small">Managers show it in their list. Empty: the computer's name.</span>
        </div>
        <div className="field">
          <label>Admin password</label>
          <input className="input" type="password" autoComplete="new-password" placeholder="Password" value={admin} onChange={(e) => setAdmin(e.target.value)} />
          <input className="input" type="password" autoComplete="new-password" placeholder="Repeat" value={admin2} onChange={(e) => setAdmin2(e.target.value)} />
          <span className="muted small">For the general settings (Admin mode).</span>
        </div>
        <div className="field">
          <label>Operator password</label>
          <input className="input" type="password" autoComplete="new-password" placeholder="Password" value={operator} onChange={(e) => setOperator(e.target.value)} />
          <input className="input" type="password" autoComplete="new-password" placeholder="Repeat" value={operator2} onChange={(e) => setOperator2(e.target.value)} />
          <span className="muted small">For Livestream, Stage and Jack of all trades. Each device asks once.</span>
        </div>
        <label className="toggle-inline">
          <Toggle checked={remote} onChange={setRemote} />
          <span>Let managers on other computers and tablets connect</span>
        </label>
        {(error || (problem && admin && operator)) && <div className="alert alert-error">{error ?? problem}</div>}
        <button className="btn btn-primary" disabled={busy || !!problem}>
          {busy ? "Saving…" : "Finish setup"}
        </button>
      </form>
    </div>
  );
}
