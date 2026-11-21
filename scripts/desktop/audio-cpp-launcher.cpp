#include <audiocpp.h>

#include "audio-cpp-wav.h"

#include <algorithm>
#include <bit>
#include <cmath>
#include <cstdio>
#include <dlfcn.h>
#include <fstream>
#include <limits>
#include <memory>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace {
void check(audiocpp_status status) {
    if (status != AUDIOCPP_OK) {
        throw std::runtime_error(audiocpp_last_error());
    }
}

void stage(const char *name) {
    std::printf("stage=%s\n", name);
    std::fflush(stdout);
}

void log_message(audiocpp_log_level, const char *text, void *) {
    std::fputs(text, stderr);
}

const char *load_reference_resampler() {
    // The native runtime resolves SOXR by its install name. Load the signed sibling first.
    auto *bundled = dlopen("@loader_path/libsoxr.dylib", RTLD_NOW | RTLD_LOCAL);
    if (!bundled) throw std::runtime_error("Could not load bundled libsoxr.dylib");
    auto *resolved = dlopen("libsoxr.dylib", RTLD_NOW | RTLD_NOLOAD);
    if (resolved != bundled) throw std::runtime_error("Could not resolve the bundled SOXR install name");
    dlclose(resolved);

    auto version = reinterpret_cast<const char *(*)()>(dlsym(bundled, "soxr_version"));
    if (!version) throw std::runtime_error("Bundled SOXR did not report its version");
    return version();
}

template <typename Integer>
void write_value(std::ostream &stream, Integer value) {
    static_assert(std::endian::native == std::endian::little);
    stream.write(reinterpret_cast<const char *>(&value), sizeof(value));
}

void write_wav(const char *path, const audiocpp_result *result) {
    const float *samples = nullptr;
    size_t frames = 0;
    int sample_rate = 0;
    int channels = 0;
    check(audiocpp_result_audio(result, &samples, &frames, &sample_rate, &channels));
    constexpr auto max_wave_bytes = std::numeric_limits<uint32_t>::max() - 36;
    if (!samples || frames == 0 || channels < 1 || channels > 2 || sample_rate <= 0 ||
        sample_rate > 384000 || frames > max_wave_bytes / (sizeof(int16_t) * channels)) {
        throw std::runtime_error("Invalid audio output");
    }
    const auto sample_count = frames * channels;
    const auto data_bytes = static_cast<uint32_t>(sample_count * sizeof(int16_t));
    const auto frame_bytes = static_cast<uint16_t>(channels * sizeof(int16_t));

    std::ofstream output;
    output.exceptions(std::ios::failbit | std::ios::badbit);
    output.open(path, std::ios::binary | std::ios::trunc);
    output.write("RIFF", 4);
    write_value(output, data_bytes + uint32_t{36});
    output.write("WAVEfmt ", 8);
    write_value(output, uint32_t{16});
    write_value(output, uint16_t{1});
    write_value(output, static_cast<uint16_t>(channels));
    write_value(output, static_cast<uint32_t>(sample_rate));
    write_value(output, static_cast<uint32_t>(sample_rate * frame_bytes));
    write_value(output, frame_bytes);
    write_value(output, uint16_t{16});
    output.write("data", 4);
    write_value(output, data_bytes);

    std::vector<int16_t> pcm(32768);
    for (size_t offset = 0; offset < sample_count; offset += pcm.size()) {
        const size_t count = std::min(pcm.size(), sample_count - offset);
        for (size_t index = 0; index < count; ++index) {
            const float sample = samples[offset + index];
            if (!std::isfinite(sample)) throw std::runtime_error("Non-finite audio sample");
            pcm[index] = static_cast<int16_t>(std::lround(std::clamp(sample, -1.0F, 1.0F) * 32767.0F));
        }
        output.write(reinterpret_cast<const char *>(pcm.data()), count * sizeof(int16_t));
    }
    output.close();
}

template <typename SetOption>
void set_option(std::string_view pair, SetOption set) {
    const auto equals = pair.find('=');
    if (equals == 0 || equals == std::string_view::npos) {
        throw std::runtime_error("Expected key=value runtime option");
    }
    const auto key = std::string(pair.substr(0, equals));
    check(set(key.c_str(), pair.data() + equals + 1));
}
}

