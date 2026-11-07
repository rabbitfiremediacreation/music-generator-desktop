#pragma once
// ACE paths are UTF-8 internally, including paths passed to the pinned GGML DLLs.
#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <cstdio>
#include <cwchar>
#include <stdexcept>
#include <string>

static std::wstring desktop_wide(const char * text) {
    const int size = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text, -1, nullptr, 0);
    if (size <= 0) throw std::runtime_error("Invalid UTF-8 path");
    std::wstring result((size_t)size, L'\0');
    if (!MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text, -1, result.data(), size))
        throw std::runtime_error("Cannot convert UTF-8 path");
    result.pop_back();
    return result;
}

static std::string desktop_utf8(const wchar_t * text) {
    const int size = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, text, -1, nullptr, 0, nullptr, nullptr);
    if (size <= 0) throw std::runtime_error("Invalid Unicode path");
    std::string result((size_t)size, '\0');
    if (!WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, text, -1, result.data(), size, nullptr, nullptr))
        throw std::runtime_error("Cannot convert Unicode path");
    result.pop_back();
    return result;
}

static FILE * desktop_fopen(const char * path, const char * mode) {
    return _wfopen(desktop_wide(path).c_str(), desktop_wide(mode).c_str());
}
