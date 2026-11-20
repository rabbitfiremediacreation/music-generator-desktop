#pragma once

#include <algorithm>
#include <array>
#include <bit>
#include <cstdint>
#include <fstream>
#include <stdexcept>
#include <string_view>
#include <vector>

namespace audio_cpp {

struct ReferenceAudio {
    int sample_rate = 0;
    int channels = 0;
    std::vector<float> samples;
};

template <typename Value>
Value read_wave_value(std::istream &input) {
    static_assert(std::endian::native == std::endian::little);
    Value value{};
    if (!input.read(reinterpret_cast<char *>(&value), sizeof(value))) {
        throw std::runtime_error("Incomplete reference WAV");
    }
    return value;
}

inline ReferenceAudio read_reference_wav(const char *path) {
    constexpr std::streamoff maximum_bytes = 60 * 1024 * 1024;
    std::ifstream input(path, std::ios::binary | std::ios::ate);
    const auto file_size = input.tellg();
    if (file_size < 12 || file_size > maximum_bytes) {
        throw std::runtime_error("Reference WAV is missing or exceeds the supported size");
    }
    input.seekg(0);
    using WaveId = std::array<char, 4>;
    const auto riff = read_wave_value<WaveId>(input);
    const auto end = std::streamoff{8} + read_wave_value<uint32_t>(input);
    const auto wave = read_wave_value<WaveId>(input);
    if (riff != WaveId{'R', 'I', 'F', 'F'} || wave != WaveId{'W', 'A', 'V', 'E'} ||
        end < 12 || end > file_size) {
        throw std::runtime_error("Invalid reference WAV header");
    }

    ReferenceAudio audio;
    int frame_bytes = 0;
    struct DataChunk {
        std::streamoff offset;
        uint32_t bytes;
    };
    std::vector<DataChunk> data;
    size_t audio_bytes = 0;
    for (std::streamoff offset = 12; offset < end;) {
        if (end - offset < 8) throw std::runtime_error("Incomplete reference WAV chunk");
        input.seekg(offset);
        const auto name = read_wave_value<WaveId>(input);
        const auto bytes = read_wave_value<uint32_t>(input);
        const auto start = offset + 8;
        offset = start + bytes + (bytes % 2);
        if (offset > end) throw std::runtime_error("Incomplete reference WAV chunk");

        const std::string_view id(name.data(), name.size());
        if (id == "fmt ") {
            if (bytes < 16 || frame_bytes != 0) throw std::runtime_error("Invalid reference WAV format");
            const auto format = read_wave_value<uint16_t>(input);
            const auto channels = read_wave_value<uint16_t>(input);
            const auto rate = read_wave_value<uint32_t>(input);
            const auto byte_rate = read_wave_value<uint32_t>(input);
            const auto align = read_wave_value<uint16_t>(input);
            const auto bits = read_wave_value<uint16_t>(input);
            if (format != 1 || (channels != 1 && channels != 2) || bits != 16 ||
                rate < 8000 || rate > 48000 || align != channels * sizeof(int16_t) ||
                byte_rate != rate * align) {
                throw std::runtime_error("Reference audio must be a 16-bit mono or stereo PCM WAV at 8–48 kHz");
            }
            audio.channels = channels;
            audio.sample_rate = static_cast<int>(rate);
            frame_bytes = align;
        } else if (id == "data" && bytes != 0) {
            data.push_back({start, bytes});
            audio_bytes += bytes;
        }
    }
    if (frame_bytes == 0 || data.empty()) throw std::runtime_error("Reference WAV has no PCM data");
    if (audio_bytes % frame_bytes != 0) throw std::runtime_error("Reference WAV has incomplete PCM frames");

    std::vector<int16_t> pcm(audio_bytes / sizeof(int16_t));
    auto *destination = reinterpret_cast<char *>(pcm.data());
    for (const auto &chunk : data) {
        input.seekg(chunk.offset);
        if (!input.read(destination, chunk.bytes)) {
            throw std::runtime_error("Incomplete reference WAV samples");
        }
        destination += chunk.bytes;
    }
    audio.samples.resize(pcm.size());
    std::transform(pcm.begin(), pcm.end(), audio.samples.begin(), [](int16_t sample) {
        return static_cast<float>(sample) / 32768.0F;
    });
    return audio;
}

}
