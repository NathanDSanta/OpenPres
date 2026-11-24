import { useState } from "react";
import { Plus } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { GAP, spanPx } from "./grid";
import type { WidgetDef } from "./widgets";

/** Room for the preview in the dialog. */
const PREVIEW_W = 470;
const PREVIEW_H = 400;

/**
 * "Add a widget": the widgets on the left, the chosen one on the right as it will look on this
 * dashboard (live, at its starting size), then Add. A double-click adds straight away.
 */
export default function WidgetPalette({ defs, cell, onAdd, onClose }: { defs: WidgetDef[]; cell: { w: number; h: number }; onAdd: (type: string) => void; onClose: () => void }) {
  const [chosen, setChosen] = useState(defs[0]?.type ?? "");
  const def = defs.find((d) => d.type === chosen) ?? defs[0];
  return (
    <Modal
      wide
      title="Add a widget"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!def} onClick={() => def && onAdd(def.type)}>
            <Plus size={14} /> Add {def?.title ?? ""}
          </button>
        </>
      }
    >
      <div className="home-palette">
        <div className="home-palette-list" role="listbox" aria-label="Widgets">
          {defs.map((d) => (
            <button
              key={d.type}
              role="option"
              aria-selected={d.type === def?.type}
              className={`home-palette-item${d.type === def?.type ? " chosen" : ""}`}
              onClick={() => setChosen(d.type)}
              onDoubleClick={() => onAdd(d.type)}
              title="Double-click to add it"
            >
              <d.icon size={18} />
              <span>
                <strong>{d.title}</strong>
                <small>{d.description}</small>
              </span>
              <em>
                {d.size[0]}×{d.size[1]}
              </em>
            </button>
          ))}
        </div>
        {def && <WidgetPreview def={def} cell={cell} />}
      </div>
    </Modal>
  );
}

/** The widget as it will look: its starting size on this dashboard's squares, scaled to fit. */
function WidgetPreview({ def, cell }: { def: WidgetDef; cell: { w: number; h: number } }) {
  const [w, h] = def.size;
  const width = spanPx(w, cell.w);
  const height = spanPx(h, cell.h);
  // True size, a little bigger for small widgets, smaller for big ones.
  const scale = Math.min(1.5, PREVIEW_W / width, PREVIEW_H / height);
  const Icon = def.icon;
  return (
    <div className="home-palette-preview">
      <div className="home-palette-stage" style={{ height: PREVIEW_H + 2 * GAP }}>
        <div style={{ width: width * scale, height: height * scale }}>
          <article
            key={def.type}
            className={`home-widget home-palette-widget${def.bare ? " bare" : ""}`}
            style={{ width, height, transform: `scale(${scale})`, transformOrigin: "top left" }}
            aria-hidden
          >
            {!def.bare && (
              <header className="home-widget-head">
                <Icon size={13} />
                <span>{def.title}</span>
              </header>
            )}
            <div className="home-widget-body">{def.render({ config: {}, setConfig: () => undefined, w, h, cell: cell.w })}</div>
            <div className="home-widget-shield" />
          </article>
        </div>
      </div>
      <p className="home-palette-about">
        <strong>{def.title}</strong> · {w}×{h} squares to start, resizable. {def.description}.
      </p>
    </div>
  );
}
