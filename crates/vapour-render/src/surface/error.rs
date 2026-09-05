//! Renderer errors and the argument validation that produces them.
//!
//! Every fallible decode reports which field failed and what it received, so a
//! malformed frame from the host is actionable rather than a silent black screen.

use thiserror::Error;

use crate::{CameraProjection, GraphError, RenderWorldError, ShaderError, mesh::MeshError};

#[derive(Debug, Error)]
pub enum SurfaceRendererError {
    #[error("post-processing settings are invalid: {reason}")]
    InvalidPostProcess { reason: &'static str },
    #[error("the selected WebGPU adapter cannot present to this canvas")]
    UnsupportedSurface,
    #[error("failed to build the standard material shader: {0}")]
    Shader(#[from] ShaderError),
    #[error("failed to compile the renderer frame graph: {0}")]
    Graph(#[from] GraphError),
    #[error("invalid render world: {0}")]
    RenderWorld(#[from] RenderWorldError),
    #[error("WebGPU surface acquisition failed: {0}")]
    Surface(String),
    #[error("rejected mesh geometry: {0}")]
    Mesh(#[from] MeshError),
    #[error("mesh identifier '{id}' is not usable: {reason}")]
    InvalidMeshId { id: String, reason: &'static str },
    #[error("texture identifier '{id}' is not usable: {reason}")]
    InvalidTextureId { id: String, reason: &'static str },
    #[error("material identifier '{id}' is not usable: {reason}")]
    InvalidMaterialId { id: String, reason: &'static str },
    #[error("texture '{id}' requires {expected} RGBA8 bytes, received {actual}")]
    TextureDataLength {
        id: String,
        expected: usize,
        actual: usize,
    },
    #[error("material '{material}' references texture '{texture}', which has not been uploaded")]
    UnknownTexture { material: String, texture: String },
    #[error("texture '{texture}' is still referenced by material '{material}'")]
    TextureInUse { texture: String, material: String },
    #[error("frame references material '{id}', which has not been defined")]
    UnknownMaterial { id: String },
    #[error(
        "entity '{entity}' references mesh '{id}', which has not been uploaded. Available meshes: {available}"
    )]
    UnknownMesh {
        id: String,
        entity: String,
        available: String,
    },
    #[error("instance {instance} names mesh-table entry {index}, but the table holds {table}")]
    MeshIndexOutOfRange {
        instance: usize,
        index: usize,
        table: usize,
    },
    #[error("instance {instance} names material-table entry {index}, but the table holds {table}")]
    MaterialIndexOutOfRange {
        instance: usize,
        index: usize,
        table: usize,
    },
    #[error("frame array '{field}' has {actual} values but {expected} were expected")]
    FrameArrayLength {
        field: &'static str,
        actual: usize,
        expected: usize,
    },
    #[error("render layer {layer} is invalid: {reason}")]
    InvalidRenderLayer { layer: usize, reason: &'static str },
    #[error("frame environment is invalid: {reason}")]
    InvalidEnvironment { reason: &'static str },
    #[error("camera projection mode must be 0 (perspective) or 1 (orthographic), received {value}")]
    InvalidCameraProjection { value: f32 },
    #[error("'{field}' submits {actual} lights, but a view may carry at most {limit}")]
    TooManyLights {
        field: &'static str,
        actual: usize,
        limit: usize,
    },
}

pub(crate) fn expect_len(
    field: &'static str,
    actual: usize,
    expected: usize,
) -> Result<(), SurfaceRendererError> {
    if actual == expected {
        Ok(())
    } else {
        Err(SurfaceRendererError::FrameArrayLength {
            field,
            actual,
            expected,
        })
    }
}

pub(crate) fn decode_projection(value: f32) -> Result<CameraProjection, SurfaceRendererError> {
    match value {
        0.0 => Ok(CameraProjection::Perspective),
        1.0 => Ok(CameraProjection::Orthographic),
        _ => Err(SurfaceRendererError::InvalidCameraProjection { value }),
    }
}

pub(crate) fn finite(field: &'static str, values: &[f32]) -> Result<(), SurfaceRendererError> {
    if values.iter().all(|value| value.is_finite()) {
        Ok(())
    } else {
        Err(RenderWorldError::NonFinite {
            field: field.to_owned(),
        }
        .into())
    }
}

/// Reads one four-float record, falling back when the array was omitted.
pub(crate) fn read4(values: &[f32], index: usize, fallback: [f32; 4]) -> [f32; 4] {
    if values.is_empty() {
        return fallback;
    }
    let base = index * 4;
    let mut result = fallback;
    for (offset, slot) in result.iter_mut().enumerate() {
        let value = values[base + offset];
        *slot = if value.is_finite() {
            value
        } else {
            fallback[offset]
        };
    }
    result
}
