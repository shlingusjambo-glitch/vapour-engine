//! Built-in mesh geometry.
//!
//! Every primitive is generated here rather than shipped as data, so the set
//! costs nothing to download and stays exact at any scale. This module is also
//! the seam imported meshes will arrive through: `MeshData` is the shape the
//! renderer uploads, whatever produced it.
//!
//! Two invariants hold for every built-in mesh, and both are enforced by tests:
//!
//! 1. **It fits inside the unit cube centred on the origin.** A Transform scale
//!    of 1 therefore means one world unit for every primitive, so swapping a
//!    cube for a sphere never changes an object's footprint.
//! 2. **Triangles wind counter-clockwise when seen from outside**, matching the
//!    pipeline's `FrontFace::Ccw` with back-face culling.
//!
//! The editor mirrors the catalogue below in `packages/engine/src/mesh-library.ts`
//! so it can size gizmos and hit-test selections without calling into WebAssembly.
//! `catalogue_matches_the_editor_mesh_library` pins the two together.

use bytemuck::{Pod, Zeroable};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Interleaved vertex layout shared by every mesh the standard pipeline draws.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Pod, Zeroable)]
pub struct MeshVertex {
    pub position: [f32; 3],
    pub normal: [f32; 3],
    pub uv: [f32; 2],
    /// `xyz` is the tangent; `w` is the bitangent sign (+1 or -1).
    pub tangent: [f32; 4],
    /// Linear RGBA multiplied into the surface colour. White leaves the
    /// material unchanged; generated geometry uses it to carry per-vertex tint
    /// and baked ambient occlusion without needing a bespoke shader.
    pub color: [f32; 4],
    /// Per-vertex texture selection semantic. Standard grid-atlas materials
    /// treat this as a zero-based cell index; non-atlas materials ignore it.
    pub texture_layer: f32,
}

impl MeshVertex {
    /// A vertex with no tint. Built-in primitives use this; colour is a feature
    /// of generated and imported geometry.
    #[must_use]
    pub const fn new(
        position: [f32; 3],
        normal: [f32; 3],
        uv: [f32; 2],
        tangent: [f32; 4],
    ) -> Self {
        Self {
            position,
            normal,
            uv,
            tangent,
            color: [1.0, 1.0, 1.0, 1.0],
            texture_layer: 0.0,
        }
    }

    #[must_use]
    pub const fn with_color(mut self, color: [f32; 4]) -> Self {
        self.color = color;
        self
    }
}

/// One vertex's skinning data: up to 4 influencing bones and their weights,
/// parallel to `MeshData::vertices` — index *i* here describes vertex *i*.
///
/// This is a separate buffer rather than fields on [`MeshVertex`] so that the
/// overwhelming majority of meshes, which are never skinned, pay nothing for
/// the attribute layout change; [`MeshGpu`](crate::surface) still uploads a
/// zero-filled one for them so the pipeline's vertex-buffer layout never has
/// to branch between a skinned and a static variant.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Pod, Zeroable)]
pub struct SkinVertex {
    pub bone_indices: [u32; 4],
    pub bone_weights: [f32; 4],
}

impl SkinVertex {
    /// A vertex with no bone influence. `bone_weights` summing to zero is how
    /// the shader recognises "not skinned" and leaves the position alone.
    pub const UNSKINNED: Self = Self {
        bone_indices: [0; 4],
        bone_weights: [0.0; 4],
    };
}

/// Flattens per-bone matrices into the layout the GPU storage buffer expects:
/// one bone after another, 16 column-major floats each, so a palette for `N`
/// bones is exactly `16 * N` floats with bone `i` at `[16*i .. 16*i + 16]`.
#[must_use]
pub fn pack_bone_palette(matrices: &[[f32; 16]]) -> Vec<f32> {
    matrices.iter().flatten().copied().collect()
}

/// The CPU-side reference for what `standard_pbr.wgsl`'s vertex stage does to
/// a skinned position: blend up to 4 bone matrices by (normalised) weight,
/// then transform the rest-pose position through the blend. Weights summing
/// to (near) zero mean "not skinned" and the rest position passes through
/// unchanged — the same convention `SkinVertex::UNSKINNED` and the shader use.
#[must_use]
pub fn skin_vertex_position(
    vertex: &SkinVertex,
    bone_matrices: &[[f32; 16]],
    rest_position: [f32; 3],
) -> [f32; 3] {
    let total: f32 = vertex.bone_weights.iter().sum();
    if total <= 0.0001 {
        return rest_position;
    }
    let mut blended = [0.0f32; 16];
    for influence in 0..4 {
        let weight = vertex.bone_weights[influence] / total;
        if weight == 0.0 {
            continue;
        }
        let bone = &bone_matrices[vertex.bone_indices[influence] as usize];
        for component in 0..16 {
            blended[component] += bone[component] * weight;
        }
    }
    let [x, y, z] = rest_position;
    std::array::from_fn(|axis| {
        blended[axis] * x + blended[4 + axis] * y + blended[8 + axis] * z + blended[12 + axis]
    })
}

/// CPU-side geometry ready to upload.
///
/// Indices are `u32` throughout. Built-in primitives would fit in `u16`, but
/// generated geometry — a meshed voxel chunk, an imported model — routinely
/// exceeds 65,536 vertices, and one index format keeps the upload path free of
/// special cases.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct MeshData {
    pub vertices: Vec<MeshVertex>,
    pub indices: Vec<u32>,
    /// One entry per vertex when this mesh is skinned; `None` for the common
    /// static case.
    pub skin: Option<Vec<SkinVertex>>,
}

impl MeshData {
    #[must_use]
    pub fn triangle_count(&self) -> usize {
        self.indices.len() / 3
    }

    /// Axis-aligned bounds as `(minimum, maximum)`. Returns the origin for an
    /// empty mesh rather than infinities, so callers never propagate garbage.
    #[must_use]
    pub fn bounds(&self) -> ([f32; 3], [f32; 3]) {
        let mut minimum = [f32::INFINITY; 3];
        let mut maximum = [f32::NEG_INFINITY; 3];
        for vertex in &self.vertices {
            for axis in 0..3 {
                minimum[axis] = minimum[axis].min(vertex.position[axis]);
                maximum[axis] = maximum[axis].max(vertex.position[axis]);
            }
        }
        if self.vertices.is_empty() {
            return ([0.0; 3], [0.0; 3]);
        }
        (minimum, maximum)
    }

