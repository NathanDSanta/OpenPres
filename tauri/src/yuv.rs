//! Pictures in YUV 4:2:0 (BT.709, limited range), the format encoders take: the stream is
//! put together in it, so videos go from the decoder to the encoder without being
//! converted to RGB and back.

/// Planes of a picture: Y is width x height, U and V half that in both directions. Width
/// and height are even. With alpha (straight, not premultiplied): one value per Y sample and
/// one per U/V sample (the average of its 2x2 block).
pub struct Image {
    pub width: u32,
    pub height: u32,
    pub y: Vec<u8>,
    pub u: Vec<u8>,
    pub v: Vec<u8>,
    pub alpha: Option<Alpha>,
}

pub struct Alpha {
    pub luma: Vec<u8>,
    pub chroma: Vec<u8>,
}

/// Black in limited range.
pub const BLACK: [u8; 3] = [16, 128, 128];

/// RGB to Y'CbCr, BT.709, limited range (what HD video uses).
pub fn rgb_to_yuv(r: u8, g: u8, b: u8) -> [u8; 3] {
    let (r, g, b) = (r as i32, g as i32, b as i32);
    let y = 16 + ((47 * r + 157 * g + 16 * b + 128) >> 8);
    let u = 128 + ((-26 * r - 86 * g + 112 * b + 128) >> 8);
    let v = 128 + ((112 * r - 102 * g - 10 * b + 128) >> 8);
    [y.clamp(16, 235) as u8, u.clamp(16, 240) as u8, v.clamp(16, 240) as u8]
}

impl Image {
    pub fn opaque(&self) -> bool {
        self.alpha.is_none()
    }

    /// I420 bytes (Y, U, V planes) as ffmpeg reads and writes them.
    pub fn from_i420(width: u32, height: u32, data: &[u8], alpha: Option<&[u8]>) -> Self {
        let (w, h) = (width as usize, height as usize);
        let (y, rest) = data.split_at(w * h);
        let (u, v) = rest.split_at(w * h / 4);
        let alpha = alpha.and_then(|a| {
            // Fully opaque: no need to blend.
            if a.iter().all(|&x| x == 255) {
                return None;
            }
            Some(Alpha { luma: a.to_vec(), chroma: chroma_alpha(a, w, h) })
        });
        Self { width, height, y: y.to_vec(), u: u[..w * h / 4].to_vec(), v: v[..w * h / 4].to_vec(), alpha }
    }

    /// From RGB (3 channels) or straight RGBA (4); width and height must be even.
    pub fn from_rgb(width: u32, height: u32, data: &[u8], channels: usize) -> Self {
        let (w, h) = (width as usize, height as usize);
        let mut y = vec![0u8; w * h];
        let mut u = vec![0u8; w * h / 4];
        let mut v = vec![0u8; w * h / 4];
        let mut a_luma = if channels == 4 { vec![0u8; w * h] } else { vec![] };
        let mut a_chroma = if channels == 4 { vec![0u8; w * h / 4] } else { vec![] };
        let mut opaque = true;
        for cy in 0..h / 2 {
            for cx in 0..w / 2 {
                // The 2x2 block: luma for each pixel, one chroma for all (alpha-weighted).
                let (mut sr, mut sg, mut sb, mut sa) = (0u32, 0u32, 0u32, 0u32);
                for (dy, dx) in [(0, 0), (0, 1), (1, 0), (1, 1)] {
                    let (px, py) = (cx * 2 + dx, cy * 2 + dy);
                    let i = (py * w + px) * channels;
                    let (r, g, b) = (data[i], data[i + 1], data[i + 2]);
                    let a = if channels == 4 { data[i + 3] } else { 255 };
                    y[py * w + px] = rgb_to_yuv(r, g, b)[0];
                    if channels == 4 {
                        a_luma[py * w + px] = a;
                        opaque &= a == 255;
                    }
                    let a = a as u32;
                    sr += r as u32 * a;
                    sg += g as u32 * a;
                    sb += b as u32 * a;
                    sa += a;
                }
                let c = cy * (w / 2) + cx;
                // Colour weighted by alpha (a transparent pixel's colour doesn't count).
                let [_, cu, cv] = match (sr.checked_div(sa), sg.checked_div(sa), sb.checked_div(sa)) {
                    (Some(r), Some(g), Some(b)) => rgb_to_yuv(r as u8, g as u8, b as u8),
                    _ => [0, 128, 128],
                };
                u[c] = cu;
                v[c] = cv;
                if channels == 4 {
                    a_chroma[c] = ((sa + 2) / 4) as u8;
                }
            }
        }
        let alpha = (channels == 4 && !opaque).then_some(Alpha { luma: a_luma, chroma: a_chroma });
        Self { width, height, y, u, v, alpha }
    }
}

