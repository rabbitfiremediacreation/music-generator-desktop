// Exercises the production registry and GGUF reader without loading model weights.
#include "model-registry.h"

#ifdef _WIN32
int desktop_main(int argc, char ** argv) {
#else
int main(int argc, char ** argv) {
#endif
    if (argc != 2) return 2;
    ModelRegistry registry;
    const bool found = registry_scan(&registry, argv[1]);
    printf("%d %zu %zu %zu %zu\n", found ? 1 : 0, registry.lm.size(),
           registry.dit.size(), registry.text_enc.size(), registry.vae.size());
    return 0;
}
