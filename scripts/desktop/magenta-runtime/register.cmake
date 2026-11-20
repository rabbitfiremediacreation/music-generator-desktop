# Loaded before the upstream targets are declared. Attach the recorder after
# the upstream project defines magentart::core, without modifying its checkout.
function(register_music_generator_magenta)
    set(recorder_dir "${CMAKE_CURRENT_FUNCTION_LIST_DIR}")
    add_executable(mrt2-record
        "${recorder_dir}/record.cpp"
        "${recorder_dir}/../engine-sandbox.mm"
    )
    target_link_libraries(mrt2-record PRIVATE magentart::core)
    set_target_properties(mrt2-record PROPERTIES
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/music-generator"
    )
endfunction()

cmake_language(DEFER CALL register_music_generator_magenta)
