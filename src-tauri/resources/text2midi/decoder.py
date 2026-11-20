"""Inference subset of AMAAI Lab Text2midi, MIT (see LICENSE.upstream).

Adapted from model/transformer_model.py at f3245ee402b29ba00b86c6eb9813032f3f05954f.
"""

import math

import torch
from torch import nn
from torch.nn import functional as F


WIDTH = 768
HEADS = 8
LAYERS = 18
FEEDFORWARD_WIDTH = 1024
POSITION_COUNT = 2048


class SelfAttention(nn.Module):
    def __init__(self):
        super().__init__()
        self.to_qkv = nn.Linear(WIDTH, WIDTH * 3, bias=False)
        self.to_out = nn.Linear(WIDTH, WIDTH, bias=False)

    def forward(self, hidden):
        batch, length, _ = hidden.shape
        # The released checkpoint uses a direct view, without a head/sequence transpose.
        query, key, value = (
            part.contiguous().view(batch, HEADS, length, -1)
            for part in self.to_qkv(hidden).chunk(3, dim=-1)
        )
        attended = F.scaled_dot_product_attention(query, key, value, is_causal=True)
        return self.to_out(attended.contiguous().view(batch, length, WIDTH))


class DecoderLayer(nn.Module):
    def __init__(self):
        super().__init__()
        self.self_attn = SelfAttention()
        self.multihead_attn = nn.MultiheadAttention(WIDTH, HEADS, batch_first=True)
        self.linear1 = nn.Linear(WIDTH, FEEDFORWARD_WIDTH)
        self.linear2 = nn.Linear(FEEDFORWARD_WIDTH, WIDTH)
        self.norm1 = nn.LayerNorm(WIDTH)
        self.norm2 = nn.LayerNorm(WIDTH)
        self.norm3 = nn.LayerNorm(WIDTH)

    def forward(self, hidden, memory):
        hidden = self.norm1(hidden + self.self_attn(hidden))
        cross_attention, _ = self.multihead_attn(hidden, memory, memory, need_weights=False)
        hidden = self.norm2(hidden + cross_attention)
        return self.norm3(hidden + self.linear2(F.relu(self.linear1(hidden))))


class Decoder(nn.Module):
    def __init__(self):
        super().__init__()
        self.layers = nn.ModuleList(DecoderLayer() for _ in range(LAYERS))
        self.norm = nn.LayerNorm(WIDTH)

    def forward(self, hidden, memory):
        for layer in self.layers:
            hidden = layer(hidden, memory)
        return self.norm(hidden)


class PositionalEncoding(nn.Module):
    def __init__(self):
        super().__init__()
        self.pe = nn.Parameter(torch.empty(POSITION_COUNT, 1, WIDTH), requires_grad=False)

    def forward(self, hidden):
        # Upstream indexes the first dimension even with batch-first input.
        return hidden + self.pe[:hidden.size(0), :]


class Text2Midi(nn.Module):
    def __init__(self, vocab_size, encoder):
        super().__init__()
        self.input_emb = nn.Embedding(vocab_size, WIDTH)
        self.pos_encoder = PositionalEncoding()
        self.encoder = encoder
        self.decoder = Decoder()
        self.projection = nn.Linear(WIDTH, vocab_size)

    def generate(self, inputs, start_token, max_tokens, generator):
        memory = self.encoder(**inputs).last_hidden_state
        sequence = torch.full((1, 1), start_token, dtype=torch.long)
        for _ in range(max_tokens):
            hidden = self.pos_encoder(self.input_emb(sequence) * math.sqrt(WIDTH))
            logits = self.projection(self.decoder(hidden, memory))
            # Match upstream sampling across all positions and retain the last draw.
            log_probabilities = F.log_softmax(logits[0], dim=-1)
            next_token = torch.multinomial(log_probabilities.exp(), 1, generator=generator)[-1:]
            sequence = torch.cat((sequence, next_token), dim=1)
        return sequence[0, 1:].tolist()
