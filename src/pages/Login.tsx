import { useState } from "react";
import { Lock } from "lucide-react";
import { systemApi } from "@/api/system";
import "@/styles/Login.css";

export default function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await systemApi.login(password);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not log in.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <form
        className="login-card"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="login-icon">
          <Lock size={22} />
        </div>
        <h1>OpenPres</h1>
        <p>Enter the password set in Settings on the presentation computer.</p>
        <input
          className="input"
          type="password"
          autoFocus
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <div className="alert alert-error">{error}</div>}
        <button className="btn btn-primary" disabled={busy || !password}>
          {busy ? "Checking…" : "Log in"}
        </button>
      </form>
    </div>
  );
}