extern "C" int music_generator_engine_main_v1(int argc, char **argv) {
    try {
        if (argc == 2 && std::string_view(argv[1]) == "--version") {
            std::printf("audio.cpp %s\n", audiocpp_build_version());
            return 0;
        }
        if (argc == 2 && std::string_view(argv[1]) == "--check-soxr") {
            std::puts(load_reference_resampler());
            return 0;
        }
        std::unique_ptr<audiocpp_options, decltype(&audiocpp_options_free)> session_options(
            audiocpp_options_create(), audiocpp_options_free);
        std::unique_ptr<audiocpp_request, decltype(&audiocpp_request_free)> request(
            audiocpp_request_create(), audiocpp_request_free);
        if (!session_options || !request) throw std::bad_alloc();

        audiocpp_model_config model_config{};
        audiocpp_backend_config backend{nullptr, 0, 4};
        const char *task = nullptr;
        const char *model_path = nullptr;
        const char *output_path = nullptr;
        const char *audio_path = nullptr;
        for (int index = 1; index < argc; ++index) {
            const std::string_view flag = argv[index];
            if (flag == "--log") {
                audiocpp_log_set(log_message, nullptr);
                continue;
            }
            if (++index == argc) throw std::runtime_error("Missing value for " + std::string(flag));
            const char *value = argv[index];
            if (flag == "--task") task = value;
            else if (flag == "--family") model_config.family_hint = value;
            else if (flag == "--model") model_path = value;
            else if (flag == "--model-spec-override") model_config.model_spec_override = value;
            else if (flag == "--backend") backend.backend = value;
            else if (flag == "--text") check(audiocpp_request_set_text(request.get(), value, nullptr));
            else if (flag == "--lyrics") check(audiocpp_request_set_option(request.get(), "lyrics", value));
            else if (flag == "--seed") check(audiocpp_request_set_option(request.get(), "seed", value));
            else if (flag == "--request-option") {
                set_option(value, [&](auto key, auto val) { return audiocpp_request_set_option(request.get(), key, val); });
            } else if (flag == "--session-option") {
                set_option(value, [&](auto key, auto val) { return audiocpp_options_set(session_options.get(), key, val); });
            } else if (flag == "--out") output_path = value;
            else if (flag == "--audio") audio_path = value;
            else throw std::runtime_error("Unsupported option " + std::string(flag));
        }
        if (!task || std::string_view(task) != "gen" || !model_config.family_hint ||
            !model_path || !backend.backend || !output_path) {
            throw std::runtime_error("Expected --task gen, --family, --model, --backend and --out");
        }
        if (audio_path) {
            if (std::string_view(model_config.family_hint) == "mulacover") load_reference_resampler();
            const auto audio = audio_cpp::read_reference_wav(audio_path);
            check(audiocpp_request_set_audio(request.get(), audio.samples.data(),
                audio.samples.size() / audio.channels, audio.sample_rate, audio.channels));
        }

        stage("loading");
        audiocpp_registry *registry_handle = nullptr;
        check(audiocpp_registry_create(nullptr, &registry_handle));
        const std::unique_ptr<audiocpp_registry, decltype(&audiocpp_registry_free)> registry(
            registry_handle, audiocpp_registry_free);
        audiocpp_model *model_handle = nullptr;
        check(audiocpp_model_load(registry.get(), model_path, &model_config, nullptr, &model_handle));
        const std::unique_ptr<audiocpp_model, decltype(&audiocpp_model_free)> model(model_handle, audiocpp_model_free);
        audiocpp_session *session_handle = nullptr;
        check(audiocpp_session_create(model.get(), task, "offline", &backend, session_options.get(), &session_handle));
        const std::unique_ptr<audiocpp_session, decltype(&audiocpp_session_free)> session(
            session_handle, audiocpp_session_free);

        stage("generating");
        audiocpp_result *result_handle = nullptr;
        check(audiocpp_session_run(session.get(), request.get(), &result_handle));
        const std::unique_ptr<audiocpp_result, decltype(&audiocpp_result_free)> result(
            result_handle, audiocpp_result_free);
        stage("writing");
        write_wav(output_path, result.get());
        stage("complete");
        return 0;
    } catch (const std::exception &error) {
        std::fprintf(stderr, "audio.cpp: %s\n", error.what());
        return 1;
    }
}
