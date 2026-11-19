import { cp, stat } from "node:fs/promises";
import path from "node:path";
import { download, run, target } from "./common.mjs";

export const soxrVersion = "0.1.3";
const sourceFolder = `soxr-${soxrVersion}-Source`;
const sourceArchive = `${sourceFolder}.tar.xz`;
const sourceUrl = `https://downloads.sourceforge.net/project/soxr/${sourceArchive}`;
const sourceSha256 = "b111c15fdc8c029989330ff559184198c161100a59312f5dc19ddeb9b5a15889";

export async function prepareAudioCppSoxr(folder, cache, work) {
  const archive = path.join(cache, sourceArchive);
  await download(sourceUrl, archive, sourceSha256);
  if ((await stat(archive)).size !== 94384) throw new Error("Wrong size for pinned SOXR source archive");

  const source = path.join(work, sourceFolder);
  const build = path.join(work, "soxr-build");
  const library = path.join(folder, "libsoxr.dylib");
  await run("tar", ["-xf", archive, "-C", work]);
  await run("cmake", [
    "-S", source, "-B", build, "-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_POLICY_VERSION_MINIMUM=3.5",
    "-DCMAKE_OSX_ARCHITECTURES=arm64", `-DCMAKE_OSX_DEPLOYMENT_TARGET=${target.minimumSystemVersion}`,
    "-DBUILD_SHARED_LIBS=ON", "-DBUILD_TESTS=OFF", "-DBUILD_EXAMPLES=OFF", "-DWITH_OPENMP=OFF",
    "-DWITH_CR32S=OFF", "-DWITH_CR64S=OFF", "-DWITH_LSR_BINDINGS=OFF",
  ]);
  await run("cmake", ["--build", build, "--config", "Release", "--target", "soxr", "--parallel", "4"]);
  await cp(path.join(build, "src/libsoxr.dylib"), library, { dereference: true });
  await run("install_name_tool", ["-id", "libsoxr.dylib", library]);
  await run("codesign", ["--force", "--sign", "-", library]);
  await cp(path.join(source, "COPYING.LGPL"), path.join(folder, "LICENSE.soxr"));
  await cp(archive, path.join(folder, sourceArchive));
}
