//! Light rigs and environment state.
//!
//! Lights cross the WASM boundary as a flat `f32` record per light; this module
//! owns that encoding, its defaults, and the GPU-side representation.

use bytemuck::{Pod, Zeroable};
use glam::Vec3;

use super::{error::*, view::*};

pub(crate) const ENVIRONMENT_STRIDE: usize = 24;

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct EnvironmentState {
    pub(crate) clear_color: [f32; 4],
    pub(crate) fog_color_mode: [f32; 4],
    pub(crate) fog_params: [f32; 4],
    pub(crate) sky_zenith_mode: [f32; 4],
    pub(crate) sky_horizon_curve: [f32; 4],
    pub(crate) sky_ground_sun_size: [f32; 4],
}

pub(crate) fn decode_environment(
    values: &[f32],
    label: &'static str,
) -> Result<Option<EnvironmentState>, SurfaceRendererError> {
    if values.is_empty() {
        return Ok(None);
    }
    expect_len(label, values.len(), ENVIRONMENT_STRIDE)?;
    finite(label, values)?;
    let clear = [values[0], values[1], values[2], values[3]];
    let fog = [values[4], values[5], values[6], values[7]];
    let params = [values[8], values[9], values[10], values[11]];
    let zenith = [values[12], values[13], values[14], values[15]];
    let horizon = [values[16], values[17], values[18], values[19]];
    let ground = [values[20], values[21], values[22], values[23]];
    let mode = fog[3];
    if !(mode == 0.0 || mode == 1.0 || mode == 2.0) {
        return Err(SurfaceRendererError::InvalidEnvironment {
            reason: "fog mode must be 0, 1, or 2",
        });
    }
    if mode == 1.0 && (params[0] < 0.0 || params[1] <= params[0]) {
        return Err(SurfaceRendererError::InvalidEnvironment {
            reason: "linear fog must satisfy 0 <= near < far",
        });
    }
    if mode == 2.0 && params[2] < 0.0 {
        return Err(SurfaceRendererError::InvalidEnvironment {
            reason: "exponential fog density must be non-negative",
        });
    }
    if !(zenith[3] == 0.0 || zenith[3] == 1.0) {
        return Err(SurfaceRendererError::InvalidEnvironment {
            reason: "sky mode must be 0 or 1",
        });
    }
    if zenith[3] == 1.0 && (horizon[3] <= 0.0 || ground[3] <= 0.0 || ground[3] > 1.5707964) {
        return Err(SurfaceRendererError::InvalidEnvironment {
            reason: "procedural sky requires a positive horizon curve and sun angular radius in (0, pi/2]",
        });
    }
    Ok(Some(EnvironmentState {
        clear_color: clear,
        fog_color_mode: fog,
        fog_params: params,
        sky_zenith_mode: zenith,
        sky_horizon_curve: horizon,
        sky_ground_sun_size: ground,
    }))
}

pub(crate) fn default_light_rig() -> Vec<GpuLight> {
    vec![
        GpuLight::directional(
            Vec3::new(-0.4, -1.0, -0.35).normalize(),
            Vec3::new(1.0, 0.94, 0.84),
            5.0,
        ),
        GpuLight::hemisphere(
            Vec3::new(0.55, 0.68, 0.92),
            Vec3::new(0.28, 0.26, 0.24),
            0.45,
        ),
    ]
}

/// How many lights one view may carry. The cap is what the shader's uniform
/// array holds; submissions beyond it are rejected rather than silently
/// dropped, so a scene never loses lighting without saying so.
pub const MAX_LIGHTS: usize = 64;

/// Floats per light in a packed submission. Four vec4 lanes, matching the
/// shader's stride so the array can be uploaded without repacking.
pub const LIGHT_STRIDE: usize = 16;

/// Light kinds as they appear on the wire and in the shader.
pub(crate) const LIGHT_KIND_AMBIENT: f32 = 0.0;
pub(crate) const LIGHT_KIND_DIRECTIONAL: f32 = 1.0;
pub(crate) const LIGHT_KIND_POINT: f32 = 2.0;
pub(crate) const LIGHT_KIND_HEMISPHERE: f32 = 3.0;
pub(crate) const LIGHT_KIND_SPOT: f32 = 4.0;

#[repr(C)]
#[derive(Debug, Clone, Copy, Pod, Zeroable, PartialEq)]
pub(crate) struct GpuLight {
    pub(crate) vector_kind: [f32; 4],
    pub(crate) color_intensity: [f32; 4],
    pub(crate) secondary_range: [f32; 4],
    pub(crate) cone: [f32; 4],
}

