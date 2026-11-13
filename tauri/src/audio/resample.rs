/// Linear-interpolating resampler for interleaved stereo f32.
pub struct Resampler {
    /// Input frames advanced per output frame (in_rate / out_rate).
    step: f64,
    pos: f64,
    prev: [f32; 2],
}

impl Resampler {
    pub fn new(in_rate: u32, out_rate: u32) -> Self {
        Self {
            step: in_rate as f64 / out_rate as f64,
            pos: 0.0,
            prev: [0.0; 2],
        }
    }

    pub fn is_identity(&self) -> bool {
        (self.step - 1.0).abs() < f64::EPSILON
    }

    /// Appends the resampled version of `input` to `out`. State carries across calls.
    pub fn process(&mut self, input: &[f32], out: &mut Vec<f32>) {
        let n = input.len() / 2;
        if n == 0 {
            return;
        }
        if self.is_identity() {
            out.extend_from_slice(&input[..n * 2]);
            return;
        }
        // Frame 0 is the last frame of the previous call, frame i (i>=1) is input[i-1].
        while self.pos < n as f64 {
            let i = self.pos as usize;
            let t = (self.pos - i as f64) as f32;
            let a = if i == 0 {
                self.prev
            } else {
                [input[(i - 1) * 2], input[(i - 1) * 2 + 1]]
            };
            let b = [input[i * 2], input[i * 2 + 1]];
            out.push(a[0] + (b[0] - a[0]) * t);
            out.push(a[1] + (b[1] - a[1]) * t);
            self.pos += self.step;
        }
        self.pos -= n as f64;
        self.prev = [input[(n - 1) * 2], input[(n - 1) * 2 + 1]];
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_keeps_samples() {
        let mut r = Resampler::new(48_000, 48_000);
        let mut out = vec![];
        r.process(&[1.0, 2.0, 3.0, 4.0], &mut out);
        assert_eq!(out, vec![1.0, 2.0, 3.0, 4.0]);
    }

    #[test]
    fn ratio_is_respected() {
        let mut r = Resampler::new(44_100, 48_000);
        let input = vec![0.5f32; 44_100 * 2];
        let mut out = vec![];
        r.process(&input, &mut out);
        let frames = out.len() / 2;
        assert!((frames as i64 - 48_000).abs() <= 2, "{frames}");
    }
}
