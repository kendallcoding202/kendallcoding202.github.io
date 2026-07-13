import Foundation
import SwiftUI
import UIKit
import WidgetKit

/// Drives a full local-network scan and publishes discovered devices to the UI.
///
/// Discovery combines three signals, merged by IP address:
///  1. A concurrent TCP sweep of every host in the subnet (`HostProbe`).
///  2. Bonjour/mDNS service advertisements (`BonjourBrowser`).
///  3. Reverse DNS (`ReverseDNS`) for friendly hostnames.
@MainActor
final class NetworkScanner: ObservableObject {
    @Published private(set) var devices: [DiscoveredDevice] = []
    @Published private(set) var isScanning = false
    @Published private(set) var progress: Double = 0
    @Published private(set) var statusText = "Ready to scan"
    @Published private(set) var localNetwork: LocalNetwork?

    /// Persistent record of previously seen devices and scan history.
    let store = DeviceStore()

    private var scanTask: Task<Void, Never>?
    private var bonjour: BonjourBrowser?
    private let probeTimeout: TimeInterval = 1.2
    private let concurrency = 48

    var deviceCount: Int { devices.count }

    func startScan() {
        guard !isScanning else { return }
        scanTask = Task { await runScan() }
    }

    func stopScan() {
        scanTask?.cancel()
        bonjour?.stop()
        isScanning = false
        statusText = devices.isEmpty ? "Scan stopped" : "\(devices.count) devices found"
    }

    private func runScan() async {
        isScanning = true
        progress = 0
        devices = []
        statusText = "Reading Wi-Fi network…"

        guard let network = LocalNetworkInfo.current() else {
            statusText = "Not connected to Wi-Fi"
            isScanning = false
            return
        }
        localNetwork = network

        // Seed the list with this device so it always appears.
        upsert(DiscoveredDevice(
            ipAddress: network.ipAddress,
            hostname: UIDevice.current.name,
            isSelf: true
        ))

        // Bonjour runs alongside the sweep and merges in as results arrive.
        let browser = BonjourBrowser()
        browser.onDiscover = { [weak self] discovery in
            self?.mergeBonjour(discovery, gateway: network.gatewayGuess)
        }
        browser.start()
        bonjour = browser

        let hosts = network.hostAddresses
        let total = max(hosts.count, 1)
        var completed = 0

        for chunk in hosts.chunked(into: concurrency) {
            if Task.isCancelled { break }
            let gateway = network.gatewayGuess
            let selfIP = network.ipAddress
            let timeout = probeTimeout

            await withTaskGroup(of: DiscoveredDevice?.self) { group in
                for ip in chunk {
                    group.addTask {
                        await Self.probeHost(ip: ip, gateway: gateway, selfIP: selfIP, timeout: timeout)
                    }
                }
                for await device in group {
                    completed += 1
                    progress = Double(completed) / Double(total)
                    statusText = "Scanning \(completed)/\(total)…"
                    if let device { upsert(device) }
                }
            }
        }

        // Give Bonjour a moment to finish resolving late responders.
        try? await Task.sleep(nanoseconds: 1_500_000_000)
        bonjour?.stop()

        if !Task.isCancelled {
            let newCount = reconcileAndNotify()
            SharedState.save(deviceCount: devices.count, newCount: newCount, date: Date())
            WidgetCenter.shared.reloadAllTimelines()
            statusText = "\(devices.count) device\(devices.count == 1 ? "" : "s") found"
            progress = 1
        }
        isScanning = false
    }

    /// Compares the finished scan with the persistent store, flags new devices
    /// and posts a "new device joined" notification. Returns the new-device count.
    @discardableResult
    private func reconcileAndNotify() -> Int {
        let newKeys = store.reconcile(devices)
        guard !newKeys.isEmpty else { return 0 }
        for index in devices.indices where newKeys.contains(devices[index].identityKey) {
            devices[index].isNew = true
        }
        let newDevices = devices.filter { newKeys.contains($0.identityKey) }
        NotificationManager.shared.notifyNewDevices(newDevices)
        return newDevices.count
    }

    /// Probes a single host off the main actor. Returns a device only if alive.
    nonisolated static func probeHost(
        ip: String,
        gateway: String,
        selfIP: String,
        timeout: TimeInterval
    ) async -> DiscoveredDevice? {
        guard ip != selfIP else { return nil } // self already seeded
        let result = await HostProbe.discover(ip: ip, ports: PortCatalog.discoveryPorts, timeout: timeout)
        guard result.alive else { return nil }

        let hostname = ReverseDNS.hostname(for: ip)
        let openPorts = result.openPorts.map {
            PortInfo(port: Int($0), serviceName: PortCatalog.serviceName(for: Int($0)))
        }
        return DiscoveredDevice(
            ipAddress: ip,
            hostname: hostname,
            openPorts: openPorts,
            isRouter: ip == gateway
        )
    }

    /// Inserts or merges a device, keeping the list sorted by numeric IP.
    private func upsert(_ device: DiscoveredDevice) {
        if let index = devices.firstIndex(where: { $0.ipAddress == device.ipAddress }) {
            var existing = devices[index]
            existing.hostname = existing.hostname ?? device.hostname
            existing.bonjourName = existing.bonjourName ?? device.bonjourName
            existing.isRouter = existing.isRouter || device.isRouter
            existing.isSelf = existing.isSelf || device.isSelf
            existing.openPorts = mergePorts(existing.openPorts, device.openPorts)
            existing.services = mergeServices(existing.services, device.services)
            devices[index] = existing
        } else {
            devices.append(device)
        }
        devices.sort { $0.sortKey < $1.sortKey }
    }

    private func mergeBonjour(_ discovery: BonjourBrowser.Discovery, gateway: String) {
        let service = BonjourService(name: discovery.name, type: discovery.type)
        if let index = devices.firstIndex(where: { $0.ipAddress == discovery.ip }) {
            var existing = devices[index]
            if !existing.services.contains(service) { existing.services.append(service) }
            if existing.bonjourName == nil { existing.bonjourName = discovery.name }
            devices[index] = existing
        } else {
            upsert(DiscoveredDevice(
                ipAddress: discovery.ip,
                bonjourName: discovery.name,
                services: [service],
                isRouter: discovery.ip == gateway
            ))
        }
    }

    private func mergePorts(_ lhs: [PortInfo], _ rhs: [PortInfo]) -> [PortInfo] {
        var combined = lhs
        for port in rhs where !combined.contains(port) { combined.append(port) }
        return combined.sorted { $0.port < $1.port }
    }

    private func mergeServices(_ lhs: [BonjourService], _ rhs: [BonjourService]) -> [BonjourService] {
        var combined = lhs
        for service in rhs where !combined.contains(service) { combined.append(service) }
        return combined
    }
}

extension Array {
    /// Splits the array into consecutive chunks of at most `size` elements.
    func chunked(into size: Int) -> [[Element]] {
        guard size > 0 else { return [self] }
        return stride(from: 0, to: count, by: size).map {
            Array(self[$0..<Swift.min($0 + size, count)])
        }
    }
}
