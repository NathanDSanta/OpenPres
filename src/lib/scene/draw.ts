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

export function drawDesign(ctx: CanvasRenderingContext2D, design: Design, width: number, height: number, info: DrawInfo) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  if (design.background.type !== "none") {
    paintFill(ctx, design.background, 0, 0, width, height, info, `bg:${design.id}`);
  }
  for (const el of design.elements) drawElement(ctx, el, info);
  ctx.restore();
}

/** Draws a design (in its theme's pixel space) fitted into a target rectangle. */
export function drawLook(ctx: CanvasRenderingContext2D, look: Look, tx: number, ty: number, tw: number, th: number, info: DrawInfo) {
  const { width, height } = look.theme;
  const scale = Math.min(tw / width, th / height);
  ctx.save();
  ctx.translate(tx + (tw - width * scale) / 2, ty + (th - height * scale) / 2);
  ctx.scale(scale, scale);
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();
  drawDesign(ctx, look.design, width, height, info);
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

/** Draws every visible layer of a screen into a w x h area. */
export function drawScene(ctx: CanvasRenderingContext2D, scene: RenderScene, w: number, h: number, now: number, videoScope: string) {
  const base: DrawInfo = { now, timers: scene.timers, services: scene.services ?? [], slide: null, videoScope };
  ctx.save();
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, w, h);
  drawBackground(ctx, scene.screen.background, scene.background_items, w, h, now, videoScope);

  const { layers } = scene;
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
  if (layers.slides) drawLook(ctx, layers.slides.look ?? DEFAULT_LOOK, 0, 0, w, h, { ...base, slide: layers.slides.slide });
  if (layers.bible) {
    const { passage, look } = layers.bible;
    const chosen = look ?? defaultBibleLook(passage.passages.length);
    const slide = bibleAsSlide(passage, !usesBibleSources(chosen.design));
    drawLook(ctx, chosen, 0, 0, w, h, { ...base, slide, bible: passage });
  }
  if (layers.announcements) drawLook(ctx, layers.announcements.look ?? DEFAULT_LOOK, 0, 0, w, h, { ...base, slide: layers.announcements.slide });
  const slide = layers.slides?.slide ?? null;
  for (const look of [...layers.complements, ...layers.props]) {
    drawLook(ctx, look, 0, 0, w, h, { ...base, slide });
  }
  if (scene.mask) drawLook(ctx, scene.mask, 0, 0, w, h, { ...base, slide });
  ctx.restore();
}

function designAnimates(design: Design): boolean {
  const fills = [design.background, ...design.elements.map((e) => e.fill)];
  return (
    fills.some((f) => f.type === "media" && mediaKind(f.media_id) === "video") ||
    design.elements.some((e) => e.text && (e.text.source.type === "clock" || e.text.source.type === "timer"))
  );
}

/** Whether a scene changes by itself (videos, cameras, clocks) and must be redrawn continuously. */
export function sceneAnimates(scene: RenderScene): boolean {
  const { layers } = scene;
  const looks = [
    layers.slides?.look,
    layers.bible?.look,
    layers.announcements?.look,
    ...layers.complements,
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
