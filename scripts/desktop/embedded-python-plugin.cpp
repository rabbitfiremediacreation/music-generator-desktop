#include <Python.h>

#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <stdexcept>

#ifndef MUSIC_PYTHON_SCRIPT
#error MUSIC_PYTHON_SCRIPT must name the bundled script
#endif

#ifndef MUSIC_PYTHON_HOME
#define MUSIC_PYTHON_HOME "python"
#endif

namespace {
void check(PyStatus status) {
    if (PyStatus_Exception(status)) {
        Py_ExitStatusException(status);
    }
}
}  // namespace

extern "C" int music_generator_engine_main_v1(int argc, char **argv) {
    try {
        const std::filesystem::path executable(argv[0]);
        const auto folder = executable.parent_path();
        const auto home = (folder / MUSIC_PYTHON_HOME).lexically_normal();
        const auto script = folder / MUSIC_PYTHON_SCRIPT;

        // A packaged runner accesses models through the native sandbox grant.
        unsetenv("MUSIC_MODEL_BOOKMARK");

        PyPreConfig preconfig;
        PyPreConfig_InitIsolatedConfig(&preconfig);
        preconfig.utf8_mode = 1;
        check(Py_PreInitialize(&preconfig));

        PyConfig config;
        PyConfig_InitIsolatedConfig(&config);
        config.parse_argv = 0;
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
        std::fprintf(stderr, "Embedded Python plug-in: %s\n", error.what());
        return 1;
    }
}
