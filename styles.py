"""The four caption styles. Sharp, contrastive definitions with a worked
example and an anti-example each; the judge scores "style match", so every
voice must be unmistakably different from the others and land its intent.

The example/anti-example pairs are few-shot guidance: they show the model the
target register and the most common way each style goes wrong, which pulls the
output toward the strong middle of the band.
"""
from __future__ import annotations

STYLE_ORDER = ["formal", "sarcastic", "humorous_tech", "humorous_non_tech"]

STYLE_GUIDE = {
    "formal": {
        "def": (
            "Two or three polished, information-dense sentences. Professional, "
            "objective, factual; neutral register, no slang, no jokes, no first "
            "person, like a documentary voiceover. Pack in the concrete details "
            "from the description: specific subjects (with counts/colors), actions "
            "and their direction, the setting, lighting, and notable objects."
        ),
        "good": "A barista at a marble counter slowly pours steamed milk into a white ceramic cup, drawing a symmetrical leaf pattern in the crema. Warm morning light falls across the countertop, where a second, empty cup waits beside a metal pitcher.",
        "bad": "OMG this barista is literally making the cutest latte art ever!!  (too casual, exclamatory, opinionated, vague)",
    },
    "sarcastic": {
        "def": (
            "One or two dry, deadpan sentences. Ironic understatement that mocks "
            "how mundane the scene is or feigns being deeply unimpressed. Sharp "
            "and clever, never cruel, no emojis. The irony must be obvious, and it "
            "should still hook onto a real, specific detail from the video."
        ),
        "good": "Groundbreaking footage of a man pouring milk into a cup, surely destined for every film-school syllabus.",
        "bad": "A barista makes latte art in a cup.  (this is just neutral/formal, no irony at all)",
    },
    "humorous_tech": {
        "def": (
            "One or two punchy, genuinely funny sentences built on a SPECIFIC "
            "tech/programming metaphor (bug, deploy, merge conflict, infinite "
            "loop, cache miss, 404, rubber-duck, CI pipeline, hotfix). The joke "
            "must actually land; the metaphor should map onto what's happening, "
            "not just sprinkle tech words on top. Keep it tight; don't ramble."
        ),
        "good": "He's rubber-ducking the espresso machine, hoping it'll finally explain why the foam keeps throwing exceptions. Third redeploy this morning and the latte art still won't render.",
        "bad": "A barista makes coffee using tech and computers and code.  (tech words bolted on, no actual metaphor or joke)",
    },
    "humorous_non_tech": {
        "def": (
            "One or two punchy, genuinely funny sentences using everyday, "
            "universal humor: food, pets, moods, weekends, chores, "
            "procrastination, relationships. ZERO technical or programming words. "
            "Keep it tight; land the joke, don't ramble."
        ),
        "good": "This latte art is the single most productive thing anyone in this cafe will accomplish before noon.",
        "bad": "The barista's coffee is buffering like a slow download.  (uses a tech metaphor; that belongs to humorous_tech)",
    },
}


def guide_for(styles: list) -> str:
    lines = []
    for s in styles:
        if s not in STYLE_GUIDE:
            continue
        g = STYLE_GUIDE[s]
        lines.append(
            f"- {s}: {g['def']}\n"
            f"    good example: {g['good']}\n"
            f"    avoid: {g['bad']}"
        )
    return "\n".join(lines)