    /// Checks geometry that arrived from outside this module — uploaded by a
    /// game, produced by an importer — before it reaches the GPU.
    ///
    /// A bad index or a NaN position is a driver-level failure or a silently
    /// corrupt frame, so both are rejected here with a message naming the
    /// offending value rather than being passed through.
    pub fn validate(&self) -> Result<(), MeshError> {
        if self.vertices.is_empty() {
            return Err(MeshError::Empty);
        }
        if !self.indices.len().is_multiple_of(3) {
            return Err(MeshError::PartialTriangle {
                indices: self.indices.len(),
            });
        }
        let vertex_count = self.vertices.len() as u32;
        for (position, index) in self.indices.iter().enumerate() {
            if *index >= vertex_count {
                return Err(MeshError::IndexOutOfRange {
                    position,
                    index: *index,
                    vertex_count,
                });
            }
        }
        for (index, vertex) in self.vertices.iter().enumerate() {
            let finite = vertex.position.iter().all(|value| value.is_finite())
                && vertex.normal.iter().all(|value| value.is_finite())
                && vertex.uv.iter().all(|value| value.is_finite())
                && vertex.tangent.iter().all(|value| value.is_finite())
                && vertex.color.iter().all(|value| value.is_finite())
                && vertex.texture_layer.is_finite();
            if !finite {
                return Err(MeshError::NonFiniteVertex { index });
            }
        }
        if let Some(skin) = &self.skin
            && skin.len() != self.vertices.len() {
                return Err(MeshError::AttributeLength {
                    attribute: "skin",
                    actual: skin.len(),
                    expected: self.vertices.len(),
                    vertices: self.vertices.len(),
                });
            }
        Ok(())
    }

    /// Largest absolute extent on each axis: what the editor needs to size a
    /// selection box or frame the camera on an object.
    #[must_use]
    pub fn half_extents(&self) -> [f32; 3] {
        let (minimum, maximum) = self.bounds();
        [0, 1, 2].map(|axis| minimum[axis].abs().max(maximum[axis].abs()))
    }
}

/// Why a mesh was rejected before upload.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum MeshError {
    #[error("mesh has no vertices")]
    Empty,
    #[error("mesh has {indices} indices, which is not a whole number of triangles")]
    PartialTriangle { indices: usize },
    #[error(
        "index {index} at position {position} addresses past the {vertex_count} vertices supplied"
    )]
    IndexOutOfRange {
        position: usize,
        index: u32,
        vertex_count: u32,
    },
    #[error("vertex {index} contains a non-finite number")]
    NonFiniteVertex { index: usize },
    #[error(
        "attribute '{attribute}' has {actual} values but {expected} were expected for {vertices} vertices"
    )]
    AttributeLength {
        attribute: &'static str,
        actual: usize,
        expected: usize,
        vertices: usize,
    },
}

/// Assembles interleaved vertices from the separate typed arrays a game or an
/// importer naturally produces.
///
/// `positions` sets the vertex count. `normals`, `uvs`, and `colors` may be
/// empty, in which case sensible defaults are used. Tangents are generated by
/// the complete attribute path that this convenience function delegates to.
pub fn build_mesh(
    positions: &[f32],
    normals: &[f32],
    uvs: &[f32],
    colors: &[f32],
    indices: &[u32],
) -> Result<MeshData, MeshError> {
    build_mesh_with_texture_layers(positions, normals, uvs, colors, &[], indices)
}

/// Variant of [`build_mesh`] carrying one texture-layer value per vertex.
/// Keeping the attribute optional lets ordinary imported and procedural meshes
/// stay compact while voxel/tile meshers can select atlas cells without
/// splitting a chunk into one draw call per texture.
pub fn build_mesh_with_texture_layers(
    positions: &[f32],
    normals: &[f32],
    uvs: &[f32],
    colors: &[f32],
    texture_layers: &[f32],
    indices: &[u32],
) -> Result<MeshData, MeshError> {
    build_mesh_with_attributes(
        positions,
        normals,
        uvs,
        colors,
        &[],
        texture_layers,
        indices,
    )
}

/// Complete runtime/importer path, including glTF-compatible tangent frames.
/// When tangents are omitted they are accumulated from triangle UV gradients;
/// degenerate or UV-less vertices receive a stable perpendicular fallback.
pub fn build_mesh_with_attributes(
    positions: &[f32],
    normals: &[f32],
    uvs: &[f32],
    colors: &[f32],
    tangents: &[f32],
    texture_layers: &[f32],
    indices: &[u32],
) -> Result<MeshData, MeshError> {
    if !positions.len().is_multiple_of(3) {
        return Err(MeshError::AttributeLength {
            attribute: "positions",
            actual: positions.len(),
            expected: positions.len() / 3 * 3,
            vertices: positions.len() / 3,
        });
    }
    let count = positions.len() / 3;
    check_length("normals", normals, count, 3, true)?;
    check_length("uvs", uvs, count, 2, true)?;
    check_length("colors", colors, count, 4, true)?;
    check_length("tangents", tangents, count, 4, true)?;
    check_length("textureLayers", texture_layers, count, 1, true)?;

    for (position, index) in indices.iter().enumerate() {
        if *index as usize >= count {
            return Err(MeshError::IndexOutOfRange {
                position,
                index: *index,
                vertex_count: count as u32,
            });
        }
    }
    let generated_tangents = if tangents.is_empty() && !uvs.is_empty() {
        Some(generate_tangents(positions, normals, uvs, indices))
    } else {
        None
    };

    let mut vertices = Vec::with_capacity(count);
    for index in 0..count {
        let position = [
            positions[index * 3],
            positions[index * 3 + 1],
            positions[index * 3 + 2],
        ];
        let normal = if normals.is_empty() {
            [0.0, 1.0, 0.0]
        } else {
            normalize([
                normals[index * 3],
                normals[index * 3 + 1],
                normals[index * 3 + 2],
            ])
        };
        let uv = if uvs.is_empty() {
            [0.0, 0.0]
        } else {
            [uvs[index * 2], uvs[index * 2 + 1]]
        };
        let color = if colors.is_empty() {
            [1.0, 1.0, 1.0, 1.0]
        } else {
            [
                colors[index * 4],
                colors[index * 4 + 1],
                colors[index * 4 + 2],
                colors[index * 4 + 3],
            ]
        };
        let texture_layer = if texture_layers.is_empty() {
            0.0
        } else {
            texture_layers[index]
        };
        vertices.push(MeshVertex {
            position,
            normal,
            uv,
            tangent: if tangents.is_empty() {
                generated_tangents
                    .as_ref()
                    .map_or_else(|| tangent_for(normal), |values| values[index])
            } else {
                normalize_tangent(
                    [
                        tangents[index * 4],
                        tangents[index * 4 + 1],
                        tangents[index * 4 + 2],
                        tangents[index * 4 + 3],
                    ],
                    normal,
                )
            },
            color,
            texture_layer,
        });
    }
    let mesh = MeshData {
        vertices,
        indices: indices.to_vec(),
        skin: None,
    };
    mesh.validate()?;
    Ok(mesh)
}

