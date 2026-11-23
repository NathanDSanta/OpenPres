import { markChanged, screensApi, useLive } from "@/api";
import { notifyError } from "@/state/Dialogs";
import { LAYER_KINDS, LAYER_LABELS, matchesPreset } from "@/types";

/** Every virtual screen with the screen presets it can switch to; the one it matches is lit. */
export default function ScreenPresetsWidget() {
  const { data: screens } = useLive(() => screensApi.list(), [], ["screens"]);
  const { data: file } = useLive(() => screensApi.presets(), [], ["screen-presets"]);
  const presets = file?.presets ?? [];
  const list = (screens ?? []).filter((s) => s.kind !== "monitor");
  if (screens && !list.length) return <div className="wg-empty muted small">Add screens in Screens.</div>;
  if (file && !presets.length) return <div className="wg-empty muted small">The admin sets up screen presets in Settings → Screen presets.</div>;
  return (
    <div className="wg-screen-presets">
      {list.map((screen) => {
        const current = presets.find((p) => matchesPreset(screen.enabled_layers, p));
        return (
          <div key={screen.id} className="wg-sp-row">
            <div className="wg-sp-name" title={current ? `${screen.name}: ${current.name}` : `${screen.name}: its own layers`}>
              {screen.name}
              <span>{current?.name ?? "Custom"}</span>
            </div>
            <div className="wg-sp-presets">
              {presets.map((p) => (
                <button
                  key={p.id}
                  className={`wg-sp-btn${current?.id === p.id ? " on" : ""}`}
                  title={`${p.name}: shows ${LAYER_KINDS.filter((k) => p.layers[k]).map((k) => LAYER_LABELS[k].toLowerCase()).join(", ") || "no layers"}`}
                  onClick={() => void screensApi.applyPreset(screen.id, p.id).then(markChanged).catch(notifyError)}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
