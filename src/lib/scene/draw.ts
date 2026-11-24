import type {
  Design,
  Element,
  Fill,
  LiveBible,
  LivePresentationState,
  Look,
  MediaFit,
  RenderScene,
  ScreenBackground,
  Service,
  Shape,
  TimerView,
} from "@/types";
import { formatClock, formatDuration, timerValue } from "@/lib/format";
import { getCamera, getMediaImage, getVideo, mediaKind, requestRedraw, syncVideo, videoReady } from "./assets";
import { DEFAULT_LOOK, defaultBibleLook } from "./defaults";
import { drawTextLayout, joinLines, layoutText } from "./text";

export interface DrawInfo {
  /** Server-adjusted "now" in epoch ms (clocks, timers, video sync). */
  now: number;
  timers: TimerView[];
  slide: LivePresentationState | null;
  /** The passage on the Bible layer (for "bible" text sources). */
  bible?: LiveBible | null;
  services?: Service[];
  /** Keeps video players of different canvases separate. */
  videoScope: string;
}

/** The Bible passage as a "slide", so lyric designs (slide text, title) show it too. */
export function bibleAsSlide(bible: LiveBible, combined: boolean): LivePresentationState {
  const first = bible.passages[0];
  const text = combined && bible.passages.length > 1 ? bible.passages.map((p) => p.text).join("\n\n") : first?.text ?? "";
  const title = combined && bible.passages.length > 1 ? bible.passages.map((p) => `${p.reference} (${p.abbreviation})`).join(" · ") : bible.label;
  return {
    presentation_id: "bible",
    title,
    arrangement: "",
    slide_index: 0,
    total_slides: 1,
    current: { index: 0, group: first?.abbreviation ?? "", text },
    previous: null,
    next: null,
  };
}

const usesBibleSources = (design: Design) => design.elements.some((e) => e.text?.source.type === "bible");

type Drawable = CanvasImageSource & { width?: number; height?: number };

function sourceSize(src: Drawable): [number, number] {
  if (src instanceof HTMLVideoElement) return [src.videoWidth, src.videoHeight];
  if (src instanceof HTMLImageElement) return [src.naturalWidth, src.naturalHeight];
  return [Number(src.width) || 1, Number(src.height) || 1];
}

