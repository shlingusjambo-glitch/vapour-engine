use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FrameStep {
    pub frame_delta: Duration,
    pub fixed_steps: u32,
    pub interpolation_alpha: f32,
}

/// Fixed-timestep accumulator with a spiral-of-death guard.
#[derive(Debug)]
pub struct Time {
    fixed_delta: Duration,
    accumulator: Duration,
    max_frame_delta: Duration,
    max_fixed_steps: u32,
}

impl Default for Time {
    fn default() -> Self {
        Self {
            fixed_delta: Duration::from_secs_f64(1.0 / 60.0),
            accumulator: Duration::ZERO,
            max_frame_delta: Duration::from_millis(250),
            max_fixed_steps: 8,
        }
    }
}

impl Time {
    pub fn advance(&mut self, real_delta: Duration) -> FrameStep {
        let frame_delta = real_delta.min(self.max_frame_delta);
        self.accumulator += frame_delta;
        let mut fixed_steps = 0;
        while self.accumulator >= self.fixed_delta && fixed_steps < self.max_fixed_steps {
            self.accumulator -= self.fixed_delta;
            fixed_steps += 1;
        }
        if fixed_steps == self.max_fixed_steps && self.accumulator >= self.fixed_delta {
            self.accumulator = Duration::ZERO;
        }
        FrameStep {
            frame_delta,
            fixed_steps,
            interpolation_alpha: self.accumulator.as_secs_f32() / self.fixed_delta.as_secs_f32(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamps_long_frames_and_fixed_work() {
        let mut time = Time::default();
        let step = time.advance(Duration::from_secs(10));
        assert_eq!(step.frame_delta, Duration::from_millis(250));
        assert_eq!(step.fixed_steps, 8);
        assert_eq!(step.interpolation_alpha, 0.0);
    }
}
