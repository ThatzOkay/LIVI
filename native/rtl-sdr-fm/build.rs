use std::env;

fn main() {
  napi_build::setup();
  // Real librtlsdr, used as a fallback for tuner chips rs_rtl doesn't drive
  // (e.g. Fitipower FC0013-based dongles like the TerraTec NOXON DAB/DAB+ stick).
  link_librtlsdr();
}

fn link_librtlsdr() {
  // `CARGO_CFG_TARGET_OS` reflects the actual compilation target, unlike
  // `cfg!()` which would reflect this build script's own host target.
  match env::var("CARGO_CFG_TARGET_OS").unwrap_or_default().as_str() {
    "windows" => link_librtlsdr_windows(),
    _ => link_librtlsdr_pkg_config(),
  }
}

/// Linux distro packages and the macOS Homebrew formula both ship a
/// `librtlsdr.pc` file, so one pkg-config probe covers both platforms — the
/// same approach `native/gst-video`'s binding.gyp uses for GStreamer.
fn link_librtlsdr_pkg_config() {
  if pkg_config::Config::new().probe("librtlsdr").is_ok() {
    return;
  }
  // No pkg-config file installed, but the library may still be on the default
  // linker search path (e.g. a manually built/installed librtlsdr).
  println!("cargo:rustc-link-lib=dylib=rtlsdr");
}

/// There's no official librtlsdr installer for Windows that sets a standard
/// env var, so this follows the same convention `native/gst-video` uses for
/// GStreamer (`GSTREAMER_1_0_ROOT_MSVC_X86_64`): point `RTLSDR_DIR` at a
/// directory containing `lib/rtlsdr.lib` (e.g. a vcpkg install or the osmocom
/// release zip).
fn link_librtlsdr_windows() {
  if let Ok(dir) = env::var("RTLSDR_DIR") {
    println!("cargo:rustc-link-search=native={dir}/lib");
  }
  println!("cargo:rustc-link-lib=dylib=rtlsdr");
}
