//! Render-to-texture targets.
//!
//! A render target is an HDR colour texture plus its own depth that a camera
//! layer can render into instead of the surface, and that materials can then
//! sample like any uploaded texture (a security monitor, a portal, a mirror,
//! a minimap). Targets either keep a fixed size or follow the surface at a
//! scale; the latter reallocate on resize, and every material bound to them
//! is rebuilt so no bind group is left pointing at a freed texture.

use std::collections::{HashMap, HashSet};

use super::{error::SurfaceRendererError, material::TextureGpu, pipeline::DEPTH_FORMAT};

/// How a render target is sized.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum RenderTargetSize {
    /// A fixed texel size, unaffected by the surface.
    Fixed { width: u32, height: u32 },
    /// A fraction of the presentation surface; reallocated when it resizes.
    SurfaceScaled(f32),
}

/// The texel extent a target takes for a given surface size. Scaled targets
/// round up so a 0.5-scale target of an odd surface never drops a pixel row,
/// and every dimension is at least one texel.
#[must_use]
pub fn target_extent(
    size: RenderTargetSize,
    surface_width: u32,
    surface_height: u32,
) -> (u32, u32) {
    match size {
        RenderTargetSize::Fixed { width, height } => (width.max(1), height.max(1)),
        RenderTargetSize::SurfaceScaled(scale) => (
            ((surface_width as f32 * scale).ceil() as u32).max(1),
            ((surface_height as f32 * scale).ceil() as u32).max(1),
        ),
    }
}

pub(crate) fn validate_target_size(
    id: &str,
    size: RenderTargetSize,
    max_dimension: u32,
) -> Result<(), SurfaceRendererError> {
    let reason = match size {
        RenderTargetSize::Fixed { width, height } if width == 0 || height == 0 => {
            "dimensions must be positive"
        }
        RenderTargetSize::Fixed { width, height }
            if width > max_dimension || height > max_dimension =>
        {
            "dimensions exceed the device maxTextureDimension2D limit"
        }
        RenderTargetSize::SurfaceScaled(scale)
            if !scale.is_finite() || scale <= 0.0 || scale > 4.0 =>
        {
            "surface scale must be finite and in (0, 4]"
        }
        _ => return Ok(()),
    };
    Err(SurfaceRendererError::InvalidRenderTarget {
        id: id.to_owned(),
        reason,
    })
}

/// Refuses a frame in which a layer would sample the target it writes,
/// directly or through other targets rendered this frame.
///
/// `layers` gives each layer's destination target (`None` for the surface)
/// and the render targets its materials sample. Edges run from a layer's
/// target to every target it samples; any cycle in that graph means some
/// texture is both read and written in one frame, which WebGPU forbids
/// within a pass and which would otherwise read a half-written image. The
/// error names the target and the chain of targets that closes the loop.
pub fn detect_render_target_cycle(
    layers: &[(Option<&str>, &[&str])],
) -> Result<(), SurfaceRendererError> {
    let mut edges: HashMap<&str, HashSet<&str>> = HashMap::new();
    for (target, sampled) in layers {
        let Some(target) = target else { continue };
        let entry = edges.entry(target).or_default();
        for sampled in sampled.iter() {
            entry.insert(sampled);
        }
    }
    let mut ordered: Vec<&str> = edges.keys().copied().collect();
    ordered.sort_unstable();
    for start in ordered {
        let mut path = vec![start];
        if let Some(cycle) = walk(&edges, start, start, &mut path, &mut HashSet::new()) {
            return Err(SurfaceRendererError::RenderTargetCycle {
                target: start.to_owned(),
                path: cycle.join(" -> "),
            });
        }
    }
    Ok(())
}

fn walk<'a>(
    edges: &HashMap<&'a str, HashSet<&'a str>>,
    start: &'a str,
    current: &'a str,
    path: &mut Vec<&'a str>,
    visited: &mut HashSet<&'a str>,
) -> Option<Vec<&'a str>> {
    let next = edges.get(current)?;
    let mut ordered: Vec<&str> = next.iter().copied().collect();
    ordered.sort_unstable();
    for sampled in ordered {
        if sampled == start {
            path.push(sampled);
            return Some(path.clone());
        }
        if !visited.insert(sampled) {
            continue;
        }
        path.push(sampled);
        if let Some(cycle) = walk(edges, start, sampled, path, visited) {
            return Some(cycle);
        }
        path.pop();
    }
    None
}

pub(crate) struct RenderTargetGpu {
    pub(crate) size: RenderTargetSize,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) color_view: wgpu::TextureView,
    pub(crate) depth_view: wgpu::TextureView,
    _color: wgpu::Texture,
    _depth: wgpu::Texture,
}

