import Foundation
import BackgroundTasks
import WidgetKit

/// Schedules and runs periodic network scans in the background via
/// `BGTaskScheduler`, posting notifications when new devices appear.
///
/// iOS decides *if and when* background refresh actually runs (based on usage,
/// battery, and the system-wide Background App Refresh setting), so this is a
/// best-effort periodic check — not a guarantee of continuous monitoring. It
/// does not run on the Simulator.
enum BackgroundScan {
    static let taskIdentifier = "com.kovyr.interior.backgroundRefresh"
    static let enabledKey = "backgroundScanEnabled"

    static var isEnabled: Bool {
        UserDefaults.standard.bool(forKey: enabledKey)
    }

    static func setEnabled(_ enabled: Bool) {
        UserDefaults.standard.set(enabled, forKey: enabledKey)
        if enabled { schedule() } else { cancel() }
    }

    /// Must be called once at launch, before the app finishes launching.
    static func register() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: taskIdentifier, using: nil) { task in
            guard let refreshTask = task as? BGAppRefreshTask else {
                task.setTaskCompleted(success: false)
                return
            }
            handle(refreshTask)
        }
    }

    static func schedule() {
        guard isEnabled else { return }
        let request = BGAppRefreshTaskRequest(identifier: taskIdentifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 60 * 60) // ~hourly
        try? BGTaskScheduler.shared.submit(request)
    }

    static func cancel() {
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: taskIdentifier)
    }

    private static func handle(_ task: BGAppRefreshTask) {
        schedule() // chain the next occurrence

        let work = Task {
            await run()
            task.setTaskCompleted(success: true)
        }
        task.expirationHandler = { work.cancel() }
    }

    /// A headless scan (no UI, no Bonjour) suitable for the short background
    /// window: sweeps the subnet, reconciles against the store, and notifies.
    @MainActor
    static func run() async {
        guard let network = LocalNetworkInfo.current() else { return }

        var devices: [DiscoveredDevice] = [
            DiscoveredDevice(ipAddress: network.ipAddress, isSelf: true)
        ]

        for chunk in network.hostAddresses.chunked(into: 48) {
            if Task.isCancelled { break }
            let gateway = network.gatewayGuess
            let selfIP = network.ipAddress
            let found = await withTaskGroup(of: DiscoveredDevice?.self) { group -> [DiscoveredDevice] in
                for ip in chunk {
                    group.addTask {
                        await NetworkScanner.probeHost(ip: ip, gateway: gateway, selfIP: selfIP, timeout: 1.0)
                    }
                }
                var accumulated: [DiscoveredDevice] = []
                for await device in group where device != nil {
                    accumulated.append(device!)
                }
                return accumulated
            }
            devices.append(contentsOf: found)
        }

        let store = DeviceStore()
        let newKeys = store.reconcile(devices)
        let newDevices = devices.filter { newKeys.contains($0.identityKey) }
        NotificationManager.shared.notifyNewDevices(newDevices)
        SharedState.save(deviceCount: devices.count, newCount: newDevices.count, date: Date())
        WidgetCenter.shared.reloadAllTimelines()
    }
}