fn chroma_alpha(a: &[u8], w: usize, h: usize) -> Vec<u8> {
    let mut out = vec![0u8; w * h / 4];
    for cy in 0..h / 2 {
        for cx in 0..w / 2 {
            let i = cy * 2 * w + cx * 2;
            let sum = a[i] as u32 + a[i + 1] as u32 + a[i + w] as u32 + a[i + w + 1] as u32;
            out[cy * (w / 2) + cx] = ((sum + 2) / 4) as u8;
        }
    }
    out
}

/// A frame being put together: I420 planes in one buffer (as the encoder reads them).
pub struct Frame<'a> {
    pub width: usize,
    pub height: usize,
    pub y: &'a mut [u8],
    pub u: &'a mut [u8],
    pub v: &'a mut [u8],
}

/// A black I420 frame.
pub fn black_frame(width: u32, height: u32) -> Vec<u8> {
    let (w, h) = (width as usize, height as usize);
    let mut buf = vec![BLACK[0]; w * h * 3 / 2];
    buf[w * h..].fill(128);
    buf
}

impl<'a> Frame<'a> {
    pub fn new(buf: &'a mut [u8], width: u32, height: u32) -> Self {
        let (w, h) = (width as usize, height as usize);
        let (y, rest) = buf.split_at_mut(w * h);
        let (u, v) = rest.split_at_mut(w * h / 4);
        Self { width: w, height: h, y, u, v }
    }

    /// Fills a rectangle (even position and size) with one colour.
    pub fn fill(&mut self, x: u32, y: u32, w: u32, h: u32, yuv: [u8; 3]) {
        let (x, y, w, h) = (x as usize, y as usize, w as usize, h as usize);
        for row in y..(y + h).min(self.height) {
            let end = (x + w).min(self.width);
            self.y[row * self.width + x..row * self.width + end].fill(yuv[0]);
        }
        let cw = self.width / 2;
        for row in y / 2..((y + h) / 2).min(self.height / 2) {
            let end = ((x + w) / 2).min(cw);
            self.u[row * cw + x / 2..row * cw + end].fill(yuv[1]);
            self.v[row * cw + x / 2..row * cw + end].fill(yuv[2]);
        }
    }

    /// Puts `img` at (x, y) (even), clipped to the frame; blends it when it has alpha.
    /// `spans`: per luma row, the columns that aren't transparent (others are skipped).
    pub fn draw(&mut self, img: &Image, x: u32, y: u32, spans: Option<&[Option<(u32, u32)>]>) {
        let (x, y) = ((x & !1) as usize, (y & !1) as usize);
        let (iw, ih) = (img.width as usize, img.height as usize);
        if x >= self.width || y >= self.height {
            return;
        }
        let cols = iw.min(self.width - x);
        let rows = ih.min(self.height - y);
        let span = |row: usize| -> Option<(usize, usize)> {
            match spans {
                None => Some((0, cols)),
                Some(s) => s.get(row).copied().flatten().map(|(a, b)| (a as usize, (b as usize + 1).min(cols))).filter(|(a, b)| a < b),
            }
        };
        // Luma.
        for row in 0..rows {
            let Some((a, b)) = span(row) else { continue };
            let dst = &mut self.y[(y + row) * self.width + x + a..(y + row) * self.width + x + b];
            let src = &img.y[row * iw + a..row * iw + b];
            match &img.alpha {
                None => dst.copy_from_slice(src),
                Some(al) => blend(dst, src, &al.luma[row * iw + a..row * iw + b]),
            }
        }
        // Chroma, half the size.
        let (cw, icw) = (self.width / 2, iw / 2);
        let (ccols, crows) = (cols / 2, rows / 2);
        for row in 0..crows {
            // A chroma row covers two luma rows: their spans together.
            let (a, b) = match (span(row * 2), span(row * 2 + 1)) {
                (None, None) => continue,
                (Some(s), None) | (None, Some(s)) => s,
                (Some(s), Some(t)) => (s.0.min(t.0), s.1.max(t.1)),
            };
            let (a, b) = (a / 2, b.div_ceil(2).min(ccols));
            if a >= b {
                continue;
            }
            let d = (y / 2 + row) * cw + x / 2;
            let s = row * icw;
            for (plane, src) in [(&mut *self.u, &img.u), (&mut *self.v, &img.v)] {
                let dst = &mut plane[d + a..d + b];
                let src = &src[s + a..s + b];
                match &img.alpha {
                    None => dst.copy_from_slice(src),
                    Some(al) => blend(dst, src, &al.chroma[s + a..s + b]),
                }
            }
        }
    }
}