impl RenderTargetGpu {
    pub(crate) fn new(
        device: &wgpu::Device,
        id: &str,
        size: RenderTargetSize,
        surface_width: u32,
        surface_height: u32,
    ) -> Self {
        let (width, height) = target_extent(size, surface_width, surface_height);
        let color = device.create_texture(&wgpu::TextureDescriptor {
            label: Some(id),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: super::HDR_FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let depth = device.create_texture(&wgpu::TextureDescriptor {
            label: Some(id),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: DEPTH_FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        });
        Self {
            size,
            width,
            height,
            color_view: color.create_view(&wgpu::TextureViewDescriptor::default()),
            depth_view: depth.create_view(&wgpu::TextureViewDescriptor::default()),
            _color: color,
            _depth: depth,
        }
    }

    /// Reallocates a surface-scaled target when the surface size changes its
    /// extent. Returns whether anything was reallocated, so the caller knows
    /// to rebuild the materials that sample it.
    pub(crate) fn resize(
        &mut self,
        device: &wgpu::Device,
        id: &str,
        surface_width: u32,
        surface_height: u32,
    ) -> bool {
        let (width, height) = target_extent(self.size, surface_width, surface_height);
        if (width, height) == (self.width, self.height) {
            return false;
        }
        *self = Self::new(device, id, self.size, surface_width, surface_height);
        true
    }

    /// A material-side handle sharing the colour texture's view.
    pub(crate) fn as_texture(&self) -> TextureGpu {
        TextureGpu {
            _texture: self._color.clone(),
            view: self.color_view.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scaled_targets_follow_the_surface_and_fixed_ones_do_not() {
        assert_eq!(
            target_extent(RenderTargetSize::SurfaceScaled(0.5), 640, 480),
            (320, 240)
        );
        // Odd sizes round up rather than dropping a row.
        assert_eq!(
            target_extent(RenderTargetSize::SurfaceScaled(0.5), 641, 3),
            (321, 2)
        );
        assert_eq!(
            target_extent(RenderTargetSize::SurfaceScaled(0.001), 8, 8),
            (1, 1)
        );
        assert_eq!(
            target_extent(
                RenderTargetSize::Fixed {
                    width: 256,
                    height: 128
                },
                1920,
                1080
            ),
            (256, 128)
        );
        assert!(
            validate_target_size(
                "t",
                RenderTargetSize::Fixed {
                    width: 0,
                    height: 4
                },
                8192
            )
            .is_err()
        );
        assert!(
            validate_target_size(
                "t",
                RenderTargetSize::Fixed {
                    width: 9000,
                    height: 4
                },
                8192
            )
            .is_err()
        );
        assert!(validate_target_size("t", RenderTargetSize::SurfaceScaled(0.0), 8192).is_err());
        assert!(
            validate_target_size("t", RenderTargetSize::SurfaceScaled(f32::NAN), 8192).is_err()
        );
        assert!(validate_target_size("t", RenderTargetSize::SurfaceScaled(1.0), 8192).is_ok());
    }

    #[test]
    fn a_layer_cannot_sample_the_target_it_writes() {
        // Direct: the monitor camera renders into "monitor" while drawing a
        // screen whose material samples "monitor".
        let error = detect_render_target_cycle(&[(Some("monitor"), &["monitor"])]).unwrap_err();
        match error {
            SurfaceRendererError::RenderTargetCycle { target, path } => {
                assert_eq!(target, "monitor");
                assert_eq!(path, "monitor -> monitor");
            }
            other => panic!("unexpected {other}"),
        }
        assert_eq!(
            detect_render_target_cycle(&[(Some("monitor"), &["monitor"])])
                .unwrap_err()
                .to_string(),
            "render target 'monitor' is sampled by a layer that renders into it (monitor -> monitor); a camera cannot read the texture it writes"
        );
        // Indirect: a renders b's output, b renders a's output.
        let error = detect_render_target_cycle(&[
            (Some("a"), &["b"]),
            (Some("b"), &["c"]),
            (Some("c"), &["a"]),
        ])
        .unwrap_err();
        assert!(matches!(
            &error,
            SurfaceRendererError::RenderTargetCycle { target, path }
                if target == "a" && path == "a -> b -> c -> a"
        ));
        // A chain without a loop, and the surface sampling anything, is fine.
        assert!(
            detect_render_target_cycle(&[
                (Some("a"), &["b"]),
                (Some("b"), &[]),
                (None, &["a", "b"]),
            ])
            .is_ok()
        );
        assert!(detect_render_target_cycle(&[(None, &["x"]), (None, &[])]).is_ok());
    }

    #[test]
    fn gpu_scaled_targets_reallocate_on_resize_and_fixed_ones_keep_their_texture() {
        let Some(gpu) = crate::test_gpu::device() else {
            return;
        };
        let mut scaled = RenderTargetGpu::new(
            &gpu.device,
            "scaled",
            RenderTargetSize::SurfaceScaled(0.5),
            640,
            480,
        );
        assert_eq!((scaled.width, scaled.height), (320, 240));
        assert!(
            !scaled.resize(&gpu.device, "scaled", 640, 480),
            "same size: no reallocation"
        );
        assert!(scaled.resize(&gpu.device, "scaled", 800, 600));
        assert_eq!((scaled.width, scaled.height), (400, 300));
        let texture = scaled.as_texture();
        assert_eq!(texture._texture.width(), 400);
        assert_eq!(texture._texture.height(), 300);

        let mut fixed = RenderTargetGpu::new(
            &gpu.device,
            "fixed",
            RenderTargetSize::Fixed {
                width: 256,
                height: 256,
            },
            640,
            480,
        );
        let before = fixed.as_texture();
        assert!(!fixed.resize(&gpu.device, "fixed", 1920, 1080));
        assert_eq!((fixed.width, fixed.height), (256, 256));
        // The same texture object survives: bind groups stay valid.
        assert!(before._texture == fixed.as_texture()._texture);
    }
}
