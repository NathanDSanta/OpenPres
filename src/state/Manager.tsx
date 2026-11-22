import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Lock, LogOut, Moon, Power as PowerIcon, Repeat, ShieldCheck } from "lucide-react";
import { onUnauthorized } from "@/api/client";
import { systemApi } from "@/api/system";
import { serverApi } from "@/api/serverApi";
import { useLive, markChanged } from "@/api/events";
import { MODES, can, modeInfo, savedMode, setCurrentMode, shellUrl, switchServer, type Mode } from "@/lib/manager";
import type { AuthStatus, Power, ServerInfo } from "@/types";
import "@/styles/Login.css";

interface ManagerContextValue {
  mode: Mode;
  /** Logged in as the admin (in any mode). */
  admin: boolean;
  server: ServerInfo;
  power: Power;
  /** Asks for the admin password when needed; false if cancelled. */
  switchMode: (mode: Mode) => void;
  setPower: (power: Power) => Promise<void>;
  logout: () => Promise<void>;
  /** Opened from the desktop manager: it can go back to the server list. */
  canSwitchServer: boolean;
}

const ManagerContext = createContext<ManagerContextValue | null>(null);

export function useManager(): ManagerContextValue {
  const value = useContext(ManagerContext);
  if (!value) throw new Error("useManager outside the manager");
  return value;
}

/** The mode in use, or null outside the manager (output windows). */
export function useOptionalManager(): ManagerContextValue | null {
  return useContext(ManagerContext);
}

type Screen = { kind: "loading" } | { kind: "login" } | { kind: "pick"; admin?: boolean; back?: Mode } | { kind: "ready"; mode: Mode };

/**
 * Before the app: log in with the operator password, pick a mode (the last one is
 * remembered on this machine), wake the server if it's asleep.
 */
export function ManagerGate({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [server, setServer] = useState<ServerInfo | null>(null);
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  const [unreachable, setUnreachable] = useState(false);
  const canSwitchServer = !!shellUrl();

  const check = useCallback(async () => {
    try {
      const [status, info] = await Promise.all([systemApi.authStatus(), serverApi.info()]);
      setAuth(status);
      setServer(info);
      setUnreachable(false);
      if (!status.authenticated) {
        setScreen({ kind: "login" });
        return;
      }
      const mode = savedMode();
      if (!mode || (mode === "admin" && !status.admin)) {
        setScreen({ kind: "pick", admin: mode === "admin" });
        return;
      }
      setCurrentMode(mode);
      setScreen({ kind: "ready", mode });
    } catch {
      setUnreachable(true);
    }
  }, []);

  useEffect(() => {
    void check();
    onUnauthorized(() => void check());
    return () => onUnauthorized(null);
  }, [check]);

  // The server's power, and logins ended elsewhere (password changed).
  const { data: power } = useLive(() => (screen.kind === "ready" ? serverApi.power() : Promise.resolve(null)), [screen.kind], ["power", "server"]);

  const pick = (mode: Mode) => {
    setCurrentMode(mode);
    setScreen({ kind: "ready", mode });
    markChanged();
  };

  if (unreachable) {
    return (
      <GateCard icon={<PowerIcon size={22} />} title="Can't reach the server" text="It may be off or on another network. Trying again…">
        <Retry onRetry={check} />
        {canSwitchServer && (
          <button className="btn" onClick={switchServer}>
            <Repeat size={14} /> Choose another server
          </button>
        )}
      </GateCard>
    );
  }
  if (screen.kind === "loading" || !auth || !server) return null;
  if (!auth.set_up && !auth.authenticated) {
    return (
      <GateCard icon={<Lock size={22} />} title={server.name} text="This server isn't set up yet. Finish its setup on the computer it runs on (it opens there on its own).">
        <Retry onRetry={check} />
      </GateCard>
    );
  }
  if (screen.kind === "login") {
    return <Login server={server} onDone={() => void check()} canSwitchServer={canSwitchServer} />;
  }
  if (screen.kind === "pick") {
    const back = screen.back;
    return (
      <ModePicker
        server={server}
        admin={auth.admin}
        askAdmin={!!screen.admin}
        onPick={(mode) => {
          pick(mode);
          if (mode === "admin") void check();
        }}
        onCancel={back ? () => pick(back) : undefined}
        canSwitchServer={canSwitchServer}
      />
    );
  }

  const mode = screen.mode;
  const currentPower = power?.power ?? server.power;
  const value: ManagerContextValue = {
    mode,
    admin: auth.admin,
    server,
    power: currentPower,
    canSwitchServer,
    switchMode: (next) => {
      if (next === "admin" && !auth.admin) setScreen({ kind: "pick", admin: true, back: mode });
      else pick(next);
    },
    setPower: async (p) => {
      await serverApi.setPower(p);
      markChanged();
    },
    logout: async () => {
      await systemApi.logout().catch(() => undefined);
      setCurrentMode(null);
      void check();
    },
  };
  if (currentPower === "sleep") {
    return <SleepScreen value={value} />;
  }
  return <ManagerContext.Provider value={value}>{children}</ManagerContext.Provider>;
}

function Retry({ onRetry }: { onRetry: () => void }) {
  useEffect(() => {
    const id = setInterval(onRetry, 3000);
    return () => clearInterval(id);
  }, [onRetry]);
  return null;
}

function GateCard({ icon, title, text, children }: { icon: ReactNode; title: string; text?: string; children?: ReactNode }) {
  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-icon">{icon}</div>
        <h1>{title}</h1>
        {text && <p>{text}</p>}
        {children}
      </div>
    </div>
  );
}

