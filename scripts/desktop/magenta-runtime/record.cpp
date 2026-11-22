#include <magentart/detail/autorelease_pool.h>
#include <magentart/mlx_engine.h>
#include <mlx/mlx.h>

#include <algorithm>
#include <array>
#include <bit>
#include <charconv>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <cstdint>
#include <cstdlib>
#include <deque>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <mutex>
#include <string_view>
#include <sys/resource.h>
#include <thread>

namespace {
using Clock = std::chrono::steady_clock;
using namespace std::chrono_literals;
using magentart::core::kFrameSamples;
using magentart::core::MLXEngine;

constexpr int kSampleRate = 48000;
constexpr int kChannels = 2;
constexpr int kSampleBytes = sizeof(std::int16_t);
constexpr int kBlockAlign = kChannels * kSampleBytes;
constexpr int kMaxSeed = 1000000000;
constexpr auto kBlockTime = 40ms;
constexpr auto kInterleavedBlock = kFrameSamples * kChannels;
constexpr std::size_t kBufferedBlocks = 2;
static_assert(std::endian::native == std::endian::little);
static_assert(kFrameSamples * 25 == kSampleRate);

bool parse_int(std::string_view input, int& value) {
    const auto [end, error] = std::from_chars(input.data(), input.data() + input.size(), value);
    return error == std::errc{} && end == input.data() + input.size();
}

template <typename T>
void write_value(std::ofstream& file, T value) {
    file.write(reinterpret_cast<const char*>(&value), sizeof(value));
}

void write_wav_header(std::ofstream& file, std::uint32_t frames) {
    const std::uint32_t data_bytes = frames * kBlockAlign;
    file.write("RIFF", 4);
    write_value<std::uint32_t>(file, data_bytes + 36);
    file.write("WAVEfmt ", 8);
    write_value<std::uint32_t>(file, 16);
    write_value<std::uint16_t>(file, 1); // PCM, signed 16-bit samples.
    write_value<std::uint16_t>(file, kChannels);
    write_value<std::uint32_t>(file, kSampleRate);
    write_value<std::uint32_t>(file, kSampleRate * kBlockAlign);
    write_value<std::uint16_t>(file, kBlockAlign);
    write_value<std::uint16_t>(file, kSampleBytes * 8);
    file.write("data", 4);
    write_value(file, data_bytes);
}

struct Recording {
    double first_audio_ms = 0;
    double capture_seconds = 0;
    std::uint64_t underrun_blocks = 0;
    bool realtime = false;
};

// Store complete stereo blocks so an underrun leaves both channels aligned.
class LocalStream {
public:
    enum class Read { Audio, Underrun, Failed };

    explicit LocalStream(MLXEngine& engine)
        : inference_([this, &engine](std::stop_token stop) { generate(engine, stop); }) {}

    bool prime() {
        std::unique_lock lock(mutex_);
        changed_.wait(lock, [this] { return buffered_.size() == kBufferedBlocks || failed_; });
        return !failed_;
    }

    Read read(float* audio, std::size_t samples) {
        std::lock_guard lock(mutex_);
        if (failed_) return Read::Failed;
        if (buffered_.empty()) {
            std::fill_n(audio, samples, 0.0f);
            return Read::Underrun;
        }
        std::copy_n(buffered_.front().begin(), samples, audio);
        buffered_.pop_front();
        changed_.notify_one();
        return Read::Audio;
    }

    void stop() {
        inference_.request_stop();
        inference_.join();
    }

private:
    void fail() {
        std::lock_guard lock(mutex_);
        failed_ = true;
        changed_.notify_one();
    }

    void generate(MLXEngine& engine, std::stop_token stop) try {
        std::array<float, kFrameSamples> left{}, right{};
        Block audio{};
        while (!stop.stop_requested()) {
            {
                std::unique_lock lock(mutex_);
                changed_.wait(lock, stop, [this] { return buffered_.size() < kBufferedBlocks; });
            }
            if (stop.stop_requested()) return;
            magentart::detail::AutoreleasePool pool;
            if (!engine.generate_frame(left.data(), right.data())) {
                fail();
                return;
            }
            for (std::size_t i = 0; i < kFrameSamples; ++i) {
                audio[2 * i] = left[i];
                audio[2 * i + 1] = right[i];
            }
            std::lock_guard lock(mutex_);
            buffered_.push_back(audio);
            changed_.notify_one();
        }
    } catch (const std::exception& error) {
        std::cerr << "MLX frame generation failed: " << error.what() << '\n';
        fail();
    }