fn generate_tangents(
    positions: &[f32],
    normals: &[f32],
    uvs: &[f32],
    indices: &[u32],
) -> Vec<[f32; 4]> {
    let count = positions.len() / 3;
    let mut tangent = vec![[0.0_f32; 3]; count];
    let mut bitangent = vec![[0.0_f32; 3]; count];
    for triangle in indices.as_chunks::<3>().0 {
        let [a, b, c] = [
            triangle[0] as usize,
            triangle[1] as usize,
            triangle[2] as usize,
        ];
        let p = |i: usize| [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
        let uv = |i: usize| [uvs[i * 2], uvs[i * 2 + 1]];
        let (p0, p1, p2) = (p(a), p(b), p(c));
        let (uv0, uv1, uv2) = (uv(a), uv(b), uv(c));
        let e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
        let e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
        let du1 = uv1[0] - uv0[0];
        let dv1 = uv1[1] - uv0[1];
        let du2 = uv2[0] - uv0[0];
        let dv2 = uv2[1] - uv0[1];
        let determinant = du1 * dv2 - du2 * dv1;
        if determinant.abs() < 1e-8 {
            continue;
        }
        let r = 1.0 / determinant;
        let t = [
            (e1[0] * dv2 - e2[0] * dv1) * r,
            (e1[1] * dv2 - e2[1] * dv1) * r,
            (e1[2] * dv2 - e2[2] * dv1) * r,
        ];
        let bt = [
            (e2[0] * du1 - e1[0] * du2) * r,
            (e2[1] * du1 - e1[1] * du2) * r,
            (e2[2] * du1 - e1[2] * du2) * r,
        ];
        for i in [a, b, c] {
            for axis in 0..3 {
                tangent[i][axis] += t[axis];
                bitangent[i][axis] += bt[axis];
            }
        }
    }
    (0..count)
        .map(|index| {
            let normal = if normals.is_empty() {
                [0., 1., 0.]
            } else {
                normalize([
                    normals[index * 3],
                    normals[index * 3 + 1],
                    normals[index * 3 + 2],
                ])
            };
            let projected = {
                let d = dot3(tangent[index], normal);
                [
                    tangent[index][0] - normal[0] * d,
                    tangent[index][1] - normal[1] * d,
                    tangent[index][2] - normal[2] * d,
                ]
            };
            if length3(projected) < 1e-7 {
                return tangent_for(normal);
            }
            let t = normalize(projected);
            let sign = if dot3(cross(normal, t), bitangent[index]) < 0.0 {
                -1.0
            } else {
                1.0
            };
            [t[0], t[1], t[2], sign]
        })
        .collect()
}

fn normalize_tangent(value: [f32; 4], normal: [f32; 3]) -> [f32; 4] {
    if !value.iter().all(|value| value.is_finite()) {
        return value;
    }
    let sign = if value[3] < 0.0 { -1.0 } else { 1.0 };
    let d = dot3([value[0], value[1], value[2]], normal);
    let projected = [
        value[0] - normal[0] * d,
        value[1] - normal[1] * d,
        value[2] - normal[2] * d,
    ];
    if length3(projected) < 1e-7 {
        return tangent_for(normal);
    }
    let value = normalize(projected);
    [value[0], value[1], value[2], sign]
}

fn check_length(
    attribute: &'static str,
    values: &[f32],
    vertices: usize,
    components: usize,
    optional: bool,
) -> Result<(), MeshError> {
    if optional && values.is_empty() {
        return Ok(());
    }
    let expected = vertices * components;
    if values.len() == expected {
        return Ok(());
    }
    Err(MeshError::AttributeLength {
        attribute,
        actual: values.len(),
        expected,
        vertices,
    })
}

/// Any unit vector perpendicular to the normal works when no tangent frame was
/// supplied; picking the more stable of two axes avoids a degenerate cross
/// product on axis-aligned faces, which voxel geometry is entirely made of.
fn tangent_for(normal: [f32; 3]) -> [f32; 4] {
    let reference = if normal[1].abs() > 0.99 {
        [1.0, 0.0, 0.0]
    } else {
        [0.0, 1.0, 0.0]
    };
    let tangent = normalize(cross(reference, normal));
    [tangent[0], tangent[1], tangent[2], 1.0]
}

/// Every mesh a `MeshRenderer` can currently reference.
///
/// Adding a variant here is the only step needed to offer a new primitive: the
/// renderer uploads whatever the catalogue lists, and the editor reads the
/// matching entry from its own mesh library.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub enum BuiltinMesh {
    #[serde(rename = "builtin:cube")]
    Cube,
    #[serde(rename = "builtin:sphere")]
    Sphere,
    #[serde(rename = "builtin:capsule")]
    Capsule,
    #[serde(rename = "builtin:cylinder")]
    Cylinder,
    #[serde(rename = "builtin:cone")]
    Cone,
    #[serde(rename = "builtin:plane")]
    Plane,
    #[serde(rename = "builtin:quad")]
    Quad,
}

impl BuiltinMesh {
    pub const ALL: [Self; 7] = [
        Self::Cube,
        Self::Sphere,
        Self::Capsule,
        Self::Cylinder,
        Self::Cone,
        Self::Plane,
        Self::Quad,
    ];

