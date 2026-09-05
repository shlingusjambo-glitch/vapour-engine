//! The WebGPU surface renderer.
//!
//! This module owns frame orchestration: it validates an incoming frame, sorts
//! and batches submissions, and drives the compiled render graph. The pieces it
//! orchestrates live in sibling modules — meshes, materials, lighting, view
//! state, per-frame types, errors, and pipeline construction — so that adding a
//! pass does not mean growing one file without bound.

mod error;
mod frame;
mod lighting;
mod material;
mod mesh;
mod pipeline;
mod postprocess;
mod shadow;
mod view;

pub use error::*;
pub use frame::*;
pub use lighting::*;
pub use material::*;
pub(crate) use mesh::*;
pub(crate) use pipeline::*;
pub(crate) use postprocess::{HDR_FORMAT, HdrTarget, PostProcessGpu};
pub use postprocess::{PostProcessSettings, ToneMapping};
pub(crate) use shadow::*;
pub(crate) use view::*;

use std::collections::HashMap;

use glam::{Mat4, Vec3};

use crate::{
    CameraProjection, CompiledRenderGraph, GpuContext, MAX_RENDER_INSTANCES, PassKind, RenderWorld,
    RenderWorldError, ShaderLibrary,
    clock::Stopwatch,
    mesh::{BuiltinMesh, MeshData},
};

pub struct SurfaceRenderer<'surface> {
    pub context: GpuContext,
    surface: wgpu::Surface<'surface>,
    config: wgpu::SurfaceConfiguration,
    pipelines: HashMap<PipelineKind, wgpu::RenderPipeline>,
    frame_layout: wgpu::BindGroupLayout,
    frame_uniforms: Vec<FrameGpu>,
    shadows: ShadowGpu,
    shadow_pipeline: wgpu::RenderPipeline,
    sky_pipeline: wgpu::RenderPipeline,
    material_layout: wgpu::BindGroupLayout,
    default_textures: Vec<TextureGpu>,
    textures: HashMap<String, TextureGpu>,
    materials: MaterialRegistry,
    meshes: MeshRegistry,
    layers: Vec<RenderLayerState>,
    instance_buffer: wgpu::Buffer,
    instance_capacity: usize,
    instance_count: u32,
    depth_texture: wgpu::Texture,
    depth_view: wgpu::TextureView,
    frame_graph: CompiledRenderGraph,
    hdr_target: HdrTarget,
    post_process: PostProcessGpu,
    post_process_settings: PostProcessSettings,
}

