import Foundation
import UserNotifications

/// Thin wrapper around local notifications for "new device joined" alerts.
///
/// Acts as the notification-center delegate so alerts also present while the app
/// is in the foreground (the common case, since scanning is user-initiated).
final class NotificationManager: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationManager()

    private var isAuthorized = false

    func configure() {
        UNUserNotificationCenter.current().delegate = self
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
}
