import cuda from "../../models/cuda-linux.json" with { type: "json" };

// Native builds only: the engine, Rust app and helpers must share the same architecture.
export function desktopTarget(platform, arch, linuxBackend = "vulkan") {
  if (platform === "macos" && (arch === "arm64" || arch === "x64")) {
    const cpuOnly = arch === "x64";
    const minimumSystemVersion = cpuOnly ? "12.7" : "14.0";
    const titleCmake = [
      `-DCMAKE_OSX_ARCHITECTURES=${cpuOnly ? "x86_64" : "arm64"}`,
      `-DCMAKE_OSX_DEPLOYMENT_TARGET=${minimumSystemVersion}`,
      // The Apple BLAS backend calls the new LAPACK interface introduced in macOS 13.3.
      ...(cpuOnly ? ["-DGGML_BLAS=OFF"] : []),
    ];
    return {
      platform, arch, cpuOnly, minimumSystemVersion, titleCmake,
      cmake: [
        `-DGGML_METAL=${cpuOnly ? "OFF" : "ON"}`, "-DGGML_BACKEND_DL=ON", "-DGGML_NATIVE=OFF",
        ...(cpuOnly ? ["-DGGML_CPU_ALL_VARIANTS=ON"] : []),
        ...titleCmake,
        "-DCMAKE_BUILD_RPATH=@loader_path", "-DCMAKE_INSTALL_RPATH=@loader_path",
      ],
    };
  }
  if (platform === "linux" && arch === "x64") {
    if (!["vulkan", "cuda"].includes(linuxBackend)) throw new Error(`Unsupported Linux backend: ${linuxBackend}`);
    const useCuda = linuxBackend === "cuda";
    return {
      platform, arch, cpuOnly: false, backend: linuxBackend,
      artifactSuffix: useCuda ? "linux-x64-cuda.AppImage" : "linux-x64.AppImage",
      cmake: [
        `-DGGML_VULKAN=${useCuda ? "OFF" : "ON"}`, `-DGGML_CUDA=${useCuda ? "ON" : "OFF"}`,
        "-DGGML_BACKEND_DL=ON", "-DGGML_CPU_ALL_VARIANTS=ON", "-DGGML_NATIVE=OFF",
        "-DCMAKE_BUILD_RPATH=$ORIGIN", "-DCMAKE_INSTALL_RPATH=$ORIGIN",
        ...(useCuda ? ["-DGGML_CUDA_NO_VMM=ON", `-DCMAKE_CUDA_ARCHITECTURES=${cuda.architectures.join(";")}`] : []),
      ],
    };
  }
  if (platform === "windows" && arch === "x64") return { platform, arch, cpuOnly: false };
  throw new Error(`Unsupported desktop target: ${platform}/${arch}`);
}
