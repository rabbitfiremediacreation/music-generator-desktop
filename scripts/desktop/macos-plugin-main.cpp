int music_generator_upstream_main(int argc, char **argv);

extern "C" int music_generator_engine_main_v1(int argc, char **argv) {
    return music_generator_upstream_main(argc, argv);
}
