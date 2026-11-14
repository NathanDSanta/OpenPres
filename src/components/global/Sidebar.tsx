import { NavLink } from "react-router-dom";
import {
  BookOpen,
  Clapperboard,
  House,
  Monitor,
  Music2,
  Palette,
  Radio,
  Settings as SettingsIcon,
  SlidersVertical,
  TextCursorInput,
  Timer,
} from "lucide-react";
import "./styles/Sidebar.css";

export const NAVIGATION = [
  { name: "Home", path: "/", icon: House },
  { name: "Songs", path: "/songs", icon: Music2 },
  { name: "Reflow", path: "/reflow", icon: TextCursorInput },
  { name: "Bible", path: "/bible", icon: BookOpen },
  { name: "Media", path: "/media", icon: Clapperboard },
  { name: "Screens", path: "/screens", icon: Monitor },
  { name: "Audio", path: "/audio", icon: SlidersVertical },
  { name: "Themes", path: "/themes", icon: Palette },
  { name: "Timers", path: "/timers", icon: Timer },
  { name: "Live", path: "/live", icon: Radio },
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
        <NavLink to="/settings" className={({ isActive }) => `sidebar-link${isActive ? " active" : ""}`} title="Settings" aria-label="Settings">
          <SettingsIcon size={21} strokeWidth={1.8} />
        </NavLink>
      </div>
    </aside>
  );
}
