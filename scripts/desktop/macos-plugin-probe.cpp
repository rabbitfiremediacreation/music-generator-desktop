#include <cstdio>
#include <dlfcn.h>

int main(int argc, char **argv) {
    if (argc < 2) return 2;
    void *library = dlopen(argv[1], RTLD_NOW | RTLD_LOCAL);
    if (!library) {
        std::fprintf(stderr, "%s\n", dlerror());
        return 2;
    }
    auto entry = reinterpret_cast<int (*)(int, char **)>(
        dlsym(library, "music_generator_engine_main_v1"));
    if (!entry) {
        std::fprintf(stderr, "%s\n", dlerror());
        return 2;
    }
    return entry(argc - 1, argv + 1);
}