    using Block = std::array<float, kInterleavedBlock>;
    std::mutex mutex_;
    std::condition_variable_any changed_;
    std::deque<Block> buffered_;
    bool failed_ = false;
    std::jthread inference_;
};

bool record(LocalStream& stream, int frames, const char* output_path,
            Clock::time_point launched, Recording& result) {
    std::ofstream wav(output_path, std::ios::binary);
    write_wav_header(wav, frames);
    if (!wav) return false;

    std::array<float, kInterleavedBlock> audio{};
    std::array<std::int16_t, kInterleavedBlock> samples{};
    auto max_lag = Clock::duration::zero();
    const auto start = Clock::now();
    auto deadline = start;
    for (int written = 0; written < frames;) {
        std::this_thread::sleep_until(deadline);
        const auto now = Clock::now();
        max_lag = std::max(max_lag, now - deadline);
        const auto count = std::min<std::size_t>(kFrameSamples, frames - written);
        const auto sample_count = count * kChannels;
        const auto read = stream.read(audio.data(), sample_count);
        if (read == LocalStream::Read::Failed) return false;
        if (read == LocalStream::Read::Underrun) ++result.underrun_blocks;
        bool has_signal = false;
        for (std::size_t i = 0; i < sample_count; ++i) {
            if (!std::isfinite(audio[i])) return false;
            samples[i] = static_cast<std::int16_t>(std::lround(std::clamp(audio[i], -1.0f, 1.0f) * 32767.0f));
            has_signal |= samples[i] != 0;
        }
        if (has_signal && result.first_audio_ms == 0) {
            result.first_audio_ms = std::chrono::duration<double, std::milli>(now - launched).count();
        }
        wav.write(reinterpret_cast<const char*>(samples.data()), count * kBlockAlign);
        if (!wav) return false;
        written += static_cast<int>(count);
        deadline += kBlockTime;
    }
    wav.close();
    if (!wav) return false;
    const auto duration = std::chrono::duration<double>(static_cast<double>(frames) / kSampleRate);
    std::this_thread::sleep_until(start + duration);
    const auto elapsed = Clock::now() - start;
    result.capture_seconds = std::chrono::duration<double>(elapsed).count();
    result.realtime = !result.underrun_blocks && max_lag < kBlockTime
        && elapsed < duration + kBlockTime;
    return result.first_audio_ms > 0;
}

bool write_report(const char* path, const Recording& recording) {
    struct rusage usage {};
    if (getrusage(RUSAGE_SELF, &usage) != 0) return false;
    // Darwin reports the recorder process's peak resident size in bytes.
    std::ofstream report(path);
    report << "{\"first_audio_ms\":" << recording.first_audio_ms
           << ",\"underrun_blocks\":" << recording.underrun_blocks
           << ",\"peak_rss_bytes\":" << usage.ru_maxrss
           << ",\"capture_seconds\":" << recording.capture_seconds
           << ",\"realtime\":" << std::boolalpha << recording.realtime << "}\n";
    report.close();
    return report.good();
}

void prepare_prompt(MLXEngine& engine, const char* prompt) {
    engine.set_text_prompt(prompt);
    const auto deadline = Clock::now() + 60s;
    while (Clock::now() < deadline) {
        const int encoder = engine.get_text_encoder_status();
        const int quantizer = engine.get_quantizer_status();
        if (encoder == 2 && quantizer == 2) return;
        if (encoder == 3 || quantizer == 3) break;
        std::this_thread::sleep_for(10ms);
    }
    for (const auto& entry : engine.get_logs()) std::cerr << entry << '\n';
    std::cerr << "MusicCoCa could not encode the requested prompt\n";
    // The encoder can still own a detached upstream worker on timeout.
    std::_Exit(EXIT_FAILURE);
}
} // namespace

extern "C" int music_generator_engine_main_v1(int argc, char** argv) try {
    if (argc == 2 && std::string_view(argv[1]) == "--runtime-probe") {
        const auto kernels = std::filesystem::path(argv[0]).parent_path() / "mlx.metallib";
        if (!std::filesystem::is_regular_file(kernels)) {
            std::cerr << "Magenta Metal library is missing\n";
            return EXIT_FAILURE;
        }
        std::cout << "mrt2-record/1\n";
        return EXIT_SUCCESS;
    }
    if (argc == 2 && std::string_view(argv[1]) == "--self-test") {
        namespace mx = mlx::core;
        auto check = mx::add(mx::ones({1}), mx::ones({1}), mx::Device::gpu);
        mx::eval(check);
        if (check.item<float>() != 2.0f) return EXIT_FAILURE;
        std::cout << "mrt2-record/1\n";
        return EXIT_SUCCESS;
    }
    const auto launched = Clock::now();
    int frames = 0;
    int seed = 0;
    if (argc != 7 || !parse_int(argv[2], frames) || !parse_int(argv[3], seed) ||
        frames <= 0 || frames > 120 * kSampleRate || seed < 0 || seed > kMaxSeed || !*argv[4]) {
        std::cerr << "Usage: mrt2-record MODEL_DIR SAMPLE_FRAMES SEED PROMPT OUTPUT_WAV METRICS_JSON\n";
        return EXIT_FAILURE;
    }
    const std::filesystem::path bundle(argv[1]);
    const auto resources = bundle / "resources";
    const auto model = bundle / "models/mrt2_small/mrt2_small.mlxfn";
    const auto codec = resources / "spectrostream/spectrostream_encoder.mlxfn";
    magentart::detail::AutoreleasePool pool;
    MLXEngine engine;
    if (!engine.init_assets(resources.c_str()) || !engine.load_prefill_model(codec.c_str(), nullptr)) {
        std::cerr << "Could not load MusicCoCa and SpectroStream assets\n";
        return EXIT_FAILURE;
    }
    if (!engine.load_model(model.c_str())) {
        std::cerr << "Could not load the mrt2_small model and initial state\n";
        return EXIT_FAILURE;
    }
    engine.set_seed_rotation(seed);
    engine.reset_state();
    prepare_prompt(engine, argv[4]);
    LocalStream stream(engine);
    Recording recording;
    if (!stream.prime() || !record(stream, frames, argv[5], launched, recording)) {
        std::cerr << "The Magenta stream did not produce a valid WAV recording\n";
        return EXIT_FAILURE;
    }
    stream.stop();
    if (!write_report(argv[6], recording)) {
        std::cerr << "Could not write Magenta recording diagnostics\n";
        return EXIT_FAILURE;
    }
    return EXIT_SUCCESS;
} catch (const std::exception& error) {
    std::cerr << "Magenta recording failed: " << error.what() << '\n';
    return EXIT_FAILURE;
}
