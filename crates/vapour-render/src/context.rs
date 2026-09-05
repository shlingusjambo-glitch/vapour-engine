use thiserror::Error;

use crate::RenderCapabilities;

#[derive(Debug, Clone, Copy)]
pub struct GpuRequest {
    pub power_preference: wgpu::PowerPreference,
    pub force_fallback_adapter: bool,
}

impl Default for GpuRequest {
    fn default() -> Self {
        Self {
            power_preference: wgpu::PowerPreference::HighPerformance,
            force_fallback_adapter: false,
        }
    }
}

#[derive(Debug, Error)]
pub enum GpuContextError {
    #[error("WebGPU could not find a compatible graphics adapter: {0}")]
    Adapter(#[from] wgpu::RequestAdapterError),
    #[error("WebGPU could not create a logical device: {0}")]
    Device(#[from] wgpu::RequestDeviceError),
}

pub struct GpuContext {
    pub instance: wgpu::Instance,
    pub adapter: wgpu::Adapter,
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
    pub capabilities: RenderCapabilities,
}

impl GpuContext {
    pub async fn request(
        surface: Option<&wgpu::Surface<'_>>,
        request: GpuRequest,
    ) -> Result<Self, GpuContextError> {
        let instance = wgpu::Instance::default();
        Self::request_from_instance(instance, surface, request).await
    }

    pub async fn request_from_instance(
        instance: wgpu::Instance,
        surface: Option<&wgpu::Surface<'_>>,
        request: GpuRequest,
    ) -> Result<Self, GpuContextError> {
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: request.power_preference,
                force_fallback_adapter: request.force_fallback_adapter,
                compatible_surface: surface,
                apply_limit_buckets: true,
            })
            .await?;
        let capabilities = RenderCapabilities::from_adapter(&adapter);
        let enabled_features = capabilities.optional_features() & adapter.features();
        let limits = wgpu::Limits::downlevel_webgl2_defaults().using_resolution(adapter.limits());
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("Vapour WebGPU device"),
                required_features: enabled_features,
                required_limits: limits,
                ..Default::default()
            })
            .await?;
        Ok(Self {
            instance,
            adapter,
            device,
            queue,
            capabilities,
        })
    }
}
