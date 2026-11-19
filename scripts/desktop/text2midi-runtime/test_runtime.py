import hashlib
import io
import os
from pathlib import Path
import pickle
import sys
from tempfile import TemporaryDirectory
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src-tauri/resources/text2midi"))

from convert_vocab import _VocabularyUnpickler, convert
from text2midi import VOCABULARY, load_vocabulary


class VocabularyTest(unittest.TestCase):
    def test_converted_file_hash(self):
        self.assertEqual(
            hashlib.sha256(VOCABULARY.read_bytes()).hexdigest(),
            "ba7c3f890496896bd22f67b9be11e645126791c45a8a5b59ff75c3cb3b941843",
        )

    def test_rejects_unpinned_source(self):
        with TemporaryDirectory() as temporary:
            wrong_file = Path(temporary) / "vocab_remi.pkl"
            wrong_file.write_bytes(b"\0" * 27_256)
            with self.assertRaisesRegex(ValueError, "pinned official"):
                convert(wrong_file)

    def test_rejects_unexpected_pickle_globals(self):
        with self.assertRaisesRegex(pickle.UnpicklingError, "Unexpected vocabulary global"):
            _VocabularyUnpickler(io.BytesIO(b"cbuiltins\neval\n.")).load()

    @unittest.skipUnless(os.getenv("TEXT2MIDI_TEST_PICKLE"), "requires the pinned upstream vocabulary")
    def test_conversion_reproduces_shipped_bytes(self):
        source = Path(os.environ["TEXT2MIDI_TEST_PICKLE"])
        self.assertEqual(convert(source).encode("utf-8"), VOCABULARY.read_bytes())

    def test_decodes_token_ids_to_independent_midi_reader(self):
        import mido

        tokenizer = load_vocabulary()
        sequence = [
            "Bar_None", "TimeSig_4/4", "Position_0", "Tempo_121.29",
            "Program_0", "Pitch_60", "Velocity_79", "Duration_1.0.4",
            "Program_32", "Pitch_48", "Velocity_79", "Duration_1.0.4",
        ]
        score = tokenizer.decode([tokenizer.vocab[token] for token in sequence])
        with TemporaryDirectory() as temporary:
            path = Path(temporary) / "composition.mid"
            score.dump_midi(path)
            midi = mido.MidiFile(path)
        tracks_with_notes = [
            [message.note for message in track if message.type == "note_on" and message.velocity > 0]
            for track in midi.tracks
        ]
        self.assertEqual([notes for notes in tracks_with_notes if notes], [[60], [48]])
        tempos = [message.tempo for track in midi.tracks for message in track if message.type == "set_tempo"]
        self.assertAlmostEqual(mido.tempo2bpm(tempos[0]), 121.29, places=2)


if __name__ == "__main__":
    unittest.main()
