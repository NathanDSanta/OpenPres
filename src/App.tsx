import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Sidebar from "./components/global/Sidebar";
import TopBar from "./components/global/TopBar";
import CommandBar from "./components/global/CommandBar";
import Keybinds from "./components/global/Keybinds";
import { DialogsProvider } from "./state/Dialogs";
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
import Audio from "./pages/Audio";
import Themes from "./pages/Themes";
import Live from "./pages/Live";
import Bible from "./pages/Bible";
import Timers from "./pages/Timers";
import Settings from "./pages/Settings";
import PresentationWindow from "./pages/PresentationWindow";
import Compositor from "./pages/Compositor";
import Login from "./pages/Login";

import "./App.css";
import "./styles/ui.css";

function AppShell() {
  const { importOpen, setImportOpen } = useApp();
  useMediaIndex();
  return (
    <div className="app-layout">
      <Keybinds />
      <Sidebar />
      <div className="app-column">
        <TopBar />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/songs" element={<Songs />} />
            <Route path="/reflow" element={<Reflow />} />
            <Route path="/bible" element={<Bible />} />
            <Route path="/media" element={<Media />} />
            <Route path="/screens" element={<Screens />} />
            <Route path="/audio" element={<Audio />} />
            <Route path="/inputs" element={<Navigate to="/audio" replace />} />
            <Route path="/outputs" element={<Navigate to="/audio" replace />} />
            <Route path="/themes" element={<Themes />} />
            <Route path="/timers" element={<Timers />} />
            <Route path="/live" element={<Live />} />
            <Route path="/stream" element={<Navigate to="/live" replace />} />
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
              <DialogsProvider>
                <AppProvider>
                  <AppShell />
                </AppProvider>
              </DialogsProvider>
            </AuthGate>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
