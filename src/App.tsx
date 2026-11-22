import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Sidebar from "./components/global/Sidebar";
import TopBar from "./components/global/TopBar";
import StreamRenderer from "./components/global/StreamRenderer";
import CommandBar from "./components/global/CommandBar";
import ServerUpdate from "./components/global/ServerUpdate";
import Keybinds from "./components/global/Keybinds";
import { DialogsProvider } from "./state/Dialogs";
import MediaImporter from "./components/global/MediaImporter";
import ImportSongDialog from "./components/import/ImportSongDialog";
import { AppProvider, useApp } from "./state/AppContext";
import { isTauri } from "./api/transport";
import { initServer } from "./api/server";
import { useMediaIndex } from "./hooks/useMediaIndex";
import { ManagerGate, useManager } from "./state/Manager";
import { canOpen } from "./lib/manager";

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
import Launcher from "./pages/Launcher";
import ServerSetup from "./pages/ServerSetup";

import "./App.css";
import "./styles/ui.css";

/** Pages a mode doesn't have go back home. */
function Allowed({ path, children }: { path: string; children: React.ReactNode }) {
  const { mode } = useManager();
  return canOpen(mode, path) ? <>{children}</> : <Navigate to="/" replace />;
}

/** Each mode has its own dashboard: a fresh page when the mode changes. */
function HomeForMode() {
  const { mode } = useManager();
  return <Home key={mode} />;
}

function AppShell() {
  const { importOpen, setImportOpen } = useApp();
  useMediaIndex();
  const page = (path: string, element: React.ReactNode) => <Route path={path} element={<Allowed path={path}>{element}</Allowed>} />;
  return (
    <div className="app-layout">
      <Keybinds />
      <Sidebar />
      <div className="app-column">
        <TopBar />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<HomeForMode />} />
            {page("/songs", <Songs />)}
            {page("/reflow", <Reflow />)}
            {page("/bible", <Bible />)}
            {page("/media", <Media />)}
            {page("/screens", <Screens />)}
            {page("/audio", <Audio />)}
            <Route path="/inputs" element={<Navigate to="/audio" replace />} />
            <Route path="/outputs" element={<Navigate to="/audio" replace />} />
            {page("/themes", <Themes />)}
            {page("/timers", <Timers />)}
            {page("/live", <Live />)}
            <Route path="/stream" element={<Navigate to="/live" replace />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
      <CommandBar />
      <ServerUpdate />
      <MediaImporter />
      {importOpen && <ImportSongDialog onClose={() => setImportOpen(false)} />}
    </div>
  );
}

/**
 * The server's own windows (outputs, stream graphics, setup) talk to it in-process; in the
 * manager, the same app shows the list of servers.
 */
function AppWindows() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/presentation/:id" element={<LocalServer><PresentationWindow /></LocalServer>} />
        <Route path="/renderer/stream" element={<LocalServer><StreamRenderer /></LocalServer>} />
        <Route path="/server-setup" element={<LocalServer><ServerSetup /></LocalServer>} />
        <Route path="/*" element={<Launcher />} />
      </Routes>
    </BrowserRouter>
  );
}

/** Windows of the server itself: they load media straight from its local HTTP server. */
function LocalServer({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void initServer().finally(() => setReady(true));
  }, []);
  return ready ? <>{children}</> : null;
}

/** A server's interface: in the desktop manager, a browser or an iPad. */
function ServedApp() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/presentation/:id" element={<PresentationWindow />} />
        <Route
          path="/*"
          element={
            <ManagerGate>
              <DialogsProvider>
                <AppProvider>
                  <AppShell />
                </AppProvider>
              </DialogsProvider>
            </ManagerGate>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

export default function App() {
  return isTauri() ? <AppWindows /> : <ServedApp />;
}
