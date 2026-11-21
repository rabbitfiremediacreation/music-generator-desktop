# Loaded before the upstream targets are declared. Attach the recorder after
# the upstream project defines magentart::core, without modifying its checkout.
function(register_music_generator_magenta)
    set(recorder_dir "${CMAKE_CURRENT_FUNCTION_LIST_DIR}")
    add_library(mrt2-record SHARED
        "${recorder_dir}/record.cpp"
        "${recorder_dir}/../engine-sandbox.mm"
    )
    target_link_libraries(mrt2-record PRIVATE magentart::core)
    target_link_options(mrt2-record PRIVATE "LINKER:-exported_symbol,_music_generator_engine_main_v1")
    set_target_properties(mrt2-record PROPERTIES
        LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/music-generator"
        PREFIX "" SUFFIX ""
    )
endfunction()

cmake_language(DEFER CALL register_music_generator_magenta)
