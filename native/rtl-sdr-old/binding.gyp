{
  "targets": [{
    "target_name": "rtl-sdr",
    "sources": ["src/rtl-sdr.cc"],
    "include_dirs": [
      "<!@(node -p \"require('node-addon-api').include\")",
      "/usr/include"
    ],
    "libraries": ["-lrtlsdr"],
    "cflags!": ["-fno-exceptions"],
    "cflags_cc!": ["-fno-exceptions"],
    "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"]
  }]
}
