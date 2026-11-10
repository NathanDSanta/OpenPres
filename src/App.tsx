import { BrowserRouter, Routes, Route } from "react-router-dom";
import Sidebar from "./components/global/Sidebar";

import Home from "./pages/Home";
import Songs from "./pages/Songs";
import Screens from "./pages/Screens";
import Inputs from "./pages/Inputs";
import Themes from "./pages/Themes";
import Settings from "./pages/Settings";
import PresentationWindow from "./pages/PresentationWindow";

import "./App.css";

function AppShell() {
  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/songs" element={<Songs />} />
          <Route path="/screens" element={<Screens />} />
          <Route path="/inputs" element={<Inputs />} />
          <Route path="/themes" element={<Themes />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/presentation/:id" element={<PresentationWindow />} />
        <Route path="/*" element={<AppShell />} />
      </Routes>
    </BrowserRouter>
  );
}
