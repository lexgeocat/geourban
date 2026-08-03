use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessMemory {
    pub rss_bytes: u64,
    pub private_bytes: u64,
    pub peak_rss_bytes: u64,
}
#[tauri::command]
pub fn process_memory() -> Option<ProcessMemory> {
    read_process_memory()
}

#[cfg(target_os = "windows")]
fn read_process_memory() -> Option<ProcessMemory> {
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::System::ProcessStatus::{
        GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS,
    };
    use windows_sys::Win32::System::Threading::GetCurrentProcess;

    unsafe {
        let handle: HANDLE = GetCurrentProcess();
        let mut pmc: PROCESS_MEMORY_COUNTERS = std::mem::zeroed();
        let size = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
        if GetProcessMemoryInfo(handle, &mut pmc, size) == 0 {
            log::warn!(
                "process_memory: GetProcessMemoryInfo falló (error {}",
                std::io::Error::last_os_error().raw_os_error().unwrap_or(-1)
            );
            return None;
        }
        Some(ProcessMemory {
            rss_bytes: pmc.WorkingSetSize as u64,
            private_bytes: pmc.PagefileUsage as u64,
            peak_rss_bytes: pmc.PeakWorkingSetSize as u64,
        })
    }
}

#[cfg(target_os = "linux")]
fn read_process_memory() -> Option<ProcessMemory> {
    fn parse_kb(value: &str) -> Option<u64> {
        let kb: u64 = value.trim().split_whitespace().next()?.parse().ok()?;
        Some(kb.saturating_mul(1024))
    }

    let status = std::fs::read_to_string("/proc/self/status").ok()?;
    let mut rss = None;
    let mut peak = None;
    let mut data = None;
    for line in status.lines() {
        if let Some(v) = line.strip_prefix("VmRSS:") {
            rss = parse_kb(v);
        } else if let Some(v) = line.strip_prefix("VmHWM:") {
            peak = parse_kb(v);
        } else if let Some(v) = line.strip_prefix("VmData:") {
            data = parse_kb(v);
        }
    }
    let rss = rss?;
    Some(ProcessMemory {
        rss_bytes: rss,
        private_bytes: data.unwrap_or(rss),
        peak_rss_bytes: peak.unwrap_or(0),
    })
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
fn read_process_memory() -> Option<ProcessMemory> {
    None
}
