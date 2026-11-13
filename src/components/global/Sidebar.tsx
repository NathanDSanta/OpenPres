import { NavLink } from "react-router-dom";
import {
  AudioLines,
  Clapperboard,
  House,
  Monitor,
  Music2,
  Palette,
  Radio,
  Settings as SettingsIcon,
  Speaker,
  TextCursorInput,
} from "lucide-react";
import "./styles/Sidebar.css";

export const NAVIGATION = [
  { name: "Home", path: "/", icon: House },
  { name: "Songs", path: "/songs", icon: Music2 },
  { name: "Reflow", path: "/reflow", icon: TextCursorInput },
  { name: "Media", path: "/media", icon: Clapperboard },
  { name: "Screens", path: "/screens", icon: Monitor },
  { name: "Inputs", path: "/inputs", icon: AudioLines },
  { name: "Outputs", path: "/outputs", icon: Speaker },
  { name: "Themes", path: "/themes", icon: Palette },
  { name: "Stream", path: "/stream", icon: Radio },
  { name: "Settings", path: "/settings", icon: SettingsIcon },
];

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-logo" title="OpenPres">
        <Music2 size={23} strokeWidth={2} />
      </div>

      <div className="sidebar-divider" />

      <nav className="sidebar-nav" aria-label="Main navigation">
        {NAVIGATION.map(({ name, path, icon: Icon }) => (
          <NavLink
            key={name}
            to={path}
            end={path === "/"}
            className={({ isActive }) => `sidebar-link${isActive ? " active" : ""}`}
            title={name}
            aria-label={name}
          >
            <Icon size={21} strokeWidth={1.8} />
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-bottom">
        <span className="status-indicator" title="App is running" />
      </div>
    </aside>
  );
}