    /// Stable identifier used in scene files and across the WASM boundary.
    #[must_use]
    pub const fn id(self) -> &'static str {
        match self {
            Self::Cube => "builtin:cube",
            Self::Sphere => "builtin:sphere",
            Self::Capsule => "builtin:capsule",
            Self::Cylinder => "builtin:cylinder",
            Self::Cone => "builtin:cone",
            Self::Plane => "builtin:plane",
            Self::Quad => "builtin:quad",
        }
    }

    /// Position in `ALL`, which is also this mesh's slot in the renderer's
    /// uploaded mesh table.
    #[must_use]
    pub fn slot(self) -> usize {
        Self::ALL
            .iter()
            .position(|candidate| *candidate == self)
            .expect("every BuiltinMesh variant is listed in ALL")
    }

    #[must_use]
    pub fn build(self) -> MeshData {
        match self {
            Self::Cube => cube(),
            Self::Sphere => sphere(24, 16),
            Self::Capsule => capsule(24, 8),
            Self::Cylinder => cylinder(24),
            Self::Cone => cone(24),
            Self::Plane => plane(),
            Self::Quad => quad(),
        }
    }
}

/// A one-unit box centred on the origin, with hard edges: each face gets its
/// own four vertices so normals and UVs do not blend across the seam.
#[must_use]
pub fn cube() -> MeshData {
    // (normal, tangent) per face, in +X, -X, +Y, -Y, +Z, -Z order.
    const FACES: [([f32; 3], [f32; 3]); 6] = [
        ([1.0, 0.0, 0.0], [0.0, 0.0, -1.0]),
        ([-1.0, 0.0, 0.0], [0.0, 0.0, 1.0]),
        ([0.0, 1.0, 0.0], [1.0, 0.0, 0.0]),
        ([0.0, -1.0, 0.0], [1.0, 0.0, 0.0]),
        ([0.0, 0.0, 1.0], [1.0, 0.0, 0.0]),
        ([0.0, 0.0, -1.0], [-1.0, 0.0, 0.0]),
    ];
    let mut mesh = MeshData::default();
    for (normal, tangent) in FACES {
        // The bitangent completes a right-handed frame, so the four corners can
        // be walked counter-clockwise as seen from outside the box.
        let bitangent = cross(normal, tangent);
        let base = mesh.vertices.len() as u32;
        for (index, (u, v)) in [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]
            .into_iter()
            .enumerate()
        {
            let _ = index;
            let su = u * 2.0 - 1.0;
            let sv = v * 2.0 - 1.0;
            let position = [0, 1, 2]
                .map(|axis| (normal[axis] + tangent[axis] * su + bitangent[axis] * sv) * 0.5);
            mesh.vertices.push(MeshVertex::new(
                position,
                normal,
                [u, 1.0 - v],
                [tangent[0], tangent[1], tangent[2], 1.0],
            ));
        }
        mesh.indices
            .extend_from_slice(&[base, base + 1, base + 2, base, base + 2, base + 3]);
    }
    mesh
}

/// A UV sphere of radius 0.5. `segments` divides longitude, `rings` latitude.
#[must_use]
pub fn sphere(segments: u16, rings: u16) -> MeshData {
    let segments = segments.max(3);
    let rings = rings.max(2);
    let mut mesh = MeshData::default();
    for ring in 0..=rings {
        let v = f32::from(ring) / f32::from(rings);
        let polar = v * std::f32::consts::PI;
        let (sin_polar, cos_polar) = polar.sin_cos();
        for segment in 0..=segments {
            let u = f32::from(segment) / f32::from(segments);
            let azimuth = u * std::f32::consts::TAU;
            let (sin_azimuth, cos_azimuth) = azimuth.sin_cos();
            let normal = [sin_polar * cos_azimuth, cos_polar, sin_polar * sin_azimuth];
            mesh.vertices.push(MeshVertex::new(
                [normal[0] * 0.5, normal[1] * 0.5, normal[2] * 0.5],
                normal,
                [u, v],
                [-sin_azimuth, 0.0, cos_azimuth, 1.0],
            ));
        }
    }
    let stride = u32::from(segments) + 1;
    for ring in 0..rings {
        for segment in 0..segments {
            let top = u32::from(ring) * stride + u32::from(segment);
            let bottom = top + stride;
            // Skip the degenerate triangles that collapse at the poles.
            if ring > 0 {
                mesh.indices.extend_from_slice(&[top, top + 1, bottom]);
            }
            if ring < rings - 1 {
                mesh.indices
                    .extend_from_slice(&[top + 1, bottom + 1, bottom]);
            }
        }
    }
    mesh
}

/// A capsule one unit tall: two hemispherical caps of radius 0.25 joined by a
/// cylindrical body, matching the proportions of a character controller.
#[must_use]
pub fn capsule(segments: u16, cap_rings: u16) -> MeshData {
    const RADIUS: f32 = 0.25;
    const HALF_BODY: f32 = 0.5 - RADIUS;
    let segments = segments.max(3);
    let cap_rings = cap_rings.max(1);
    let mut mesh = MeshData::default();
    // Rows run top cap, then bottom cap; the body is the span between the two
    // equator rows, so no extra vertices are needed for it.
    let rows = (cap_rings + 1) * 2;
    for row in 0..rows {
        let in_top_cap = row <= cap_rings;
        let cap_step = if in_top_cap {
            f32::from(row) / f32::from(cap_rings)
        } else {
            f32::from(row - cap_rings - 1) / f32::from(cap_rings)
        };
        let polar = cap_step * std::f32::consts::FRAC_PI_2;
        let (sin_polar, cos_polar) = polar.sin_cos();
        let offset = if in_top_cap { HALF_BODY } else { -HALF_BODY };
        let vertical_normal = if in_top_cap { cos_polar } else { -sin_polar };
        let horizontal = if in_top_cap { sin_polar } else { cos_polar };
        for segment in 0..=segments {
            let u = f32::from(segment) / f32::from(segments);
            let azimuth = u * std::f32::consts::TAU;
            let (sin_azimuth, cos_azimuth) = azimuth.sin_cos();
            let normal = [
                horizontal * cos_azimuth,
                vertical_normal,
                horizontal * sin_azimuth,
            ];
            mesh.vertices.push(MeshVertex::new(
                [
                    normal[0] * RADIUS,
                    normal[1] * RADIUS + offset,
                    normal[2] * RADIUS,
                ],
                normal,
                [u, f32::from(row) / f32::from(rows - 1)],
                [-sin_azimuth, 0.0, cos_azimuth, 1.0],
            ));
        }
    }
    let stride = u32::from(segments) + 1;
    for row in 0..rows - 1 {
        for segment in 0..segments {
            let top = u32::from(row) * stride + u32::from(segment);
            let bottom = top + stride;
            if row > 0 {
                mesh.indices.extend_from_slice(&[top, top + 1, bottom]);
            }
            if row < rows - 2 {
                mesh.indices
                    .extend_from_slice(&[top + 1, bottom + 1, bottom]);
            }
        }
    }
    mesh
}