/** Draws an image/video into a box with cover / contain / stretch. */
export function drawFitted(ctx: CanvasRenderingContext2D, src: Drawable, fit: MediaFit, x: number, y: number, w: number, h: number) {
  const [sw, sh] = sourceSize(src);
  if (!sw || !sh) return;
  if (fit === "stretch") {
    ctx.drawImage(src, x, y, w, h);
    return;
  }
  const scale = fit === "cover" ? Math.max(w / sw, h / sh) : Math.min(w / sw, h / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  if (fit === "cover") {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.drawImage(src, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    ctx.restore();
  } else {
    ctx.drawImage(src, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }
}

function shapePath(ctx: CanvasRenderingContext2D, shape: Shape, radius: number, x: number, y: number, w: number, h: number) {
  ctx.beginPath();
  switch (shape.type) {
    case "ellipse":
      ctx.ellipse(x + w / 2, y + h / 2, Math.max(0, w / 2), Math.max(0, h / 2), 0, 0, Math.PI * 2);
      break;
    case "triangle":
      ctx.moveTo(x + w / 2, y);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x, y + h);
      ctx.closePath();
      break;
    case "star": {
      const points = Math.max(3, Math.min(24, shape.points || 5));
      const inner = Math.max(0.1, Math.min(0.95, shape.inner_ratio || 0.5));
      for (let i = 0; i < points * 2; i++) {
        const r = i % 2 === 0 ? 1 : inner;
        const a = (Math.PI * i) / points - Math.PI / 2;
        const px = x + w / 2 + (Math.cos(a) * r * w) / 2;
        const py = y + h / 2 + (Math.sin(a) * r * h) / 2;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
    case "polygon": {
      const sides = Math.max(3, Math.min(24, shape.sides || 6));
      for (let i = 0; i < sides; i++) {
        const a = (Math.PI * 2 * i) / sides - Math.PI / 2;
        const px = x + w / 2 + (Math.cos(a) * w) / 2;
        const py = y + h / 2 + (Math.sin(a) * h) / 2;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
    default: {
      const r = Math.max(0, Math.min(radius, w / 2, h / 2));
      if (r > 0 && "roundRect" in ctx) ctx.roundRect(x, y, w, h, r);
      else ctx.rect(x, y, w, h);
    }
  }
}

/** Paints `fill` inside the current path. Returns false when there was nothing to paint. */
function paintFill(ctx: CanvasRenderingContext2D, fill: Fill, x: number, y: number, w: number, h: number, info: DrawInfo, key: string): boolean {
  switch (fill.type) {
    case "color":
      ctx.fillStyle = fill.color;
      ctx.fill();
      return true;
    case "gradient": {
      const a = ((fill.angle || 0) * Math.PI) / 180;
      const dx = Math.sin(a);
      const dy = -Math.cos(a);
      const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
      const cx = x + w / 2;
      const cy = y + h / 2;
      const g = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
      g.addColorStop(0, fill.from);
      g.addColorStop(1, fill.to);
      ctx.fillStyle = g;
      ctx.fill();
      return true;
    }
    case "media": {
      const kind = mediaKind(fill.media_id);
      let src: Drawable | null = null;
      if (kind === "video") {
        const video = getVideo(`${info.videoScope}:${key}:${fill.media_id}`, fill.media_id, fill.loop);
        if (video.paused) void video.play().catch(() => undefined);
        src = videoReady(video) ? video : null;
      } else if (kind === "image") {
        src = getMediaImage(fill.media_id);
      }
      if (src) {
        ctx.save();
        ctx.clip();
        drawFitted(ctx, src, fill.fit, x, y, w, h);
        ctx.restore();
      }
      return !!src;
    }
    default:
      return false;
  }
}

/** The text an element shows right now. */
export function resolveText(el: Element, info: DrawInfo): string {
  const source = el.text?.source;
  if (!source) return "";
  switch (source.type) {
    case "static":
      return source.text;
    case "clock":
      return formatClock(new Date(info.now), source.format || "HH:mm");
    case "timer": {
      const timer = info.timers.find((t) => t.id === source.timer_id);
      return timer ? formatDuration(timerValue(timer, info.now, info.services ?? []), source.format || "mm:ss") : "--:--";
    }
    case "bible": {
      const passage = info.bible?.passages[source.slot ?? 0];
      if (!passage) return "";
      switch (source.field) {
        case "reference": return passage.reference;
        case "version": return passage.abbreviation;
        case "attribution": return passage.attribution;
        default: return passage.text;
      }
    }
    case "slide": {
      const state = info.slide;
      if (!state) return "";
      const slide = source.scope === "previous" ? state.previous : source.scope === "next" ? state.next : state.current;
      switch (source.field) {
        case "text": return slide?.text ?? "";
        case "number": return slide ? String(slide.index + 1) : "";
        case "total": return String(state.total_slides);
        case "group": return slide?.group ?? "";
        case "title": return state.title;
      }
    }
  }
  return "";
}

export function drawElement(ctx: CanvasRenderingContext2D, el: Element, info: DrawInfo) {
  if (!el.visible) return;
  const { x, y, width: w, height: h, rotation } = el.transform;
  if (w <= 0 || h <= 0) return;
  ctx.save();
  ctx.globalAlpha *= Math.max(0, Math.min(1, el.opacity));
  if (rotation) {
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.translate(-(x + w / 2), -(y + h / 2));
  }
  const shadow = () => {
    if (el.shadow.enabled) {
      ctx.shadowColor = el.shadow.color;
      ctx.shadowBlur = el.shadow.blur;
      ctx.shadowOffsetX = el.shadow.x;
      ctx.shadowOffsetY = el.shadow.y;
    }
  };
  const noShadow = () => {
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  };

  shapePath(ctx, el.shape, el.corner_radius, x, y, w, h);
  ctx.save();
  shadow();
  const filled = paintFill(ctx, el.fill, x, y, w, h, info, el.id);
  ctx.restore();

  if (el.border.enabled && el.border.width > 0) {
    ctx.save();
    if (!filled) shadow();
    // Stroke inside the shape so the outer size stays as set.
    ctx.clip();
    ctx.lineWidth = el.border.width * 2;
    ctx.strokeStyle = el.border.color;
    ctx.stroke();
    ctx.restore();
  }

  if (el.text) {
    const text = joinLines(resolveText(el, info), el.text.style.join_lines);
    if (text) {
      const style = el.text.style;
      const p = el.padding;
      const m = style.margin;
      const bx = x + p.left + m.left;
      const by = y + p.top + m.top;
      const bw = Math.max(1, w - p.left - p.right - m.left - m.right);
      const bh = Math.max(1, h - p.top - p.bottom - m.top - m.bottom);
      const layout = layoutText(ctx, text, style, bw, bh);
      ctx.save();
      if (filled) noShadow();
      else shadow();
      ctx.fillStyle = style.color;
      drawTextLayout(ctx, layout, style, bx, by, bw, bh);
      ctx.restore();
    }
  }
  ctx.restore();
}

export function drawDesign(ctx: CanvasRenderingContext2D, design: Design, width: number, height: number, info: DrawInfo, skipBackground = false) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  if (design.background.type !== "none" && !skipBackground) {
    paintFill(ctx, design.background, 0, 0, width, height, info, `bg:${design.id}`);
  }
  for (const el of design.elements) drawElement(ctx, el, info);
  ctx.restore();
}

/** Where a look goes inside a target rectangle (its theme fitted, centred). */
export function lookRect(look: Look, tx: number, ty: number, tw: number, th: number) {
  const { width, height } = look.theme;
  const scale = Math.min(tw / width, th / height);
  return { x: tx + (tw - width * scale) / 2, y: ty + (th - height * scale) / 2, w: width * scale, h: height * scale, scale };
}

/** Draws a design (in its theme's pixel space) fitted into a target rectangle. */
export function drawLook(ctx: CanvasRenderingContext2D, look: Look, tx: number, ty: number, tw: number, th: number, info: DrawInfo, skipBackground = false) {
  const { width, height } = look.theme;
  const r = lookRect(look, tx, ty, tw, th);
  ctx.save();
  ctx.translate(r.x, r.y);
  ctx.scale(r.scale, r.scale);
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();
  drawDesign(ctx, look.design, width, height, info, skipBackground);
  ctx.restore();
}

/** Which video of a background folder each canvas is on. */
const folderVideo = new Map<string, number>();

/** The screen's own background: a colour, a picture or video, or a folder of them. */
function drawBackground(ctx: CanvasRenderingContext2D, bg: ScreenBackground, items: string[] | undefined, w: number, h: number, now: number, scope: string) {
  if (bg.type === "color") {
    ctx.fillStyle = bg.color;
    ctx.fillRect(0, 0, w, h);
    return;
  }
  const one = (id: string, key: string, loop: boolean, onEnded?: () => void) => {
    if (mediaKind(id) === "video") {
      const video = getVideo(key, id, loop);
      if (onEnded && !video.onended) video.onended = onEnded;
      if (video.paused) void video.play().catch(() => undefined);
      if (videoReady(video)) drawFitted(ctx, video, bg.fit, 0, 0, w, h);
    } else {
      const img = getMediaImage(id);
      if (img) drawFitted(ctx, img, bg.fit, 0, 0, w, h);
    }
  };
  if (bg.type === "media") {
    if (bg.media_id) one(bg.media_id, `${scope}:bg:${bg.media_id}`, true);
    return;
  }
  const list = (items ?? []).filter((id) => mediaKind(id));
  if (!list.length) return;
  if (mediaKind(list[0]) === "video") {
    const key = `${scope}:bgf:${bg.folder_id}`;
    const index = (folderVideo.get(key) ?? 0) % list.length;
    one(list[index], `${key}:${index}:${list[index]}`, list.length === 1, () => {
      folderVideo.set(key, (index + 1) % list.length);
      requestRedraw();
    });
  } else {
    const seconds = Math.max(1, bg.seconds || 10);
    one(list[Math.floor(now / (seconds * 1000)) % list.length], "", false);
  }
}

/** A design's background video the stream draws natively under the overlay. */
export interface NativeVideo {
  media_id: string;
  /** In the screen's pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  fit: MediaFit;
  loop: boolean;
}

export interface DrawSceneOptions {
  /**
   * The stream: the background, the video input layer (camera) and the media layer are
   * drawn natively underneath, so they are left transparent here; videos never have to be
   * copied out of the window.
   */
  nativeBase?: boolean;
  /** With nativeBase: the lowest design's background video is drawn natively too; told where. */
  onNativeVideo?: (video: NativeVideo) => void;
}

/** The designs of a scene from bottom to top, with what each one shows. */
function sceneLooks(scene: RenderScene, base: DrawInfo): { look: Look; info: DrawInfo }[] {
  const { layers } = scene;
  const out: { look: Look; info: DrawInfo }[] = [];
  if (layers.slides) out.push({ look: layers.slides.look ?? DEFAULT_LOOK, info: { ...base, slide: layers.slides.slide } });
  if (layers.bible) {
    const { passage, look } = layers.bible;
    const chosen = look ?? defaultBibleLook(passage.passages.length);
    const slide = bibleAsSlide(passage, !usesBibleSources(chosen.design));
    out.push({ look: chosen, info: { ...base, slide, bible: passage } });
  }
  if (layers.announcements) out.push({ look: layers.announcements.look ?? DEFAULT_LOOK, info: { ...base, slide: layers.announcements.slide } });
  const slide = layers.slides?.slide ?? null;
  for (const look of layers.props) out.push({ look, info: { ...base, slide } });
  if (scene.mask) out.push({ look: scene.mask, info: { ...base, slide } });
  return out;
}

/** The lowest design's background, when it is a video (the stream draws it natively). */
function lowestLookVideo(scene: RenderScene): Look | null {
  const first = sceneLooks(scene, { now: 0, timers: [], slide: null, videoScope: "" })[0]?.look;
  const bg = first?.design.background;
  return bg?.type === "media" && mediaKind(bg.media_id) === "video" ? first : null;
}

/** Draws every visible layer of a screen into a w x h area. */
export function drawScene(ctx: CanvasRenderingContext2D, scene: RenderScene, w: number, h: number, now: number, videoScope: string, options: DrawSceneOptions = {}) {
  const base: DrawInfo = { now, timers: scene.timers, services: scene.services ?? [], slide: null, videoScope };
  const { layers } = scene;
  ctx.save();
  if (!options.nativeBase) {
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, w, h);
    drawBackground(ctx, scene.screen.background, scene.background_items, w, h, now, videoScope);
    if (layers.video_input) {
      const frame = getCamera(layers.video_input.device_id);
      if (frame) drawFitted(ctx, frame, "cover", 0, 0, w, h);
    }
    if (layers.media?.state) {
      const { state } = layers.media;
      if (state.kind === "image") {
        const img = getMediaImage(state.media_id);
        if (img) drawFitted(ctx, img, state.fit, 0, 0, w, h);
      } else if (state.kind === "video") {
        const video = getVideo(`${videoScope}:media-layer:${state.media_id}`, state.media_id, false);
        syncVideo(video, state, now);
        if (videoReady(video)) drawFitted(ctx, video, state.fit, 0, 0, w, h);
      }
    }
  }
  const nativeLook = options.nativeBase && options.onNativeVideo ? lowestLookVideo(scene) : null;
  sceneLooks(scene, base).forEach(({ look, info }, i) => {
    const native = i === 0 && look === nativeLook;
    if (native && look.design.background.type === "media") {
      const r = lookRect(look, 0, 0, w, h);
      const bg = look.design.background;
      options.onNativeVideo?.({ media_id: bg.media_id, x: r.x, y: r.y, w: r.w, h: r.h, fit: bg.fit, loop: bg.loop });
    }
    drawLook(ctx, look, 0, 0, w, h, info, native);
  });
  ctx.restore();
}

function designHasVideo(design: Design): boolean {
  const fills = [design.background, ...design.elements.map((e) => e.fill)];
  return fills.some((f) => f.type === "media" && mediaKind(f.media_id) === "video");
}

function designHasClock(design: Design): boolean {
  return design.elements.some((e) => e.text && (e.text.source.type === "clock" || e.text.source.type === "timer"));
}

function designAnimates(design: Design): boolean {
  return designHasVideo(design) || designHasClock(design);
}

/**
 * How often the stream's overlay (slides and graphics) must be redrawn: every frame for a
 * video inside a design (except the lowest design's background video, which is native),
 * a few times a second for clocks and timers, otherwise only when something changes. The
 * background, camera and media layer are drawn natively, so they don't count.
 */
export function overlayMotion(scene: RenderScene): "none" | "slow" | "fast" {
  const looks = sceneLooks(scene, { now: 0, timers: [], slide: null, videoScope: "" }).map((l) => l.look);
  const native = lowestLookVideo(scene);
  const videoInside = (look: Look) => {
    const d = look.design;
    const fills = [...(look === native ? [] : [d.background]), ...d.elements.map((e) => e.fill)];
    return fills.some((f) => f.type === "media" && mediaKind(f.media_id) === "video");
  };
  if (looks.some(videoInside)) return "fast";
  if (looks.some((l) => designHasClock(l.design))) return "slow";
  return "none";
}

/** How a picture changes by itself: every frame (videos, cameras), a few times a second
 * (clocks and timers), or not at all. */
export type Motion = "none" | "slow" | "fast";

/** How often a scene must be redrawn by itself. */
export function sceneMotion(scene: RenderScene): Motion {
  const { layers } = scene;
  const looks = [
    layers.slides?.look,
    layers.bible?.look,
    layers.announcements?.look,
    ...layers.props,
    scene.mask,
  ].filter(Boolean) as Look[];
  const bg = scene.screen.background;
  const bgMoves = bg.type === "folder" || (bg.type === "media" && mediaKind(bg.media_id) === "video");
  if (bgMoves || !!layers.video_input || layers.media?.state.kind === "video" || looks.some((l) => designHasVideo(l.design))) return "fast";
  return looks.some((l) => designHasClock(l.design)) ? "slow" : "none";
}

export function lookMotion(look: Look | null): Motion {
  if (!look) return "none";
  if (designHasVideo(look.design)) return "fast";
  return designHasClock(look.design) ? "slow" : "none";
}

/** Whether a scene changes by itself (videos, cameras, clocks) and must be redrawn continuously. */
export function sceneAnimates(scene: RenderScene): boolean {
  const { layers } = scene;
  const looks = [
    layers.slides?.look,
    layers.bible?.look,
    layers.announcements?.look,
    ...layers.props,
    scene.mask,
  ].filter(Boolean) as Look[];
  const bg = scene.screen.background;
  const bgMoves = bg.type === "folder" || (bg.type === "media" && mediaKind(bg.media_id) === "video");
  return (
    bgMoves ||
    !!layers.video_input ||
    layers.media?.state.kind === "video" ||
    looks.some((l) => designAnimates(l.design))
  );
}

export function lookAnimates(look: Look | null): boolean {
  return !!look && designAnimates(look.design);
}
