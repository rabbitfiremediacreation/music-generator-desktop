"""Run the pinned HTDemucs adapter on local files using data-only weights."""

import json
import os
import sys
from fractions import Fraction
from importlib.metadata import version
from pathlib import Path

RATE = 44100

# Constructor metadata from the two reviewed checkpoints. Upgrades must retain these shapes.
COMMON_MODEL = {
    'audio_channels': 2,
    'cac': True,
    'channels': 48,
    'channels_time': None,
    'context': 1,
    'context_enc': 0,
    'dconv_comp': 8,
    'dconv_depth': 2,
    'dconv_init': 0.001,
    'dconv_mode': 3,
    'depth': 4,
    'emb_scale': 10,
    'emb_smooth': True,
    'end_iters': 0,
    'freq_emb': 0.2,
    'growth': 2,
    'kernel_size': 8,
    'multi_freqs': [],
    'multi_freqs_depth': 3,
    'nfft': 4096,
    'norm_groups': 4,
    'norm_starts': 4,
    'rescale': 0.1,
    'rewrite': True,
    'samplerate': 44100,
    'segment': {'_type': 'fraction', 'numerator': 39, 'denominator': 5},
    'stride': 4,
    't_auto_sparsity': False,
    't_cape_augment': True,
    't_cape_glob_loc_scale': [5000.0, 1.0, 1.4],
    't_cape_mean_normalize': True,
    't_cross_first': False,
    't_dropout': 0.02,
    't_emb': 'sin',
    't_gelu': True,
    't_global_window': 100,
    't_group_norm': False,
    't_heads': 8,
    't_hidden_scale': 4.0,
    't_layer_scale': True,
    't_layers': 5,
    't_lr': None,
    't_mask_random_seed': 42,
    't_mask_type': 'diag',
    't_max_period': 10000.0,
    't_max_positions': 10000,
    't_norm_first': True,
    't_norm_in': True,
    't_norm_in_group': False,
    't_norm_out': True,
    't_sin_random_shift': 0,
    't_sparse_attn_window': 400,
    't_sparse_cross_attn': False,
    't_sparse_self_attn': False,
    't_sparsity': 0.95,
    't_weight_decay': 0.0,
    't_weight_pos_embed': 1.0,
    'time_stride': 2,
    'wiener_iters': 0,
    'wiener_residual': False,
}
MODEL_VARIANTS = {
    4: {
        'bottom_channels': 512,
        'sources': ['drums', 'bass', 'other', 'vocals'],
    },
    6: {
        'bottom_channels': 0,
        'sources': ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano'],
    },
}


def report(**fields):
    print(json.dumps(fields, allow_nan=False), flush=True)


def inspect(path):
    import numpy as np
    import soundfile as sf

    with sf.SoundFile(path) as audio:
        if not audio.frames or audio.channels not in (1, 2):
            raise ValueError("Expected nonempty mono or stereo audio")
        peaks = []
        for index in range(160):
            start = audio.frames * index // 160
            end = audio.frames * (index + 1) // 160
            peak = 0.0
            for _ in range(start, end, 65536):
                frames = audio.read(min(end - audio.tell(), 65536), dtype="float32")
                if not len(frames) or not np.isfinite(frames).all():
                    raise ValueError("Source contains unreadable or invalid samples")
                peak = max(peak, float(np.max(np.abs(frames))))
            peaks.append(peak)
        report(frames=audio.frames, rate=audio.samplerate, channels=audio.channels, peaks=peaks)


def load_model(path, expected):
    from demucs.htdemucs import HTDemucs
    from safetensors import safe_open

    with safe_open(path, framework="pt", device="cpu") as weights:
        metadata = weights.metadata()
        if metadata.get("klass") != "demucs.htdemucs.HTDemucs" or json.loads(metadata["args"]):
            raise ValueError("Unsupported Demucs checkpoint format")
        args = json.loads(metadata["kwargs"])
        approved = MODEL_VARIANTS.get(len(expected))
        if approved is None or args != {**COMMON_MODEL, **approved}:
            raise ValueError("Unreviewed Demucs architecture or constructor metadata")
        segment = args["segment"]
        if not isinstance(segment, dict) or segment.get("_type") != "fraction":
            raise ValueError("Missing Demucs segment length")
        args["segment"] = Fraction(segment["numerator"], segment["denominator"])
        if not 0 < args["segment"] <= 10:
            raise ValueError("Invalid Demucs segment length")
        if tuple(args["sources"]) != expected or args["samplerate"] != RATE or args["audio_channels"] != 2:
            raise ValueError("Incompatible Demucs source roles or timebase")
        model = HTDemucs(**args)
        model.load_state_dict({key: weights.get_tensor(key) for key in weights.keys()}, strict=True)
    return model.eval()


