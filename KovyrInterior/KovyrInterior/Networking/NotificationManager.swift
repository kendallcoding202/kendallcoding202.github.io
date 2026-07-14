import Foundation
import UserNotifications

/// Thin wrapper around local notifications for "new device joined" alerts.
///
/// Acts as the notification-center delegate so alerts also present while the app
/// is in the foreground (the common case, since scanning is user-initiated).
final class NotificationManager: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationManager()

    /// Key under which a new-device notification carries the target device's IP,
    /// so tapping the notification can deep-link straight to that device.
    static let deviceIPKey = "deviceIP"

    private var isAuthorized = false

    /// Invoked (on the main actor) when the user taps a "new device" notification,
    /// with the target device's IP address. Set by the app so it can navigate.
    /// If a tap arrives before this is assigned (e.g. a cold launch from the
    /// notification), the IP is buffered and delivered as soon as it is set.
    var onOpenDevice: ((String) -> Void)? {
        didSet {
            guard let ip = bufferedDeviceIP, let handler = onOpenDevice else { return }
            bufferedDeviceIP = nil
            handler(ip)
        }
    }
    private var bufferedDeviceIP: String?

    func configure() {
        UNUserNotificationCenter.current().delegate = self
    }

    /// Removes the app-icon badge (and is safe to call any time the app becomes
    /// active). The badge is set when a new-device alert is posted, so clearing it
    /// here is what makes the alert "go away" once the user has seen it.
    func clearBadge() {
        UNUserNotificationCenter.current().setBadgeCount(0)
    }

    func requestAuthorization() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { [weak self] granted, _ in
            self?.isAuthorized = granted
        }
    }

    /// Posts one notification summarising the new devices found in a scan.
    func notifyNewDevices(_ devices: [DiscoveredDevice]) {
        guard !devices.isEmpty else { return }

        let content = UNMutableNotificationContent()
        if devices.count == 1, let device = devices.first {
            content.title = "New device joined"
            content.body = "\(device.displayName) (\(device.ipAddress))"
        } else {
            content.title = "\(devices.count) new devices joined"
            content.body = devices.prefix(4).map { $0.displayName }.joined(separator: ", ")
        }
        content.sound = .default
        content.badge = NSNumber(value: devices.count)
        // Deep-link target: tapping the alert opens this device. For a multi-device
        // alert we point at the first one.
        if let ip = devices.first?.ipAddress {
            content.userInfo[Self.deviceIPKey] = ip
        }

        let request = UNNotificationRequest(
            identifier: UUID().uuidString,
            content: content,
            trigger: nil // deliver immediately
        )
        UNUserNotificationCenter.current().add(request)
    }

    // MARK: UNUserNotificationCenterDelegate

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound])
    }

    /// The user tapped (or otherwise acted on) a delivered notification. Clear the
    /// badge and, if the alert carried a device IP, ask the app to open it.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let ip = response.notification.request.content.userInfo[Self.deviceIPKey] as? String
        Task { @MainActor in
            clearBadge()
            if let ip {
                if let handler = onOpenDevice {
                    handler(ip)
                } else {
                    bufferedDeviceIP = ip // delivered once the app wires up onOpenDevice
                }
            }
        }
        completionHandler()
    }
}
