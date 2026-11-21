import { I18N } from "./i18n.js";
import type { Language } from "./locales";

const keys = ["cpu_warning", "cpu_unknown_warning", "cpu_setup", "cpu_unknown_setup", "cpu_reduce", "cpu_continue", "cpu_title", "iterations_tip"] as const;
export const cpuTranslations: Record<Language, readonly [string, string, string, string, string, string, string, string]> = {
  de: ["Die Klangerzeugung läuft auf der CPU. Mehr als 30 Iterationen können die Generierung deutlich verlängern. Für einen ersten Versuch empfehlen wir 30 Iterationen und 10 Sekunden Musik.", "Das Rechengerät der Klangerzeugung konnte nicht ermittelt werden. Bei CPU-Betrieb können mehr als 30 Iterationen sehr lange dauern. Beginne mit 30 Iterationen und 10 Sekunden Musik.", "Die Klangerzeugung läuft auf der CPU. Wir empfehlen höchstens 30 Iterationen und für den ersten Versuch 10 Sekunden Musik. Auch damit kann die Generierung mehrere Minuten dauern.", "Das Rechengerät der Klangerzeugung konnte nicht ermittelt werden. Vorsorglich empfehlen wir höchstens 30 Iterationen und zunächst 10 Sekunden Musik.", "Mit 30 starten", "Trotzdem starten", "Lange Generierung möglich", "Diffusionsschritte der Klangerzeugung. Mehr Schritte brauchen mehr Zeit. CPU-Empfehlung: höchstens 30; niedrigere Modellempfehlungen bleiben erhalten. Auf GPU gilt die Modellempfehlung."],
  en: ["Sound generation runs on the CPU. More than 30 iterations can substantially increase generation time. For a first attempt, we recommend 30 iterations and 10 seconds of music.", "The sound generation device could not be identified. On CPU, more than 30 iterations can take a very long time. Start with 30 iterations and 10 seconds of music.", "Sound generation runs on the CPU. We recommend at most 30 iterations and 10 seconds of music for a first attempt. Generation can still take several minutes.", "The sound generation device could not be identified. As a precaution, we recommend at most 30 iterations and initially 10 seconds of music.", "Start with 30", "Start anyway", "Generation may take a long time", "Sound generation diffusion steps. More steps take more time. CPU recommendation: at most 30; lower model recommendations are retained. On GPU, use the model recommendation."],
  es: ["El sonido se genera en la CPU. Más de 30 iteraciones pueden alargar mucho la generación. Para la primera prueba recomendamos 30 iteraciones y 10 segundos de música.", "No se pudo identificar el dispositivo de generación de sonido. En CPU, más de 30 iteraciones pueden tardar mucho. Empieza con 30 iteraciones y 10 segundos de música.", "El sonido se genera en la CPU. Recomendamos como máximo 30 iteraciones y 10 segundos de música para la primera prueba. Aun así puede tardar varios minutos.", "No se pudo identificar el dispositivo de generación de sonido. Por precaución recomendamos como máximo 30 iteraciones y empezar con 10 segundos de música.", "Iniciar con 30", "Iniciar de todos modos", "La generación puede tardar", "Pasos de difusión del sonido. Más pasos requieren más tiempo. En CPU: como máximo 30; se mantienen las recomendaciones inferiores del modelo. En GPU se usa la recomendación del modelo."],
  fr: ["Le son est généré sur le CPU. Plus de 30 itérations peuvent allonger considérablement la génération. Pour un premier essai, nous recommandons 30 itérations et 10 secondes de musique.", "Le périphérique de génération sonore n’a pas pu être identifié. Sur CPU, plus de 30 itérations peuvent prendre très longtemps. Commencez avec 30 itérations et 10 secondes de musique.", "Le son est généré sur le CPU. Nous recommandons au plus 30 itérations et 10 secondes de musique pour un premier essai. Cela peut encore prendre plusieurs minutes.", "Le périphérique de génération sonore n’a pas pu être identifié. Par précaution, nous recommandons au plus 30 itérations et d’abord 10 secondes de musique.", "Démarrer avec 30", "Démarrer quand même", "La génération peut être longue", "Étapes de diffusion sonore. Plus d’étapes demandent plus de temps. Sur CPU : au plus 30 ; les recommandations inférieures du modèle sont conservées. Sur GPU, suivre la recommandation du modèle."],
  it: ["Il suono viene generato sulla CPU. Più di 30 iterazioni possono allungare molto la generazione. Per una prima prova consigliamo 30 iterazioni e 10 secondi di musica.", "Impossibile identificare il dispositivo di generazione del suono. Sulla CPU, più di 30 iterazioni possono richiedere molto tempo. Inizia con 30 iterazioni e 10 secondi di musica.", "Il suono viene generato sulla CPU. Consigliamo al massimo 30 iterazioni e 10 secondi di musica per la prima prova. La generazione può comunque richiedere diversi minuti.", "Impossibile identificare il dispositivo di generazione del suono. Per precauzione consigliamo al massimo 30 iterazioni e inizialmente 10 secondi di musica.", "Avvia con 30", "Avvia comunque", "La generazione può essere lunga", "Passi di diffusione sonora. Più passi richiedono più tempo. Sulla CPU: al massimo 30; si mantengono i consigli inferiori del modello. Sulla GPU vale il consiglio del modello."],
  pt: ["O som é gerado na CPU. Mais de 30 iterações podem prolongar bastante a geração. Para a primeira tentativa, recomendamos 30 iterações e 10 segundos de música.", "Não foi possível identificar o dispositivo de geração de som. Na CPU, mais de 30 iterações podem demorar muito. Começa com 30 iterações e 10 segundos de música.", "O som é gerado na CPU. Recomendamos no máximo 30 iterações e 10 segundos de música para a primeira tentativa. A geração ainda pode demorar vários minutos.", "Não foi possível identificar o dispositivo de geração de som. Por precaução recomendamos no máximo 30 iterações e começar com 10 segundos de música.", "Iniciar com 30", "Iniciar na mesma", "A geração pode demorar", "Passos de difusão sonora. Mais passos exigem mais tempo. Na CPU: no máximo 30; mantêm-se as recomendações inferiores do modelo. Na GPU aplica-se a recomendação do modelo."],
  tr: ["Ses üretimi CPU üzerinde çalışıyor. 30’dan fazla yineleme üretim süresini önemli ölçüde uzatabilir. İlk deneme için 30 yineleme ve 10 saniye müzik öneriyoruz.", "Ses üretim aygıtı belirlenemedi. CPU üzerinde 30’dan fazla yineleme çok uzun sürebilir. 30 yineleme ve 10 saniye müzikle başlayın.", "Ses üretimi CPU üzerinde çalışıyor. İlk deneme için en fazla 30 yineleme ve 10 saniye müzik öneriyoruz. Üretim yine de birkaç dakika sürebilir.", "Ses üretim aygıtı belirlenemedi. Önlem olarak en fazla 30 yineleme ve başlangıçta 10 saniye müzik öneriyoruz.", "30 ile başlat", "Yine de başlat", "Üretim uzun sürebilir", "Ses üretiminin difüzyon adımları. Daha fazla adım daha uzun sürer. CPU önerisi: en fazla 30; modelin daha düşük önerileri korunur. GPU üzerinde model önerisi geçerlidir."],
  pl: ["Dźwięk jest generowany na CPU. Ponad 30 iteracji może znacznie wydłużyć generowanie. Na pierwszą próbę zalecamy 30 iteracji i 10 sekund muzyki.", "Nie udało się rozpoznać urządzenia generującego dźwięk. Na CPU ponad 30 iteracji może potrwać bardzo długo. Zacznij od 30 iteracji i 10 sekund muzyki.", "Dźwięk jest generowany na CPU. Zalecamy najwyżej 30 iteracji i 10 sekund muzyki na pierwszą próbę. Generowanie nadal może potrwać kilka minut.", "Nie udało się rozpoznać urządzenia generującego dźwięk. Ostrożnościowo zalecamy najwyżej 30 iteracji i początkowo 10 sekund muzyki.", "Uruchom z 30", "Uruchom mimo to", "Generowanie może potrwać", "Kroki dyfuzji dźwięku. Więcej kroków wymaga więcej czasu. Na CPU: najwyżej 30; niższe zalecenia modelu zostają zachowane. Na GPU obowiązuje zalecenie modelu."],
  ru: ["Звук генерируется на CPU. Более 30 итераций могут значительно увеличить время генерации. Для первой попытки рекомендуем 30 итераций и 10 секунд музыки.", "Не удалось определить устройство генерации звука. На CPU более 30 итераций могут занять очень много времени. Начните с 30 итераций и 10 секунд музыки.", "Звук генерируется на CPU. Для первой попытки рекомендуем не более 30 итераций и 10 секунд музыки. Генерация всё равно может занять несколько минут.", "Не удалось определить устройство генерации звука. На всякий случай рекомендуем не более 30 итераций и сначала 10 секунд музыки.", "Начать с 30", "Всё равно начать", "Генерация может затянуться", "Шаги диффузии звука. Больше шагов — больше времени. На CPU: не более 30; более низкие рекомендации модели сохраняются. На GPU действует рекомендация модели."],
  uk: ["Звук генерується на CPU. Понад 30 ітерацій можуть значно збільшити час генерації. Для першої спроби рекомендуємо 30 ітерацій і 10 секунд музики.", "Не вдалося визначити пристрій генерації звуку. На CPU понад 30 ітерацій можуть тривати дуже довго. Почніть із 30 ітерацій і 10 секунд музики.", "Звук генерується на CPU. Для першої спроби рекомендуємо не більше 30 ітерацій і 10 секунд музики. Генерація все одно може тривати кілька хвилин.", "Не вдалося визначити пристрій генерації звуку. Про всяк випадок рекомендуємо не більше 30 ітерацій і спочатку 10 секунд музики.", "Почати з 30", "Усе одно почати", "Генерація може тривати довго", "Кроки дифузії звуку. Більше кроків потребує більше часу. На CPU: не більше 30; нижчі рекомендації моделі зберігаються. На GPU діє рекомендація моделі."],
  ja: ["音声生成はCPUで実行されます。30回を超える反復では生成時間が大幅に長くなる場合があります。最初は30回の反復と10秒の音楽をお勧めします。", "音声生成の計算デバイスを確認できませんでした。CPUでは30回を超える反復に非常に時間がかかる場合があります。30回の反復と10秒の音楽から始めてください。", "音声生成はCPUで実行されます。最初は最大30回の反復と10秒の音楽をお勧めします。それでも生成に数分かかる場合があります。", "音声生成の計算デバイスを確認できませんでした。念のため最大30回の反復と、まず10秒の音楽をお勧めします。", "30回で開始", "そのまま開始", "生成に時間がかかる場合があります", "音声生成の拡散ステップ数。多いほど時間がかかります。CPUでは最大30回を推奨し、それより低いモデル推奨値は維持します。GPUではモデル推奨値を使用します。"],
  zh: ["声音生成正在 CPU 上运行。超过 30 次迭代可能显著延长生成时间。首次尝试建议使用 30 次迭代和 10 秒音乐。", "无法确定声音生成所用的计算设备。在 CPU 上，超过 30 次迭代可能耗时很长。建议从 30 次迭代和 10 秒音乐开始。", "声音生成正在 CPU 上运行。首次尝试建议最多 30 次迭代和 10 秒音乐。即使如此，生成仍可能需要几分钟。", "无法确定声音生成所用的计算设备。为谨慎起见，建议最多 30 次迭代，并先尝试 10 秒音乐。", "以 30 次开始", "仍然开始", "生成可能耗时较长", "声音生成的扩散步数。步数越多，耗时越长。CPU 建议最多 30 步；模型更低的建议值会保留。GPU 使用模型建议值。"],
};
for (const [language, values] of Object.entries(cpuTranslations)) {
  Object.assign(I18N[language as Language], Object.fromEntries(keys.map((key, i) => [key, values[i]])));
}

