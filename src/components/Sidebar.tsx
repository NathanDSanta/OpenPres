
import { NavLink } from "react-router-dom";
import {
  House,
  Music2,
  Monitor,
  AudioLines,
  Palette,
  Settings as SettingsIcon,
} from "lucide-react";

import "./styles/Sidebar.css";

const navigation = [
  { name: "Home", path: "/", icon: House },
  { name: "Songs", path: "/songs", icon: Music2 },
  { name: "Screens", path: "/screens", icon: Monitor },
  { name: "Inputs", path: "/inputs", icon: AudioLines },
  { name: "Themes", path: "/themes", icon: Palette },
  { name: "Settings", path: "/settings", icon: SettingsIcon },
];

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-logo" title="Your app">
        <Music2 size={23} strokeWidth={2} />
      </div>

      <div className="sidebar-divider" />

      <nav className="sidebar-nav" aria-label="Main navigation">
        {navigation.map(({ name, path, icon: Icon }) => (
          <NavLink
            key={name}
            to={path}
            end={path === "/"}
            className={({ isActive }) =>
              `sidebar-link${isActive ? " active" : ""}`
            }
            title={name}
            aria-label={name}
          >
            <Icon size={21} strokeWidth={1.8} />
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-bottom">
        <span
          className="status-indicator"
          title="App is running"
        />
      </div>
    </aside>
  );
}