function Login({ server, onDone, canSwitchServer }: { server: ServerInfo; onDone: () => void; canSwitchServer: boolean }) {
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
        <h1>{server.name}</h1>
        <p>Enter the operator password. This device stays logged in.</p>
        <input className="input" type="password" autoFocus placeholder="Operator password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <div className="alert alert-error">{error}</div>}
        <button className="btn btn-primary" disabled={busy || !password}>
          {busy ? "Checking…" : "Log in"}
        </button>
        {canSwitchServer && (
          <button type="button" className="btn" onClick={switchServer}>
            <Repeat size={14} /> Another server
          </button>
        )}
      </form>
    </div>
  );
}

/** Which operator is this? Admin asks for its password (until the manager closes). */
export function ModePicker({
  server,
  admin,
  askAdmin,
  onPick,
  onCancel,
  canSwitchServer,
}: {
  server: ServerInfo;
  admin: boolean;
  askAdmin: boolean;
  onPick: (mode: Mode) => void;
  onCancel?: () => void;
  canSwitchServer?: boolean;
}) {
  const [adminOpen, setAdminOpen] = useState(askAdmin && !admin);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const unlock = async () => {
    setBusy(true);
    setError(null);
    try {
      await systemApi.login(password, "admin");
      onPick("admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wrong password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card mode-picker">
        <h1>{server.name}</h1>
        <p>Choose how you'll work. You can switch at any time from the top bar.</p>
        <div className="mode-list">
          {MODES.map(({ id, name, description, icon: Icon }) => (
            <button
              key={id}
              className={`mode-option${adminOpen && id === "admin" ? " active" : ""}`}
              onClick={() => (id === "admin" && !admin ? setAdminOpen(true) : onPick(id))}
            >
              <Icon size={20} />
              <span>
                <strong>{name}</strong>
                <small>{description}</small>
              </span>
              {id === "admin" && !admin && <Lock size={14} className="mode-lock" />}
            </button>
          ))}
        </div>
        {adminOpen && (
          <form
            className="mode-admin"
            onSubmit={(e) => {
              e.preventDefault();
              void unlock();
            }}
          >
            <input className="input" type="password" autoFocus placeholder="Admin password" value={password} onChange={(e) => setPassword(e.target.value)} />
            {error && <div className="alert alert-error">{error}</div>}
            <button className="btn btn-primary" disabled={busy || !password}>
              <ShieldCheck size={14} /> {busy ? "Checking…" : "Open Admin"}
            </button>
          </form>
        )}
        <div className="mode-footer">
          {onCancel && (
            <button className="btn btn-small" onClick={onCancel}>
              Back
            </button>
          )}
          {canSwitchServer && (
            <button className="btn btn-small" onClick={switchServer}>
              <Repeat size={13} /> Another server
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function SleepScreen({ value }: { value: ManagerContextValue }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allowed = can(value.mode, "power");
  const wake = async () => {
    setBusy(true);
    setError(null);
    try {
      await value.setPower("active");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not wake it up.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <GateCard
      icon={<Moon size={22} />}
      title={`${value.server.name} is asleep`}
      text={
        allowed
          ? "Nothing works until it wakes up: screens, stream, sound and management are all stopped."
          : `The ${modeInfo(value.mode).name} mode can't wake it. Switch to Stage or Jack of all trades, or ask an operator.`
      }
    >
      {allowed && (
        <button className="btn btn-primary" disabled={busy} onClick={() => void wake()}>
          <PowerIcon size={14} /> {busy ? "Waking up…" : "Wake up"}
        </button>
      )}
      {error && <div className="alert alert-error">{error}</div>}
      {!allowed && (
        <button className="btn" onClick={() => value.switchMode("stage")}>
          Switch to Stage
        </button>
      )}
      {value.canSwitchServer && (
        <button className="btn" onClick={switchServer}>
          <Repeat size={14} /> Another server
        </button>
      )}
      <button className="btn btn-small" onClick={() => void value.logout()}>
        <LogOut size={13} /> Log out
      </button>
    </GateCard>
  );
}
