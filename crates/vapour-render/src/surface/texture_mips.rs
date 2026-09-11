//! Import-time RGBA8 mip generation. Colour is filtered in linear light;
//! non-power-of-two footprints include edge texels rather than dropping them.
pub(crate) fn mip_chain(width: u32, height: u32, pixels: &[u8], srgb: bool) -> (u32, Vec<u8>) {
    let mut output = pixels.to_vec();
    let (mut w, mut h, mut offset, mut levels) = (width, height, 0, 1);
    while w > 1 || h > 1 {
        let nw = (w / 2).max(1);
        let nh = (h / 2).max(1);
        let mut next = vec![0; (nw * nh * 4) as usize];
        for y in 0..nh {
            for x in 0..nw {
                let (x0, x1) = (x * w / nw, (x + 1) * w / nw);
                let (y0, y1) = (y * h / nh, (y + 1) * h / nh);
                for channel in 0..4 {
                    let mut sum = 0.0;
                    for sy in y0..y1 {
                        for sx in x0..x1 {
                            let value = output[offset + ((sy * w + sx) * 4 + channel) as usize]
                                as f32
                                / 255.0;
                            sum += if srgb && channel < 3 {
                                to_linear(value)
                            } else {
                                value
                            };
                        }
                    }
                    let mean = sum / ((x1 - x0) * (y1 - y0)) as f32;
                    let value = if srgb && channel < 3 {
                        to_srgb(mean)
                    } else {
                        mean
                    };
                    next[((y * nw + x) * 4 + channel) as usize] =
                        (value * 255.0).round().clamp(0.0, 255.0) as u8;
                }
            }
        }
        offset = output.len();
        output.extend(next);
        w = nw;
        h = nh;
        levels += 1;
    }
    (levels, output)
}
fn to_linear(x: f32) -> f32 {
    if x <= 0.04045 {
        x / 12.92
    } else {
        ((x + 0.055) / 1.055).powf(2.4)
    }
}
fn to_srgb(x: f32) -> f32 {
    if x <= 0.0031308 {
        x * 12.92
    } else {
        1.055 * x.powf(1.0 / 2.4) - 0.055
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn colours_average_in_linear_light_but_alpha_and_data_do_not() {
        let pixels = [0, 0, 0, 0, 255, 255, 255, 255];
        let (levels, colour) = mip_chain(2, 1, &pixels, true);
        assert_eq!(levels, 2);
        assert_eq!(&colour[8..], &[188, 188, 188, 128]);
        assert_eq!(&mip_chain(2, 1, &pixels, false).1[8..], &[128; 4]);
    }
    #[test]
    fn odd_edge_and_single_dimension_are_preserved() {
        let pixels = [0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255];
        assert_eq!(&mip_chain(1, 3, &pixels, false).1[12..], &[85, 85, 85, 255]);
        let (levels, data) = mip_chain(7, 5, &vec![127; 7 * 5 * 4], true);
        assert_eq!(levels, 3);
        assert_eq!(data.len(), (35 + 6 + 1) * 4);
        assert!(data.iter().all(|x| *x == 127));
    }
}
