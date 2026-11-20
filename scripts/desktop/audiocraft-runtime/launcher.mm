#include <Python.h>

#include <cstdio>
#include <filesystem>
#include <mach-o/dyld.h>
#include <stdexcept>
#include <vector>

namespace {
std::filesystem::path executable_path() {
    uint32_t size = 0;
    _NSGetExecutablePath(nullptr, &size);
    std::vector<char> path(size);
    if (_NSGetExecutablePath(path.data(), &size) != 0) {
        throw std::runtime_error("Could not locate the AudioCraft launcher");
    }
    return std::filesystem::canonical(path.data());
}

void check(PyStatus status) {
    if (PyStatus_Exception(status)) {
        Py_ExitStatusException(status);
    }
}
}  // namespace

int main(int argc, char **argv) {
    try {
        const auto executable = executable_path();
        const auto folder = executable.parent_path();
        const auto home = folder / "python";
        const auto script = folder / "audiocraft_synth.py";

        PyPreConfig preconfig;
        PyPreConfig_InitIsolatedConfig(&preconfig);
        preconfig.utf8_mode = 1;
        check(Py_PreInitialize(&preconfig));

        PyConfig config;
        PyConfig_InitIsolatedConfig(&config);
        config.write_bytecode = 0;
        check(PyConfig_SetBytesString(&config, &config.program_name, executable.c_str()));
        check(PyConfig_SetBytesString(&config, &config.home, home.c_str()));
        check(PyConfig_SetBytesString(&config, &config.run_filename, script.c_str()));
        check(PyConfig_SetBytesArgv(&config, argc, argv));
        check(Py_InitializeFromConfig(&config));
        PyConfig_Clear(&config);

        // CPython runs in the process that resolved the model-folder bookmark.
        return Py_RunMain();
    } catch (const std::exception &error) {
        std::fprintf(stderr, "AudioCraft launcher: %s\n", error.what());
        return 1;
    }
}