export const cpuBehaviorKeys = ["cpu_remember", "cpu_remember_error", "cpu_behavior_label", "cpu_behavior_ask", "cpu_behavior_limit", "cpu_behavior_continue", "cpu_behavior_hint"] as const;
export const cpuBehaviorTranslations: Record<Language, readonly string[]> = {
  "de": [
    "Diese Entscheidung merken",
    "Die Entscheidung konnte nicht gespeichert werden. Versuche es erneut oder schalte „Diese Entscheidung merken“ aus, um nur dieses Mal zu starten.",
    "Verhalten bei hohen CPU-Iterationen",
    "Immer nachfragen",
    "Automatisch auf maximal 30 begrenzen",
    "Gewählte Iterationszahl ohne Rückfrage verwenden",
    "Gilt bei mehr als 30 Iterationen auf CPU oder unbekanntem Rechengerät, auch beim Wiederholen. Rotmarkierung und Hinweise bleiben ab 30 sichtbar."
  ],
  "en": [
    "Remember this decision",
    "The decision could not be saved. Try again or turn off “Remember this decision” to start just this once.",
    "Behavior at high CPU iteration counts",
    "Always ask",
    "Automatically limit to at most 30",
    "Use selected iteration count without asking",
    "Applies above 30 iterations on CPU or an unknown device, including retries. Red marking and hints remain visible from 30."
  ],
  "es": [
    "Recordar esta decisión",
    "No se pudo guardar la decisión. Inténtalo de nuevo o desactiva «Recordar esta decisión» para iniciar solo esta vez.",
    "Comportamiento con muchas iteraciones en CPU",
    "Preguntar siempre",
    "Limitar automáticamente a un máximo de 30",
    "Usar las iteraciones elegidas sin preguntar",
    "Se aplica a más de 30 iteraciones en CPU o dispositivo desconocido, también al reintentar. La marca roja y los avisos aparecen desde 30."
  ],
  "fr": [
    "Mémoriser cette décision",
    "La décision n’a pas pu être enregistrée. Réessayez ou désactivez « Mémoriser cette décision » pour démarrer uniquement cette fois.",
    "Comportement avec un nombre élevé d’itérations CPU",
    "Toujours demander",
    "Limiter automatiquement à 30 maximum",
    "Utiliser le nombre choisi sans demander",
    "S’applique au-delà de 30 itérations sur CPU ou périphérique inconnu, y compris aux nouvelles tentatives. Le rouge et les indications restent visibles dès 30."
  ],
  "it": [
    "Ricorda questa decisione",
    "Impossibile salvare la decisione. Riprova o disattiva «Ricorda questa decisione» per avviare solo questa volta.",
    "Comportamento con molte iterazioni sulla CPU",
    "Chiedi sempre",
    "Limita automaticamente a un massimo di 30",
    "Usa le iterazioni scelte senza chiedere",
    "Si applica oltre 30 iterazioni su CPU o dispositivo sconosciuto, anche nei nuovi tentativi. Il rosso e gli avvisi restano visibili da 30."
  ],
  "pt": [
    "Memorizar esta decisão",
    "Não foi possível guardar a decisão. Tenta novamente ou desativa «Memorizar esta decisão» para iniciar apenas desta vez.",
    "Comportamento com muitas iterações na CPU",
    "Perguntar sempre",
    "Limitar automaticamente a um máximo de 30",
    "Usar as iterações escolhidas sem perguntar",
    "Aplica-se acima de 30 iterações na CPU ou num dispositivo desconhecido, incluindo novas tentativas. A marca vermelha e os avisos mantêm-se visíveis a partir de 30."
  ],
  "tr": [
    "Bu kararı hatırla",
    "Karar kaydedilemedi. Yeniden deneyin veya yalnızca bu sefer başlatmak için “Bu kararı hatırla” seçeneğini kapatın.",
    "Yüksek CPU yineleme sayılarında davranış",
    "Her zaman sor",
    "Otomatik olarak en fazla 30 ile sınırla",
    "Seçilen yineleme sayısını sormadan kullan",
    "CPU veya bilinmeyen aygıtta 30’dan fazla yinelemeye, yeniden denemeler dahil uygulanır. Kırmızı işaret ve uyarılar 30’dan itibaren görünür."
  ],
  "pl": [
    "Zapamiętaj tę decyzję",
    "Nie udało się zapisać decyzji. Spróbuj ponownie lub wyłącz opcję „Zapamiętaj tę decyzję”, aby uruchomić tylko tym razem.",
    "Zachowanie przy dużej liczbie iteracji na CPU",
    "Zawsze pytaj",
    "Automatycznie ogranicz do najwyżej 30",
    "Użyj wybranej liczby iteracji bez pytania",
    "Dotyczy ponad 30 iteracji na CPU lub nieznanym urządzeniu, także przy ponawianiu. Czerwone oznaczenie i wskazówki są widoczne od 30."
  ],
  "ru": [
    "Запомнить это решение",
    "Не удалось сохранить решение. Повторите попытку или отключите «Запомнить это решение», чтобы начать только в этот раз.",
    "Поведение при большом числе итераций на CPU",
    "Всегда спрашивать",
    "Автоматически ограничивать до 30",
    "Использовать выбранное число итераций без вопроса",
    "Применяется при более чем 30 итерациях на CPU или неизвестном устройстве, включая повторы. Красная отметка и подсказки видны начиная с 30."
  ],
  "uk": [
    "Запам’ятати це рішення",
    "Не вдалося зберегти рішення. Спробуйте ще раз або вимкніть «Запам’ятати це рішення», щоб почати лише цього разу.",
    "Поведінка за великої кількості ітерацій на CPU",
    "Завжди запитувати",
    "Автоматично обмежувати до 30",
    "Використовувати вибрану кількість ітерацій без запиту",
    "Застосовується за понад 30 ітерацій на CPU або невідомому пристрої, також під час повторів. Червона позначка й підказки видимі від 30."
  ],
  "ja": [
    "この選択を記憶する",
    "選択を保存できませんでした。再試行するか、「この選択を記憶する」をオフにして今回だけ開始してください。",
    "CPUの反復回数が多い場合の動作",
    "毎回確認する",
    "自動的に最大30回に制限する",
    "選択した反復回数で確認せずに開始する",
    "CPUまたは不明なデバイスで30回を超える場合に適用し、再試行も含みます。赤い表示と注意文は30回から表示されます。"
  ],
  "zh": [
    "记住此决定",
    "无法保存此决定。请重试，或关闭「记住此决定」以仅在本次开始。",
    "CPU 迭代次数较高时的行为",
    "始终询问",
    "自动限制为最多 30 次",
    "直接使用所选迭代次数，不再询问",
    "适用于 CPU 或未知设备上超过 30 次的迭代，包括重试。红色标记和提示从 30 次起显示。"
  ]
};
for (const [language, values] of Object.entries(cpuBehaviorTranslations)) {
  Object.assign(I18N[language as Language], Object.fromEntries(cpuBehaviorKeys.map((key, i) => [key, values[i]])));
}
