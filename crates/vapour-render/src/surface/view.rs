//! Camera view state and projection matrices.

use glam::{Mat4, Vec3};

use crate::CameraProjection;

use super::lighting::*;

#[derive(Debug, Clone)]
pub(crate) struct ViewState {
    pub(crate) camera_world: Mat4,
    pub(crate) projection: CameraProjection,
    pub(crate) field_of_view_degrees: f32,
    pub(crate) orthographic_size: f32,
    pub(crate) near: f32,
    pub(crate) far: f32,
    /// Every light affecting this view, in submission order.
    pub(crate) lights: Vec<GpuLight>,
    pub(crate) clear_color: [f32; 4],
    /// RGB fog colour and mode: 0 disabled, 1 linear, 2 exponential.
    pub(crate) fog_color_mode: [f32; 4],
    /// Near, far, density, reserved.
    pub(crate) fog_params: [f32; 4],
    pub(crate) sky_zenith_mode: [f32; 4],
    pub(crate) sky_horizon_curve: [f32; 4],
    pub(crate) sky_ground_sun_size: [f32; 4],
}

impl Default for ViewState {
    fn default() -> Self {
        Self {
            camera_world: Mat4::from_translation(Vec3::new(3.2, 2.4, 4.2)),
            projection: CameraProjection::Perspective,
            field_of_view_degrees: 60.0,
            orthographic_size: 10.0,
            near: 0.1,
            far: 1_000.0,
            lights: default_light_rig(),
            clear_color: [0.012, 0.018, 0.035, 1.0],
            fog_color_mode: [0.0; 4],
            fog_params: [0.0; 4],
            sky_zenith_mode: [0.0; 4],
            sky_horizon_curve: [0.0; 4],
            sky_ground_sun_size: [0.0; 4],
        }
    }
}

impl ViewState {
    /// Replaces the rig with a single directional light, the shape the legacy
    /// seven-float light submission describes.
    pub(crate) fn set_single_directional(&mut self, direction: Vec3, color: Vec3, intensity: f32) {
        self.lights.clear();
        self.lights
            .push(GpuLight::directional(direction, color, intensity));
        // A lone directional light leaves every surface facing away from it
        // pure black, which is never what a caller submitting one light means.
        self.lights.push(GpuLight::ambient(color, intensity * 0.04));
    }
}

/// The lighting a view gets when a frame submits none: a key light plus enough
/// fill that unlit faces read as shaded rather than as holes.
pub(crate) fn projection_matrix(view: &ViewState, aspect: f32) -> Mat4 {
    match view.projection {
        CameraProjection::Perspective => Mat4::perspective_rh(
            view.field_of_view_degrees.to_radians(),
            aspect,
            view.near,
            view.far,
        ),
        CameraProjection::Orthographic => {
            let half_height = view.orthographic_size * 0.5;
            let half_width = half_height * aspect;
            Mat4::orthographic_rh(
                -half_width,
                half_width,
                -half_height,
                half_height,
                view.near,
                view.far,
            )
        }
    }
}
