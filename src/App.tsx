import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Route, Routes, useNavigate } from "react-router-dom";
import Sidebar from "./components/global/Sidebar";
import TopBar from "./components/global/TopBar";
import CommandBar from "./components/global/CommandBar";
import MediaImporter from "./components/global/MediaImporter";
import ImportSongDialog from "./components/import/ImportSongDialog";
import { AppProvider, useApp } from "./state/AppContext";
import { onUnauthorized } from "./api/client";
import { isTauri } from "./api/transport";
import { systemApi } from "./api/system";
import { initServer } from "./api/server";
import { useMediaIndex } from "./hooks/useMediaIndex";

import Home from "./pages/Home";
import Songs from "./pages/Songs";
import Reflow from "./pages/Reflow";
import Media from "./pages/Media";
import Screens from "./pages/Screens";
import Inputs from "./pages/Inputs";
import Outputs from "./pages/Outputs";
import Themes from "./pages/Themes";
import Stream from "./pages/Stream";
import Settings from "./pages/Settings";
import PresentationWindow from "./pages/PresentationWindow";
import Compositor from "./pages/Compositor";
import Login from "./pages/Login";

import "./App.css";
import "./styles/ui.css";

function Shortcuts() {
  const { openCommand } = useApp();
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openCommand(e.shiftKey ? "command" : "present");
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        openCommand("command");
      } else if (mod && /^[1-9]$/.test(e.key) && !e.shiftKey) {
        const paths = ["/", "/songs", "/reflow", "/media", "/screens", "/inputs", "/outputs", "/themes", "/stream"];
        const path = paths[Number(e.key) - 1];
        if (path) {
          e.preventDefault();
          navigate(path);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openCommand, navigate]);
  return null;
}

function AppShell() {
  const { importOpen, setImportOpen } = useApp();
  useMediaIndex();
  return (
    <div className="app-layout">
      <Shortcuts />
      <Sidebar />
      <div className="app-column">
        <TopBar />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/songs" element={<Songs />} />
            <Route path="/reflow" element={<Reflow />} />
            <Route path="/media" element={<Media />} />
            <Route path="/screens" element={<Screens />} />
            <Route path="/inputs" element={<Inputs />} />
            <Route path="/outputs" element={<Outputs />} />
            <Route path="/themes" element={<Themes />} />
            <Route path="/stream" element={<Stream />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
      <CommandBar />
      <MediaImporter />
      {importOpen && <ImportSongDialog onClose={() => setImportOpen(false)} />}
    </div>
  );
}

/** Browsers (e.g. an iPad) must log in when a password is set. */
function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"checking" | "login" | "ok">(isTauri() ? "ok" : "checking");
  const check = useCallback(async () => {
    try {
      const status = await systemApi.authStatus();
      setState(status.authenticated ? "ok" : "login");
    } catch {
      setState("ok");
    }
  }, []);
  useEffect(() => {
    if (isTauri()) return;
    void check();
    onUnauthorized(() => setState("login"));
    return () => onUnauthorized(null);
  }, [check]);
  if (state === "checking") return null;
  if (state === "login") return <Login onDone={() => window.location.reload()} />;
  return <>{children}</>;
}

export default function App() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void initServer().finally(() => setReady(true));
  }, []);
  if (!ready) return null;
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/presentation/:id" element={<PresentationWindow />} />
        <Route path="/compositor/:id" element={<Compositor />} />
        <Route
          path="/*"
          element={
            <AuthGate>
              <AppProvider>
                <AppShell />
              </AppProvider>
            </AuthGate>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