/// A closed cylinder of radius 0.5 and height 1, with flat caps whose normals
/// do not blend into the side wall.
#[must_use]
pub fn cylinder(segments: u16) -> MeshData {
    let segments = segments.max(3);
    let mut mesh = MeshData::default();
    for side in [0_u16, 1] {
        let y = if side == 0 { 0.5 } else { -0.5 };
        for segment in 0..=segments {
            let u = f32::from(segment) / f32::from(segments);
            let (sin_azimuth, cos_azimuth) = (u * std::f32::consts::TAU).sin_cos();
            mesh.vertices.push(MeshVertex::new(
                [cos_azimuth * 0.5, y, sin_azimuth * 0.5],
                [cos_azimuth, 0.0, sin_azimuth],
                [u, f32::from(side)],
                [-sin_azimuth, 0.0, cos_azimuth, 1.0],
            ));
        }
    }
    let stride = u32::from(segments) + 1;
    for segment in 0..segments {
        let top = u32::from(segment);
        let bottom = top + stride;
        mesh.indices
            .extend_from_slice(&[top, top + 1, bottom, top + 1, bottom + 1, bottom]);
    }
    push_disc(&mut mesh, 0.5, 0.5, true, segments);
    push_disc(&mut mesh, -0.5, 0.5, false, segments);
    mesh
}

/// A cone of base radius 0.5 and height 1, apex at +Y.
#[must_use]
pub fn cone(segments: u16) -> MeshData {
    let segments = segments.max(3);
    let mut mesh = MeshData::default();
    // The slope normal is constant around the cone: rise 1 over run 0.5.
    let slope = (0.5_f32).atan2(1.0).cos();
    let lift = (0.5_f32).atan2(1.0).sin();
    for segment in 0..=segments {
        let u = f32::from(segment) / f32::from(segments);
        let (sin_azimuth, cos_azimuth) = (u * std::f32::consts::TAU).sin_cos();
        let normal = normalize([slope * cos_azimuth, lift, slope * sin_azimuth]);
        let tangent = [-sin_azimuth, 0.0, cos_azimuth, 1.0];
        // The apex is duplicated per segment so each sliver keeps its own normal.
        mesh.vertices
            .push(MeshVertex::new([0.0, 0.5, 0.0], normal, [u, 0.0], tangent));
        mesh.vertices.push(MeshVertex::new(
            [cos_azimuth * 0.5, -0.5, sin_azimuth * 0.5],
            normal,
            [u, 1.0],
            tangent,
        ));
    }
    for segment in 0..segments {
        let apex = u32::from(segment) * 2;
        mesh.indices.extend_from_slice(&[apex, apex + 3, apex + 1]);
    }
    push_disc(&mut mesh, -0.5, 0.5, false, segments);
    mesh
}

/// A one-unit ground plane in XZ, facing +Y.
#[must_use]
pub fn plane() -> MeshData {
    let mut mesh = MeshData::default();
    for (x, z, u, v) in [
        (-0.5, -0.5, 0.0, 0.0),
        (0.5, -0.5, 1.0, 0.0),
        (0.5, 0.5, 1.0, 1.0),
        (-0.5, 0.5, 0.0, 1.0),
    ] {
        mesh.vertices.push(MeshVertex::new(
            [x, 0.0, z],
            [0.0, 1.0, 0.0],
            [u, v],
            [1.0, 0.0, 0.0, 1.0],
        ));
    }
    mesh.indices.extend_from_slice(&[0, 2, 1, 0, 3, 2]);
    mesh
}

/// A one-unit upright quad in XY, facing +Z: the base for sprites and billboards.
#[must_use]
pub fn quad() -> MeshData {
    let mut mesh = MeshData::default();
    for (x, y, u, v) in [
        (-0.5, -0.5, 0.0, 1.0),
        (0.5, -0.5, 1.0, 1.0),
        (0.5, 0.5, 1.0, 0.0),
        (-0.5, 0.5, 0.0, 0.0),
    ] {
        mesh.vertices.push(MeshVertex::new(
            [x, y, 0.0],
            [0.0, 0.0, 1.0],
            [u, v],
            [1.0, 0.0, 0.0, 1.0],
        ));
    }
    mesh.indices.extend_from_slice(&[0, 1, 2, 0, 2, 3]);
    mesh
}

/// Appends a flat cap. `upward` picks the facing, which also decides the
/// winding so the cap is not culled.
fn push_disc(mesh: &mut MeshData, y: f32, radius: f32, upward: bool, segments: u16) {
    let normal = [0.0, if upward { 1.0 } else { -1.0 }, 0.0];
    let centre = mesh.vertices.len() as u32;
    mesh.vertices.push(MeshVertex::new(
        [0.0, y, 0.0],
        normal,
        [0.5, 0.5],
        [1.0, 0.0, 0.0, 1.0],
    ));
    for segment in 0..=segments {
        let u = f32::from(segment) / f32::from(segments);
        let (sin_azimuth, cos_azimuth) = (u * std::f32::consts::TAU).sin_cos();
        mesh.vertices.push(MeshVertex::new(
            [cos_azimuth * radius, y, sin_azimuth * radius],
            normal,
            [cos_azimuth * 0.5 + 0.5, sin_azimuth * 0.5 + 0.5],
            [1.0, 0.0, 0.0, 1.0],
        ));
    }
    for segment in 0..segments {
        let first = centre + 1 + u32::from(segment);
        let second = first + 1;
        if upward {
            mesh.indices.extend_from_slice(&[centre, second, first]);
        } else {
            mesh.indices.extend_from_slice(&[centre, first, second]);
        }
    }
}

