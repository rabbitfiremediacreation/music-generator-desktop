# Run in a Windows test profile with the application closed. Save a normal or
# maximized window once before running. Repeat after changing monitors or DPI.
param([Parameter(Mandatory)][string]$Executable)
$ErrorActionPreference = "Stop"
$statePath = Join-Path ([Environment]::GetFolderPath("ApplicationData")) "de.alphatester.music-generator/.window-state.json"
function Read-State { (Get-Content -Raw $statePath | ConvertFrom-Json).main }
$expected = Read-State
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Placement89 {
    [StructLayout(LayoutKind.Sequential)]
    public struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr window);
    [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
}
'@
$dpiContext = [Placement89]::SetThreadDpiAwarenessContext([IntPtr](-4))
try {
    for ($run = 1; $run -le 5; $run++) {
        $process = Start-Process -FilePath $Executable -PassThru
        Read-Host "Run $run - press Enter when the main workspace is ready"
        $process.Refresh()
        $window = $process.MainWindowHandle
        $client = New-Object Placement89+Rect
        $outer = New-Object Placement89+Rect
        if (![Placement89]::GetClientRect($window, [ref]$client) -or
            ![Placement89]::GetWindowRect($window, [ref]$outer)) { throw "Cannot measure main window" }
        if ([Placement89]::IsZoomed($window) -ne $expected.maximized) { throw "Wrong maximized state" }
        $bounds = "$($outer.Left),$($outer.Top),$($outer.Right),$($outer.Bottom)"
        Write-Output "Run $run - outer $bounds, client $($client.Right)x$($client.Bottom)"
        if (!$expected.maximized -and ($outer.Left -ne $expected.x -or $outer.Top -ne $expected.y)) {
            throw "Window did not restore its saved position (use a fitting seed on the current monitor)"
        }
        if ($run -eq 1) { $firstBounds = $bounds }
        if ($bounds -ne $firstBounds) { throw "Native placement drifted" }
        if (!$expected.maximized -and ($client.Right -ne $expected.width -or $client.Bottom -ne $expected.height)) {
            throw "Client size differs from saved normal geometry (use a fitting seed on the current monitor)"
        }
        if (!$process.CloseMainWindow() -or !$process.WaitForExit(30000)) { throw "Main window did not close" }
        $saved = Read-State
        if ($saved.width -ne $expected.width -or $saved.height -ne $expected.height -or
            $saved.maximized -ne $expected.maximized) { throw "Persisted state changed" }
    }
} finally {
    [void][Placement89]::SetThreadDpiAwarenessContext($dpiContext)
}
