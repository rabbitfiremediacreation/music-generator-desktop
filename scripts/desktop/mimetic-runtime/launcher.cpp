#include <Python.h>

#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <string>

extern "C" int music_generator_engine_main_v1(int argc, char **argv) {
    const std::filesystem::path path(argv[0]);
    const std::string program = path.string();
    const auto runtime = path.parent_path() / "pytorch";
    const std::string home = runtime.string();
    std::string script = (runtime / "generate_clip.py").string();

    PyConfig config;
    PyConfig_InitIsolatedConfig(&config);
    config.parse_argv = 0;
    config.write_bytecode = 0;
    config.buffered_stdio = 0;
    argv[0] = script.data();
    PyStatus status = PyConfig_SetBytesArgv(&config, argc, argv);
    if (!PyStatus_Exception(status)) status = PyConfig_SetBytesString(&config, &config.program_name, program.c_str());
    if (!PyStatus_Exception(status)) status = PyConfig_SetBytesString(&config, &config.home, home.c_str());
    if (!PyStatus_Exception(status)) status = Py_InitializeFromConfig(&config);
    PyConfig_Clear(&config);
    if (PyStatus_Exception(status)) Py_ExitStatusException(status);

    FILE *file = std::fopen(script.c_str(), "rb");
    if (!file) {
        std::perror(script.c_str());
        std::_Exit(EXIT_FAILURE);
    }
    const int result = PyRun_SimpleFileExFlags(file, script.c_str(), 1, nullptr);
    std::fflush(nullptr);
    // The script closes the WAV and removes its temporary files before returning.
    // Skip native ML-library teardown during CPython finalization in this one-shot worker.
    std::_Exit(result == 0 ? EXIT_SUCCESS : EXIT_FAILURE);
}
