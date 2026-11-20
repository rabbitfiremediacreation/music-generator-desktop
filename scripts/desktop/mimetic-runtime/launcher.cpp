#include <Python.h>
#include <mach-o/dyld.h>

#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <string>
#include <vector>

int main(int argc, char **argv) {
    uint32_t size = 0;
    _NSGetExecutablePath(nullptr, &size);
    std::vector<char> executable(size);
    if (_NSGetExecutablePath(executable.data(), &size) != 0) {
        std::fprintf(stderr, "Could not locate the Mimetic A0 executable\n");
        return 1;
    }
    std::error_code error;
    auto path = std::filesystem::canonical(executable.data(), error);
    if (error) {
        std::fprintf(stderr, "Could not resolve the Mimetic A0 executable: %s\n", error.message().c_str());
        return 1;
    }
    const std::string program = path.string();
    const std::string home = (path.parent_path() / "mimetic-python").string();
    std::string script = (path.parent_path() / "mimetic-python" / "generate_clip.py").string();

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