def read_waveform(config):
    import soundfile as sf
    import torch
    from torchaudio.functional import resample

    with sf.SoundFile(config["input"]) as source:
        source.seek(config["first"])
        audio = source.read(config["frames"], dtype="float32", always_2d=True)
        if len(audio) != config["frames"] or source.samplerate != config["source_rate"]:
            raise ValueError("Source changed after preflight")
        waveform = torch.from_numpy(audio.T.copy())
        if source.samplerate != RATE:
            waveform = resample(waveform, source.samplerate, RATE)
    if waveform.shape[0] == 1:
        waveform = waveform.expand(2, -1).contiguous()
    if waveform.shape[0] != 2 or not torch.isfinite(waveform).all():
        raise ValueError("Source contains invalid samples")
    return waveform


def write_wave(path, tensor, expected_shape):
    import soundfile as sf
    import torch

    if tensor.shape != expected_shape or not torch.isfinite(tensor).all():
        raise ValueError(f"Invalid shape or samples in {Path(path).name}")
    sf.write(path, tensor.T.contiguous().numpy(), RATE, subtype="FLOAT")


def align(request_path):
    import torch

    config = json.loads(Path(request_path).read_text(encoding="utf-8"))
    torch.set_num_threads(4)
    waveform = read_waveform(config)
    shape = (2, config["target_frames"])
    write_wave(config["output"], waveform, shape)


def separate(request_path):
    import torch
    from demucs.apply import apply_model

    config = json.loads(Path(request_path).read_text(encoding="utf-8"))
    torch.set_num_threads(4)
    torch.manual_seed(0)
    report(phase="loading")
    model = load_model(config["weights"], tuple(config["roles"]))
    report(phase="preparing")
    waveform = read_waveform(config)

    def save(name, tensor):
        write_wave(Path(config["output"]) / f"{name}.wav", tensor, waveform.shape)

    # Use a common affine transform and share the DC offset across the estimates.
    reference = waveform.mean(0)
    mean = reference.mean()
    scale = reference.std(unbiased=False).clamp_min(1e-8)
    overlap = config["overlap"]
    segment = min(float(model.segment), 4.0) if config["quality"] == "fast" else None
    report(phase="separating")
    with torch.inference_mode():
        estimates = apply_model(
            model, ((waveform - mean) / scale)[None], shifts=0, split=True,
            device="cpu", overlap=overlap, segment=segment,
        )[0]
        estimates = estimates * scale + mean / len(model.sources)
        outputs = dict(zip(model.sources, estimates, strict=True))
        report(phase="validating")
        save("original", waveform)
        for role in config["outputs"]:
            save(role, sum(value for key, value in outputs.items() if key != "vocals")
                 if role == "instrumental" else outputs[role])


if __name__ == "__main__":
    if os.environ.get("MUSIC_STEM_LIFELINE") == "1":
        import threading

        def watch_parent():
            os.read(0, 1)
            os._exit(1)

        threading.Thread(target=watch_parent, daemon=True).start()
    command, *args = sys.argv[1:]
    if command == "probe":
        from demucs import __version__ as demucs_version
        from demucs.apply import apply_model
        from safetensors import safe_open
        from soundfile import SoundFile
        from torchaudio.functional import resample

        torch_version = "2.7.1" if sys.version_info[:2] == (3, 11) else "2.8.0"
        assert sys.version_info[:2] in ((3, 11), (3, 12))
        assert demucs_version == "4.0.1"
        assert all(callable(item) for item in (apply_model, safe_open, SoundFile, resample))
        assert version("torch").split("+")[0] == version("torchaudio").split("+")[0] == torch_version
        report(engine="demucs", version=demucs_version, torch=torch_version)
    elif command == "inspect":
        inspect(*args)
    elif command == "check":
        import torch
        torch.set_num_threads(2)
        model = load_model(args[0], tuple(args[1:]))
        report(segment=float(model.segment))
    elif command == "separate":
        separate(*args)
    elif command == "align":
        align(*args)
    else:
        raise SystemExit("Unknown adapter operation")
