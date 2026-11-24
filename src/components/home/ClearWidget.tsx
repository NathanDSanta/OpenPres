import { useMemo } from "react";
import { Eraser } from "lucide-react";
import {
  bibleApi,
  liveApi,
  markChanged,
  mediaApi,
  presenterApi,
  useLive,
} from "@/api";
import { SHOW_TOPICS } from "@/api/events";
import { notifyError } from "@/state/Dialogs";
import {
  CLEAR_LAYERS,
  clearLayerLabel,
} from "@/lib/clearLayers";
import type { ClearLayer } from "@/types";

const run = (p: Promise<unknown>) =>
  void p.then(markChanged).catch(notifyError);

/** Which layers have something on them right now. */
function useActiveLayers(): Set<ClearLayer> {
  const { data: presenter } = useLive(
    () => presenterApi.getState(),
    [],
    SHOW_TOPICS,
  );
  const { data: bible } = useLive(() => bibleApi.live(), [], SHOW_TOPICS);
  const { data: live } = useLive(() => liveApi.get(), [], SHOW_TOPICS);
  const { data: player } = useLive(() => mediaApi.player(), [], SHOW_TOPICS);
  return useMemo(() => {
    const on = new Set<ClearLayer>();
    if (player?.audio) on.add("audio");
    if (live?.props.length) on.add("props");
    if (live?.complements.length) on.add("complements");
    if (presenter?.announcements) on.add("announcements");
    if (bible) on.add("bible");
    if (presenter?.slides) on.add("slides");
    if (player?.visual) on.add("media");
    if (live?.video_input) on.add("video_input");
    return on;
  }, [presenter, bible, live, player]);
}

/**
 * One tile wide, two columns: the clear groups the admin set up on the left, and every layer
 * on the right, top layer first as they stack on screen. Layers with something on them light up.
 */
export default function ClearWidget({ h, cell }: { h: number; cell: number }) {
  const { data } = useLive(() => liveApi.clearGroups(), [], ["clear-groups"]);
  const active = useActiveLayers();
  const groups = data?.groups ?? [];
  // Names only fit when each button gets some height.
  const tall = h * cell >= 300;
  return (
    <div className={`wg-clear2${tall ? " tall" : ""}`}>
      <div className="wg-clear2-col groups">
        {groups.map((g) => {
          const live = g.layers.some((l) => active.has(l));
          return (
            <button
              key={g.id}
              className={`wg-clear2-group${live ? " live" : ""}`}
              style={{ ["--group" as string]: g.color }}
              title={`${g.name}: clears ${g.layers.map(clearLayerLabel).join(", ").toLowerCase()}`}
              onClick={() => run(liveApi.runClearGroup(g.id))}
            >
              <Eraser size={16} />
              <span>{g.name}</span>
            </button>
          );
        })}
        {data && !groups.length && (
          <span className="wg-clear2-empty">No clear groups</span>
        )}
      </div>
      <div className="wg-clear2-col layers">
        {CLEAR_LAYERS.map(({ layer, label, icon: Icon }) => {
          const on = active.has(layer);
          return (
            <button
              key={layer}
              className={`wg-clear2-layer${on ? " on" : ""}${layer === "audio" ? " audio" : ""}`}
              title={
                on
                  ? `Clear ${label.toLowerCase()}: something is on this layer`
                  : `${label}: nothing on it`
              }
              aria-label={`Clear ${label}`}
              onClick={() => run(liveApi.clearLayers([layer]))}
            >
              <Icon size={15} />
              {tall && <span>{label}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
