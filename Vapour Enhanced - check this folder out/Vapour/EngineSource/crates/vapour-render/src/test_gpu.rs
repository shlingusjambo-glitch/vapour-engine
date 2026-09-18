//! Headless GPU support for tests: a real device when the machine has one,
//! and readback helpers. Tests that need a device skip with a printed notice
//! when no adapter exists (a CI runner without a GPU); they never pass by
//! pretending.

use std::future::Future;
use std::pin::pin;
use std::task::{Context, Poll, Waker};

pub(crate) fn block_on<F: Future>(future: F) -> F::Output {
    let mut future = pin!(future);
    let mut context = Context::from_waker(Waker::noop());
    loop {
        if let Poll::Ready(output) = future.as_mut().poll(&mut context) {
            return output;
        }
        std::thread::yield_now();
    }
}

pub(crate) struct TestGpu {
    pub(crate) device: wgpu::Device,
    pub(crate) queue: wgpu::Queue,
    pub(crate) capabilities: crate::RenderCapabilities,
}

/// A real headless device, or `None` when this machine has no adapter.
pub(crate) fn device() -> Option<TestGpu> {
    let instance = wgpu::Instance::default();
    let adapter = block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::HighPerformance,
        force_fallback_adapter: false,
        compatible_surface: None,
        apply_limit_buckets: true,
    }));
    let Ok(adapter) = adapter else {
        eprintln!("SKIPPED: no WebGPU adapter available on this machine");
        return None;
    };
    let capabilities = crate::RenderCapabilities::from_adapter(&adapter);
    let features = capabilities.optional_features() & adapter.features();
    let (device, queue) = block_on(adapter.request_device(&wgpu::DeviceDescriptor {
        label: Some("Vapour test device"),
        required_features: features,
        required_limits: wgpu::Limits::default().using_resolution(adapter.limits()),
        ..Default::default()
    }))
    .expect("an adapter that exists must yield a device");
    Some(TestGpu {
        device,
        queue,
        capabilities,
    })
}

impl TestGpu {
    /// Copies one mip/layer of an `rgba16float` texture back to the CPU.
    pub(crate) fn read_rgba16f(
        &self,
        texture: &wgpu::Texture,
        mip: u32,
        layer: u32,
        width: u32,
        height: u32,
    ) -> Vec<[f32; 4]> {
        let bytes = self.read_texture(texture, mip, layer, width, height, 8);
        bytes
            .chunks_exact(8)
            .map(|texel| {
                let mut out = [0.0; 4];
                for (channel, half) in texel.chunks_exact(2).enumerate() {
                    out[channel] = half_to_f32(u16::from_le_bytes([half[0], half[1]]));
                }
                out
            })
            .collect()
    }

    pub(crate) fn read_texture(
        &self,
        texture: &wgpu::Texture,
        mip: u32,
        layer: u32,
        width: u32,
        height: u32,
        bytes_per_texel: u32,
    ) -> Vec<u8> {
        let unpadded = width * bytes_per_texel;
        let padded = unpadded.next_multiple_of(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT);
        let staging = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("readback"),
            size: (padded * height) as u64,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor { label: None });
        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture,
                mip_level: mip,
                origin: wgpu::Origin3d {
                    x: 0,
                    y: 0,
                    z: layer,
                },
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &staging,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(padded),
                    rows_per_image: Some(height),
                },
            },
            wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
        );
        self.queue.submit([encoder.finish()]);
        let bytes = self.read_buffer_padded(&staging, padded, unpadded, height);
        bytes
    }

    pub(crate) fn read_buffer(&self, buffer: &wgpu::Buffer, size: u64) -> Vec<u8> {
        let staging = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("readback"),
            size,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor { label: None });
        encoder.copy_buffer_to_buffer(buffer, 0, &staging, 0, size);
        self.queue.submit([encoder.finish()]);
        self.read_buffer_padded(&staging, size as u32, size as u32, 1)
    }

    fn read_buffer_padded(
        &self,
        staging: &wgpu::Buffer,
        padded_row: u32,
        unpadded_row: u32,
        rows: u32,
    ) -> Vec<u8> {
        let slice = staging.slice(..);
        let (sender, receiver) = std::sync::mpsc::channel();
        slice.map_async(wgpu::MapMode::Read, move |result| {
            sender.send(result).expect("receiver alive");
        });
        self.device
            .poll(wgpu::PollType::wait_indefinitely())
            .expect("device poll");
        receiver
            .recv()
            .expect("map callback")
            .expect("buffer mapped");
        let data = slice.get_mapped_range().expect("mapped range");
        let mut out = Vec::with_capacity((unpadded_row * rows) as usize);
        for row in 0..rows {
            let start = (row * padded_row) as usize;
            out.extend_from_slice(&data[start..start + unpadded_row as usize]);
        }
        drop(data);
        staging.unmap();
        out
    }
}

pub(crate) fn half_to_f32(half: u16) -> f32 {
    let sign = if half & 0x8000 != 0 { -1.0 } else { 1.0 };
    let exponent = ((half >> 10) & 0x1f) as i32;
    let mantissa = (half & 0x3ff) as f32;
    match exponent {
        0 => sign * mantissa * 2f32.powi(-24),
        31 => {
            if mantissa == 0.0 {
                sign * f32::INFINITY
            } else {
                f32::NAN
            }
        }
        _ => sign * (1.0 + mantissa / 1024.0) * 2f32.powi(exponent - 15),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn half_floats_decode() {
        assert_eq!(half_to_f32(0x3c00), 1.0);
        assert_eq!(half_to_f32(0xc000), -2.0);
        assert_eq!(half_to_f32(0x3800), 0.5);
        assert_eq!(half_to_f32(0x0000), 0.0);
        assert!((half_to_f32(0x3555) - 0.333252).abs() < 1e-5);
    }
}