impl<'surface> SurfaceRenderer<'surface> {
    pub fn new(
        context: GpuContext,
        surface: wgpu::Surface<'surface>,
        width: u32,
        height: u32,
    ) -> Result<Self, SurfaceRendererError> {
        let width = width.max(1);
        let height = height.max(1);
        let mut config = surface
            .get_default_config(&context.adapter, width, height)
            .ok_or(SurfaceRendererError::UnsupportedSurface)?;
        let capabilities = surface.get_capabilities(&context.adapter);
        if let Some(format) = capabilities
            .formats
            .iter()
            .copied()
            .find(wgpu::TextureFormat::is_srgb)
        {
            config.format = format;
        }
        config.present_mode = if capabilities
            .present_modes
            .contains(&wgpu::PresentMode::Mailbox)
        {
            wgpu::PresentMode::Mailbox
        } else {
            wgpu::PresentMode::Fifo
        };
        surface.configure(&context.device, &config);

        let shader_library = ShaderLibrary::standard()?;
        let shader = shader_library.create_module(&context.device, "vapour.standard-pbr")?;
        let sky_shader = shader_library.create_module(&context.device, "vapour.procedural-sky")?;
        let shadows = ShadowGpu::new(&context.device);
        let frame_layout = create_frame_layout(&context.device);
        let material_layout = create_material_layout(&context.device);
        let pipeline_layout =
            context
                .device
                .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                    label: Some("Vapour standard PBR pipeline layout"),
                    bind_group_layouts: &[Some(&frame_layout), Some(&material_layout)],
                    immediate_size: 0,
                });
        let pipelines =
            create_standard_pipelines(&context.device, &pipeline_layout, &shader, HDR_FORMAT);
        let shadow_pipeline = create_shadow_pipeline(&context.device, &shadows.layout);
        let sky_pipeline = create_sky_pipeline(&context.device, &frame_layout, &sky_shader);

        let frame_uniforms = vec![create_frame_gpu(
            &context.device,
            &frame_layout,
            &shadows,
            0,
        )];

        let default_textures = vec![
            solid_texture(&context, "base color", [255, 255, 255, 255], true),
            solid_texture(&context, "normal", [128, 128, 255, 255], false),
            solid_texture(&context, "metallic roughness", [255, 255, 0, 255], false),
            solid_texture(&context, "occlusion", [255, 255, 255, 255], false),
            solid_texture(&context, "emission", [0, 0, 0, 255], true),
        ];
        let textures = HashMap::new();
        let default_definition =
            normalize_material("builtin:default", &StandardMaterialDescriptor::default())?;
        let default_material = create_material_gpu(
            &context,
            &material_layout,
            &default_textures,
            &textures,
            "builtin:default",
            default_definition,
        )?;
        let mut materials = MaterialRegistry::default();
        let default_slot = materials.insert("builtin:default", default_material);
        debug_assert_eq!(default_slot, 0);

        // Built-in meshes are generated and uploaded once at startup. They are
        // small, and holding them resident keeps switching primitives in the
        // editor instant.
        let mut meshes = MeshRegistry::default();
        for builtin in BuiltinMesh::ALL {
            meshes.insert(
                builtin.id(),
                MeshGpu::upload(&context.device, builtin.id(), &builtin.build()),
            );
        }
        let instance_capacity = 1;
        let instance_buffer = create_instance_buffer(&context.device, instance_capacity);
        let (depth_texture, depth_view) = create_depth(&context.device, width, height);
        let frame_graph = create_frame_graph()?;
        let hdr_target = HdrTarget::new(&context.device, width, height);
        let post_process = PostProcessGpu::new(&context.device, config.format);

        Ok(Self {
            context,
            surface,
            config,
            pipelines,
            frame_layout,
            frame_uniforms,
            shadows,
            shadow_pipeline,
            sky_pipeline,
            material_layout,
            default_textures,
            textures,
            materials,
            meshes,
            layers: Vec::new(),
            instance_buffer,
            instance_capacity,
            instance_count: 0,
            depth_texture,
            depth_view,
            frame_graph,
            hdr_target,
            post_process,
            post_process_settings: PostProcessSettings::default(),
        })
    }

    pub fn resize(&mut self, width: u32, height: u32) {
        let width = width.max(1);
        let height = height.max(1);
        if self.config.width == width && self.config.height == height {
            return;
        }
        self.config.width = width;
        self.config.height = height;
        self.surface.configure(&self.context.device, &self.config);
        (self.depth_texture, self.depth_view) = create_depth(&self.context.device, width, height);
        self.hdr_target = HdrTarget::new(&self.context.device, width, height);
    }

    pub fn set_post_process(
        &mut self,
        settings: PostProcessSettings,
    ) -> Result<(), SurfaceRendererError> {
        self.post_process_settings = settings
            .validate()
            .map_err(|reason| SurfaceRendererError::InvalidPostProcess { reason })?;
        Ok(())
    }

    #[must_use]
    pub fn post_process(&self) -> PostProcessSettings {
        self.post_process_settings
    }

    /// Uploads or replaces a runtime mesh under `id`.
    ///
    /// Replacing keeps the identifier's slot, so instances already referencing
    /// it show the new geometry on the next frame — the path a remeshed voxel
    /// chunk takes. Identifiers beginning with `builtin:` are reserved so game
    /// content cannot shadow a primitive the editor offers.
    pub fn upload_mesh(&mut self, id: &str, data: &MeshData) -> Result<(), SurfaceRendererError> {
        if id.trim().is_empty() {
            return Err(SurfaceRendererError::InvalidMeshId {
                id: id.to_owned(),
                reason: "identifier is empty",
            });
        }
        if id.starts_with("builtin:") && BuiltinMesh::ALL.iter().all(|mesh| mesh.id() != id) {
            return Err(SurfaceRendererError::InvalidMeshId {
                id: id.to_owned(),
                reason: "the 'builtin:' prefix is reserved for engine primitives",
            });
        }
        data.validate()?;
        let mesh = MeshGpu::upload(&self.context.device, id, data);
        self.meshes.insert(id, mesh);
        Ok(())
    }

    /// Releases a runtime mesh. Returns whether it existed. Built-in primitives
    /// cannot be released; the editor always needs them.
    pub fn release_mesh(&mut self, id: &str) -> Result<bool, SurfaceRendererError> {
        if BuiltinMesh::ALL.iter().any(|mesh| mesh.id() == id) {
            return Err(SurfaceRendererError::InvalidMeshId {
                id: id.to_owned(),
                reason: "built-in primitives cannot be released",
            });
        }
        Ok(self.meshes.remove(id))
    }

    #[must_use]
    pub fn mesh_ids(&self) -> Vec<&str> {
        self.meshes.ids()
    }

    #[must_use]
    pub fn mesh_count(&self) -> usize {
        self.meshes.len()
    }

    /// Uploads or replaces an RGBA8 texture. Replacing automatically rebuilds
    /// every referencing material bind group, so atlas hot reload is atomic
    /// from the next submitted frame.
    pub fn upload_texture_rgba8(
        &mut self,
        id: &str,
        width: u32,
        height: u32,
        pixels: &[u8],
        srgb: bool,
    ) -> Result<(), SurfaceRendererError> {
        validate_asset_id("texture", id)?;
        if width == 0 || height == 0 {
            return Err(SurfaceRendererError::InvalidTextureId {
                id: id.to_owned(),
                reason: "dimensions must be positive",
            });
        }
        let expected = width as usize * height as usize * 4;
        if pixels.len() != expected {
            return Err(SurfaceRendererError::TextureDataLength {
                id: id.to_owned(),
                expected,
                actual: pixels.len(),
            });
        }
        let texture = texture_rgba8(&self.context, id, width, height, pixels, srgb);
        self.textures.insert(id.to_owned(), texture);

        let definitions: Vec<(usize, String, MaterialDefinition)> = self
            .materials
            .slots
            .iter()
            .filter_map(|(material_id, slot)| {
                let material = self.materials.get(*slot)?;
                material
                    .definition
                    .textures
                    .iter()
                    .any(|texture_id| texture_id.as_deref() == Some(id))
                    .then(|| (*slot, material_id.clone(), material.definition.clone()))
            })
            .collect();
        let replacements: Result<Vec<_>, _> = definitions
            .into_iter()
            .map(|(slot, material_id, definition)| {
                create_material_gpu(
                    &self.context,
                    &self.material_layout,
                    &self.default_textures,
                    &self.textures,
                    &material_id,
                    definition,
                )
                .map(|material| (slot, material))
            })
            .collect();
        for (slot, material) in replacements? {
            self.materials.materials[slot] = Some(material);
        }
        Ok(())
    }

    pub fn release_texture(&mut self, id: &str) -> Result<bool, SurfaceRendererError> {
        for (material_id, slot) in &self.materials.slots {
            let Some(material) = self.materials.get(*slot) else {
                continue;
            };
            if material
                .definition
                .textures
                .iter()
                .any(|texture_id| texture_id.as_deref() == Some(id))
            {
                return Err(SurfaceRendererError::TextureInUse {
                    texture: id.to_owned(),
                    material: material_id.clone(),
                });
            }
        }
        Ok(self.textures.remove(id).is_some())
    }

    pub fn define_material(
        &mut self,
        id: &str,
        descriptor: &StandardMaterialDescriptor,
    ) -> Result<(), SurfaceRendererError> {
        validate_asset_id("material", id)?;
        let definition = normalize_material(id, descriptor)?;
        let material = create_material_gpu(
            &self.context,
            &self.material_layout,
            &self.default_textures,
            &self.textures,
            id,
            definition,
        )?;
        self.materials.insert(id, material);
        Ok(())
    }

    pub fn release_material(&mut self, id: &str) -> Result<bool, SurfaceRendererError> {
        if id == "builtin:default" {
            return Err(SurfaceRendererError::InvalidMaterialId {
                id: id.to_owned(),
                reason: "the default material cannot be released",
            });
        }
        Ok(self.materials.remove(id))
    }

    /// Submits an authored scene. This is the editor's path: readable JSON,
    /// convenient, and fine at document-editing rates.
    ///
    /// Games use [`set_render_frame`](Self::set_render_frame) instead, which
    /// takes the same information as packed arrays.
    pub fn set_render_world(
        &mut self,
        render_world: RenderWorld,
    ) -> Result<(), SurfaceRendererError> {
        render_world.validate()?;

        let mut view = ViewState::default();
        let default_view = render_world.camera.is_none();
        if let Some(camera) = &render_world.camera {
            view.camera_world = Mat4::from_cols_array(&camera.world_matrix);
            view.projection = camera.projection;
            view.field_of_view_degrees = camera.field_of_view;
            view.orthographic_size = camera.orthographic_size;
            view.near = camera.near;
            view.far = camera.far;
        }
        if let Some(light) = &render_world.directional_light {
            let world = Mat4::from_cols_array(&light.world_matrix);
            view.set_single_directional(
                world.transform_vector3(Vec3::NEG_Z),
                Vec3::from_array(light.color),
                light.intensity,
            );
        }

        let mut submission = Vec::with_capacity(render_world.instances.len());
        for instance in &render_world.instances {
            let material_id = if instance.material == "builtin:standard" {
                "builtin:default"
            } else {
                instance.material.as_str()
            };
            let material = self.materials.slot(material_id).ok_or_else(|| {
                SurfaceRendererError::UnknownMaterial {
                    id: material_id.to_owned(),
                }
            })?;
            let pipeline = self
                .materials
                .get(material)
                .expect("a registered material slot must be live")
                .definition
                .pipeline;
            submission.push(InstanceSubmission {
                slot: self.resolve_mesh(&instance.mesh, &instance.entity_id)?,
                material,
                pipeline,
                model: Mat4::from_cols_array(&instance.model_matrix),
                base_color: instance.base_color,
                material_params: instance.material_params,
            });
        }
        self.commit(view, default_view, submission);
        Ok(())
    }

    /// Submits a frame as packed arrays, the path a running game uses.
    ///
    /// Geometry-heavy scenes make JSON untenable: a voxel world with a thousand
    /// visible chunks would serialize hundreds of kilobytes every frame just to
    /// restate matrices. Here each array is copied once, and `mesh_table` is
    /// the only text — one entry per distinct mesh, not per instance.
    ///
    /// * `mesh_indices` — one entry per instance, indexing `mesh_table`
    /// * `matrices` — 16 floats per instance, column-major
    /// * `base_colors` — 4 floats per instance; empty means opaque white
    /// * `material_params` — 4 floats per instance; empty means the default
    ///   dielectric
    /// * `camera` — 16 matrix floats, projection mode, projection size, near, far
    /// * `light` — 3 direction floats, 3 colour floats, then intensity
    pub fn set_render_frame(&mut self, frame: RenderFrame<'_>) -> Result<(), SurfaceRendererError> {
        let RenderFrame {
            mesh_table,
            mesh_indices,
            material_table,
            material_indices,
            matrices,
            base_colors,
            material_params,
            camera,
            light,
            environment,
        } = frame;
        let count = mesh_indices.len();
        expect_len("matrices", matrices.len(), count * 16)?;
        expect_len("materialIndices", material_indices.len(), count)?;
        if !base_colors.is_empty() {
            expect_len("baseColors", base_colors.len(), count * 4)?;
        }
        if !material_params.is_empty() {
            expect_len("materialParams", material_params.len(), count * 4)?;
        }
        if count > MAX_RENDER_INSTANCES {
            return Err(RenderWorldError::TooManyInstances {
                actual: count,
                maximum: MAX_RENDER_INSTANCES,
            }
            .into());
        }

        // Resolve the small table once instead of per instance.
        let mut slots = Vec::with_capacity(mesh_table.len());
        for id in mesh_table {
            slots.push(self.resolve_mesh(id, "frame")?);
        }
        let mut material_slots = Vec::with_capacity(material_table.len());
        for id in material_table {
            material_slots.push(
                self.materials
                    .slot(id)
                    .ok_or_else(|| SurfaceRendererError::UnknownMaterial { id: id.clone() })?,
            );
        }

        let mut view = ViewState::default();
        let default_view = camera.is_empty();
        if !camera.is_empty() {
            expect_len("camera", camera.len(), 20)?;
            finite("camera", camera)?;
            let mut world = [0.0_f32; 16];
            world.copy_from_slice(&camera[..16]);
            view.camera_world = Mat4::from_cols_array(&world);
            view.projection = decode_projection(camera[16])?;
            if view.projection == CameraProjection::Perspective {
                view.field_of_view_degrees = camera[17].clamp(1.0, 179.0);
            } else {
                view.orthographic_size = camera[17].max(1e-4);
            }
            view.near = camera[18].max(1e-4);
            view.far = camera[19].max(view.near * 1.001);
        }
        if let Some(rig) = decode_light_rig(light, "light")? {
            view.lights = rig;
        }
        if let Some(environment) = decode_environment(environment, "environment")? {
            view.clear_color = environment.clear_color;
            view.fog_color_mode = environment.fog_color_mode;
            view.fog_params = environment.fog_params;
            view.sky_zenith_mode = environment.sky_zenith_mode;
            view.sky_horizon_curve = environment.sky_horizon_curve;
            view.sky_ground_sun_size = environment.sky_ground_sun_size;
        }

        let mut submission = Vec::with_capacity(count);
        for index in 0..count {
            let table_index = mesh_indices[index] as usize;
            let slot =
                *slots
                    .get(table_index)
                    .ok_or(SurfaceRendererError::MeshIndexOutOfRange {
                        instance: index,
                        index: table_index,
                        table: mesh_table.len(),
                    })?;
            let material_index = material_indices[index] as usize;
            let material = *material_slots.get(material_index).ok_or(
                SurfaceRendererError::MaterialIndexOutOfRange {
                    instance: index,
                    index: material_index,
                    table: material_table.len(),
                },
            )?;
            let mut model = [0.0_f32; 16];
            model.copy_from_slice(&matrices[index * 16..index * 16 + 16]);
            if !model.iter().all(|value| value.is_finite()) {
                return Err(RenderWorldError::NonFinite {
                    field: format!("matrices[{index}]"),
                }
                .into());
            }
            submission.push(InstanceSubmission {
                slot,
                material,
                pipeline: self
                    .materials
                    .get(material)
                    .expect("resolved material slots stay occupied during submission")
                    .definition
                    .pipeline,
                model: Mat4::from_cols_array(&model),
                base_color: read4(base_colors, index, [1.0, 1.0, 1.0, 1.0]),
                material_params: read4(material_params, index, [0.0, 0.6, 0.0, 0.01]),
            });
        }
        self.commit(view, default_view, submission);
        Ok(())
    }

    /// Atomically replaces the live frame with several camera layers. The
    /// first layer clears the presentation target; later layers may preserve
    /// colour and optionally clear depth for view models, gizmos, or overlays.
    pub fn set_render_layers(
        &mut self,
        frame: RenderLayers<'_>,
    ) -> Result<(), SurfaceRendererError> {
        let RenderLayers {
            mesh_table,
            mesh_indices,
            material_table,
            material_indices,
            matrices,
            base_colors,
            material_params,
            layer_instance_counts,
            layer_flags,
            cameras,
            lights,
            layer_light_counts,
            environments,
        } = frame;
        let layer_count = layer_instance_counts.len();
        if layer_count == 0 {
            return Err(SurfaceRendererError::InvalidRenderLayer {
                layer: 0,
                reason: "at least one layer is required",
            });
        }
        expect_len("layerFlags", layer_flags.len(), layer_count)?;
        expect_len("cameras", cameras.len(), layer_count * 20)?;
        expect_len(
            "environments",
            environments.len(),
            layer_count * ENVIRONMENT_STRIDE,
        )?;
        if !layer_light_counts.is_empty() {
            expect_len("layerLightCounts", layer_light_counts.len(), layer_count)?;
        }
        let total_lights: usize = layer_light_counts.iter().map(|value| *value as usize).sum();
        expect_len("lights", lights.len(), total_lights * LIGHT_STRIDE)?;
        if layer_flags[0] & (RENDER_LAYER_CLEAR_COLOR | RENDER_LAYER_CLEAR_DEPTH)
            != RENDER_LAYER_CLEAR_COLOR | RENDER_LAYER_CLEAR_DEPTH
        {
            return Err(SurfaceRendererError::InvalidRenderLayer {
                layer: 0,
                reason: "the first layer must clear colour and depth",
            });
        }
        let count: usize = layer_instance_counts
            .iter()
            .map(|value| *value as usize)
            .sum();
        expect_len("meshIndices", mesh_indices.len(), count)?;
        expect_len("materialIndices", material_indices.len(), count)?;
        expect_len("matrices", matrices.len(), count * 16)?;
        expect_len("baseColors", base_colors.len(), count * 4)?;
        expect_len("materialParams", material_params.len(), count * 4)?;
        if count > MAX_RENDER_INSTANCES {
            return Err(RenderWorldError::TooManyInstances {
                actual: count,
                maximum: MAX_RENDER_INSTANCES,
            }
            .into());
        }

        let mut slots = Vec::with_capacity(mesh_table.len());
        for id in mesh_table {
            slots.push(self.resolve_mesh(id, "layered frame")?);
        }
        let mut material_slots = Vec::with_capacity(material_table.len());
        for id in material_table {
            material_slots.push(
                self.materials
                    .slot(id)
                    .ok_or_else(|| SurfaceRendererError::UnknownMaterial { id: id.clone() })?,
            );
        }

        let mut layers = Vec::with_capacity(layer_count);
        let mut instance_start = 0;
        let mut light_offset = 0;
        for layer_index in 0..layer_count {
            let flags = layer_flags[layer_index];
            if flags
                & !(RENDER_LAYER_CLEAR_COLOR
                    | RENDER_LAYER_CLEAR_DEPTH
                    | RENDER_LAYER_HAS_CAMERA
                    | RENDER_LAYER_HAS_LIGHT
                    | RENDER_LAYER_HAS_ENVIRONMENT)
                != 0
            {
                return Err(SurfaceRendererError::InvalidRenderLayer {
                    layer: layer_index,
                    reason: "flags contain unknown bits",
                });
            }
            let mut view = ViewState::default();
            let default_view = flags & RENDER_LAYER_HAS_CAMERA == 0;
            if !default_view {
                let camera = &cameras[layer_index * 20..layer_index * 20 + 20];
                finite("layer camera", camera)?;
                let mut world = [0.0_f32; 16];
                world.copy_from_slice(&camera[..16]);
                view.camera_world = Mat4::from_cols_array(&world);
                view.projection = decode_projection(camera[16])?;
                if view.projection == CameraProjection::Perspective {
                    view.field_of_view_degrees = camera[17].clamp(1.0, 179.0);
                } else {
                    view.orthographic_size = camera[17].max(1e-4);
                }
                view.near = camera[18].max(1e-4);
                view.far = camera[19].max(view.near * 1.001);
            }
            if flags & RENDER_LAYER_HAS_LIGHT != 0 {
                let count = layer_light_counts
                    .get(layer_index)
                    .copied()
                    .unwrap_or_default() as usize;
                let start = light_offset * LIGHT_STRIDE;
                let slice = &lights[start..start + count * LIGHT_STRIDE];
                if let Some(rig) = decode_light_rig(slice, "layer light")? {
                    view.lights = rig;
                }
            }
            light_offset += layer_light_counts
                .get(layer_index)
                .copied()
                .unwrap_or_default() as usize;
            if flags & RENDER_LAYER_HAS_ENVIRONMENT != 0 {
                let start = layer_index * ENVIRONMENT_STRIDE;
                if let Some(environment) = decode_environment(
                    &environments[start..start + ENVIRONMENT_STRIDE],
                    "layer environment",
                )? {
                    view.clear_color = environment.clear_color;
                    view.fog_color_mode = environment.fog_color_mode;
                    view.fog_params = environment.fog_params;
                    view.sky_zenith_mode = environment.sky_zenith_mode;
                    view.sky_horizon_curve = environment.sky_horizon_curve;
                    view.sky_ground_sun_size = environment.sky_ground_sun_size;
                }
            }

            let instance_end = instance_start + layer_instance_counts[layer_index] as usize;
            let mut instances = Vec::with_capacity(instance_end - instance_start);
            for index in instance_start..instance_end {
                let mesh_index = mesh_indices[index] as usize;
                let slot =
                    *slots
                        .get(mesh_index)
                        .ok_or(SurfaceRendererError::MeshIndexOutOfRange {
                            instance: index,
                            index: mesh_index,
                            table: mesh_table.len(),
                        })?;
                let material_index = material_indices[index] as usize;
                let material = *material_slots.get(material_index).ok_or(
                    SurfaceRendererError::MaterialIndexOutOfRange {
                        instance: index,
                        index: material_index,
                        table: material_table.len(),
                    },
                )?;
                let mut model = [0.0_f32; 16];
                model.copy_from_slice(&matrices[index * 16..index * 16 + 16]);
                if !model.iter().all(|value| value.is_finite()) {
                    return Err(RenderWorldError::NonFinite {
                        field: format!("matrices[{index}]"),
                    }
                    .into());
                }
                instances.push(InstanceSubmission {
                    slot,
                    material,
                    pipeline: self
                        .materials
                        .get(material)
                        .expect("resolved material slots stay occupied during submission")
                        .definition
                        .pipeline,
                    model: Mat4::from_cols_array(&model),
                    base_color: read4(base_colors, index, [1.0; 4]),
                    material_params: read4(material_params, index, [0.0, 0.6, 0.0, 0.01]),
                });
            }
            layers.push(LayerSubmission {
                view,
                default_view,
                clear_color: flags & RENDER_LAYER_CLEAR_COLOR != 0,
                clear_depth: flags & RENDER_LAYER_CLEAR_DEPTH != 0,
                instances,
            });
            instance_start = instance_end;
        }
        self.commit_layers(layers);
        Ok(())
    }

    fn resolve_mesh(&self, id: &str, entity: &str) -> Result<usize, SurfaceRendererError> {
        self.meshes
            .slot(id)
            .ok_or_else(|| SurfaceRendererError::UnknownMesh {
                id: id.to_owned(),
                entity: entity.to_owned(),
                available: self.meshes.ids().join(", "),
            })
    }

    /// Sorts opaque instances for batching and blended instances back-to-front,
    /// then packs and uploads them. Both submission paths end here, so ordering
    /// and batching behaviour is identical for the editor and a game.
    fn commit(&mut self, view: ViewState, default_view: bool, submission: Vec<InstanceSubmission>) {
        self.commit_layers(vec![LayerSubmission {
            view,
            default_view,
            clear_color: true,
            clear_depth: true,
            instances: submission,
        }]);
    }

    fn commit_layers(&mut self, mut submissions: Vec<LayerSubmission>) {
        let total_instances: usize = submissions.iter().map(|layer| layer.instances.len()).sum();
        let mut instances = Vec::with_capacity(total_instances);
        let mut layers = Vec::with_capacity(submissions.len());
        for layer in &mut submissions {
            sort_submissions(
                &mut layer.instances,
                layer.view.camera_world.transform_point3(Vec3::ZERO),
            );
            let mut batches: Vec<DrawBatch> = Vec::new();
            for entry in layer.instances.drain(..) {
                let normal_matrix = if entry.model.determinant().abs() > f32::EPSILON {
                    entry.model.inverse().transpose()
                } else {
                    Mat4::IDENTITY
                };
                match batches.last_mut() {
                    Some(batch)
                        if batch.mesh == entry.slot
                            && batch.material == entry.material
                            && batch.pipeline == entry.pipeline =>
                    {
                        batch.instance_count += 1;
                    }
                    _ => batches.push(DrawBatch {
                        mesh: entry.slot,
                        material: entry.material,
                        pipeline: entry.pipeline,
                        first_instance: instances.len() as u32,
                        instance_count: 1,
                    }),
                }
                instances.push(InstanceData {
                    model: entry.model.to_cols_array_2d(),
                    normal_matrix: normal_matrix.to_cols_array_2d(),
                    base_color: entry.base_color,
                    material_params: entry.material_params,
                });
            }
            layers.push(RenderLayerState {
                view: layer.view.clone(),
                default_view: layer.default_view,
                clear_color: layer.clear_color,
                clear_depth: layer.clear_depth,
                batches,
            });
        }

        if instances.len() > self.instance_capacity {
            self.instance_capacity = instances.len().next_power_of_two();
            self.instance_buffer =
                create_instance_buffer(&self.context.device, self.instance_capacity);
        }
        if !instances.is_empty() {
            self.context.queue.write_buffer(
                &self.instance_buffer,
                0,
                bytemuck::cast_slice(&instances),
            );
        }
        self.instance_count = instances.len() as u32;
        while self.frame_uniforms.len() < layers.len() {
            let index = self.frame_uniforms.len();
            self.frame_uniforms.push(create_frame_gpu(
                &self.context.device,
                &self.frame_layout,
                &self.shadows,
                index,
            ));
        }
        self.layers = layers;
    }

    pub fn render(&mut self, time_seconds: f32) -> Result<FrameStats, SurfaceRendererError> {
        let started = Stopwatch::start();
        let Some(output) = self.acquire_surface_texture()? else {
            return Ok(FrameStats {
                draw_calls: 0,
                triangles: 0,
                cpu_encode_ms: started.elapsed_ms(),
            });
        };
        let shadow_cascades = self.update_uniforms(time_seconds);
        let view = output
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        let mut encoder =
            self.context
                .device
                .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("Vapour frame encoder"),
                });
        self.post_process
            .update(&self.context.queue, self.post_process_settings);
        let post_bind_group = self
            .post_process
            .bind_group(&self.context.device, &self.hdr_target.view);
        let mut draw_calls = 0;
        for pass in self.frame_graph.passes() {
            match (pass.name.as_str(), pass.kind) {
                ("directional-shadow", PassKind::Render) => {
                    if let (Some(cascades), Some(layer)) =
                        (shadow_cascades.first(), self.layers.first())
                    {
                        for (cascade_index, cascade) in cascades.iter().enumerate() {
                            self.context.queue.write_buffer(
                                &self.shadows.cascade_buffers[cascade_index],
                                0,
                                bytemuck::bytes_of(cascade),
                            );
                            let mut shadow_pass =
                                encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                                    label: Some("Vapour directional cascade depth pass"),
                                    color_attachments: &[],
                                    depth_stencil_attachment: Some(
                                        wgpu::RenderPassDepthStencilAttachment {
                                            view: &self.shadows.layer_views[cascade_index],
                                            depth_ops: Some(wgpu::Operations {
                                                load: wgpu::LoadOp::Clear(1.0),
                                                store: wgpu::StoreOp::Store,
                                            }),
                                            stencil_ops: None,
                                        },
                                    ),
                                    timestamp_writes: None,
                                    occlusion_query_set: None,
                                    multiview_mask: None,
                                });
                            shadow_pass.set_pipeline(&self.shadow_pipeline);
                            shadow_pass.set_bind_group(
                                0,
                                &self.shadows.cascade_bind_groups[cascade_index],
                                &[],
                            );
                            shadow_pass.set_vertex_buffer(1, self.instance_buffer.slice(..));
                            for batch in &layer.batches {
                                if batch.pipeline.blended() {
                                    continue;
                                }
                                let Some(mesh) = self.meshes.get(batch.mesh) else {
                                    continue;
                                };
                                shadow_pass.set_vertex_buffer(0, mesh.vertex_buffer.slice(..));
                                shadow_pass.set_index_buffer(
                                    mesh.index_buffer.slice(..),
                                    wgpu::IndexFormat::Uint32,
                                );
                                let first = batch.first_instance;
                                shadow_pass.draw_indexed(
                                    0..mesh.index_count,
                                    0,
                                    first..first + batch.instance_count,
                                );
                                draw_calls += 1;
                            }
                        }
                    }
                }
                ("standard-pbr", PassKind::Render) => {
                    for (layer_index, layer) in self.layers.iter().enumerate() {
                        let color_load = if layer.clear_color {
                            wgpu::LoadOp::Clear(wgpu::Color {
                                r: layer.view.clear_color[0] as f64,
                                g: layer.view.clear_color[1] as f64,
                                b: layer.view.clear_color[2] as f64,
                                a: layer.view.clear_color[3] as f64,
                            })
                        } else {
                            wgpu::LoadOp::Load
                        };
                        let depth_load = if layer.clear_depth {
                            wgpu::LoadOp::Clear(1.0)
                        } else {
                            wgpu::LoadOp::Load
                        };
                        let mut render_pass =
                            encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                                label: Some("Vapour layered standard PBR pass"),
                                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                                    view: &self.hdr_target.view,
                                    depth_slice: None,
                                    resolve_target: None,
                                    ops: wgpu::Operations {
                                        load: color_load,
                                        store: wgpu::StoreOp::Store,
                                    },
                                })],
                                depth_stencil_attachment: Some(
                                    wgpu::RenderPassDepthStencilAttachment {
                                        view: &self.depth_view,
                                        depth_ops: Some(wgpu::Operations {
                                            load: depth_load,
                                            store: wgpu::StoreOp::Store,
                                        }),
                                        stencil_ops: None,
                                    },
                                ),
                                timestamp_writes: None,
                                occlusion_query_set: None,
                                multiview_mask: None,
                            });
                        render_pass.set_bind_group(
                            0,
                            &self.frame_uniforms[layer_index].bind_group,
                            &[],
                        );
                        if layer.clear_color && layer.view.sky_zenith_mode[3] == 1.0 {
                            render_pass.set_pipeline(&self.sky_pipeline);
                            render_pass.draw(0..3, 0..1);
                            draw_calls += 1;
                        }
                        render_pass.set_vertex_buffer(1, self.instance_buffer.slice(..));
                        for batch in &layer.batches {
                            let Some(mesh) = self.meshes.get(batch.mesh) else {
                                continue;
                            };
                            let Some(material) = self.materials.get(batch.material) else {
                                continue;
                            };
                            let pipeline = self
                                .pipelines
                                .get(&batch.pipeline)
                                .expect("every material pipeline variant is created at startup");
                            render_pass.set_pipeline(pipeline);
                            render_pass.set_bind_group(1, &material.bind_group, &[]);
                            render_pass.set_vertex_buffer(0, mesh.vertex_buffer.slice(..));
                            render_pass.set_index_buffer(
                                mesh.index_buffer.slice(..),
                                wgpu::IndexFormat::Uint32,
                            );
                            let first = batch.first_instance;
                            render_pass.draw_indexed(
                                0..mesh.index_count,
                                0,
                                first..first + batch.instance_count,
                            );
                            draw_calls += 1;
                        }
                    }
                }
                ("tone-map", PassKind::Render) => {
                    let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                        label: Some("Vapour HDR tone-map pass"),
                        color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                            view: &view,
                            depth_slice: None,
                            resolve_target: None,
                            ops: wgpu::Operations {
                                load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                                store: wgpu::StoreOp::Store,
                            },
                        })],
                        depth_stencil_attachment: None,
                        timestamp_writes: None,
                        occlusion_query_set: None,
                        multiview_mask: None,
                    });
                    render_pass.set_pipeline(&self.post_process.pipeline);
                    render_pass.set_bind_group(0, &post_bind_group, &[]);
                    render_pass.draw(0..3, 0..1);
                    draw_calls += 1;
                }
                _ => unreachable!("compiled frame graph contains an unknown pass"),
            }
        }
        self.context.queue.submit([encoder.finish()]);
        self.context.queue.present(output);
        Ok(FrameStats {
            draw_calls,
            triangles: self.triangle_count(),
            cpu_encode_ms: started.elapsed_ms(),
        })
    }

    /// Triangles submitted this frame, summed across every batch.
    fn triangle_count(&self) -> u32 {
        self.layers
            .iter()
            .flat_map(|layer| &layer.batches)
            .filter_map(|batch| {
                Some(self.meshes.get(batch.mesh)?.index_count / 3 * batch.instance_count)
            })
            .sum()
    }

    #[must_use]
    pub const fn width(&self) -> u32 {
        self.config.width
    }

    #[must_use]
    pub const fn height(&self) -> u32 {
        self.config.height
    }

    fn update_uniforms(&self, time_seconds: f32) -> Vec<[ShadowPassUniform; SHADOW_CASCADE_COUNT]> {
        let aspect = self.config.width as f32 / self.config.height.max(1) as f32;
        let mut shadow_sets = Vec::with_capacity(self.layers.len());
        for (index, layer) in self.layers.iter().enumerate() {
            let view = &layer.view;
            let camera = view.camera_world.transform_point3(Vec3::ZERO);
            let (view_matrix, projection) = if layer.default_view {
                // With no authored camera, frame the origin so an empty scene still
                // shows something recognisable rather than a black screen.
                (
                    Mat4::look_at_rh(camera, Vec3::ZERO, Vec3::Y),
                    projection_matrix(view, aspect),
                )
            } else {
                let forward = view
                    .camera_world
                    .transform_vector3(Vec3::NEG_Z)
                    .normalize_or(Vec3::NEG_Z);
                let up = view
                    .camera_world
                    .transform_vector3(Vec3::Y)
                    .normalize_or(Vec3::Y);
                (
                    Mat4::look_to_rh(camera, forward, up),
                    projection_matrix(view, aspect),
                )
            };
            let live = view.lights.len().min(MAX_LIGHTS);
            let cascades = shadow_cascades(view, aspect);
            let shadow_count = if index == 0 && has_directional_shadow(view) {
                SHADOW_CASCADE_COUNT as f32
            } else {
                0.0
            };
            let camera_forward = view
                .camera_world
                .transform_vector3(Vec3::NEG_Z)
                .normalize_or(Vec3::NEG_Z);
            let mut lights = [GpuLight::ambient(Vec3::ZERO, 0.0); MAX_LIGHTS];
            lights[..live].copy_from_slice(&view.lights[..live]);
            let view_projection = projection * view_matrix;
            let frame = FrameUniforms {
                view_projection: view_projection.to_cols_array_2d(),
                inverse_view_projection: view_projection.inverse().to_cols_array_2d(),
                camera_position_exposure: [camera.x, camera.y, camera.z, 1.0],
                camera_forward: [camera_forward.x, camera_forward.y, camera_forward.z, 0.0],
                light_count_time: [live as f32, time_seconds, 0.0, 0.0],
                fog_color_mode: view.fog_color_mode,
                fog_params: view.fog_params,
                sky_zenith_mode: view.sky_zenith_mode,
                sky_horizon_curve: view.sky_horizon_curve,
                sky_ground_sun_size: view.sky_ground_sun_size,
                lights,
                shadow_matrices: cascades.map(|cascade| cascade.view_projection),
                shadow_splits: cascades.map(|cascade| cascade.far),
                shadow_params: [shadow_count, SHADOW_MAP_SIZE as f32, 0.0015, 0.0],
            };
            self.context.queue.write_buffer(
                &self.frame_uniforms[index].buffer,
                0,
                bytemuck::bytes_of(&frame),
            );
            shadow_sets.push(cascades);
        }
        shadow_sets
    }

    fn acquire_surface_texture(
        &mut self,
    ) -> Result<Option<wgpu::SurfaceTexture>, SurfaceRendererError> {
        use wgpu::CurrentSurfaceTexture;
        match self.surface.get_current_texture() {
            CurrentSurfaceTexture::Success(texture)
            | CurrentSurfaceTexture::Suboptimal(texture) => Ok(Some(texture)),
            CurrentSurfaceTexture::Timeout | CurrentSurfaceTexture::Occluded => Ok(None),
            CurrentSurfaceTexture::Outdated | CurrentSurfaceTexture::Lost => {
                self.surface.configure(&self.context.device, &self.config);
                match self.surface.get_current_texture() {
                    CurrentSurfaceTexture::Success(texture)
                    | CurrentSurfaceTexture::Suboptimal(texture) => Ok(Some(texture)),
                    CurrentSurfaceTexture::Timeout | CurrentSurfaceTexture::Occluded => Ok(None),
                    CurrentSurfaceTexture::Outdated => Err(SurfaceRendererError::Surface(
                        "surface remained outdated after reconfiguration".into(),
                    )),
                    CurrentSurfaceTexture::Lost => Err(SurfaceRendererError::Surface(
                        "surface remained lost after reconfiguration".into(),
                    )),
                    CurrentSurfaceTexture::Validation => Err(SurfaceRendererError::Surface(
                        "surface acquisition triggered a WebGPU validation error".into(),
                    )),
                }
            }
            CurrentSurfaceTexture::Validation => Err(SurfaceRendererError::Surface(
                "surface acquisition triggered a WebGPU validation error".into(),
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mesh::MeshVertex;

    #[test]
    fn camera_projection_modes_are_strict_and_actionable() {
        assert_eq!(
            decode_projection(0.0).unwrap(),
            CameraProjection::Perspective
        );
        assert_eq!(
            decode_projection(1.0).unwrap(),
            CameraProjection::Orthographic
        );
        assert!(matches!(
            decode_projection(2.0),
            Err(SurfaceRendererError::InvalidCameraProjection { value: 2.0 })
        ));
    }

    #[test]
    fn orthographic_projection_does_not_change_scale_with_depth() {
        let view = ViewState {
            projection: CameraProjection::Orthographic,
            orthographic_size: 10.0,
            near: 0.1,
            far: 100.0,
            ..ViewState::default()
        };
        let projection = projection_matrix(&view, 2.0);
        let near = projection.project_point3(Vec3::new(3.0, 2.0, -1.0));
        let far = projection.project_point3(Vec3::new(3.0, 2.0, -50.0));
        assert!((near.x - far.x).abs() < f32::EPSILON);
        assert!((near.y - far.y).abs() < f32::EPSILON);
    }

    /// Mirrors the grouping in `set_render_world` without needing a GPU, so
    /// batching is verified even where no adapter exists.
    fn batches_for(slots: &[usize]) -> Vec<DrawBatch> {
        let entries: Vec<_> = slots.iter().map(|slot| (*slot, 0)).collect();
        batches_for_meshes_and_materials(&entries)
    }

    fn batches_for_meshes_and_materials(entries: &[(usize, usize)]) -> Vec<DrawBatch> {
        let mut ordered = entries.to_vec();
        ordered.sort_unstable_by_key(|(mesh, material)| (*material, *mesh));
        let mut batches: Vec<DrawBatch> = Vec::new();
        for (index, (mesh, material)) in ordered.iter().enumerate() {
            match batches.last_mut() {
                Some(batch) if batch.mesh == *mesh && batch.material == *material => {
                    batch.instance_count += 1;
                }
                _ => batches.push(DrawBatch {
                    mesh: *mesh,
                    material: *material,
                    pipeline: PipelineKind::OpaqueCulled,
                    first_instance: index as u32,
                    instance_count: 1,
                }),
            }
        }
        batches
    }

    #[test]
    fn instances_sharing_a_mesh_collapse_into_one_draw() {
        let batches = batches_for(&[0, 0, 0, 0]);
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].instance_count, 4);
        assert_eq!(batches[0].first_instance, 0);
    }

    #[test]
    fn interleaved_meshes_still_produce_one_draw_each() {
        // Scene order must not affect the draw count; that is the whole point
        // of sorting before batching.
        let batches = batches_for(&[2, 0, 2, 1, 0, 2]);
        assert_eq!(batches.len(), 3, "one batch per distinct mesh");
        let total: u32 = batches.iter().map(|batch| batch.instance_count).sum();
        assert_eq!(total, 6);
        // Batches must tile the instance buffer with no gaps or overlap.
        let mut cursor = 0;
        for batch in &batches {
            assert_eq!(batch.first_instance, cursor);
            cursor += batch.instance_count;
        }
    }

    #[test]
    fn an_empty_scene_issues_no_draws() {
        assert!(batches_for(&[]).is_empty());
    }

    #[test]
    fn one_mesh_with_two_materials_forms_two_batches() {
        let batches = batches_for_meshes_and_materials(&[(3, 1), (3, 2), (3, 1)]);
        assert_eq!(batches.len(), 2);
        assert_eq!(batches[0].instance_count, 2);
        assert_eq!(batches[1].instance_count, 1);
    }

    #[test]
    fn blended_submissions_follow_opaque_and_sort_back_to_front() {
        let entry = |slot: usize, pipeline: PipelineKind, z: f32| InstanceSubmission {
            slot,
            material: slot,
            pipeline,
            model: Mat4::from_translation(Vec3::new(0.0, 0.0, z)),
            base_color: [1.0; 4],
            material_params: [0.0; 4],
        };
        let mut submissions = vec![
            entry(1, PipelineKind::BlendCulledNoDepthWrite, 2.0),
            entry(2, PipelineKind::OpaqueCulled, 9.0),
            entry(3, PipelineKind::BlendDoubleSidedNoDepthWrite, 12.0),
            entry(4, PipelineKind::BlendCulledDepthWrite, 5.0),
        ];
        sort_submissions(&mut submissions, Vec3::ZERO);
        assert_eq!(
            submissions
                .iter()
                .map(|entry| entry.slot)
                .collect::<Vec<_>>(),
            vec![2, 3, 4, 1]
        );
    }

    #[test]
    fn material_descriptors_normalize_defaults_and_reject_bad_values() {
        let material = normalize_material("test", &StandardMaterialDescriptor::default()).unwrap();
        assert_eq!(material.uniforms.base_color, [1.0; 4]);
        assert_eq!(material.filter, wgpu::FilterMode::Linear);
        let sdf = normalize_material(
            "font",
            &StandardMaterialDescriptor {
                coverage_mode: Some("sdf".into()),
                alpha_mode: Some("blend".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(sdf.uniforms.roughness_normal_occlusion_cutoff[3], 1.0);
        assert!(matches!(
            normalize_material(
                "bad-coverage",
                &StandardMaterialDescriptor {
                    coverage_mode: Some("msdf".into()),
                    ..Default::default()
                }
            ),
            Err(SurfaceRendererError::InvalidMaterialId { .. })
        ));
        let invalid = StandardMaterialDescriptor {
            normal_scale: Some(f32::NAN),
            ..Default::default()
        };
        assert!(matches!(
            normalize_material("bad", &invalid),
            Err(SurfaceRendererError::InvalidMaterialId { .. })
        ));
        let atlas = normalize_material(
            "atlas",
            &StandardMaterialDescriptor {
                atlas: Some(TextureAtlasDescriptor {
                    columns: 16,
                    rows: 96,
                    inset: Some(0.006),
                    origin: Some("top-left".into()),
                }),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(
            atlas.uniforms.atlas_grid_inset_origin,
            [16.0, 96.0, 0.006, 1.0]
        );
        let transparent = normalize_material(
            "glass",
            &StandardMaterialDescriptor {
                alpha_mode: Some("blend".into()),
                double_sided: Some(true),
                depth_write: Some(false),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(
            transparent.pipeline,
            PipelineKind::BlendDoubleSidedNoDepthWrite
        );
        assert!(
            normalize_material(
                "bad-atlas",
                &StandardMaterialDescriptor {
                    atlas: Some(TextureAtlasDescriptor {
                        columns: 0,
                        rows: 1,
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            )
            .is_err()
        );
    }

    #[test]
    fn frame_arrays_are_length_checked_before_reaching_the_gpu() {
        // These come straight from a game's typed arrays. A short matrix array
        // would otherwise read past its end into whatever follows in memory.
        assert!(matches!(
            expect_len("matrices", 31, 32),
            Err(SurfaceRendererError::FrameArrayLength {
                field: "matrices",
                actual: 31,
                expected: 32
            })
        ));
        assert!(expect_len("matrices", 32, 32).is_ok());
    }

    #[test]
    fn frame_arrays_reject_non_finite_values() {
        assert!(finite("camera", &[1.0, 2.0, 3.0]).is_ok());
        assert!(matches!(
            finite("camera", &[1.0, f32::NAN]),
            Err(SurfaceRendererError::RenderWorld(
                RenderWorldError::NonFinite { .. }
            ))
        ));
    }

    #[test]
    fn environments_validate_fog_modes_and_ranges_without_a_gpu() {
        let linear = [
            0.1, 0.2, 0.3, 1.0, 0.4, 0.5, 0.6, 1.0, 10.0, 200.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
            0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
        ];
        let decoded = decode_environment(&linear, "environment").unwrap().unwrap();
        assert_eq!(decoded.clear_color, [0.1, 0.2, 0.3, 1.0]);
        assert_eq!(decoded.fog_color_mode[3], 1.0);
        assert_eq!(decoded.fog_params[..2], [10.0, 200.0]);

        let mut invalid_range = linear;
        invalid_range[9] = 5.0;
        assert!(matches!(
            decode_environment(&invalid_range, "environment"),
            Err(SurfaceRendererError::InvalidEnvironment { .. })
        ));
        let mut invalid_mode = linear;
        invalid_mode[7] = 9.0;
        assert!(matches!(
            decode_environment(&invalid_mode, "environment"),
            Err(SurfaceRendererError::InvalidEnvironment { .. })
        ));

        let mut sky = linear;
        sky[12..16].copy_from_slice(&[0.05, 0.2, 1.4, 1.0]);
        sky[16..20].copy_from_slice(&[0.9, 0.45, 0.18, 0.7]);
        sky[20..24].copy_from_slice(&[0.03, 0.025, 0.02, 0.00465]);
        let decoded = decode_environment(&sky, "environment").unwrap().unwrap();
        assert_eq!(decoded.sky_zenith_mode, [0.05, 0.2, 1.4, 1.0]);
        let mut invalid_sun = sky;
        invalid_sun[23] = 0.0;
        assert!(decode_environment(&invalid_sun, "environment").is_err());
    }

    #[test]
    fn omitted_per_instance_arrays_fall_back_instead_of_reading_out_of_bounds() {
        // Colours and material parameters are optional in a frame submission.
        assert_eq!(read4(&[], 7, [1.0, 1.0, 1.0, 1.0]), [1.0, 1.0, 1.0, 1.0]);
        let colors = [0.0, 0.5, 1.0, 1.0, 0.25, 0.25, 0.25, 0.5];
        assert_eq!(read4(&colors, 1, [1.0; 4]), [0.25, 0.25, 0.25, 0.5]);
        // A stray NaN degrades to the fallback for that channel rather than
        // poisoning the whole frame.
        let poisoned = [f32::NAN, 0.5, 1.0, 1.0];
        assert_eq!(
            read4(&poisoned, 0, [1.0, 1.0, 1.0, 1.0]),
            [1.0, 0.5, 1.0, 1.0]
        );
    }

    #[test]
    fn instance_data_matches_the_declared_vertex_attributes() {
        // Ten vec4 attributes: 4x4 model, 4x4 normal matrix, colour, material.
        assert_eq!(
            std::mem::size_of::<InstanceData>(),
            10 * 4 * std::mem::size_of::<f32>()
        );
        assert_eq!(InstanceData::ATTRIBUTES.len(), 10);
    }

    #[test]
    fn the_registry_recycles_slots_and_replaces_in_place() {
        // Streaming a voxel world uploads and releases meshes continuously, so
        // the table must not grow without bound, and remeshing a chunk must
        // keep its slot so instances already referencing it stay valid.
        let mut registry = MeshRegistry::default();
        assert_eq!(registry.slot("chunk:0"), None);

        registry.slots.insert("chunk:0".into(), 0);
        registry.meshes.push(None);
        registry.slots.insert("chunk:1".into(), 1);
        registry.meshes.push(None);
        assert_eq!(registry.len(), 2);

        assert!(registry.remove("chunk:0"));
        assert!(!registry.remove("chunk:0"));
        assert_eq!(registry.free, vec![0]);
        assert_eq!(registry.len(), 1);
        assert_eq!(registry.ids(), vec!["chunk:1"]);
    }

    #[test]
    fn vertex_and_instance_attributes_do_not_collide() {
        // Both buffers feed one shader, so their shader locations must be
        // disjoint or pipeline creation fails at runtime.
        let vertex: Vec<u32> = <MeshVertex as VertexLayout>::ATTRIBUTES
            .iter()
            .map(|attribute| attribute.shader_location)
            .collect();
        let instance: Vec<u32> = InstanceData::ATTRIBUTES
            .iter()
            .map(|attribute| attribute.shader_location)
            .collect();
        for location in &vertex {
            assert!(
                !instance.contains(location),
                "location {location} is used twice"
            );
        }
        assert_eq!(vertex, vec![0, 1, 2, 3, 4, 5]);
        assert_eq!(instance, vec![6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    }

    /// Builds one packed light record in the wire layout the shader expects.
    fn light_record(
        kind: f32,
        vector: [f32; 3],
        color: [f32; 3],
        intensity: f32,
        secondary: [f32; 3],
        range: f32,
    ) -> Vec<f32> {
        vec![
            kind,
            vector[0],
            vector[1],
            vector[2],
            color[0],
            color[1],
            color[2],
            intensity,
            secondary[0],
            secondary[1],
            secondary[2],
            range,
            1.0,
            0.0,
            0.0,
            0.0,
        ]
    }

    #[test]
    fn an_empty_light_submission_keeps_the_default_rig() {
        assert!(decode_light_rig(&[], "light").unwrap().is_none());
        // The default must light a scene from more than one direction, or a
        // surface facing away from the key light renders as a black hole.
        let rig = default_light_rig();
        assert!(rig.len() >= 2);
        assert!(
            rig.iter()
                .any(|light| light.vector_kind[3] == LIGHT_KIND_DIRECTIONAL)
        );
        assert!(
            rig.iter()
                .any(|light| light.vector_kind[3] == LIGHT_KIND_HEMISPHERE)
        );
    }

    #[test]
    fn the_legacy_seven_float_light_still_describes_one_directional_light() {
        // Games written against the original single-light API must keep
        // working unchanged after the rig landed.
        let rig = decode_light_rig(&[0.0, -1.0, 0.0, 1.0, 0.9, 0.8, 3.0], "light")
            .unwrap()
            .expect("a rig");
        let directional = rig
            .iter()
            .find(|light| light.vector_kind[3] == LIGHT_KIND_DIRECTIONAL)
            .expect("a directional light");
        assert_eq!(directional.vector_kind[..3], [0.0, -1.0, 0.0]);
        assert_eq!(directional.color_intensity, [1.0, 0.9, 0.8, 3.0]);
        // A bare directional light gets a little fill so unlit faces read as
        // shaded rather than as holes.
        assert!(
            rig.iter()
                .any(|light| light.vector_kind[3] == LIGHT_KIND_AMBIENT)
        );
    }

    #[test]
    fn every_light_kind_survives_the_round_trip() {
        let mut packed = Vec::new();
        packed.extend(light_record(
            0.0,
            [0.0; 3],
            [0.2, 0.3, 0.4],
            1.0,
            [0.0; 3],
            0.0,
        ));
        packed.extend(light_record(
            1.0,
            [0.0, -1.0, 0.0],
            [1.0; 3],
            2.0,
            [0.0; 3],
            0.0,
        ));
        packed.extend(light_record(
            2.0,
            [4.0, 5.0, 6.0],
            [1.0, 0.5, 0.0],
            3.0,
            [0.0; 3],
            12.0,
        ));
        packed.extend(light_record(
            3.0,
            [0.0; 3],
            [0.4, 0.6, 0.9],
            0.5,
            [0.2, 0.2, 0.1],
            0.0,
        ));
        packed.extend(light_record(
            4.0,
            [1.0, 2.0, 3.0],
            [1.0; 3],
            4.0,
            [0.0, -1.0, 0.0],
            20.0,
        ));

        let rig = decode_light_rig(&packed, "light").unwrap().expect("a rig");
        assert_eq!(rig.len(), 5);
        assert_eq!(rig[0].vector_kind[3], LIGHT_KIND_AMBIENT);
        assert_eq!(rig[1].vector_kind[3], LIGHT_KIND_DIRECTIONAL);

        let point = rig[2];
        assert_eq!(point.vector_kind[3], LIGHT_KIND_POINT);
        // A point light's position must survive verbatim; normalizing it, as a
        // direction would be, would move every torch to the world origin.
        assert_eq!(point.vector_kind[..3], [4.0, 5.0, 6.0]);
        assert_eq!(point.secondary_range[3], 12.0);

        let hemisphere = rig[3];
        assert_eq!(hemisphere.vector_kind[3], LIGHT_KIND_HEMISPHERE);
        assert_eq!(hemisphere.color_intensity[..3], [0.4, 0.6, 0.9]);
        assert_eq!(hemisphere.secondary_range[..3], [0.2, 0.2, 0.1]);

        let spot = rig[4];
        assert_eq!(spot.vector_kind[3], LIGHT_KIND_SPOT);
        assert_eq!(spot.vector_kind[..3], [1.0, 2.0, 3.0]);
        assert_eq!(spot.secondary_range[..3], [0.0, -1.0, 0.0]);
    }

    #[test]
    fn a_spot_cone_is_ordered_so_the_falloff_span_stays_positive() {
        // An inner cosine below the outer one would divide by a negative span
        // and light the world inside out.
        let mut record = light_record(4.0, [0.0; 3], [1.0; 3], 1.0, [0.0, -1.0, 0.0], 10.0);
        record[12] = 0.2;
        record[13] = 0.9;
        let rig = decode_light_rig(&record, "light").unwrap().expect("a rig");
        assert!(rig[0].cone[0] >= rig[0].cone[1]);
    }

    #[test]
    fn a_partial_light_record_is_rejected_rather_than_read_out_of_bounds() {
        let error = decode_light_rig(&[1.0; 20], "light").unwrap_err();
        assert!(matches!(
            error,
            SurfaceRendererError::FrameArrayLength { field: "light", .. }
        ));
    }

    #[test]
    fn a_rig_larger_than_the_shader_array_is_refused() {
        // Silently dropping the surplus would lose lighting without saying so.
        let packed = vec![0.0_f32; (MAX_LIGHTS + 1) * LIGHT_STRIDE];
        let error = decode_light_rig(&packed, "light").unwrap_err();
        assert!(matches!(
            error,
            SurfaceRendererError::TooManyLights {
                limit: MAX_LIGHTS,
                ..
            }
        ));
    }

    #[test]
    fn a_light_rig_fits_the_shader_uniform_block() {
        // The uniform array is fixed size; if the Rust struct and the WGSL
        // block disagree the GPU reads whatever follows in the buffer.
        assert_eq!(size_of::<GpuLight>(), 64);
        assert_eq!(
            size_of::<FrameUniforms>(),
            64 + 64
                + 16
                + 16
                + 16
                + 16
                + 16
                + 16
                + 16
                + 16
                + MAX_LIGHTS * 64
                + SHADOW_CASCADE_COUNT * 64
                + 16
                + 16
        );
    }

    #[test]
    fn a_non_finite_light_is_rejected() {
        let mut record = light_record(1.0, [0.0, -1.0, 0.0], [1.0; 3], 1.0, [0.0; 3], 0.0);
        record[5] = f32::NAN;
        assert!(decode_light_rig(&record, "light").is_err());
    }
}
