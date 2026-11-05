// Runs against the real registry and GGUF loader, using the distributed GGML DLLs.
#include "model-registry.h"
#include "gguf-weights.h"
#include <cstring>

int desktop_main(int argc, char ** argv) {
    if (argc != 3) return 2;
    printf("Windows ANSI codepage: %u\n", GetACP());
    const std::string folder = argv[1];
    const std::string filename = argv[2];
    ModelRegistry registry;
    if (!registry_scan(&registry, folder.c_str()) || registry.lm.size() != 1) return 3;
    const auto & entry = registry.lm.front();
    if (entry.name != filename || !registry_is_file(entry.path.c_str())) return 4;
    if (registry_is_file(folder.c_str())) return 5;
    GGUFModel model;
    if (!gf_load(&model, entry.path.c_str())) return 6;
    const auto tensor = ggml_get_tensor(model.meta, "test.weight");
    if (!tensor || ggml_nelements(tensor) != 1) { gf_close(&model); return 7; }
    float weight = 0;
    memcpy(&weight, model.mapping + model.data_offset, sizeof(weight));
    gf_close(&model);
    if (weight != 0.5f) return 8;
    std::vector<std::string> subdirs;
    registry_list_subdirs(folder.c_str(), &subdirs);
    if (subdirs.size() != 1 || subdirs[0] != filename + ".dir") return 9;
    printf("Unicode registry, file attributes and mapped GGUF weight passed: %s\n", entry.path.c_str());
    return 0;
}
