#include "desktop-windows-paths.h"
#include <vector>

int desktop_main(int argc, char ** argv);

// Rust launches via CreateProcessW. Never round-trip those arguments through the ANSI codepage.
int wmain(int argc, wchar_t ** argv) {
    try {
        std::vector<std::string> utf8;
        utf8.reserve((size_t)argc);
        for (int i = 0; i < argc; ++i) utf8.push_back(desktop_utf8(argv[i]));
        std::vector<char *> args;
        args.reserve((size_t)argc + 1);
        for (auto & argument : utf8) args.push_back(argument.data());
        args.push_back(nullptr);
        return desktop_main(argc, args.data());
    } catch (const std::exception & error) {
        fprintf(stderr, "Engine: %s\n", error.what());
        return 1;
    }
}
