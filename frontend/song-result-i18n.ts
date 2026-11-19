import { I18N } from "./i18n.js";
import type { Language } from "./locales";

type Message = (actual: string, requested: string) => string;
const messages: Record<Language, readonly [Message, Message]> = {
  de: [(a, r) => `Kürzer als angefordert: ${a} statt ${r}.`, (a, r) => `Länger als angefordert: ${a} statt ${r}.`],
  en: [(a, r) => `Shorter than requested: ${a} instead of ${r}.`, (a, r) => `Longer than requested: ${a} instead of ${r}.`],
  es: [(a, r) => `Más corto de lo solicitado: ${a} en lugar de ${r}.`, (a, r) => `Más largo de lo solicitado: ${a} en lugar de ${r}.`],
  fr: [(a, r) => `Plus court que demandé : ${a} au lieu de ${r}.`, (a, r) => `Plus long que demandé : ${a} au lieu de ${r}.`],
  it: [(a, r) => `Più breve del richiesto: ${a} invece di ${r}.`, (a, r) => `Più lungo del richiesto: ${a} invece di ${r}.`],
  pt: [(a, r) => `Mais curto do que o pedido: ${a} em vez de ${r}.`, (a, r) => `Mais longo do que o pedido: ${a} em vez de ${r}.`],
  tr: [(a, r) => `İstenenden kısa: ${r} yerine ${a}.`, (a, r) => `İstenenden uzun: ${r} yerine ${a}.`],
  pl: [(a, r) => `Krótszy niż zamówiono: ${a} zamiast ${r}.`, (a, r) => `Dłuższy niż zamówiono: ${a} zamiast ${r}.`],
  ru: [(a, r) => `Короче запрошенного: ${a} вместо ${r}.`, (a, r) => `Длиннее запрошенного: ${a} вместо ${r}.`],
  uk: [(a, r) => `Коротше за запит: ${a} замість ${r}.`, (a, r) => `Довше за запит: ${a} замість ${r}.`],
  ja: [(a, r) => `指定より短い音声です：指定 ${r}、実際 ${a}。`, (a, r) => `指定より長い音声です：指定 ${r}、実際 ${a}。`],
  zh: [(a, r) => `音频短于请求时长：请求 ${r}，实际 ${a}。`, (a, r) => `音频长于请求时长：请求 ${r}，实际 ${a}。`],
};

for (const [language, values] of Object.entries(messages)) {
  Object.assign(I18N[language as Language], { duration_short_audio: values[0], duration_long_audio: values[1] });
}

Object.assign(I18N.en, {
  stream_first_audio: (seconds: string) => `First audio after ${seconds} s`,
  stream_underruns: (blocks: string) => `${blocks} underrun blocks`,
  stream_peak_ram: (gib: string) => `Peak resident RAM ${gib} GiB`,
  stream_realtime_met: "Real-time capture verified",
  stream_realtime_missed: "Real-time capture fell behind",
});

Object.assign(I18N.de, {
  stream_first_audio: (seconds: string) => `Erstes Audio nach ${seconds} s`,
  stream_underruns: (blocks: string) => `${blocks} Aussetzerblöcke`,
  stream_peak_ram: (gib: string) => `Maximaler residenter RAM ${gib} GiB`,
  stream_realtime_met: "Echtzeitaufnahme bestätigt",
  stream_realtime_missed: "Echtzeitaufnahme blieb zurück",
});
