#![deny(clippy::all)]

use napi_derive::napi;
use rs_rtl::{DeviceDescriptors, DeviceId};

#[napi]
pub fn get_device_count() -> u32 {
  DeviceDescriptors::new()
    .map(|d| d.len() as u32)
    .unwrap_or(0)
}
