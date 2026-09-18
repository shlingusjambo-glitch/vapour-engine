"""General MIDI names. Instrument name -> program number; drum name -> note number."""
_GM = """acoustic_grand_piano bright_acoustic_piano electric_grand_piano honky_tonk_piano electric_piano_1 electric_piano_2 harpsichord clavinet
celesta glockenspiel music_box vibraphone marimba xylophone tubular_bells dulcimer
drawbar_organ percussive_organ rock_organ church_organ reed_organ accordion harmonica tango_accordion
nylon_guitar steel_guitar jazz_guitar clean_guitar muted_guitar overdriven_guitar distortion_guitar guitar_harmonics
acoustic_bass fingered_bass picked_bass fretless_bass slap_bass_1 slap_bass_2 synth_bass_1 synth_bass_2
violin viola cello contrabass tremolo_strings pizzicato_strings orchestral_harp timpani
string_ensemble_1 string_ensemble_2 synth_strings_1 synth_strings_2 choir_aahs voice_oohs synth_voice orchestra_hit
trumpet trombone tuba muted_trumpet french_horn brass_section synth_brass_1 synth_brass_2
soprano_sax alto_sax tenor_sax baritone_sax oboe english_horn bassoon clarinet
piccolo flute recorder pan_flute blown_bottle shakuhachi whistle ocarina
lead_square lead_sawtooth lead_calliope lead_chiff lead_charang lead_voice lead_fifths lead_bass
pad_new_age pad_warm pad_polysynth pad_choir pad_bowed pad_metallic pad_halo pad_sweep
fx_rain fx_soundtrack fx_crystal fx_atmosphere fx_brightness fx_goblins fx_echoes fx_sci_fi
sitar banjo shamisen koto kalimba bagpipe fiddle shanai
tinkle_bell agogo steel_drums woodblock taiko_drum melodic_tom synth_drum reverse_cymbal
guitar_fret_noise breath_noise seashore bird_tweet telephone_ring helicopter applause gunshot""".split()
PROGRAMS = {n: i for i, n in enumerate(_GM)}
FAMILIES = ["piano", "chromatic_percussion", "organ", "guitar", "bass", "strings", "ensemble", "brass",
            "reed", "pipe", "synth_lead", "synth_pad", "synth_fx", "ethnic", "percussive", "sound_fx"]

DRUMS = {
    "kick": 36, "kick_2": 35, "side_stick": 37, "snare": 38, "clap": 39, "snare_2": 40,
    "tom_low": 41, "hihat_closed": 42, "tom_low_2": 43, "hihat_pedal": 44, "tom_mid": 45, "hihat_open": 46,
    "tom_mid_2": 47, "tom_high": 48, "crash": 49, "tom_high_2": 50, "ride": 51, "china": 52, "ride_bell": 53,
    "tambourine": 54, "splash": 55, "cowbell": 56, "crash_2": 57, "vibraslap": 58, "ride_2": 59,
    "bongo_high": 60, "bongo_low": 61, "conga_mute": 62, "conga_high": 63, "conga_low": 64,
    "timbale_high": 65, "timbale_low": 66, "agogo_high": 67, "agogo_low": 68, "cabasa": 69, "maracas": 70,
    "whistle_short": 71, "whistle_long": 72, "guiro_short": 73, "guiro_long": 74, "claves": 75,
    "woodblock_high": 76, "woodblock_low": 77, "cuica_mute": 78, "cuica_open": 79, "triangle_mute": 80, "triangle_open": 81,
    "shaker": 82, "hat": 42,
}
# drum kit name -> GM bank-0 program on channel 10
DRUM_KITS = {"standard": 0, "room": 8, "power": 16, "electronic": 24, "tr808": 25, "jazz": 32, "brush": 40, "orchestra": 48, "sfx": 56}


def family(program):
    return FAMILIES[program // 8]
