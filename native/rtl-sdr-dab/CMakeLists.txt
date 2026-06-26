cmake_minimum_required(VERSION 3.15)
project(rtl_sdr_dab)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
# welle_backend/fec are static libs linked into the rtl_sdr_dab.node shared
# library, so they need position-independent code too.
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# cmake-js boilerplate
include_directories(${CMAKE_JS_INC})

# node-addon-api headers (no exceptions)
execute_process(
  COMMAND node -p "require('node-addon-api').include"
  WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}
  OUTPUT_VARIABLE NODE_ADDON_API_DIR
  OUTPUT_STRIP_TRAILING_WHITESPACE
)
string(REPLACE "\"" "" NODE_ADDON_API_DIR ${NODE_ADDON_API_DIR})
include_directories(${NODE_ADDON_API_DIR})
add_definitions(-DNAPI_DISABLE_CPP_EXCEPTIONS)

# ── welle.io backend ─────────────────────────────────────────────────────────
set(WELLE_SRC_DIR ${CMAKE_SOURCE_DIR}/vendor/welle.io/src)
set(WELLE_BACKEND_DIR ${WELLE_SRC_DIR}/backend)
set(WELLE_VARIOUS_DIR ${WELLE_SRC_DIR}/various)
set(WELLE_INPUT_DIR ${WELLE_SRC_DIR}/input)
set(WELLE_FEC_DIR ${WELLE_SRC_DIR}/libs/fec)

# ka9q-fec (Reed-Solomon FEC used by the DAB+ decoder). Built directly from
# its three sources rather than add_subdirectory()'ing its own CMakeLists,
# which also wires up unrelated speed-test/unit-test executables we don't need.
add_library(fec STATIC
  ${WELLE_FEC_DIR}/encode_rs_char.c
  ${WELLE_FEC_DIR}/decode_rs_char.c
  ${WELLE_FEC_DIR}/init_rs_char.c
)
set_target_properties(fec PROPERTIES LINKER_LANGUAGE C)

file(GLOB WELLE_BACKEND_SOURCES
  ${WELLE_BACKEND_DIR}/*.cpp
)

# fft.h (used unconditionally by the backend) only declares fft::Forward /
# fft::Backward — their fftwf-backed implementations live in fft.cpp.
add_library(welle_backend STATIC
  ${WELLE_BACKEND_SOURCES}
  ${WELLE_VARIOUS_DIR}/fft.cpp
)

target_include_directories(welle_backend PUBLIC
  ${WELLE_BACKEND_DIR}
  ${WELLE_SRC_DIR}
  ${WELLE_VARIOUS_DIR}
  ${WELLE_INPUT_DIR}
  ${WELLE_FEC_DIR}
)

target_link_libraries(welle_backend fec)

# system deps for welle.io backend
find_package(PkgConfig REQUIRED)
pkg_check_modules(FFTW3F REQUIRED fftw3f)
pkg_check_modules(FAAD REQUIRED faad2)
pkg_check_modules(MPG123 REQUIRED libmpg123)

target_include_directories(welle_backend PUBLIC
  ${FFTW3F_INCLUDE_DIRS}
  ${FAAD_INCLUDE_DIRS}
  ${MPG123_INCLUDE_DIRS}
)

target_link_directories(welle_backend PUBLIC
  ${FFTW3F_LIBRARY_DIRS}
  ${FAAD_LIBRARY_DIRS}
  ${MPG123_LIBRARY_DIRS}
)

target_link_libraries(welle_backend
  ${FFTW3F_LIBRARIES}
  ${FAAD_LIBRARIES}
  ${MPG123_LIBRARIES}
)

target_compile_options(welle_backend PRIVATE
  -O2
  -DDABLIN_AAC_FAAD2
)

# ── RTL-SDR ──────────────────────────────────────────────────────────────────
pkg_check_modules(RTLSDR REQUIRED librtlsdr)

# ── addon ────────────────────────────────────────────────────────────────────
# Uses welle.io's own CRTL_SDR input (vendor/welle.io/src/input/rtl_sdr.cpp)
# rather than a hand-rolled RTL-SDR wrapper.
add_library(${PROJECT_NAME} SHARED
  src/addon.cpp
  src/dab_controller.cpp
  ${WELLE_INPUT_DIR}/rtl_sdr.cpp
  ${CMAKE_JS_SRC}
)

set_target_properties(${PROJECT_NAME} PROPERTIES
  PREFIX ""
  SUFFIX ".node"
)

target_include_directories(${PROJECT_NAME} PRIVATE
  ${WELLE_BACKEND_DIR}
  ${RTLSDR_INCLUDE_DIRS}
)

target_link_directories(${PROJECT_NAME} PRIVATE
  ${RTLSDR_LIBRARY_DIRS}
)

target_link_libraries(${PROJECT_NAME}
  ${CMAKE_JS_LIB}
  welle_backend
  ${RTLSDR_LIBRARIES}
)