fn cross(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn dot3(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn length3(value: [f32; 3]) -> f32 {
    dot3(value, value).sqrt()
}

fn normalize(value: [f32; 3]) -> [f32; 3] {
    let length = (value[0] * value[0] + value[1] * value[1] + value[2] * value[2]).sqrt();
    if length < f32::EPSILON {
        return [0.0, 1.0, 0.0];
    }
    [value[0] / length, value[1] / length, value[2] / length]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn subtract(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
        [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
    }

    fn dot(a: [f32; 3], b: [f32; 3]) -> f32 {
        a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    }

    fn length(value: [f32; 3]) -> f32 {
        dot(value, value).sqrt()
    }

    const IDENTITY: [f32; 16] = [
        1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
    ];

    #[test]
    fn a_bone_palette_packs_matrices_back_to_back_in_column_major_order() {
        let mut translated = IDENTITY;
        translated[12] = 5.0;
        let packed = pack_bone_palette(&[IDENTITY, translated]);
        assert_eq!(packed.len(), 32, "16 floats per bone, 2 bones");
        assert_eq!(&packed[0..16], &IDENTITY[..]);
        assert_eq!(&packed[16..32], &translated[..]);
    }

    #[test]
    fn a_single_bone_pose_translates_the_vertex_exactly() {
        let mut bone = IDENTITY;
        bone[12] = 2.0;
        bone[13] = 3.0;
        bone[14] = -1.0;
        let vertex = SkinVertex {
            bone_indices: [0, 0, 0, 0],
            bone_weights: [1.0, 0.0, 0.0, 0.0],
        };
        let result = skin_vertex_position(&vertex, &[bone], [1.0, 1.0, 1.0]);
        assert_eq!(result, [3.0, 4.0, 0.0]);
    }

    #[test]
    fn two_bones_blend_by_normalised_weight() {
        let mut bone_a = IDENTITY;
        bone_a[12] = 10.0;
        let bone_b = IDENTITY; // identity: contributes the rest position unmoved
        let vertex = SkinVertex {
            // Unnormalised weights (3 : 1) must behave like the normalised
            // (0.75 : 0.25) split — authored weights are rarely pre-normalised.
            bone_indices: [0, 1, 0, 0],
            bone_weights: [3.0, 1.0, 0.0, 0.0],
        };
        let result = skin_vertex_position(&vertex, &[bone_a, bone_b], [0.0, 0.0, 0.0]);
        assert_eq!(result, [7.5, 0.0, 0.0]);
    }

    #[test]
    fn zero_total_weight_means_unskinned_and_the_rest_position_passes_through() {
        let result = skin_vertex_position(&SkinVertex::UNSKINNED, &[IDENTITY], [4.0, 5.0, 6.0]);
        assert_eq!(result, [4.0, 5.0, 6.0]);
    }

    #[test]
    fn every_builtin_fits_inside_the_unit_cube() {
        for mesh in BuiltinMesh::ALL {
            let data = mesh.build();
            let extents = data.half_extents();
            for (axis, extent) in extents.iter().enumerate() {
                assert!(
                    *extent <= 0.5 + 1e-5,
                    "{} exceeds the unit cube on axis {axis}: {extent}",
                    mesh.id()
                );
            }
            // A mesh that collapsed to nothing would pass the bound above.
            assert!(
                extents.iter().any(|extent| *extent > 0.1),
                "{} has no meaningful size",
                mesh.id()
            );
        }
    }

    #[test]
    fn every_builtin_has_valid_indexed_triangles() {
        for mesh in BuiltinMesh::ALL {
            let data = mesh.build();
            assert!(!data.vertices.is_empty(), "{} has no vertices", mesh.id());
            assert_eq!(
                data.indices.len() % 3,
                0,
                "{} has a partial triangle",
                mesh.id()
            );
            assert!(data.triangle_count() >= 2, "{} is too sparse", mesh.id());
            for index in &data.indices {
                assert!(
                    (*index as usize) < data.vertices.len(),
                    "{} indexes past its vertex list",
                    mesh.id()
                );
            }
        }
    }

    #[test]
    fn every_builtin_has_unit_length_normals_and_tangents() {
        for mesh in BuiltinMesh::ALL {
            let data = mesh.build();
            for vertex in &data.vertices {
                let normal = length(vertex.normal);
                assert!(
                    (normal - 1.0).abs() < 1e-4,
                    "{} has a normal of length {normal}",
                    mesh.id()
                );
                let tangent = length([vertex.tangent[0], vertex.tangent[1], vertex.tangent[2]]);
                assert!(
                    (tangent - 1.0).abs() < 1e-4,
                    "{} has a tangent of length {tangent}",
                    mesh.id()
                );
                assert!(
                    vertex.tangent[3].abs() == 1.0,
                    "{} has a bitangent sign that is not ±1",
                    mesh.id()
                );
            }
        }
    }

    #[test]
    fn every_builtin_triangle_faces_outward() {
        // The pipeline culls back faces with counter-clockwise winding, so a
        // triangle wound the wrong way is invisible. Comparing the geometric
        // face normal against the interpolated vertex normals catches that
        // without a GPU.
        for mesh in BuiltinMesh::ALL {
            let data = mesh.build();
            for (triangle, window) in data.indices.as_chunks::<3>().0.iter().enumerate() {
                let [a, b, c] = [
                    data.vertices[window[0] as usize].position,
                    data.vertices[window[1] as usize].position,
                    data.vertices[window[2] as usize].position,
                ];
                let face = cross(subtract(b, a), subtract(c, a));
                if length(face) < 1e-7 {
                    continue; // A degenerate sliver has no meaningful facing.
                }
                let average = [0, 1, 2].map(|axis| {
                    (data.vertices[window[0] as usize].normal[axis]
                        + data.vertices[window[1] as usize].normal[axis]
                        + data.vertices[window[2] as usize].normal[axis])
                        / 3.0
                });
                assert!(
                    dot(normalize(face), normalize(average)) > 0.0,
                    "{} triangle {triangle} winds inward",
                    mesh.id()
                );
            }
        }
    }

    #[test]
    fn sphere_points_lie_on_its_surface() {
        for vertex in &sphere(16, 12).vertices {
            let radius = length(vertex.position);
            assert!((radius - 0.5).abs() < 1e-5, "radius {radius}");
            // On a sphere the normal is the direction from the centre.
            assert!(dot(normalize(vertex.position), vertex.normal) > 0.999);
        }
    }

    #[test]
    fn capsule_caps_sit_on_the_body() {
        let data = capsule(16, 6);
        let (minimum, maximum) = data.bounds();
        assert!((maximum[1] - 0.5).abs() < 1e-5, "top {}", maximum[1]);
        assert!((minimum[1] + 0.5).abs() < 1e-5, "bottom {}", minimum[1]);
        // The straight section is 0.25 wide in X and Z, not 0.5 like a cylinder.
        assert!((maximum[0] - 0.25).abs() < 1e-5, "radius {}", maximum[0]);
    }

    #[test]
    fn flat_meshes_stay_flat_and_face_the_documented_axis() {
        let ground = plane();
        assert!(
            ground
                .vertices
                .iter()
                .all(|vertex| vertex.position[1] == 0.0)
        );
        assert!(
            ground
                .vertices
                .iter()
                .all(|vertex| vertex.normal == [0.0, 1.0, 0.0])
        );
        let sprite = quad();
        assert!(
            sprite
                .vertices
                .iter()
                .all(|vertex| vertex.position[2] == 0.0)
        );
        assert!(
            sprite
                .vertices
                .iter()
                .all(|vertex| vertex.normal == [0.0, 0.0, 1.0])
        );
    }

    #[test]
    fn generators_survive_degenerate_resolution_requests() {
        // Clamping matters because these numbers may one day come from an
        // import setting; zero segments would otherwise produce no geometry.
        for data in [sphere(0, 0), capsule(1, 0), cylinder(0), cone(2)] {
            assert!(data.triangle_count() > 0);
            for index in &data.indices {
                assert!((*index as usize) < data.vertices.len());
            }
        }
    }

    #[test]
    fn runtime_meshes_generate_uv_consistent_tangent_frames() {
        let mesh = build_mesh_with_attributes(
            &[-1., -1., 0., 1., -1., 0., 1., 1., 0., -1., 1., 0.],
            &[0., 0., 1., 0., 0., 1., 0., 0., 1., 0., 0., 1.],
            &[0., 0., 1., 0., 1., 1., 0., 1.],
            &[],
            &[],
            &[],
            &[0, 1, 2, 0, 2, 3],
        )
        .unwrap();
        for vertex in mesh.vertices {
            assert!(dot(vertex.tangent[..3].try_into().unwrap(), [1., 0., 0.]) > 0.999);
            assert_eq!(vertex.tangent[3], 1.0);
        }
    }

    #[test]
    fn runtime_meshes_preserve_authored_bitangent_handedness() {
        let mesh = build_mesh_with_attributes(
            &[0., 0., 0., 1., 0., 0., 0., 1., 0.],
            &[0., 0., 1., 0., 0., 1., 0., 0., 1.],
            &[0., 0., 1., 0., 0., 1.],
            &[],
            &[2., 0., 0., -1., 2., 0., 0., -1., 2., 0., 0., -1.],
            &[],
            &[0, 1, 2],
        )
        .unwrap();
        assert!(
            mesh.vertices
                .iter()
                .all(|vertex| vertex.tangent == [1., 0., 0., -1.])
        );
    }

    #[test]
    fn every_variant_has_a_distinct_slot_in_all() {
        for (expected, mesh) in BuiltinMesh::ALL.iter().enumerate() {
            assert_eq!(mesh.slot(), expected, "{}", mesh.id());
        }
    }

    #[test]
    fn identifiers_round_trip_through_serde() {
        for mesh in BuiltinMesh::ALL {
            let json = serde_json::to_string(&mesh).expect("serializable");
            assert_eq!(json, format!("\"{}\"", mesh.id()));
            let parsed: BuiltinMesh = serde_json::from_str(&json).expect("deserializable");
            assert_eq!(parsed, mesh);
        }
        assert!(serde_json::from_str::<BuiltinMesh>("\"builtin:teapot\"").is_err());
    }

    #[test]
    fn builds_a_mesh_from_separate_typed_arrays() {
        // The shape a game's mesher naturally produces: parallel arrays.
        let mesh = build_mesh(
            &[0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0],
            &[0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0],
            &[0.0, 0.0, 1.0, 0.0, 0.0, 1.0],
            &[1.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0],
            &[0, 1, 2],
        )
        .expect("valid geometry");
        assert_eq!(mesh.vertices.len(), 3);
        assert_eq!(mesh.triangle_count(), 1);
        assert_eq!(mesh.vertices[0].color, [1.0, 0.0, 0.0, 1.0]);
        assert_eq!(mesh.vertices[1].uv, [1.0, 0.0]);
    }

    #[test]
    fn carries_per_vertex_texture_layers_for_atlas_meshes() {
        let mesh = build_mesh_with_texture_layers(
            &[0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0],
            &[],
            &[0.0, 0.0, 2.0, 0.0, 0.0, 2.0],
            &[],
            &[17.0, 17.0, 17.0],
            &[0, 1, 2],
        )
        .expect("valid atlas geometry");
        assert!(
            mesh.vertices
                .iter()
                .all(|vertex| vertex.texture_layer == 17.0)
        );
        assert!(matches!(
            build_mesh_with_texture_layers(
                &[0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0],
                &[],
                &[],
                &[],
                &[0.0, 1.0],
                &[0, 1, 2],
            ),
            Err(MeshError::AttributeLength {
                attribute: "textureLayers",
                ..
            })
        ));
    }

    #[test]
    fn optional_attributes_fall_back_to_usable_defaults() {
        // A voxel mesher may emit positions and indices only; the result must
        // still light correctly rather than rendering black or inside out.
        let mesh = build_mesh(
            &[0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0],
            &[],
            &[],
            &[],
            &[0, 1, 2],
        )
        .expect("valid geometry");
        for vertex in &mesh.vertices {
            assert_eq!(vertex.color, [1.0, 1.0, 1.0, 1.0]);
            assert!((length(vertex.normal) - 1.0).abs() < 1e-5);
            let tangent = [vertex.tangent[0], vertex.tangent[1], vertex.tangent[2]];
            assert!((length(tangent) - 1.0).abs() < 1e-5);
            // A tangent parallel to the normal would collapse the frame.
            assert!(dot(tangent, vertex.normal).abs() < 1e-5);
        }
    }

    #[test]
    fn generated_tangents_stay_stable_on_axis_aligned_faces() {
        // Voxel geometry is entirely axis aligned, including straight up and
        // down, where a naive cross product against world up degenerates.
        for normal in [
            [0.0_f32, 1.0, 0.0],
            [0.0, -1.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 0.0, -1.0],
        ] {
            let mesh = build_mesh(
                &[0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0],
                &[
                    normal[0], normal[1], normal[2], normal[0], normal[1], normal[2], normal[0],
                    normal[1], normal[2],
                ],
                &[],
                &[],
                &[0, 1, 2],
            )
            .expect("valid geometry");
            let tangent = [
                mesh.vertices[0].tangent[0],
                mesh.vertices[0].tangent[1],
                mesh.vertices[0].tangent[2],
            ];
            assert!((length(tangent) - 1.0).abs() < 1e-5, "normal {normal:?}");
            assert!(dot(tangent, normal).abs() < 1e-5, "normal {normal:?}");
        }
    }

    #[test]
    fn rejects_geometry_that_would_corrupt_a_frame() {
        let positions = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
        // An index past the vertex list is a GPU-level fault, not a warning.
        assert!(matches!(
            build_mesh(&positions, &[], &[], &[], &[0, 1, 9]),
            Err(MeshError::IndexOutOfRange { index: 9, .. })
        ));
        assert!(matches!(
            build_mesh(&positions, &[], &[], &[], &[0, 1]),
            Err(MeshError::PartialTriangle { indices: 2 })
        ));
        assert!(matches!(
            build_mesh(&[], &[], &[], &[], &[]),
            Err(MeshError::Empty)
        ));
        assert!(matches!(
            build_mesh(
                &[f32::NAN, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0],
                &[],
                &[],
                &[],
                &[0, 1, 2]
            ),
            Err(MeshError::NonFiniteVertex { index: 0 })
        ));
    }

    #[test]
    fn rejects_attribute_arrays_that_do_not_match_the_vertex_count() {
        let positions = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
        assert!(matches!(
            build_mesh(&positions, &[0.0, 1.0, 0.0], &[], &[], &[0, 1, 2]),
            Err(MeshError::AttributeLength {
                attribute: "normals",
                ..
            })
        ));
        assert!(matches!(
            build_mesh(&positions, &[], &[0.0], &[], &[0, 1, 2]),
            Err(MeshError::AttributeLength {
                attribute: "uvs",
                ..
            })
        ));
        assert!(matches!(
            build_mesh(&[0.0, 0.0], &[], &[], &[], &[]),
            Err(MeshError::AttributeLength {
                attribute: "positions",
                ..
            })
        ));
    }

    #[test]
    fn a_mesh_larger_than_a_u16_index_space_is_representable() {
        // Chunk meshes routinely exceed 65,536 vertices; u16 indices silently
        // wrapped there, which is why the format is u32 throughout.
        let vertex_count = 70_000_usize;
        let positions: Vec<f32> = (0..vertex_count * 3)
            .map(|value| value as f32 * 0.001)
            .collect();
        let indices: Vec<u32> = vec![0, 1, (vertex_count - 1) as u32];
        let mesh = build_mesh(&positions, &[], &[], &[], &indices).expect("valid geometry");
        assert_eq!(mesh.vertices.len(), vertex_count);
        assert!(mesh.validate().is_ok());
    }

    #[test]
    fn builtin_vertices_carry_no_tint() {
        for builtin in BuiltinMesh::ALL {
            for vertex in &builtin.build().vertices {
                assert_eq!(vertex.color, [1.0, 1.0, 1.0, 1.0], "{}", builtin.id());
            }
        }
    }

    #[test]
    fn mesh_identifiers_are_unique_and_namespaced() {
        let mut seen = std::collections::BTreeSet::new();
        for mesh in BuiltinMesh::ALL {
            assert!(mesh.id().starts_with("builtin:"), "{}", mesh.id());
            assert!(seen.insert(mesh.id()), "duplicate id {}", mesh.id());
        }
        assert_eq!(seen.len(), BuiltinMesh::ALL.len());
    }

    #[test]
    fn catalogue_matches_the_editor_mesh_library() {
        // Mirrors `packages/engine/src/mesh-library.ts`. The editor sizes gizmos
        // and hit-tests selections from its copy without calling into WASM, so
        // the two tables must agree; this test fails if geometry here changes
        // without the editor's half-extents being updated to match.
        let expected: [(&str, [f32; 3], usize); 7] = [
            ("builtin:cube", [0.5, 0.5, 0.5], 12),
            ("builtin:sphere", [0.5, 0.5, 0.5], 720),
            ("builtin:capsule", [0.25, 0.5, 0.25], 768),
            ("builtin:cylinder", [0.5, 0.5, 0.5], 96),
            ("builtin:cone", [0.5, 0.5, 0.5], 48),
            ("builtin:plane", [0.5, 0.0, 0.5], 2),
            ("builtin:quad", [0.5, 0.5, 0.0], 2),
        ];
        assert_eq!(expected.len(), BuiltinMesh::ALL.len());
        for mesh in BuiltinMesh::ALL {
            let (_, extents, triangles) = expected
                .iter()
                .find(|(id, _, _)| *id == mesh.id())
                .unwrap_or_else(|| panic!("{} is missing from the editor library", mesh.id()));
            let data = mesh.build();
            let actual = data.half_extents();
            for axis in 0..3 {
                assert!(
                    (actual[axis] - extents[axis]).abs() < 1e-4,
                    "{} axis {axis}: renderer {} vs editor {}",
                    mesh.id(),
                    actual[axis],
                    extents[axis]
                );
            }
            assert_eq!(
                data.triangle_count(),
                *triangles,
                "{} triangle count drifted from the editor library",
                mesh.id()
            );
        }
    }
}