impl GpuLight {
    pub(crate) fn ambient(color: Vec3, intensity: f32) -> Self {
        Self {
            vector_kind: [0.0, 0.0, 0.0, LIGHT_KIND_AMBIENT],
            color_intensity: [color.x, color.y, color.z, intensity.max(0.0)],
            secondary_range: [0.0; 4],
            cone: [0.0; 4],
        }
    }

    pub(crate) fn directional(direction: Vec3, color: Vec3, intensity: f32) -> Self {
        let direction = direction.normalize_or(Vec3::new(-0.4, -1.0, -0.35).normalize());
        Self {
            vector_kind: [
                direction.x,
                direction.y,
                direction.z,
                LIGHT_KIND_DIRECTIONAL,
            ],
            color_intensity: [color.x, color.y, color.z, intensity.max(0.0)],
            secondary_range: [0.0; 4],
            cone: [0.0; 4],
        }
    }

    pub(crate) fn hemisphere(sky: Vec3, ground: Vec3, intensity: f32) -> Self {
        Self {
            vector_kind: [0.0, 0.0, 0.0, LIGHT_KIND_HEMISPHERE],
            color_intensity: [sky.x, sky.y, sky.z, intensity.max(0.0)],
            secondary_range: [ground.x, ground.y, ground.z, 0.0],
            cone: [0.0; 4],
        }
    }
}

/// Reads one packed light record. `record` is [`LIGHT_STRIDE`] floats laid out
/// as the shader's four vec4 lanes; see the TypeScript `LightRig` for the
/// authoring side of the same format.
pub(crate) fn decode_light(record: &[f32]) -> GpuLight {
    let kind = record[0];
    let vector = Vec3::new(record[1], record[2], record[3]);
    let color = Vec3::new(record[4], record[5], record[6]);
    let intensity = record[7].max(0.0);
    let secondary = Vec3::new(record[8], record[9], record[10]);
    let range = record[11].max(0.0);
    // Cone angles arrive as cosines already, so a spot light costs no
    // trigonometry per frame.
    let cos_inner = record[12];
    let cos_outer = record[13];

    if kind < 0.5 {
        return GpuLight::ambient(color, intensity);
    }
    if kind < 1.5 {
        return GpuLight::directional(vector, color, intensity);
    }
    if kind < 2.5 {
        return GpuLight {
            vector_kind: [vector.x, vector.y, vector.z, LIGHT_KIND_POINT],
            color_intensity: [color.x, color.y, color.z, intensity],
            secondary_range: [0.0, 0.0, 0.0, range],
            cone: [0.0; 4],
        };
    }
    if kind < 3.5 {
        return GpuLight::hemisphere(color, secondary, intensity);
    }
    let direction = secondary.normalize_or(Vec3::NEG_Y);
    GpuLight {
        vector_kind: [vector.x, vector.y, vector.z, LIGHT_KIND_SPOT],
        color_intensity: [color.x, color.y, color.z, intensity],
        secondary_range: [direction.x, direction.y, direction.z, range],
        // An inner cone wider than the outer one would divide by a negative
        // span and light the world inside out, so the pair is ordered here.
        cone: [cos_inner.max(cos_outer), cos_outer.min(cos_inner), 0.0, 0.0],
    }
}

/// Turns a packed light submission into a rig.
///
/// Three shapes are accepted so callers can grow into the format: empty means
/// "use the renderer's default", seven floats is the original single
/// directional light, and any multiple of [`LIGHT_STRIDE`] is a full rig.
pub(crate) fn decode_light_rig(
    lights: &[f32],
    label: &'static str,
) -> Result<Option<Vec<GpuLight>>, SurfaceRendererError> {
    if lights.is_empty() {
        return Ok(None);
    }
    finite(label, lights)?;
    if lights.len() == 7 {
        let mut view = ViewState::default();
        view.set_single_directional(
            Vec3::new(lights[0], lights[1], lights[2]),
            Vec3::new(lights[3], lights[4], lights[5]),
            lights[6].max(0.0),
        );
        return Ok(Some(view.lights));
    }
    if !lights.len().is_multiple_of(LIGHT_STRIDE) {
        return Err(SurfaceRendererError::FrameArrayLength {
            field: label,
            actual: lights.len(),
            // Report the nearest whole rig so the message names a length the
            // caller could actually have sent.
            expected: lights.len().next_multiple_of(LIGHT_STRIDE),
        });
    }
    let count = lights.len() / LIGHT_STRIDE;
    if count > MAX_LIGHTS {
        return Err(SurfaceRendererError::TooManyLights {
            field: label,
            actual: count,
            limit: MAX_LIGHTS,
        });
    }
    Ok(Some(
        lights
            .as_chunks::<LIGHT_STRIDE>()
            .0
            .iter()
            .map(|record| decode_light(record))
            .collect(),
    ))
}