/// dst = src over dst, with straight alpha.
fn blend(dst: &mut [u8], src: &[u8], alpha: &[u8]) {
    for ((d, &s), &a) in dst.iter_mut().zip(src).zip(alpha) {
        match a {
            0 => {}
            255 => *d = s,
            a => {
                let a = a as u32;
                *d = ((s as u32 * a + *d as u32 * (255 - a) + 127) / 255) as u8;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn colours_convert_like_bt709() {
        assert_eq!(rgb_to_yuv(0, 0, 0), [16, 128, 128]);
        assert_eq!(rgb_to_yuv(255, 255, 255), [235, 128, 128]);
        // Pure red: Y 63, Cb 102, Cr 240 (BT.709 limited).
        let [y, u, v] = rgb_to_yuv(255, 0, 0);
        assert!((62..=64).contains(&y) && (101..=103).contains(&u) && v >= 239, "{y} {u} {v}");
    }

    #[test]
    fn rgba_keeps_alpha_and_opaque_drops_it() {
        let opaque = Image::from_rgb(2, 2, &[255u8; 16], 4);
        assert!(opaque.opaque());
        let mut px = [255u8; 16];
        px[3] = 0; // one transparent pixel
        let img = Image::from_rgb(2, 2, &px, 4);
        let a = img.alpha.as_ref().unwrap();
        assert_eq!(a.luma, vec![0, 255, 255, 255]);
        assert_eq!(a.chroma, vec![191]);
    }

    #[test]
    fn drawing_copies_or_blends_inside_the_frame() {
        let mut buf = black_frame(4, 4);
        let mut frame = Frame::new(&mut buf, 4, 4);
        frame.fill(0, 0, 4, 4, rgb_to_yuv(0, 0, 255));
        // A 2x2 half-transparent white square at (2, 2).
        let white = Image::from_rgb(2, 2, &[255, 255, 255, 128].repeat(4), 4);
        frame.draw(&white, 2, 2, None);
        let blue = rgb_to_yuv(0, 0, 255)[0];
        assert_eq!(frame.y[0], blue);
        let mixed = frame.y[3 * 4 + 3];
        assert!(mixed > blue + 50 && mixed < 235, "{mixed}");
        // Clipped at the edge, opaque.
        let red = Image::from_rgb(2, 2, &[255, 0, 0].repeat(4), 3);
        frame.draw(&red, 3, 0, None); // x rounds down to 2
        assert_eq!(frame.y[2], rgb_to_yuv(255, 0, 0)[0]);
        assert_eq!(frame.v[1], rgb_to_yuv(255, 0, 0)[2]);
    }

    #[test]
    fn spans_skip_transparent_rows() {
        let mut buf = black_frame(4, 2);
        let mut frame = Frame::new(&mut buf, 4, 2);
        let img = Image::from_rgb(4, 2, &[255u8, 255, 255].repeat(8), 3);
        frame.draw(&img, 0, 0, Some(&[None, Some((1, 2))]));
        assert_eq!(&frame.y[..4], &[16, 16, 16, 16]);
        assert_eq!(&frame.y[4..], &[16, 235, 235, 16]);
    }

    #[test]
    fn i420_round_trip() {
        let mut data = vec![50u8; 4 * 2];
        data.extend([60, 70, 80, 90]);
        let img = Image::from_i420(4, 2, &data, None);
        assert_eq!((img.y.len(), img.u.len(), img.v.len()), (8, 2, 2));
        assert_eq!(img.u, vec![60, 70]);
        assert_eq!(img.v, vec![80, 90]);
    }
}
