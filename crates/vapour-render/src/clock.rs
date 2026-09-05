//! Wall-clock timing that works on every target Vapour builds for.
//!
//! `std::time::Instant` panics on `wasm32-unknown-unknown` — the standard
//! library has no clock there — so calling it from renderer code aborts the
//! very first frame in a browser. Profiling timers therefore go through this
//! module, which uses the high-resolution browser clock on WebAssembly and
//! `std::time` everywhere else.

/// Measures elapsed wall-clock time in milliseconds.
#[derive(Debug, Clone, Copy)]
pub struct Stopwatch {
    started_ms: f64,
}

impl Stopwatch {
    #[must_use]
    pub fn start() -> Self {
        Self {
            started_ms: now_ms(),
        }
    }

    /// Milliseconds since `start`. Never negative: a browser whose clock is
    /// coarsened or stepped backwards reports zero rather than a bogus figure
    /// that would corrupt profiler averages.
    #[must_use]
    pub fn elapsed_ms(&self) -> f32 {
        let elapsed = now_ms() - self.started_ms;
        if elapsed.is_finite() && elapsed > 0.0 {
            elapsed as f32
        } else {
            0.0
        }
    }
}

#[cfg(target_arch = "wasm32")]
fn now_ms() -> f64 {
    // `performance.now()` is monotonic and sub-millisecond where the page is
    // cross-origin isolated. Workers expose it through WorkerGlobalScope, and a
    // context with neither still has to return something usable.
    use wasm_bindgen::JsCast;

    let global = js_sys::global();
    if let Some(window) = global.dyn_ref::<web_sys::Window>() {
        if let Some(performance) = window.performance() {
            return performance.now();
        }
    }
    if let Some(scope) = global.dyn_ref::<web_sys::WorkerGlobalScope>() {
        if let Some(performance) = scope.performance() {
            return performance.now();
        }
    }
    js_sys::Date::now()
}

#[cfg(not(target_arch = "wasm32"))]
fn now_ms() -> f64 {
    use std::time::{SystemTime, UNIX_EPOCH};

    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0.0, |elapsed| elapsed.as_secs_f64() * 1000.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn measures_a_non_negative_span() {
        let watch = Stopwatch::start();
        let mut total = 0_u64;
        for value in 0..200_000_u64 {
            total = total.wrapping_add(value);
        }
        assert!(total > 0);
        let elapsed = watch.elapsed_ms();
        assert!(elapsed >= 0.0, "elapsed {elapsed}");
        assert!(elapsed.is_finite());
    }

    #[test]
    fn a_fresh_stopwatch_reports_a_small_span() {
        assert!(Stopwatch::start().elapsed_ms() < 1_000.0);
    }
}
